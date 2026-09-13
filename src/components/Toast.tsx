"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastFn = (message: string) => void;

const ToastContext = createContext<ToastFn>(() => {});

export function useToast(): ToastFn {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback<ToastFn>((msg) => {
    setMessage(msg);
    setShow(true);
    if (timer.current) clearTimeout(timer.current);
    // Give longer status messages enough time to be read while keeping short
    // confirmations quick.
    const duration = Math.min(7000, Math.max(2400, msg.length * 45));
    timer.current = setTimeout(() => setShow(false), duration);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={`toast${show ? " show" : ""}`} role="status" aria-live="polite">
        {message}
      </div>
    </ToastContext.Provider>
  );
}
