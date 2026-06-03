import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch } from "wouter";
import { Sidebar } from "@/components/Sidebar";
import { Toaster } from "@/components/ui/toast";
import Dashboard from "@/pages/Dashboard";
import Opportunities from "@/pages/Opportunities";
import Signals from "@/pages/Signals";
import Positions from "@/pages/Positions";
import Settings from "@/pages/Settings";
import LockScreen from "@/pages/LockScreen";
import { getStoredKey, clearStoredKey } from "@/lib/auth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 1000 * 30 },
  },
});

async function verifyStoredKey(key: string): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await res.json() as { ok: boolean };
    return data.ok;
  } catch {
    return false;
  }
}

export default function App() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = getStoredKey();
    if (!stored) { setUnlocked(false); return; }
    verifyStoredKey(stored).then(ok => {
      if (!ok) clearStoredKey();
      setUnlocked(ok);
    });
  }, []);

  if (unlocked === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center font-mono">
        <div className="text-xs text-muted-foreground tracking-widest uppercase animate-pulse">Loading…</div>
      </div>
    );
  }

  if (!unlocked) {
    return <LockScreen onUnlock={() => setUnlocked(true)} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <Switch>
            <Route path="/"              component={Dashboard}     />
            <Route path="/opportunities" component={Opportunities} />
            <Route path="/signals"       component={Signals}       />
            <Route path="/positions"     component={Positions}     />
            <Route path="/settings"      component={Settings}      />
            <Route>
              <div className="font-mono text-muted-foreground text-sm p-8">404 — page not found</div>
            </Route>
          </Switch>
        </main>
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}
