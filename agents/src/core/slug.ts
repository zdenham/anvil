/**
 * Converts a title into a URL-safe slug.
 *
 * @param title - The title to slugify
 * @returns A slugified version of the title
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // Remove special chars
    .replace(/\s+/g, "-") // Spaces to hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, "") // Trim hyphens
    .slice(0, 50); // Max length
}

/**
 * Resolves slug conflicts by appending a number suffix.
 *
 * @param baseSlug - The base slug to resolve conflicts for
 * @param existingSlugs - Set of existing slugs to check against
 * @returns A unique slug that doesn't conflict with existing slugs
 */
export function resolveSlugConflict(
  baseSlug: string,
  existingSlugs: Set<string>
): string {
  if (!existingSlugs.has(baseSlug)) return baseSlug;

  let n = 1;
  while (existingSlugs.has(`${baseSlug}-${n}`)) {
    n++;
  }
  return `${baseSlug}-${n}`;
}
