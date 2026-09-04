"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function BottomSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Portal only after mount so SSR HTML matches the first client render (null).
  if (!mounted) return null;

  return createPortal(
    <div
      className={`scrim${open ? " open" : ""}`}
      onMouseDown={(e) => {
        // mousedown (not click): avoids autocomplete/suggestion dismiss
        // click-through closing the sheet while typing.
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        {open && children}
      </div>
    </div>,
    document.body,
  );
}
