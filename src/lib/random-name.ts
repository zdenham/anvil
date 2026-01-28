import { uniqueNamesGenerator, colors, animals } from 'unique-names-generator';

/**
 * Generate a random worktree name.
 * Uses color-animal pattern for human-friendly names.
 * Examples: "red-fox", "blue-owl", "turquoise-elephant"
 */
export function generateRandomWorktreeName(): string {
  return uniqueNamesGenerator({
    dictionaries: [colors, animals],
    separator: '-',
    length: 2,
    style: 'lowerCase',
  });
}

/**
 * Generate a unique worktree name that doesn't conflict with existing names.
 * Appends numeric suffix if initial name conflicts.
 */
export function generateUniqueWorktreeName(existingNames: Set<string>): string {
  const baseName = generateRandomWorktreeName();
  let name = baseName;
  let suffix = 1;

  while (existingNames.has(name)) {
    name = `${baseName}-${suffix}`;
    suffix++;
  }

  return name;
}
