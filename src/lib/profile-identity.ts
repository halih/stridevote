/** Name and initials stored on the user after a profile save. */
export function displayIdentity(
  firstName: string,
  lastName: string,
): { name: string | null; initials: string | null } {
  const first = firstName.trim();
  const last = lastName.trim();
  const name = [first, last].filter(Boolean).join(" ") || null;
  const letters = ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
  return { name, initials: letters || null };
}

/**
 * Phone-only accounts sign in with that number. Clearing it leaves no email
 * or phone to reach the account again.
 */
export function removingLastLoginIdentifier(input: {
  email: string | null | undefined;
  currentPhone: string | null | undefined;
  nextPhone: string | null;
}): boolean {
  const hasEmail = Boolean(input.email?.trim());
  const droppingPhone = Boolean(input.currentPhone) && input.nextPhone == null;
  return droppingPhone && !hasEmail;
}
