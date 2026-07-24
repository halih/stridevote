"use client";

import { useTransition } from "react";
import { doSignOut } from "@/lib/actions";

export function AccountButton({ initials }: { initials: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="avatar"
      title="Account"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Sign out of StrideVote?")) {
          startTransition(() => {
            void doSignOut();
          });
        }
      }}
    >
      {initials}
    </button>
  );
}
