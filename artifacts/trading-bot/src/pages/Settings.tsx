import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useGetBotConfig, useUpdateBotConfig, getGetBotConfigQueryKey,
  useGetCredentialsStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Save, Eye, EyeOff, CheckCircle2, Circle, AlertTriangle, Loader2,
  ChevronDown, ChevronRight, ExternalLink, Key, Wallet, Radio,
  Zap, Send, Copy, Check, RefreshCw, ArrowRight, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getStoredKey } from "@/lib/auth";

const SENTINEL = "••••••••";

const configSchema = z.object({
  mode: z.enum(["live", "paper"]),
  minEdge: z.coerce.number().min(0).max(1),
  maxPositionSize: z.coerce.number().min(1),
  maxOpenPositions: z.coerce.number().min(1),
  signalWindowSeconds: z.coerce.number().min(1),
  notifyMinEdge: z.coerce.number().min(0).max(1).optional(),
  notifyMaxPerCycle: z.coerce.number().int().min(1).max(50).optional(),
  polymarketPrivateKey: z.string().optional(),
  polymarketApiKey: z.string().optional(),
  polymarketApiSecret: z.string().optional(),
  polymarketApiPassphrase: z.string().optional(),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
  dailyReportHour: z.coerce.number().int().min(0).max(23).optional(),
  sportsApiKey: z.string().optional(),
  weatherApiKey: z.string().optional(),
});

type ConfigForm = z.infer<typeof configSchema>;

const SECRET_FIELDS: (keyof ConfigForm)[] = [
  "polymarketPrivateKey", "polymarketApiKey", "polymarketApiSecret",
  "polymarketApiPassphrase", "telegramBotToken", "sportsApiKey", "weatherApiKey",
];

async function apiPost(path: string, body: object) {
  const key = getStoredKey();
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="p-1 text-muted-foreground/50 hover:text-primary transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function RevealInput({
  value, placeholder, onChange, readOnly, monospace = true,
}: {
  value: string; placeholder?: string; onChange?: (v: string) => void;
  readOnly?: boolean; monospace?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={e => onChange?.(e.target.value)}
        className={cn(
          "rounded-none bg-background border-border h-9 text-xs pr-16 focus:border-primary/50",
          monospace && "font-mono tracking-wide",
          readOnly && "text-primary cursor-default select-all"
        )}
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
        {readOnly && <CopyButton value={value} />}
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          className="p-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          tabIndex={-1}
        >
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

function StatusPill({ set, label }: { set: boolean; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 font-mono text-[9px] border px-1.5 py-0.5 uppercase tracking-wider",
      set
        ? "text-primary border-primary/30 bg-primary/5"
        : "text-muted-foreground/50 border-border bg-muted/10"
    )}>
      {set ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Circle className="w-2.5 h-2.5" />}
      {label}
    </span>
  );
}

function StepBadge({ n, done, active }: { n: number; done?: boolean; active?: boolean }) {
  return (
    <div className={cn(
      "w-6 h-6 flex-shrink-0 flex items-center justify-center border font-mono text-[11px] font-bold transition-all",
      done  ? "border-primary/50 bg-primary/15 text-primary"
           : active ? "border-primary/30 bg-primary/8 text-primary/70"
           : "border-border/60 bg-muted/10 text-muted-foreground/40"
    )}>
      {done ? <Check className="w-3 h-3" /> : n}
    </div>
  );
}

function SectionCard({
  title, subtitle, icon: Icon, accentColor, badge, badgeColor,
  defaultOpen = true, children,
}: {
  title: string; subtitle?: string; icon: React.ElementType;
  accentColor?: string; badge?: string; badgeColor?: string;
  defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/10 transition-colors text-left group"
      >
        <div className={cn("p-1.5 border flex-shrink-0", accentColor ?? "border-border/60 bg-muted/10")}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">
              {title}
            </span>
            {badge && (
              <span className={cn(
                "font-mono text-[9px] border px-1.5 py-0.5 uppercase tracking-wider",
                badgeColor ?? "border-border text-muted-foreground"
              )}>
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="font-mono text-[10px] text-muted-foreground/60 mt-0.5">{subtitle}</p>
          )}
        </div>
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0 group-hover:text-muted-foreground transition-colors" />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0 group-hover:text-muted-foreground transition-colors" />
        }
      </button>
      {open && (
        <div className="px-5 pb-6 pt-2 border-t border-border/40 space-y-5">
          {children}
        </div>
      )}
    </div>
  );
}

function L1KeyWizard({ isSet, onSave }: { isSet: boolean; onSave: (privateKey: string) => void }) {
  const [pk, setPk] = useState("");
  const [showPk, setShowPk] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<{ address: string } | null>(null);
  const [error, setError] = useState("");

  const handleVerify = async () => {
    if (!pk.trim()) { setError("Please enter your private key."); return; }
    setVerifying(true); setError(""); setVerified(null);
    try {
      const data = await apiPost("/bot/verify-l1-key", { privateKey: pk.trim() });
      if (data.ok) setVerified({ address: data.address });
      else setError(data.error ?? "Invalid private key.");
    } catch { setError("Could not reach server."); }
    finally { setVerifying(false); }
  };

  return (
    <div className="space-y-3">
      <div className="font-mono text-[10px] text-muted-foreground/60 leading-relaxed">
        Your <span className="text-foreground">Polygon wallet private key</span> — used to sign on-chain transactions.{" "}
        Export from MetaMask: <span className="text-foreground/80">Account Details → Export Private Key</span>.
      </div>
      <div className="relative">
        <Input
          type={showPk ? "text" : "password"}
          placeholder="0xabc123… (64 hex characters)"
          value={pk}
          onChange={e => { setPk(e.target.value); setVerified(null); setError(""); }}
          className="font-mono text-xs rounded-none bg-background border-border h-9 focus:border-primary/50 pr-9 tracking-wide"
          onKeyDown={e => e.key === "Enter" && handleVerify()}
          data-testid="input-l1-key"
        />
        <button type="button" tabIndex={-1} onClick={() => setShowPk(v => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground">
          {showPk ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
      {error && (
        <div className="flex items-center gap-2 font-mono text-[10px] text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" /> {error}
        </div>
      )}
      {verified && (
        <div className="border border-primary/25 bg-primary/5 px-3 py-2.5 space-y-1">
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-primary font-bold">
            <CheckCircle2 className="w-3 h-3" /> Key verified
          </div>
          <div className="font-mono text-[9px] text-muted-foreground/70 flex items-center gap-1.5">
            Wallet: <span className="text-foreground/80 truncate">{verified.address}</span>
            <CopyButton value={verified.address} />
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handleVerify}
          disabled={verifying || !pk.trim()}
          className="font-mono text-[10px] tracking-wider rounded-none h-8 border-border hover:border-primary/40 hover:text-primary flex-1"
          data-testid="button-verify-l1">
          {verifying ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />VERIFYING…</> : <><Lock className="w-3 h-3 mr-1.5" />VERIFY KEY</>}
        </Button>
        {verified && (
          <Button type="button" size="sm" onClick={() => { onSave(pk.trim()); setPk(""); setVerified(null); }}
            className="font-mono text-[10px] tracking-wider rounded-none h-8 bg-primary text-primary-foreground flex-1"
            data-testid="button-save-l1">
            <Save className="w-3 h-3 mr-1.5" />SAVE L1 KEY
          </Button>
        )}
      </div>
    </div>
  );
}

function L2KeyGenerator({ isSet, onSave }: { isSet: boolean; onSave: (key: string, secret: string, passphrase: string) => void }) {
  const [pk, setPk] = useState("");
  const [showPk, setShowPk] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ address: string; apiKey: string; apiSecret: string; apiPassphrase: string } | null>(null);
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    if (!pk.trim()) { setError("Enter your L1 private key."); return; }
    setGenerating(true); setError(""); setResult(null);
    try {
      const data = await apiPost("/bot/generate-l2-keys", { privateKey: pk.trim() });
      if (data.ok) setResult(data);
      else setError(data.error ?? "Generation failed.");
    } catch { setError("Could not reach server."); }
    finally { setGenerating(false); }
  };

  return (
    <div className="space-y-4">
      <div className="font-mono text-[10px] text-muted-foreground/60 leading-relaxed">
        L2 credentials are <span className="text-foreground">generated from your L1 wallet key</span> — required for order placement.
      </div>
      <div className="relative">
        <Input
          type={showPk ? "text" : "password"}
          placeholder="0xabc123… (your wallet private key)"
          value={pk}
          onChange={e => { setPk(e.target.value); setResult(null); setError(""); }}
          className="font-mono text-xs rounded-none bg-background border-border h-9 focus:border-primary/50 pr-9 tracking-wide"
          data-testid="input-l2-pk"
        />
        <button type="button" tabIndex={-1} onClick={() => setShowPk(v => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground">
          {showPk ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
      {error && (
        <div className="flex items-start gap-2 font-mono text-[10px] text-red-400 border border-red-400/20 bg-red-400/5 px-3 py-2">
          <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" /> {error}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" onClick={handleGenerate}
        disabled={generating || !pk.trim()}
        className="w-full font-mono text-[10px] tracking-widest rounded-none h-9 border-primary/30 text-primary hover:bg-primary/10"
        data-testid="button-generate-l2">
        {generating
          ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />GENERATING…</>
          : <><RefreshCw className="w-3 h-3 mr-2" />{isSet ? "RE-GENERATE L2 CREDENTIALS" : "GENERATE L2 CREDENTIALS"}</>
        }
      </Button>
      {result && (
        <div className="border border-primary/25 bg-primary/3 space-y-3 p-4">
          <div className="flex items-center gap-2 font-mono text-xs text-primary font-bold">
            <CheckCircle2 className="w-4 h-4" />
            Credentials generated for {result.address.slice(0, 6)}…{result.address.slice(-4)}
          </div>
          <div className="font-mono text-[10px] text-amber-400/80 border border-amber-400/20 bg-amber-400/5 px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
            Save these now — they won't be shown again in plain text after you save.
          </div>
          {[
            { label: "API Key",        value: result.apiKey        },
            { label: "API Secret",     value: result.apiSecret     },
            { label: "API Passphrase", value: result.apiPassphrase },
          ].map(({ label, value }) => (
            <div key={label} className="space-y-1">
              <div className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest">{label}</div>
              <RevealInput value={value} readOnly />
            </div>
          ))}
          <Button type="button" size="sm"
            onClick={() => { if (result) { onSave(result.apiKey, result.apiSecret, result.apiPassphrase); setPk(""); setResult(null); } }}
            className="w-full font-mono text-[10px] tracking-widest rounded-none h-9 bg-primary text-primary-foreground hover:bg-primary/90"
            data-testid="button-save-l2">
            <Save className="w-3.5 h-3.5 mr-2" />SAVE ALL L2 CREDENTIALS TO BOT
          </Button>
        </div>
      )}
    </div>
  );
}

function TelegramSetup({ hasBotToken, hasChatId, control, form }: {
  hasBotToken: boolean; hasChatId: boolean; control: unknown; form: ReturnType<typeof useForm<ConfigForm>>;
}) {
  const [showToken, setShowToken] = useState(false);
  const steps = [
    { n: 1, label: "Create a bot via @BotFather", done: hasBotToken },
    { n: 2, label: "Add your Chat ID", done: hasChatId },
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            <StepBadge n={s.n} done={s.done} active={!s.done && (i === 0 || steps[i-1]?.done)} />
            <span className={cn("font-mono text-[10px]", s.done ? "text-primary" : "text-muted-foreground/50")}>{s.label}</span>
            {i < steps.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground/30 mx-1" />}
          </div>
        ))}
      </div>
      <div className={cn("space-y-3 p-4 border", hasBotToken ? "border-primary/15 bg-primary/3" : "border-sky-400/15 bg-sky-400/3")}>
        <div className="flex items-center gap-2">
          <StepBadge n={1} done={hasBotToken} active={!hasBotToken} />
          <span className="font-mono text-xs font-bold text-foreground/90">Create a Telegram bot</span>
        </div>
        <ol className="font-mono text-[10px] text-muted-foreground/60 space-y-1 leading-relaxed ml-8">
          <li>1. Search for <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-sky-400/80 underline underline-offset-2 inline-flex items-center gap-0.5">@BotFather <ExternalLink className="w-2.5 h-2.5" /></a></li>
          <li>2. Send <code className="bg-muted/40 px-1 py-0.5 text-[9px]">/newbot</code></li>
          <li>3. Copy the token (e.g. <code className="bg-muted/40 px-1 py-0.5 text-[9px]">1234567890:ABCdef…</code>)</li>
        </ol>
        <FormField control={control as never} name="telegramBotToken" render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-[10px] uppercase tracking-widest flex items-center gap-2">
              Bot Token <StatusPill set={hasBotToken} label={hasBotToken ? "Set" : "Not set"} />
            </FormLabel>
            <FormControl>
              <div className="relative">
                <Input type={showToken ? "text" : "password"}
                  placeholder="1234567890:ABCdefGHIjklMNOpqrSTU…"
                  {...field}
                  value={field.value === SENTINEL ? "" : (field.value ?? "")}
                  className="font-mono text-xs rounded-none bg-background border-border h-9 focus:border-sky-400/50 pr-9 tracking-wide"
                  data-testid="input-telegram-token"
                />
                <button type="button" tabIndex={-1} onClick={() => setShowToken(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground">
                  {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </FormControl>
            <FormDescription className="font-mono text-[9px] text-muted-foreground/50">
              {hasBotToken ? "Leave blank to keep existing token." : "Paste the token from @BotFather here."}
            </FormDescription>
            <FormMessage className="font-mono text-[10px]" />
          </FormItem>
        )} />
      </div>
      <div className={cn("space-y-3 p-4 border", hasChatId ? "border-primary/15 bg-primary/3" : "border-sky-400/15 bg-sky-400/3")}>
        <div className="flex items-center gap-2">
          <StepBadge n={2} done={hasChatId} active={hasBotToken && !hasChatId} />
          <span className="font-mono text-xs font-bold text-foreground/90">Your username or Chat ID</span>
        </div>
        <FormField control={control as never} name="telegramChatId" render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-[10px] uppercase tracking-widest flex items-center gap-2">
              Username / Chat ID <StatusPill set={hasChatId} label={hasChatId ? "Set" : "Not set"} />
            </FormLabel>
            <FormControl>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted-foreground/40 text-xs select-none pointer-events-none">@</span>
                <Input placeholder="yourusername   or   -1001234567890" {...field}
                  className="font-mono text-xs rounded-none bg-background border-border h-9 focus:border-sky-400/50 pl-7"
                  data-testid="input-telegram-chatid"
                />
              </div>
            </FormControl>
            <FormMessage className="font-mono text-[10px]" />
          </FormItem>
        )} />
      </div>
      <div className="space-y-3 p-4 border border-primary/15 bg-primary/3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-foreground/90">Daily Report Time (UTC)</span>
        </div>
        <FormField control={form.control} name="dailyReportHour" defaultValue={8} render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-[10px] uppercase tracking-widest">
              Send daily P&amp;L summary at hour (UTC 0–23)
            </FormLabel>
            <FormControl>
              <Input
                type="number"
                min={0}
                max={23}
                step={1}
                placeholder="8"
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                value={typeof field.value === "number" ? field.value : 8}
                onChange={(e) => field.onChange(e.target.valueAsNumber)}
                className="font-mono text-xs rounded-none bg-background border-border h-9 focus:border-sky-400/50 w-24"
              />
            </FormControl>
            <FormDescription className="font-mono text-[9px] text-muted-foreground/50">
              Default: 8 = 08:00 UTC. Bot must be running for the report to send.
            </FormDescription>
            <FormMessage className="font-mono text-[10px]" />
          </FormItem>
        )} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          { icon: "📡", label: "Signal fired alerts" },
          { icon: "⚡", label: "Trade execution alerts" },
          { icon: "📈", label: "Configurable daily P&L" },
          { icon: "🚨", label: "Error & crash warnings" },
        ].map(({ icon, label }) => (
          <div key={label} className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground/60 border border-border/40 bg-muted/5 px-3 py-2">
            <span>{icon}</span> {label}
          </div>
        ))}
      </div>
    </div>
  );
}

type CredSource = "env" | "db" | "none";
function SourceBadge({ source }: { source: CredSource }) {
  const styles: Record<CredSource, string> = {
    env: "border-sky-400/30 text-sky-400 bg-sky-400/5",
    db:  "border-primary/30 text-primary bg-primary/5",
    none: "border-border/40 text-muted-foreground/40 bg-transparent",
  };
  const labels: Record<CredSource, string> = { env: "ENV", db: "DB", none: "—" };
  return (
    <span className={`font-mono text-[8px] border px-1.5 py-0.5 uppercase tracking-widest ${styles[source]}`}>
      {labels[source]}
    </span>
  );
}

function CredentialsStatusPanel() {
  const { data, isLoading } = useGetCredentialsStatus();

  const groups = [
    { key: "polymarket" as const, label: "Polymarket" },
    { key: "telegram"   as const, label: "Telegram"   },
    { key: "sportsApi"  as const, label: "Sports API"  },
    { key: "weatherApi" as const, label: "Weather API" },
  ];

  return (
    <div className="border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border/40 flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
          Credential Status
        </span>
        {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/40" />}
      </div>
      <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {groups.map(({ key, label }) => {
          const group = data?.[key];
          const configured = group?.configured ?? false;
          const source = (group?.source ?? "none") as CredSource;
          return (
            <div key={key} className="space-y-1.5">
              <div className="font-mono text-[9px] text-muted-foreground/50 uppercase tracking-widest">{label}</div>
              <div className="flex items-center gap-1.5">
                {configured
                  ? <CheckCircle2 className="w-3 h-3 text-primary flex-shrink-0" />
                  : <Circle className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                }
                <span className={`font-mono text-[10px] ${configured ? "text-primary" : "text-muted-foreground/40"}`}>
                  {configured ? "Set" : "Not set"}
                </span>
                {!isLoading && <SourceBadge source={source} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useGetBotConfig({ query: { queryKey: getGetBotConfigQueryKey() } });
  const updateConfig = useUpdateBotConfig();

  const form = useForm<ConfigForm>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      mode: "paper", minEdge: 0.05, maxPositionSize: 100,
      maxOpenPositions: 5, signalWindowSeconds: 300, dailyReportHour: 8,
      notifyMinEdge: 0.10, notifyMaxPerCycle: 5,
    },
  });

  const watchedMode = form.watch("mode");
  const hasL1  = !!config?.polymarketPrivateKey;
  const hasL2  = !!(config?.polymarketApiKey && config?.polymarketApiSecret && config?.polymarketApiPassphrase);
  const hasTg  = !!(config?.telegramBotToken && config?.telegramChatId);
  const liveReady = hasL1 && hasL2;

  useEffect(() => {
    if (config) {
      form.reset({
        mode: config.mode as "live" | "paper",
        minEdge: config.minEdge,
        maxPositionSize: config.maxPositionSize,
        maxOpenPositions: config.maxOpenPositions,
        signalWindowSeconds: config.signalWindowSeconds,
        notifyMinEdge: config.notifyMinEdge ?? 0.10,
        notifyMaxPerCycle: config.notifyMaxPerCycle ?? 5,
        polymarketPrivateKey: "", polymarketApiKey: "", polymarketApiSecret: "",
        polymarketApiPassphrase: "", telegramBotToken: "",
        telegramChatId: config.telegramChatId ?? "",
        dailyReportHour: config.dailyReportHour ?? 8,
        sportsApiKey: "", weatherApiKey: "",
      });
    }
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveL1Key = useCallback((privateKey: string) => {
    updateConfig.mutate({ data: { polymarketPrivateKey: privateKey } as never }, {
      onSuccess: () => {
        toast({ title: "L1 key saved", description: "Wallet private key stored securely." });
        queryClient.invalidateQueries({ queryKey: getGetBotConfigQueryKey() });
      },
      onError: () => toast({ variant: "destructive", title: "Error", description: "Failed to save L1 key." }),
    });
  }, [updateConfig, toast, queryClient]);

  const saveL2Keys = useCallback((apiKey: string, apiSecret: string, apiPassphrase: string) => {
    updateConfig.mutate(
      { data: { polymarketApiKey: apiKey, polymarketApiSecret: apiSecret, polymarketApiPassphrase: apiPassphrase } as never },
      {
        onSuccess: () => {
          toast({ title: "L2 credentials saved" });
          queryClient.invalidateQueries({ queryKey: getGetBotConfigQueryKey() });
        },
        onError: () => toast({ variant: "destructive", title: "Error", description: "Failed to save L2 credentials." }),
      }
    );
  }, [updateConfig, toast, queryClient]);

  const onSubmit = (values: ConfigForm) => {
    const payload = { ...values } as Record<string, unknown>;
    for (const k of SECRET_FIELDS) {
      if (!payload[k] || payload[k] === "" || payload[k] === SENTINEL) delete payload[k];
    }
    updateConfig.mutate({ data: payload as never }, {
      onSuccess: (newConfig) => {
        toast({ title: "Configuration saved" });
        queryClient.setQueryData(getGetBotConfigQueryKey(), newConfig);
        form.reset({
          ...form.getValues(),
          polymarketPrivateKey: "", polymarketApiKey: "", polymarketApiSecret: "",
          polymarketApiPassphrase: "", telegramBotToken: "", sportsApiKey: "", weatherApiKey: "",
        });
      },
      onError: () => toast({ variant: "destructive", title: "Error", description: "Failed to update configuration." }),
    });
  };

  if (isLoading) return (
    <div className="flex items-center gap-2 p-8 font-mono text-muted-foreground text-xs">
      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading configuration…
    </div>
  );

  return (
    <div className="max-w-2xl space-y-4 animate-fade-up">
      <div>
        <h1 className="text-3xl font-bold font-mono tracking-tight">SETTINGS</h1>
        <p className="font-mono text-xs text-muted-foreground/60 mt-1 uppercase tracking-wider">
          Bot configuration and API credentials
        </p>
      </div>

      <CredentialsStatusPanel />

      {watchedMode === "live" && (
        <div className={cn(
          "border px-4 py-3 flex items-start gap-3 font-mono text-xs",
          liveReady ? "border-primary/30 bg-primary/5 text-primary" : "border-amber-400/30 bg-amber-400/5 text-amber-400"
        )}>
          {liveReady ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
          <div>
            <div className="font-bold uppercase tracking-wider mb-0.5">
              {liveReady ? "Live trading ready — real funds will be used" : "Credentials required for live trading"}
            </div>
            <div className="text-[10px] opacity-70">
              {liveReady
                ? "L1 wallet key and L2 API credentials are configured."
                : `Still needed: ${[!hasL1 && "L1 wallet key", !hasL2 && "L2 API credentials"].filter(Boolean).join(", ")}.`
              }
            </div>
          </div>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <SectionCard title="Execution Parameters" subtitle="Trading thresholds and risk controls" icon={Zap}
            accentColor="border-primary/30 bg-primary/8 text-primary">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="mode" render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-[10px] uppercase tracking-widest">Mode</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className={cn("font-mono text-xs rounded-none bg-background border-border h-9",
                        field.value === "live" && "border-amber-400/40 text-amber-400")}
                        data-testid="select-mode">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="font-mono rounded-none">
                      <SelectItem value="paper">📋  Paper (Simulation)</SelectItem>
                      <SelectItem value="live">⚡  Live (Real Funds)</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              {([
                { name: "minEdge" as const, label: "Min Edge", desc: "0.05 = 5% required edge to trade", step: "0.01" },
                { name: "maxPositionSize" as const, label: "Max Position $", desc: "Max USDC per position", step: "1" },
                { name: "maxOpenPositions" as const, label: "Max Open Pos.", desc: "Hard cap on concurrent trades", step: "1" },
                { name: "signalWindowSeconds" as const, label: "Signal Expiry (s)", desc: "Seconds before signal discarded", step: "1" },
                { name: "notifyMinEdge" as const, label: "Notify Min Edge", desc: "Min edge to fire Telegram alert (e.g. 0.10)", step: "0.01" },
                { name: "notifyMaxPerCycle" as const, label: "Max Alerts/Cycle", desc: "Cap on Telegram signal alerts per scan", step: "1" },
              ]).map(({ name, label, desc, step }) => (
                <FormField key={name} control={form.control} name={name} render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-[10px] uppercase tracking-widest">{label}</FormLabel>
                    <FormControl>
                      <Input type="number" step={step} {...field}
                        className="font-mono text-xs rounded-none bg-background border-border h-9 focus:border-primary/50 tabular-nums"
                        data-testid={`input-${name}`} />
                    </FormControl>
                    <FormDescription className="font-mono text-[9px] text-muted-foreground/50">{desc}</FormDescription>
                    <FormMessage className="font-mono text-[10px]" />
                  </FormItem>
                )} />
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Polymarket — L1 Wallet Key" subtitle="Your Polygon wallet private key for on-chain signing"
            icon={Wallet} accentColor="border-amber-400/30 bg-amber-400/8 text-amber-400"
            badge={hasL1 ? "SET" : "REQUIRED FOR LIVE"}
            badgeColor={hasL1 ? "border-primary/30 text-primary bg-primary/8" : "border-amber-400/30 text-amber-400/80"}>
            <L1KeyWizard isSet={hasL1} onSave={saveL1Key} />
          </SectionCard>

          <SectionCard title="Polymarket — L2 API Credentials" subtitle="Generated from your L1 key — required for order placement"
            icon={Key} accentColor="border-primary/30 bg-primary/8 text-primary"
            badge={hasL2 ? "SET" : "REQUIRED FOR LIVE"}
            badgeColor={hasL2 ? "border-primary/30 text-primary bg-primary/8" : "border-amber-400/30 text-amber-400/80"}>
            <div className="flex gap-2">
              <StatusPill set={!!config?.polymarketApiKey}        label="API Key"    />
              <StatusPill set={!!config?.polymarketApiSecret}     label="Secret"     />
              <StatusPill set={!!config?.polymarketApiPassphrase} label="Passphrase" />
            </div>
            <L2KeyGenerator isSet={hasL2} onSave={saveL2Keys} />
            <details className="group">
              <summary className="font-mono text-[10px] text-muted-foreground/50 hover:text-muted-foreground cursor-pointer list-none flex items-center gap-1.5 select-none">
                <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                Paste credentials manually instead
              </summary>
              <div className="mt-3 space-y-3 pt-3 border-t border-border/40">
                {([
                  { name: "polymarketApiKey" as const,        label: "API Key",        isSet: !!config?.polymarketApiKey        },
                  { name: "polymarketApiSecret" as const,     label: "API Secret",     isSet: !!config?.polymarketApiSecret     },
                  { name: "polymarketApiPassphrase" as const, label: "API Passphrase", isSet: !!config?.polymarketApiPassphrase },
                ]).map(({ name, label, isSet }) => (
                  <FormField key={name} control={form.control} name={name} render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-[10px] uppercase tracking-widest flex items-center gap-2">
                        {label} <StatusPill set={isSet} label={isSet ? "Set" : "Not set"} />
                      </FormLabel>
                      <FormControl>
                        <RevealInput
                          value={field.value === SENTINEL ? "" : (field.value ?? "")}
                          placeholder={isSet ? "Leave blank to keep existing" : "Paste value…"}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage className="font-mono text-[10px]" />
                    </FormItem>
                  )} />
                ))}
              </div>
            </details>
          </SectionCard>

          <SectionCard title="Telegram Alerts" subtitle="Daily P&L reports and real-time trade notifications"
            icon={Send} accentColor="border-sky-400/30 bg-sky-400/8 text-sky-400"
            badge={hasTg ? "CONNECTED" : "OPTIONAL"}
            badgeColor={hasTg ? "border-primary/30 text-primary bg-primary/8" : "border-border text-muted-foreground/50"}
            defaultOpen={!hasTg}>
            <TelegramSetup hasBotToken={!!config?.telegramBotToken} hasChatId={!!config?.telegramChatId}
              control={form.control} form={form} />
          </SectionCard>

          <SectionCard title="Optional Data Feeds" subtitle="External APIs that improve signal quality" icon={Radio} defaultOpen={false}>
            <div className="grid gap-4">
              {([
                { name: "sportsApiKey" as const,  label: "Sports — The Odds API",    desc: "Free at the-odds-api.com",   isSet: !!config?.sportsApiKey  },
                { name: "weatherApiKey" as const, label: "Weather — OpenWeatherMap", desc: "Free at openweathermap.org", isSet: !!config?.weatherApiKey },
              ]).map(({ name, label, desc, isSet }) => (
                <FormField key={name} control={form.control} name={name} render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-[10px] uppercase tracking-widest flex items-center gap-2">
                      {label} <StatusPill set={isSet} label={isSet ? "Set" : "Not set"} />
                    </FormLabel>
                    <FormControl>
                      <RevealInput
                        value={field.value === SENTINEL ? "" : (field.value ?? "")}
                        placeholder={isSet ? "Leave blank to keep existing" : "Paste API key…"}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormDescription className="font-mono text-[9px] text-muted-foreground/50">{desc}</FormDescription>
                    <FormMessage className="font-mono text-[10px]" />
                  </FormItem>
                )} />
              ))}
            </div>
          </SectionCard>

          <Button type="submit"
            className="w-full font-mono font-bold text-xs tracking-widest h-11 rounded-none bg-primary text-primary-foreground hover:bg-primary/90"
            style={{ boxShadow: '0 0 20px hsl(142 76% 48% / 0.2)' }}
            disabled={updateConfig.isPending}
            data-testid="button-save-config">
            {updateConfig.isPending
              ? <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />SAVING…</>
              : <><Save className="w-3.5 h-3.5 mr-2" />SAVE CONFIGURATION</>
            }
          </Button>
        </form>
      </Form>
    </div>
  );
}
