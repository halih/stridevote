import type { MinivanAdapter } from "./types";
import { imraanAdapter } from "./imraan";

const ADAPTERS: Record<string, MinivanAdapter> = {
  [imraanAdapter.key]: imraanAdapter,
};

export function listMinivanAdapters(): Array<{ key: string; label: string }> {
  return Object.values(ADAPTERS).map((a) => ({ key: a.key, label: a.label }));
}

export function getMinivanAdapter(key: string | null | undefined): MinivanAdapter | null {
  if (!key) return null;
  return ADAPTERS[key] ?? null;
}

export function requireMinivanAdapter(key: string | null | undefined): MinivanAdapter {
  const adapter = getMinivanAdapter(key);
  if (!adapter) {
    throw new Error(
      key
        ? `Unknown MiniVAN adapter “${key}”.`
        : "This campaign has no MiniVAN adapter configured.",
    );
  }
  return adapter;
}

export { imraanAdapter };
export type { MinivanAdapter } from "./types";
