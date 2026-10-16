/** Ear tag / animal tag ID: the only mandatory registration field and the primary field identifier. */

export const TAG_ID_MAX = 40;
const TAG_PATTERN = /^[A-Z0-9][A-Z0-9 /._-]*$/;

/** Upper-case, trimmed, single-spaced — the same normalisation the server applies. */
export function normaliseTagId(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Empty string when valid; otherwise a field message. */
export function tagIdError(value: string): string {
  const tag = normaliseTagId(value);
  if (!tag) return 'Tag ID is required. Enter the ear tag / animal tag number.';
  if (tag.length > TAG_ID_MAX) return `Tag ID is too long (maximum ${TAG_ID_MAX} characters).`;
  if (!TAG_PATTERN.test(tag)) return 'Use only letters, numbers, spaces and / . _ -';
  return '';
}

/** Label for display; legacy records registered before Tag ID was mandatory have none. */
export function tagLabel(tag: string | null | undefined): string {
  return tag?.trim() ? tag : 'NO TAG';
}

export function hasTag(tag: string | null | undefined): boolean {
  return !!tag?.trim();
}
