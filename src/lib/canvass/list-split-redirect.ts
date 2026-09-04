import { prisma } from "@/lib/db";

/** Follow redirect chain for a household that may have moved during splits. */
export async function resolveSplitRedirect(
  fromListId: string,
  householdId: string,
): Promise<string> {
  let listId = fromListId;
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const key = `${listId}:${householdId}`;
    if (seen.has(key)) break;
    seen.add(key);
    const redirect = await prisma.listHouseholdRedirect.findUnique({
      where: {
        fromListId_householdId: { fromListId: listId, householdId },
      },
      select: { toListId: true },
    });
    if (!redirect) break;
    listId = redirect.toListId;
  }
  return listId;
}
