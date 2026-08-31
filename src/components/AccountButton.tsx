"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAdminAccess } from "./AdminAccessContext";
import { Icon } from "./Icon";

export function AccountButton({ initials }: { initials: string }) {
  const canManage = useAdminAccess();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!canManage) {
    return (
      <Link className="avatar" href="/profile" title="Your profile">
        {initials}
      </Link>
    );
  }

  return (
    <div className="account-menu" ref={menuRef}>
      <button
        type="button"
        className="avatar account-menu-trigger"
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {initials}
      </button>
      {open ? (
        <div className="account-menu-popover" role="menu">
          <Link href="/profile" role="menuitem" onClick={() => setOpen(false)}>
            <Icon name="users" size={17} />
            Your profile
          </Link>
          <Link href="/admin" role="menuitem" onClick={() => setOpen(false)}>
            <Icon name="shield" size={17} />
            <span>
              <b>Switch to admin view</b>
              <small>Manage campaigns and members</small>
            </span>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
