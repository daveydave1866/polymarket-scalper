/**
 * NWS-based weather signal generator for Polymarket temperature bucket markets.
 *
 * Strategy (from alteregoeth-ai/weatherbot):
 *  1. For each weather market, parse city + date + temperature condition from the question
 *  2. Fetch the NWS hourly forecast for that city's airport station (Polymarket resolves on
 *     airport weather stations, not city centres — e.g. NYC = LaGuardia KLGA not Manhattan)
 *  3. Estimate P(condition is true) via a normal distribution centred on the NWS high
 *     temperature (σ = 4 °F, typical 1-3 day forecast error)
 *  4. Edge = forecast_probability − market_price.  Insert a signal if edge ≥ minEdge.
 */

import { db, signalsTable, marketsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// City → airport station (lat/lon)
// Polymarket temperature markets resolve on these specific airport stations.
// ---------------------------------------------------------------------------
const WEATHER_CITIES: Array<{
  aliases: string[];
  lat: number;
  lon: number;
}> = [
  { aliases: ["new york", "nyc", "ny", "new york city"],      lat: 40.7769, lon: -73.8740 },
  { aliases: ["dallas"],                                        lat: 32.8471, lon: -96.8517 },
  { aliases: ["chicago"],                                       lat: 41.9742, lon: -87.9073 },
  { aliases: ["los angeles", "la ", "l.a."],                   lat: 33.9425, lon: -118.4081 },
  { aliases: ["miami"],                                         lat: 25.7959, lon: -80.2870  },
  { aliases: ["san francisco", " sf ", "s.f."],                lat: 37.6213, lon: -122.3790 },
];

function cityCoords(question: string): { lat: number; lon: number } | null {
  const q = question.toLowerCase();
  for (const city of WEATHER_CITIES) {
    if (city.aliases.some((a) => q.includes(a.trim()))) return { lat: city.lat, lon: city.lon };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Temperature condition parsed from a market question
// ---------------------------------------------------------------------------
type TempCondition =
  | { type: "above"; temp: number }
  | { type: "below"; temp: number }
  | { type: "range"; low: number; high: number }
  | { type: "exact"; temp: number };

function parseCondition(question: string): TempCondition | null {
  const q = question.toLowerCase().replace(/°f/g, "").replace(/℉/g, "");

  // "between X and Y" or "X-Y" or "X to Y"
  const rangePat = /between\s+(\d+(?:\.\d+)?)\s*(?:and|-|to)\s*(\d+(?:\.\d+)?)/;
  const dashPat  = /(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:f|degrees)?/;
  let m = q.match(rangePat) ?? q.match(dashPat);
  if (m) return { type: "range", low: parseFloat(m[1]), high: parseFloat(m[2]) };

  // "X or higher" / "at least X" / "X or above"
  const abovePat = /(\d+(?:\.\d+)?)\s*(?:or\s+(?:higher|above|more)|°?\s*or\s+higher|°?\s*or\s+above)|at\s+least\s+(\d+(?:\.\d+)?)/;
  m = q.match(abovePat);
  if (m) return { type: "above", temp: parseFloat(m[1] ?? m[2]) };

  // "X or lower" / "at most X" / "X or below"
  const belowPat = /(\d+(?:\.\d+)?)\s*(?:or\s+(?:lower|below|less)|°?\s*or\s+lower|°?\s*or\s+below)|at\s+most\s+(\d+(?:\.\d+)?)/;
  m = q.match(belowPat);
  if (m) return { type: "below", temp: parseFloat(m[1] ?? m[2]) };

  // bare number — "Will the high be 72"
  const exactPat = /(?:be|reach|hit|of)\s+(\d+(?:\.\d+)?)/;
  m = q.match(exactPat);
  if (m) return { type: "exact", temp: parseFloat(m[1]) };

  return null;
}

// ---------------------------------------------------------------------------
// Target date extracted from the question ("on June 5", "on Jun 5, 2025", etc.)
// ---------------------------------------------------------------------------
function parseTargetDate(question: string): Date | null {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    january: 0, february: 1, march: 2, april: 3, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };

  const pat = /(?:on\s+)?([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/i;
  const m = question.match(pat);
  if (!m) return null;

  const monthNum = months[m[1].toLowerCase()];
  if (monthNum === undefined) return null;

  const day = parseInt(m[2], 10);
  const year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
  const d = new Date(year, monthNum, day);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// NWS forecast cache (per lat/lon, 30-min TTL) to stay within rate limits
// ---------------------------------------------------------------------------
const nwsForecastCache = new Map<string, { fetchedAt: number; highTemps: Map<string, number> }>();
const NWS_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Returns a map of dateKey ("YYYY-MM-DD") → predicted high temperature (°F)
 * for the next 7 days, using the NWS hourly forecast for the given coordinates.
 */
async function fetchNWSHighTemps(lat: number, lon: number): Promise<Map<string, number>> {
  const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = nwsForecastCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < NWS_CACHE_TTL_MS) {
    return cached.highTemps;
  }

  const highTemps = new Map<string, number>();

  try {
    // Step 1: resolve grid endpoint
    const pointsRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
      headers: { "User-Agent": "polymarket-scalper/1.0 (automated trading bot)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!pointsRes.ok) {
      logger.warn({ lat, lon, status: pointsRes.status }, "NWS points API returned non-200");
      return highTemps;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pointsData = await pointsRes.json() as any;
    const hourlyUrl: string = pointsData?.properties?.forecastHourly;
    if (!hourlyUrl) {
      logger.warn({ lat, lon }, "NWS points response missing forecastHourly URL");
      return highTemps;
    }

    // Step 2: fetch hourly forecast
    const hourlyRes = await fetch(hourlyUrl, {
      headers: { "User-Agent": "polymarket-scalper/1.0 (automated trading bot)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!hourlyRes.ok) {
      logger.warn({ hourlyUrl, status: hourlyRes.status }, "NWS hourly forecast returned non-200");
      return highTemps;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hourlyData = await hourlyRes.json() as any;
    const periods: Array<{ startTime: string; temperature: number; temperatureUnit: string }> =
      hourlyData?.properties?.periods ?? [];

    // Build daily high from hourly temps (daytime hours 06:00-21:00 local)
    for (const period of periods) {
      const start = new Date(period.startTime);
      const hour  = start.getHours();
      if (hour < 6 || hour > 21) continue;

      let tempF = period.temperature;
      if (period.temperatureUnit === "C") tempF = tempF * 9 / 5 + 32;

      const dateKey = start.toISOString().slice(0, 10); // "YYYY-MM-DD"
      const existing = highTemps.get(dateKey) ?? -Infinity;
      if (tempF > existing) highTemps.set(dateKey, tempF);
    }

    nwsForecastCache.set(cacheKey, { fetchedAt: Date.now(), highTemps });
    logger.debug({ lat, lon, days: highTemps.size }, "NWS forecast cached");
  } catch (err) {
    logger.error({ err, lat, lon }, "Failed to fetch NWS forecast");
  }

  return highTemps;
}

// ---------------------------------------------------------------------------
// Normal CDF (Abramowitz & Stegun approximation) for probability estimation
// ---------------------------------------------------------------------------
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t) *
      Math.exp(-x * x);
  return sign * y;
}

function normalCDF(x: number, mean: number, sd: number): number {
  return 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
}

const FORECAST_SD_F = 4; // typical NWS 1-3 day high temp forecast error (°F)

function forecastProbability(forecastHigh: number, cond: TempCondition): number {
  switch (cond.type) {
    case "above":
      return 1 - normalCDF(cond.temp, forecastHigh, FORECAST_SD_F);
    case "below":
      return normalCDF(cond.temp, forecastHigh, FORECAST_SD_F);
    case "range":
      return (
        normalCDF(cond.high + 0.5, forecastHigh, FORECAST_SD_F) -
        normalCDF(cond.low  - 0.5, forecastHigh, FORECAST_SD_F)
      );
    case "exact":
      return (
        normalCDF(cond.temp + 0.5, forecastHigh, FORECAST_SD_F) -
        normalCDF(cond.temp - 0.5, forecastHigh, FORECAST_SD_F)
      );
  }
}

// ---------------------------------------------------------------------------
// Main export: generate NWS-backed signals for weather category markets
// ---------------------------------------------------------------------------
export async function generateWeatherSignals(minEdge: number): Promise<number> {
  const weatherMarkets = await db
    .select()
    .from(marketsTable)
    .where(eq(marketsTable.category, "weather"));

  if (weatherMarkets.length === 0) return 0;

  let generated = 0;

  for (const market of weatherMarkets) {
    try {
      const coords = cityCoords(market.question);
      if (!coords) {
        logger.debug({ marketId: market.id }, "Weather signal skipped: no city match");
        continue;
      }

      const cond = parseCondition(market.question);
      if (!cond) {
        logger.debug({ marketId: market.id }, "Weather signal skipped: could not parse temperature condition");
        continue;
      }

      const targetDate = parseTargetDate(market.question);
      if (!targetDate) {
        logger.debug({ marketId: market.id }, "Weather signal skipped: could not parse target date");
        continue;
      }

      // Skip markets expiring in the past or more than 7 days away (NWS forecast range)
      const daysOut = (targetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysOut < 0 || daysOut > 7) continue;

      const highTemps = await fetchNWSHighTemps(coords.lat, coords.lon);
      const dateKey = targetDate.toISOString().slice(0, 10);
      const forecastHigh = highTemps.get(dateKey);

      if (forecastHigh === undefined) {
        logger.debug({ marketId: market.id, dateKey }, "Weather signal skipped: no NWS data for target date");
        continue;
      }

      const forecastProb = forecastProbability(forecastHigh, cond);

      // Decide which side to trade
      // If forecast says >50% chance → buy YES; otherwise → buy NO
      const side = forecastProb >= 0.5 ? "yes" : "no";
      const marketPrice = side === "yes" ? market.yesPrice : market.noPrice;
      const edge = forecastProb >= 0.5
        ? forecastProb - market.yesPrice
        : (1 - forecastProb) - market.noPrice;

      if (edge < minEdge) {
        logger.debug(
          { marketId: market.id, forecastHigh, forecastProb: forecastProb.toFixed(3), marketPrice, edge: edge.toFixed(3), minEdge },
          "Weather signal edge below threshold — skipped"
        );
        continue;
      }

      await db.insert(signalsTable).values({
        id: randomUUID(),
        marketId: market.id,
        side,
        confidence: Math.min(forecastProb, 1),
        edge,
        source: "nws_weather",
        notified: false,
      });

      generated++;
      logger.info(
        {
          marketId: market.id,
          question: market.question.slice(0, 80),
          city: coords,
          dateKey,
          forecastHigh,
          condition: cond,
          forecastProb: forecastProb.toFixed(3),
          side,
          marketPrice,
          edge: edge.toFixed(3),
        },
        "NWS weather signal generated"
      );
    } catch (err) {
      logger.error({ err, marketId: market.id }, "Error generating weather signal");
    }
  }

  return generated;
}
