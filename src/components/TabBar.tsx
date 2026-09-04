"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/canvass", label: "Canvass", icon: "map" },
  { href: "/stats", label: "Stats", icon: "bars" },
  { href: "/campaigns", label: "Campaigns", icon: "compass" },
];

export function TabBar() {
  const pathname = usePathname();
  // Full-screen walk mode — keep chrome out of the way.
  if (/^\/canvass\/[^/]+/.test(pathname)) return null;

  return (
    <nav className="tabbar">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`tab-btn${active ? " active" : ""}`}>
            <Icon name={t.icon} size={20} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
