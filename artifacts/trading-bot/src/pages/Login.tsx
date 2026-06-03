import { useState } from "react";
import { Lock, LogIn, Loader2 } from "lucide-react";
import { setStoredAuth } from "@/lib/auth";

interface LoginProps {
  onLogin: (token: string, userId: string, username: string, role: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json() as { token?: string; userId?: string; username?: string; role?: string; error?: string };
      if (!res.ok || !data.token) {
        setError(data.error ?? "Invalid username or password.");
        return;
      }
      setStoredAuth({ token: data.token, userId: data.userId!, username: data.username!, role: data.role! });
      onLogin(data.token, data.userId!, data.username!, data.role!);
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
              <div className="text-xs text-muted-foreground tracking-wider uppercase mt-0.5">Sign In</div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              value={username}
              onChange={e => { setUsername(e.target.value); setError(""); }}
              placeholder="Username"
              autoFocus
              autoComplete="username"
              className="w-full bg-background border border-border text-foreground font-mono text-sm px-3 py-2 outline-none focus:border-primary placeholder:text-muted-foreground/40"
            />
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              placeholder="Password"
              autoComplete="current-password"
              className="w-full bg-background border border-border text-foreground font-mono text-sm px-3 py-2 outline-none focus:border-primary placeholder:text-muted-foreground/40"
            />
            {error && (
              <div className="text-xs text-destructive tracking-wide uppercase">{error}</div>
            )}
            <button
              type="submit"
              disabled={loading || !username.trim() || !password.trim()}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground text-xs font-bold tracking-widest uppercase py-2 px-4 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
