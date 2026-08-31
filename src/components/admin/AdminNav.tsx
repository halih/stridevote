"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

export function AdminNav({
  canCreate,
  campaigns,
}: {
  canCreate: boolean;
  campaigns: { slug: string; name: string }[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const candidate = pathname.split("/")[2] ?? "";
  const currentSlug =
    candidate && candidate !== "new" && candidate !== "lists" ? candidate : "";

  return (
    <nav className="admin-nav" aria-label="Admin navigation">
      <div className="admin-context-switcher">
        <label htmlFor="admin-campaign-context">Campaign context</label>
        <select
          id="admin-campaign-context"
          value={currentSlug}
          onChange={(event) =>
            router.push(event.target.value ? `/admin/${event.target.value}` : "/admin")
          }
        >
          <option value="">All campaigns</option>
          {campaigns.map((campaign) => (
            <option key={campaign.slug} value={campaign.slug}>
              {campaign.name}
            </option>
          ))}
        </select>
      </div>
      <Link
        href="/admin"
        className={pathname === "/admin" ? "active" : ""}
      >
        <Icon name="shield" size={18} />
        Campaigns
      </Link>
      {canCreate ? (
        <Link
          href="/admin/new"
          className={pathname === "/admin/new" ? "active" : ""}
        >
          <Icon name="plus" size={18} />
          New campaign
        </Link>
      ) : null}
    </nav>
  );
}
