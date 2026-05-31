import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch } from "wouter";
import { Sidebar } from "@/components/Sidebar";
import { Toaster } from "@/components/ui/toast";
import Dashboard from "@/pages/Dashboard";
import Opportunities from "@/pages/Opportunities";
import Signals from "@/pages/Signals";
import Positions from "@/pages/Positions";
import Settings from "@/pages/Settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 1000 * 30 },
  },
});

export default function App() {
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
