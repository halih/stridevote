import { sourceHref as baseSourceHref } from "@/lib/sources";

/** Deep link / open instructions for external canvassing apps. */
export function externalListOpen(source: string, sourceRef: string | null): {
  href: string | null;
  label: string;
  hint: string;
} | null {
  if (source === "civibyte") {
    const href = baseSourceHref(source, sourceRef);
    return {
      href,
      label: "Open in Civibyte",
      hint: href
        ? "Door knocking for this list happens in Civibyte."
        : "Ask your organizer for the Civibyte link.",
    };
  }
  if (source === "minivan") {
    return {
      href: null,
      label: "Open in MiniVAN",
      hint: sourceRef
        ? `MiniVAN list ${sourceRef} — open it in the MiniVAN app on your phone.`
        : "Open this list in the MiniVAN app on your phone.",
    };
  }
  return null;
}
