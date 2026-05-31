import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  GetBotStatusResponseType,
  StartBotResponseType,
  StopBotResponseType,
  GetBotConfigResponseType,
  UpdateBotConfigBodyType,
  UpdateBotConfigResponseType,
  SyncMarketsResponseType,
  GetOpportunitiesResponseType,
  GetCredentialsStatusResponseType,
} from "@workspace/api-zod";

// ── Auth helper ───────────────────────────────────────────────────────────────

function getStoredKey(): string | null {
  try {
    return localStorage.getItem("bot_api_key");
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  const key = getStoredKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function customFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers as Record<string, string>) },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body?: object): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

async function apiPut<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Query keys ────────────────────────────────────────────────────────────────

export function getGetBotStatusQueryKey() {
  return ["bot", "status"] as const;
}

export function getGetBotConfigQueryKey() {
  return ["bot", "config"] as const;
}

export function getGetOpportunitiesQueryKey() {
  return ["bot", "opportunities"] as const;
}

export function getGetCredentialsStatusQueryKey() {
  return ["bot", "credentials-status"] as const;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function useGetBotStatus(options?: { query?: { enabled?: boolean; refetchInterval?: number } }) {
  return useQuery<GetBotStatusResponseType>({
    queryKey: getGetBotStatusQueryKey(),
    queryFn: () => apiFetch<GetBotStatusResponseType>("/bot/status"),
    refetchInterval: options?.query?.refetchInterval ?? 5000,
    enabled: options?.query?.enabled ?? true,
  });
}

export function useGetBotConfig(options?: { query?: { queryKey?: readonly unknown[]; enabled?: boolean } }) {
  return useQuery<GetBotConfigResponseType>({
    queryKey: options?.query?.queryKey ?? getGetBotConfigQueryKey(),
    queryFn: () => apiFetch<GetBotConfigResponseType>("/bot/config"),
    enabled: options?.query?.enabled ?? true,
  });
}

export function useGetOpportunities(options?: { query?: { refetchInterval?: number; enabled?: boolean } }) {
  return useQuery<GetOpportunitiesResponseType>({
    queryKey: getGetOpportunitiesQueryKey(),
    queryFn: () => apiFetch<GetOpportunitiesResponseType>("/bot/opportunities"),
    refetchInterval: options?.query?.refetchInterval ?? 30000,
    enabled: options?.query?.enabled ?? true,
  });
}

export function useGetCredentialsStatus(options?: { query?: { enabled?: boolean } }) {
  return useQuery<GetCredentialsStatusResponseType>({
    queryKey: getGetCredentialsStatusQueryKey(),
    queryFn: () => apiFetch<GetCredentialsStatusResponseType>("/bot/credentials-status"),
    enabled: options?.query?.enabled ?? true,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useStartBot() {
  const queryClient = useQueryClient();
  return useMutation<StartBotResponseType, Error>({
    mutationFn: () => apiPost<StartBotResponseType>("/bot/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
    },
  });
}

export function useStopBot() {
  const queryClient = useQueryClient();
  return useMutation<StopBotResponseType, Error>({
    mutationFn: () => apiPost<StopBotResponseType>("/bot/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
    },
  });
}

export function useSyncMarkets() {
  const queryClient = useQueryClient();
  return useMutation<SyncMarketsResponseType, Error>({
    mutationFn: () => apiPost<SyncMarketsResponseType>("/bot/sync-markets"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOpportunitiesQueryKey() });
    },
  });
}

export function useUpdateBotConfig() {
  return useMutation<UpdateBotConfigResponseType, Error, { data: UpdateBotConfigBodyType }>({
    mutationFn: ({ data }) => apiPut<UpdateBotConfigResponseType>("/bot/config", data),
  });
}

export function useSendReport() {
  return useMutation<{ ok: boolean }, Error>({
    mutationFn: () => apiPost<{ ok: boolean }>("/bot/send-report"),
  });
}
