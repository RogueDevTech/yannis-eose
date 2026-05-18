import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Return a no-op when used outside provider (SSR safety)
    return {
      toasts: [] as Toast[],
      addToast: () => {},
      removeToast: () => {},
      toast: {
        success: (_title: string, _message?: string) => {},
        error: (_title: string, _message?: string) => {},
        warning: (_title: string, _message?: string) => {},
        info: (_title: string, _message?: string) => {},
      },
    };
  }
  return {
    ...ctx,
    toast: {
      success: (title: string, message?: string) =>
        ctx.addToast({ type: 'success', title, message, duration: 4000 }),
      error: (title: string, message?: string) =>
        ctx.addToast({ type: 'error', title, message, duration: 6000 }),
      warning: (title: string, message?: string) =>
        ctx.addToast({ type: 'warning', title, message, duration: 5000 }),
      info: (title: string, message?: string) =>
        ctx.addToast({ type: 'info', title, message, duration: 4000 }),
    },
  };
}

/**
 * Watch a Remix fetcher and auto-fire toasts on success/error.
 * Expects fetcher.data to have shape { success?: boolean; error?: string }.
 */
export function useFetcherToast(
  fetcherData: unknown,
  options?: { successMessage?: string; skipErrorToast?: boolean; skipSuccessToast?: boolean },
) {
  const { toast } = useToast();
  const prevRef = useRef(fetcherData);
  useEffect(() => {
    if (fetcherData === prevRef.current) return;
    prevRef.current = fetcherData;
    if (!fetcherData || typeof fetcherData !== 'object') return;
    const data = fetcherData as { success?: boolean; error?: string };
    if (data.success) {
      if (!options?.skipSuccessToast) {
        toast.success(options?.successMessage ?? 'Action completed');
      }
    } else if (data.error && !options?.skipErrorToast) {
      toast.error('Error', data.error);
    }
  }, [
    fetcherData,
    toast,
    options?.successMessage,
    options?.skipErrorToast,
    options?.skipSuccessToast,
  ]);
}

let toastCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${++toastCounter}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed top-[calc(var(--header-height)+1rem)] right-4 z-[100] flex flex-col gap-2 pointer-events-none max-w-sm w-full">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, toast.duration ?? 4000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  const styles: Record<ToastType, { bg: string; icon: string; title: string; message: string; dismiss: string; iconPath: string }> = {
    success: {
      bg: 'bg-app-elevated border-success-300 dark:border-success-600',
      icon: 'text-success-500 dark:text-success-400',
      title: 'text-app-fg',
      message: 'text-app-fg-muted',
      dismiss: 'text-app-fg-muted hover:text-app-fg',
      iconPath: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    error: {
      bg: 'bg-app-elevated border-danger-300 dark:border-danger-500',
      icon: 'text-danger-500 dark:text-danger-400',
      title: 'text-app-fg',
      message: 'text-app-fg-muted',
      dismiss: 'text-app-fg-muted hover:text-app-fg',
      iconPath: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z',
    },
    warning: {
      bg: 'bg-app-elevated border-warning-300 dark:border-warning-500',
      icon: 'text-warning-500 dark:text-warning-400',
      title: 'text-app-fg',
      message: 'text-app-fg-muted',
      dismiss: 'text-app-fg-muted hover:text-app-fg',
      iconPath: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z',
    },
    info: {
      bg: 'bg-app-elevated border-info-300 dark:border-info-500',
      icon: 'text-info-500 dark:text-info-400',
      title: 'text-app-fg',
      message: 'text-app-fg-muted',
      dismiss: 'text-app-fg-muted hover:text-app-fg',
      iconPath: 'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z',
    },
  };

  const { bg, icon, title, message, dismiss, iconPath } = styles[toast.type];

  return (
    <div className={`pointer-events-auto flex items-start gap-3 p-3 rounded-lg border shadow-lg ${bg} animate-slide-in-right`}>
      <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
      </svg>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${title}`}>{toast.title}</p>
        {toast.message && (
          <p className={`text-xs mt-0.5 ${message}`}>{toast.message}</p>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className={`flex-shrink-0 p-0.5 rounded transition-colors ${dismiss}`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
