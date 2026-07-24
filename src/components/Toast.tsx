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
    timer.current = setTimeout(() => setShow(false), 2400);
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
