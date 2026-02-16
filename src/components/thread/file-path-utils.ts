/**
 * File extensions recognized as code/doc files for auto-linking.
 * Kept restrictive to avoid false positives on things like "v2.0" or "google.com".
 */
const FILE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "json", "yaml", "yml", "toml",
  "md", "mdx", "txt", "csv",
  "rs", "go", "py", "rb", "java", "kt", "swift", "c", "cpp", "h", "hpp",
  "css", "scss", "less", "html", "htm", "xml", "svg",
  "sh", "bash", "zsh", "fish",
  "sql", "graphql", "gql",
  "lock",
  "vue", "svelte", "astro",
]);

/** Check if a link href looks like a file path (not a URL or anchor) */
export function looksLikeFilePath(href: string): boolean {
  if (href.startsWith("#")) return false;
  if (/^[a-z]+:\/\//i.test(href)) return false;
  // Starts with ./ or ../ — definitely a path
  if (href.startsWith("./") || href.startsWith("../")) return true;
  // Has a recognized file extension
  const dotIdx = href.lastIndexOf(".");
  if (dotIdx === -1) return false;
  const ext = href.slice(dotIdx + 1).toLowerCase();
  if (!FILE_EXTENSIONS.has(ext)) return false;
  // Has a path separator — definitely a file path (e.g. src/foo.ts)
  if (href.includes("/")) return true;
  // Bare name: reject if it has multiple dots (e.g. console.log.bind)
  const dots = href.split(".").length - 1;
  if (dots > 1) return false;
  return true;
}

/** Resolve a possibly-relative path against a working directory */
export function resolvePath(href: string, workingDirectory: string): string {
  if (href.startsWith("/")) return href;
  const parts = `${workingDirectory}/${href}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return "/" + resolved.join("/");
}

/**
 * Regex to match file-path-like tokens in plain text.
 *
 * Matches tokens like:
 * - src/components/foo.tsx
 * - ./README.md
 * - ../lib/utils.ts
 * - README.md
 * - package.json
 *
 * The negative lookbehind prevents matching inside URLs, markdown links, or
 * already-linked content. The negative lookahead prevents partial matches.
 */
const FILE_PATH_RE =
  /(?<![(\[a-zA-Z0-9_/\\])(?:\.\.?\/)?(?:[a-zA-Z0-9_@][a-zA-Z0-9_@.\-]*\/)*[a-zA-Z0-9_@][a-zA-Z0-9_@.\-]*\.[a-zA-Z0-9]+(?![a-zA-Z0-9_/\\])/g;

/**
 * Pre-process markdown text to auto-link bare file paths.
 *
 * Scans the content for bare file-path-like tokens in text (not inside
 * code blocks, inline code, or existing links) and wraps them in markdown
 * link syntax so the MarkdownRenderer's custom `a` handler can make them
 * clickable.
 *
 * Example: `Found file README.md here` → `Found file [README.md](README.md) here`
 */
export function autoLinkFilePaths(content: string): string {
  const lines = content.split("\n");
  let inCodeBlock = false;
  const result: string[] = [];

  for (const line of lines) {
    // Track fenced code blocks
    if (/^```/.test(line.trimStart())) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    result.push(linkFilePathsInLine(line));
  }

  return result.join("\n");
}

/**
 * Process a single line of markdown text, wrapping bare file paths in links.
 * Skips content inside inline code, existing links, and other markdown syntax.
 */
function linkFilePathsInLine(line: string): string {
  // Build a set of character ranges that are "protected" (inside backticks or links)
  const protected_ranges: Array<[number, number]> = [];

  // Inline code spans: `...`
  const backtickRe = /`[^`]*`/g;
  let m: RegExpExecArray | null;
  while ((m = backtickRe.exec(line)) !== null) {
    protected_ranges.push([m.index, m.index + m[0].length]);
  }

  // Markdown links: [text](url) and ![text](url)
  const linkRe = /!?\[[^\]]*\]\([^)]*\)/g;
  while ((m = linkRe.exec(line)) !== null) {
    protected_ranges.push([m.index, m.index + m[0].length]);
  }

  // HTML tags: <a href="...">
  const htmlRe = /<[^>]+>/g;
  while ((m = htmlRe.exec(line)) !== null) {
    protected_ranges.push([m.index, m.index + m[0].length]);
  }

  // Autolinks: <url>
  const autolinkRe = /<[a-zA-Z][a-zA-Z0-9+.-]*:[^\s>]+>/g;
  while ((m = autolinkRe.exec(line)) !== null) {
    protected_ranges.push([m.index, m.index + m[0].length]);
  }

  function isProtected(start: number, end: number): boolean {
    return protected_ranges.some(([ps, pe]) => start >= ps && end <= pe);
  }

  // Find file path matches and replace (from right to left to preserve indices)
  const matches: Array<{ start: number; end: number; path: string }> = [];
  FILE_PATH_RE.lastIndex = 0;
  while ((m = FILE_PATH_RE.exec(line)) !== null) {
    const token = m[0];
    if (isFilePath(token) && !isProtected(m.index, m.index + token.length)) {
      matches.push({ start: m.index, end: m.index + token.length, path: token });
    }
  }

  if (matches.length === 0) return line;

  // Replace from right to left so indices stay valid
  let result = line;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { start, end, path } = matches[i];
    result = result.slice(0, start) + `[${path}](${path})` + result.slice(end);
  }

  return result;
}

function isFilePath(token: string): boolean {
  return looksLikeFilePath(token);
}
