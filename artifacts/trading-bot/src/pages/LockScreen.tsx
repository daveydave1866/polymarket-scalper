import { useState } from "react";
import { Lock, LogIn, Loader2 } from "lucide-react";
import { setStoredKey } from "@/lib/auth";

interface LockScreenProps {
  onUnlock: () => void;
}

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { Authorization: `Bearer ${key.trim()}` },
      });
      const data = await res.json() as { ok: boolean };
      if (data.ok) {
        setStoredKey(key.trim());
        onUnlock();
      } else {
        setError("Invalid key — try again.");
      }
    } catch {
      setError("Could not reach server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center font-mono">
      <div className="w-full max-w-sm px-4">
        <div className="border border-border bg-card p-8 space-y-6">
          <div className="flex items-center gap-3">
            <Lock className="w-5 h-5 text-primary" />
            <div>
              <div className="text-sm font-bold tracking-widest text-foreground uppercase">Polymarket Scalper</div>
              <div className="text-xs text-muted-foreground tracking-wider uppercase mt-0.5">Enter API Key</div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              value={key}
              onChange={e => { setKey(e.target.value); setError(""); }}
              placeholder="bsk_••••••••••••••••"
              autoFocus
              className="w-full bg-background border border-border text-foreground font-mono text-sm px-3 py-2 outline-none focus:border-primary placeholder:text-muted-foreground/40"
            />
            {error && (
              <div className="text-xs text-destructive tracking-wide uppercase">{error}</div>
            )}
            <button
              type="submit"
              disabled={loading || !key.trim()}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground text-xs font-bold tracking-widest uppercase py-2 px-4 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
              {loading ? "Verifying…" : "Unlock"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
