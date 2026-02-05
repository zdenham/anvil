import type { PhaseInfo } from "@core/types/plans.js";

/**
 * Parse markdown content for GitHub-style todo lists within a ## Phases section.
 *
 * Supported formats:
 * - [ ] Uncompleted phase
 * - [x] Completed phase
 * - [X] Completed phase (uppercase)
 *
 * Only parses todos within a delimited "## Phases" section.
 * The section ends at the next heading (##) or horizontal rule (---).
 *
 * @param markdown - The markdown content to parse
 * @returns PhaseInfo with completed/total counts, or null if no ## Phases section
 */
export function parsePhases(markdown: string): PhaseInfo | null {
  const lines = markdown.split('\n');

  const phaseSectionPattern = /^##\s+Phases\s*$/i;
  const sectionEndPattern = /^(##\s|---)/;
  const todoPattern = /^(\s*)- \[([ xX])\] (.+)$/;

  let inPhasesSection = false;
  let phaseSectionStart = -1;
  let completed = 0;
  let total = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (phaseSectionPattern.test(line)) {
      inPhasesSection = true;
      phaseSectionStart = i;
      continue;
    }

    if (inPhasesSection && i > phaseSectionStart && sectionEndPattern.test(line)) {
      break;
    }

    if (inPhasesSection) {
      const match = line.match(todoPattern);
      if (match) {
        const [, indent, checked] = match;
        // Only count top-level items (0-2 spaces of indentation)
        if (indent.length <= 2) {
          total++;
          if (checked.toLowerCase() === 'x') {
            completed++;
          }
        }
      }
    }
  }

  // Return null if no Phases section found
  // Return { completed: 0, total: 0 } if section exists but is empty
  if (!inPhasesSection) {
    return null;
  }

  return { completed, total };
}
