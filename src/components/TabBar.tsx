"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/campaigns", label: "Campaigns", icon: "compass" },
  { href: "/canvass", label: "Canvass", icon: "map" },
  { href: "/stats", label: "Stats", icon: "bars" },
];

export function TabBar({ canManage = false }: { canManage?: boolean }) {
  const pathname = usePathname();
  const tabs = canManage
    ? [...TABS, { href: "/manage", label: "Manage", icon: "shield" as IconName }]
    : TABS;
  return (
    <nav className="tabbar">
      {tabs.map((t) => {
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
