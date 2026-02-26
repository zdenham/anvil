import {
  createHighlighter,
  type Highlighter,
  type ThemedToken,
  type BundledLanguage,
  bundledLanguages,
} from "shiki";
import { logger } from "./logger-client";

let highlighter: Highlighter | null = null;
let initPromise: Promise<void> | null = null;

// Languages to preload on initialization
const PRELOADED_LANGUAGES: BundledLanguage[] = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "rust",
  "python",
  "json",
  "yaml",
  "markdown",
  "css",
  "html",
  "go",
];

const THEME = "github-dark";

// Cache for highlighted code to avoid re-highlighting on remount
const highlightCache = new Map<string, ThemedToken[][]>();
const MAX_CACHE_SIZE = 200;

/**
 * Initialize the Shiki highlighter with preloaded languages.
 * This should be called once at app startup.
 * Multiple calls are safe - subsequent calls return immediately.
 */
export async function initHighlighter(): Promise<void> {
  if (highlighter) return;

  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    highlighter = await createHighlighter({
      themes: [THEME],
      langs: PRELOADED_LANGUAGES,
    });
  })();

  await initPromise;
}

/**
 * Check if the highlighter has been initialized.
 */
export function isHighlighterReady(): boolean {
  return highlighter !== null;
}

/**
 * Check if a language is supported by Shiki.
 */
export function isLanguageSupported(language: string): boolean {
  return language in bundledLanguages;
}

/**
 * Check if a language has been loaded into the highlighter.
 */
export function isLanguageLoaded(language: string): boolean {
  if (!highlighter) return false;
  return highlighter.getLoadedLanguages().includes(language);
}

/**
 * Load a language into the highlighter.
 * If the language is not supported, this is a no-op.
 */
export async function loadLanguage(language: string): Promise<void> {
  if (!highlighter) {
    await initHighlighter();
  }

  if (!isLanguageSupported(language)) {
    logger.warn(
      `[syntax-highlighter] Language "${language}" is not supported, falling back to plaintext`
    );
    return;
  }

  if (isLanguageLoaded(language)) {
    return;
  }

  await highlighter!.loadLanguage(language as BundledLanguage);
}

/**
 * Create a plain text fallback when highlighting fails.
 */
function plainTextFallback(code: string): ThemedToken[][] {
  let offset = 0;
  return code.split("\n").map((line) => {
    const token: ThemedToken = { content: line, color: undefined, offset };
    offset += line.length + 1; // +1 for newline
    return [token];
  });
}

/**
 * Highlight code and return tokenized output.
 *
 * Returns an array of lines, where each line is an array of tokens.
 * Each token has `content` (the text) and `color` (the hex color).
 *
 * This function highlights the entire code block to preserve multi-line
 * syntax constructs (strings, comments, etc.).
 *
 * @param code - The code to highlight
 * @param language - The Shiki language identifier
 * @returns Array of token arrays (one per line)
 */
export async function highlightCode(
  code: string,
  language: string
): Promise<ThemedToken[][]> {
  const cacheKey = `${language}:${code}`;

  // Check cache first to avoid flickering on remount
  const cached = highlightCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Ensure highlighter is initialized
    if (!highlighter) {
      await initHighlighter();
    }

    // Determine the effective language
    const effectiveLang = isLanguageSupported(language) ? language : "plaintext";

    // Load the language if not already loaded
    if (!isLanguageLoaded(effectiveLang) && effectiveLang !== "plaintext") {
      await loadLanguage(effectiveLang);
    }

    // Get tokens using codeToTokens for granular control
    const result = highlighter!.codeToTokens(code, {
      lang: effectiveLang as BundledLanguage,
      theme: THEME,
    });

    const tokens = result.tokens;

    // Cache the result (with simple LRU eviction)
    if (highlightCache.size >= MAX_CACHE_SIZE) {
      const firstKey = highlightCache.keys().next().value;
      if (firstKey) highlightCache.delete(firstKey);
    }
    highlightCache.set(cacheKey, tokens);

    return tokens;
  } catch (error) {
    logger.error("[syntax-highlighter] Highlighting failed:", error);
    return plainTextFallback(code);
  }
}

/**
 * Get the currently loaded theme name.
 */
export function getTheme(): string {
  return THEME;
}

/**
 * Synchronously get cached tokens if available.
 * Returns null if not cached - use highlightCode for async highlighting.
 */
export function getCachedTokens(
  code: string,
  language: string
): ThemedToken[][] | null {
  return highlightCache.get(`${language}:${code}`) ?? null;
}

// Export types for consumers
export type { ThemedToken };
