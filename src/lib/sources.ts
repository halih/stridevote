export function sourceLabel(source: string): string {
  switch (source) {
    case "civibyte":
      return "Civibyte";
    case "minivan":
      return "MiniVAN";
    default:
      return source;
  }
}

/** External link for a list, when the source is URL-based (Civibyte). */
export function sourceHref(source: string, ref: string | null): string | null {
  if (!ref) return null;
  if (source === "civibyte" && /^https?:\/\//i.test(ref)) return ref;
  return null;
}
