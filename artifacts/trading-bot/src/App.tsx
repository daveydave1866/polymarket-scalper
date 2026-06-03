import { useState, useEffect, createContext, useContext } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch } from "wouter";
import { Sidebar } from "@/components/Sidebar";
import { Toaster } from "@/components/ui/toast";
import Dashboard from "@/pages/Dashboard";
import Opportunities from "@/pages/Opportunities";
import Signals from "@/pages/Signals";
import Positions from "@/pages/Positions";
import Settings from "@/pages/Settings";
import Admin from "@/pages/Admin";
import Login from "@/pages/Login";
import { getStoredAuth, clearStoredAuth, type AuthUser } from "@/lib/auth";

export interface AuthContextType {
  user: AuthUser | null;
  logout: () => void;
}
export const AuthContext = createContext<AuthContextType>({ user: null, logout: () => {} });
export function useAuth() { return useContext(AuthContext); }

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 1000 * 30 },
  },
});

async function verifyToken(token: string): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json() as { ok: boolean };
    return data.ok;
  } catch {
    return false;
  }
}

export default function App() {
  const [auth, setAuth] = useState<AuthUser | null | "loading">("loading");

  useEffect(() => {
    const stored = getStoredAuth();
    if (!stored) { setAuth(null); return; }
    verifyToken(stored.token).then(ok => {
      if (!ok) { clearStoredAuth(); setAuth(null); }
      else setAuth(stored);
    });
  }, []);

  function handleLogin(token: string, userId: string, username: string, role: string) {
    const user: AuthUser = { token, userId, username, role };
    setAuth(user);
  }

  function handleLogout() {
    clearStoredAuth();
    setAuth(null);
    queryClient.clear();
  }

  if (auth === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center font-mono">
        <div className="text-xs text-muted-foreground tracking-widest uppercase animate-pulse">Loading…</div>
      </div>
    );
  }

  if (!auth) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <AuthContext.Provider value={{ user: auth, logout: handleLogout }}>
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
              <Route path="/admin"         component={auth.role === "admin" ? Admin : () => <div className="font-mono text-muted-foreground text-sm">Access denied.</div>} />
              <Route>
                <div className="font-mono text-muted-foreground text-sm p-8">404 — page not found</div>
              </Route>
            </Switch>
          </main>
        </div>
        <Toaster />
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}
