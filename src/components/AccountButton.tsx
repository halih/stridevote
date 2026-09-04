"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { doSignOut } from "@/lib/actions";
import { useAdminAccess } from "./AdminAccessContext";
import { Icon } from "./Icon";

export function AccountButton({
  initials,
  name,
  detail,
  variant = "volunteer",
}: {
  initials: string;
  name?: string | null;
  detail?: string | null;
  variant?: "volunteer" | "admin";
}) {
  const canManage = useAdminAccess();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isAdmin = variant === "admin";

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

  return (
    <div className={`account-menu${isAdmin ? " account-menu-admin" : ""}`} ref={menuRef}>
      <button
        type="button"
        className={isAdmin ? "account-menu-trigger-row" : "avatar account-menu-trigger"}
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {isAdmin ? (
          <>
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="admin-account-copy">
              <b>{name || "Administrator"}</b>
              <span>{detail}</span>
            </span>
          </>
        ) : (
          initials
        )}
      </button>
      {open ? (
        <div className="account-menu-popover" role="menu">
          <Link href="/profile" role="menuitem" onClick={() => setOpen(false)}>
            <Icon name="users" size={17} />
            Your profile
          </Link>
          {isAdmin ? (
            <Link href="/campaigns" role="menuitem" onClick={() => setOpen(false)}>
              <Icon name="compass" size={17} />
              <span>
                <b>Switch to volunteer view</b>
                <small>Canvass lists and doors</small>
              </span>
            </Link>
          ) : canManage ? (
            <Link href="/admin" role="menuitem" onClick={() => setOpen(false)}>
              <Icon name="shield" size={17} />
              <span>
                <b>Switch to admin view</b>
                <small>Manage campaigns and members</small>
              </span>
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void doSignOut();
            }}
          >
            <Icon name="logout" size={17} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
