import { useState, useCallback } from "react";

export type ToastVariant = "default" | "destructive";

export interface Toast {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
}

const listeners: Array<(toasts: Toast[]) => void> = [];
let toasts: Toast[] = [];

function emit() {
  listeners.forEach((fn) => fn([...toasts]));
}

export function toast(t: Omit<Toast, "id">) {
  const id = Math.random().toString(36).slice(2);
  toasts = [...toasts, { id, ...t }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== id);
    emit();
  }, 4000);
}

export function useToast() {
  const [state, setState] = useState<Toast[]>([...toasts]);

  const subscribe = useCallback(() => {
    listeners.push(setState);
    return () => {
      const idx = listeners.indexOf(setState);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }, []);

  useState(() => {
    const unsub = subscribe();
    return unsub;
  });

  return {
    toasts: state,
    toast: (t: Omit<Toast, "id">) => toast(t),
    dismiss: (id: string) => {
      toasts = toasts.filter((x) => x.id !== id);
      emit();
    },
  };
}
