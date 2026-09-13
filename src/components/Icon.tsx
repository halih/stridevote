import type { CSSProperties } from "react";

// Line-icon set (ported from the prototype) as a single React component.
const PATHS: Record<string, string> = {
  contact:
    "M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z",
  lit: "M3 5h18v14H3z M3 7l9 6 9-6",
  chevronLeft: "M15 18l-6-6 6-6",
  chevronRight: "M9 18l6-6-6-6",
  map: "M9 20l-6 2V6l6-2 6 2 6-2v16l-6 2-6-2z M9 4v16 M15 6v16",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  check: "M20 6L9 17l-5-5",
  vote: "M12 3.2a8.8 8.8 0 100 17.6 8.8 8.8 0 000-17.6z M7.6 12.2l3 3 5.8-6.6",
  bell: "M6 8a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z M10 20a2 2 0 004 0",
  lock: "M4 10h16v10H4z M8 10V7a4 4 0 018 0v3",
  home: "M4 11l8-7 8 7 M6 10v10h12V10",
  trophy: "M8 21h8M12 17v4 M7 4h10v5a5 5 0 01-10 0V4z M7 5H4a3 3 0 003 3M17 5h3a3 3 0 01-3 3",
  phone:
    "M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z",
  users:
    "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8 M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75",
  compass: "M12 2a10 10 0 100 20 10 10 0 000-20z M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4 M16 17l5-5-5-5 M21 12H9",
  clock: "M12 2a10 10 0 100 20 10 10 0 000-20z M12 6v6l4 2",
  door: "M6 21V5a2 2 0 012-2h8a2 2 0 012 2v16 M4 21h16 M14 12h.01",
  mail: "M4 5h16v14H4z M4 7l8 6 8-6",
  bars: "M4 20V10 M12 20V4 M20 20v-7",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z",
  plus: "M12 5v14 M5 12h14",
  trash: "M4 7h16 M6 7l1 13h10l1-13 M9 7V4h6v3 M10 11v6 M14 11v6",
  pencil: "M12 20h9 M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z",
  externalLink: "M14 3h7v7 M21 3l-9 9 M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6",
  menu: "M3 6h18 M3 12h18 M3 18h18",
  copy: "M9 9h11v11H9z M5 15H4V4h11v1",
  x: "M18 6L6 18 M6 6l12 12",
  layers: "M12 2l10 5-10 5L2 7l10-5z M2 12l10 5 10-5 M2 17l10 5 10-5",
  help: "M12 2a10 10 0 100 20 10 10 0 000-20z M9.1 9a3 3 0 015.8 1c0 2-3 2.5-3 4.5 M12 17h.01",
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  style,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}) {
  const d = PATHS[name] ?? "";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
    >
      {d.split(" M").map((seg, i) => (
        <path key={i} d={(i === 0 ? seg : "M" + seg).trim()} />
      ))}
    </svg>
  );
}
