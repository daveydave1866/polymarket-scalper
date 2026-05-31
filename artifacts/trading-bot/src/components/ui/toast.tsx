import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "flex items-start gap-3 border px-4 py-3 text-sm animate-fade-up",
            t.variant === "destructive"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-primary/30 bg-card text-foreground"
          )}
        >
          <div className="flex-1">
            {t.title && <div className="font-mono text-xs font-bold uppercase tracking-wider">{t.title}</div>}
            {t.description && <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{t.description}</div>}
          </div>
          <button onClick={() => dismiss(t.id)} className="text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
