import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { BarChart2, Settings, TrendingUp, Activity, Zap } from "lucide-react";

const NAV = [
  { href: "/",             label: "Dashboard",      icon: Activity      },
  { href: "/opportunities",label: "Opportunities",  icon: TrendingUp    },
  { href: "/signals",      label: "Signals",        icon: Zap           },
  { href: "/positions",    label: "Positions",      icon: BarChart2     },
  { href: "/settings",     label: "Settings",       icon: Settings      },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="w-52 flex-shrink-0 border-r border-border bg-card flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-border">
        <div className="font-mono text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2">
          <span className="text-lg">⬡</span> Polymarket
        </div>
        <div className="font-mono text-[9px] text-muted-foreground/50 uppercase tracking-wider mt-0.5">
          Scalper v1.0
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-0.5 px-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = location === href || (href !== "/" && location.startsWith(href));
          return (
            <Link key={href} href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 font-mono text-[11px] uppercase tracking-wider transition-colors",
                active
                  ? "text-primary bg-primary/8 border-l-2 border-primary"
                  : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/20 border-l-2 border-transparent"
              )}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-border">
        <div className="font-mono text-[9px] text-muted-foreground/30 uppercase tracking-wider">
          Polymarket API v4
        </div>
      </div>
    </aside>
  );
}
