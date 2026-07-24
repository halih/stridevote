export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function sourceLabel(source: string): string {
  switch (source) {
    case "minivan":
      return "MiniVAN";
    case "civibyte":
      return "Civibyte";
    default:
      return "Manual";
  }
}
