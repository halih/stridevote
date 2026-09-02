// Addresses in the reserved domains of RFC 2606 / RFC 6761 can never receive
// mail (e.g. the seeded demo@stridevote.local). In dev we skip the provider for
// these and surface the magic link on the login screen instead.

const RESERVED_TLDS = ["local", "localhost", "test", "invalid", "example"];
const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];

export function isUndeliverableAddress(address: string): boolean {
  const domain = address.trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  if (RESERVED_DOMAINS.includes(domain)) return true;
  const tld = domain.split(".").pop() ?? "";
  return RESERVED_TLDS.includes(tld);
}
