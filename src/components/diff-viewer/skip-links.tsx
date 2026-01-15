import type { AnnotatedFile } from "./types";

interface SkipLinksProps {
  /** Files to generate skip links for */
  files: AnnotatedFile[];
}

/**
 * Skip links for keyboard navigation between files.
 * Visually hidden until focused for accessibility.
 */
export function SkipLinks({ files }: SkipLinksProps) {
  if (files.length <= 1) {
    return null;
  }

  return (
    <nav
      aria-label="Skip to file"
      className="sr-only focus-within:not-sr-only focus-within:relative focus-within:z-50"
    >
      <ul className="flex flex-wrap gap-2 p-2 bg-surface-800 rounded mb-2">
        {files.map((file, index) => {
          const path = file.file.newPath ?? file.file.oldPath ?? `File ${index + 1}`;
          const fileName = path.split("/").pop() ?? path;

          return (
            <li key={path}>
              <a
                href={`#diff-file-${index}`}
                className="
                  inline-block px-2 py-1
                  text-sm text-accent-400
                  hover:text-accent-300 hover:underline
                  focus:outline-none focus:ring-2 focus:ring-accent-500 rounded
                "
                onClick={(e) => {
                  e.preventDefault();
                  const element = document.getElementById(`diff-file-${index}`);
                  if (element) {
                    element.scrollIntoView({ behavior: "smooth" });
                    element.focus();
                  }
                }}
              >
                {fileName}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * CSS for sr-only utility (included by default in Tailwind).
 * Add this to your global styles if not using Tailwind.
 */
export const srOnlyStyles = `
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.not-sr-only {
  position: static;
  width: auto;
  height: auto;
  padding: 0;
  margin: 0;
  overflow: visible;
  clip: auto;
  white-space: normal;
}

.focus-within\\:not-sr-only:focus-within {
  position: static;
  width: auto;
  height: auto;
  padding: 0;
  margin: 0;
  overflow: visible;
  clip: auto;
  white-space: normal;
}
`;
