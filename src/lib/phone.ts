// Minimal phone normalization to a rough E.164 form for keying OTP challenges.
// Not a full libphonenumber; sufficient for US-centric dev + stubbed channels.
export function normalizePhone(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    const rest = digits.slice(1).replace(/\D/g, "");
    return rest.length >= 8 && rest.length <= 15 ? `+${rest}` : null;
  }
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`; // assume US
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}
