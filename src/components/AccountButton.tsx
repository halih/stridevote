import Link from "next/link";

export function AccountButton({ initials }: { initials: string }) {
  return (
    <Link className="avatar" href="/profile" title="Your profile">
      {initials}
    </Link>
  );
}
