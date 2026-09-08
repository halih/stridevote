"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icon";

const SECTIONS = [
  { id: "members", label: "Members", icon: "users" as const },
  { id: "voters", label: "Voters", icon: "contact" as const },
  { id: "waves", label: "Waves", icon: "layers" as const },
  { id: "turfs", label: "Turfs", icon: "map" as const },
  { id: "lists", label: "Lists", icon: "list" as const },
  { id: "reports", label: "Reports", icon: "bars" as const },
  { id: "settings", label: "Settings", icon: "pencil" as const },
];

function sectionHref(slug: string, id: string): string {
  if (id === "voters") return `/admin/${slug}/voters`;
  if (id === "reports") return `/admin/${slug}/reports`;
  return `/admin/${slug}?section=${id}`;
}

export function AdminNav({
  canCreate,
  campaigns,
}: {
  canCreate: boolean;
  campaigns: { slug: string; name: string }[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const candidate = pathname.split("/")[2] ?? "";
  const currentSlug =
    candidate && candidate !== "new" && candidate !== "lists" ? candidate : "";
  const showSwitcher = canCreate || campaigns.length > 1;
  const onlyCampaign = campaigns.length === 1 ? campaigns[0] : null;
  const navSlug = currentSlug || onlyCampaign?.slug || "";
  const showSections = Boolean(navSlug && (currentSlug || !canCreate));

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  function switchCampaign(slug: string) {
    if (!slug) {
      router.push("/admin");
      return;
    }
    if (pathname.includes("/voters")) {
      router.push(`/admin/${slug}/voters`);
      return;
    }
    if (pathname.includes("/reports")) {
      router.push(`/admin/${slug}/reports`);
      return;
    }
    if (pathname.includes("/waves") || pathname.includes("/programs")) {
      router.push(`/admin/${slug}?section=waves`);
      return;
    }
    const section = searchParams.get("section");
    const normalized =
      section === "programs" ? "waves" : section;
    router.push(normalized ? `/admin/${slug}?section=${normalized}` : `/admin/${slug}`);
  }

  function isActive(id: string): boolean {
    if (!navSlug) return false;
    if (id === "voters") return pathname.startsWith(`/admin/${navSlug}/voters`);
    if (id === "reports") return pathname.startsWith(`/admin/${navSlug}/reports`);
    if (id === "waves") {
      return (
        pathname.startsWith(`/admin/${navSlug}/waves`) ||
        pathname.startsWith(`/admin/${navSlug}/programs`) ||
        (pathname === `/admin/${navSlug}` &&
          (searchParams.get("section") === "waves" ||
            searchParams.get("section") === "programs"))
      );
    }
    if (pathname.startsWith(`/admin/${navSlug}/voters`)) return false;
    if (pathname.startsWith(`/admin/${navSlug}/reports`)) return false;
    if (
      pathname.startsWith(`/admin/${navSlug}/waves`) ||
      pathname.startsWith(`/admin/${navSlug}/programs`)
    ) {
      return false;
    }
    if (pathname !== `/admin/${navSlug}`) return false;
    const section = searchParams.get("section") ?? "members";
    if (section === "programs") return id === "waves";
    return section === id;
  }

  return (
    <nav className="admin-nav" aria-label="Admin navigation">
      {showSwitcher ? (
        <div className="admin-context-switcher">
          <label htmlFor="admin-campaign-context">Select campaign</label>
          <select
            id="admin-campaign-context"
            value={currentSlug}
            onChange={(event) => switchCampaign(event.target.value)}
          >
            {canCreate ? (
              <option value="">Manage campaigns</option>
            ) : (
              <option value="">All campaigns</option>
            )}
            {campaigns.map((campaign) => (
              <option key={campaign.slug} value={campaign.slug}>
                {campaign.name}
              </option>
            ))}
          </select>
        </div>
      ) : onlyCampaign ? (
        <div className="admin-context-switcher">
          <span className="admin-context-kicker">Campaign</span>
          <span className="admin-context-name">{onlyCampaign.name}</span>
        </div>
      ) : null}

      {showSections ? (
        <>
          <button
            type="button"
            className="admin-nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="admin-nav-panel"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? "x" : "menu"} size={18} />
            {menuOpen ? "Close" : "Menu"}
          </button>

          <div
            id="admin-nav-panel"
            className={`admin-nav-panel${menuOpen ? " open" : ""}`}
          >
            <div className="admin-nav-links">
              {SECTIONS.map((section) => (
                <Link
                  key={section.id}
                  href={sectionHref(navSlug, section.id)}
                  className={isActive(section.id) ? "active" : ""}
                  onClick={() => setMenuOpen(false)}
                >
                  <Icon name={section.icon} size={18} />
                  {section.label}
                </Link>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </nav>
  );
}
