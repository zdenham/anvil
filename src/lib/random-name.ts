import { uniqueNamesGenerator, colors, animals } from 'unique-names-generator';

/**
 * Generate a random worktree name (max 10 characters).
 * Uses color-animal pattern for human-friendly names.
 * Examples: "red-fox", "blue-owl", "teal-cat"
 */
export function generateRandomWorktreeName(): string {
  // Use short dictionaries to stay under 10 chars
  return uniqueNamesGenerator({
    dictionaries: [colors, animals],
    separator: '-',
    length: 2,
    style: 'lowerCase',
  }).slice(0, 10);
}

/**
 * Generate a unique worktree name that doesn't conflict with existing names.
 * Appends numeric suffix if initial name conflicts.
 */
export function generateUniqueWorktreeName(existingNames: Set<string>): string {
  let name = generateRandomWorktreeName();
  let suffix = 1;

  while (existingNames.has(name)) {
    const base = name.slice(0, 7); // Leave room for suffix
    name = `${base}-${suffix}`;
    suffix++;
  }

  return name;
}
