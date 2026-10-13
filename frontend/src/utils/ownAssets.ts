// src/utils/ownAssets.ts
//
// A person's own assets come from `api/assets/mine.get_my_assets` as well as the normal Asset Master
// list: the list follows their project User Permissions, so an asset assigned to them for a project
// they are not on is missing from it (owner, 2026-10-13: it must still show for them).

/**
 * The listed assets plus the person's own that the list missed, and which of those the person can't
 * open (their asset page reads the same permissions, so the card shows the name without a link).
 */
export function withOwnAssets<T extends { name: string }>(
  listed: readonly T[] | undefined,
  own: readonly T[] | undefined
): { assets: T[] | undefined; withoutPage: ReadonlySet<string> } {
  if (!own?.length) return { assets: listed ? [...listed] : listed, withoutPage: new Set() };
  const listedNames = new Set((listed ?? []).map((asset) => asset.name));
  const missing = own.filter((asset) => !listedNames.has(asset.name));
  return {
    assets: [...(listed ?? []), ...missing],
    // Only once the list has loaded: before that every own asset would look unopenable.
    withoutPage: new Set(listed ? missing.map((asset) => asset.name) : []),
  };
}
