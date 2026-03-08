/**
 * Maps Shiki language IDs (from language-detection.ts) to CodeMirror 6
 * LanguageSupport objects. Core languages are loaded eagerly via dynamic
 * import; unsupported languages return null (plain text editing).
 */

import type { LanguageSupport } from "@codemirror/language";

type LanguageLoader = () => Promise<LanguageSupport>;

const LANGUAGE_LOADERS: Record<string, LanguageLoader> = {
  typescript: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ typescript: true })
    ),
  tsx: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ typescript: true, jsx: true })
    ),
  javascript: () =>
    import("@codemirror/lang-javascript").then((m) => m.javascript()),
  jsx: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ jsx: true })
    ),
  markdown: () =>
    import("@codemirror/lang-markdown").then((m) => m.markdown()),
  mdx: () =>
    import("@codemirror/lang-markdown").then((m) => m.markdown()),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  jsonc: () => import("@codemirror/lang-json").then((m) => m.json()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  scss: () => import("@codemirror/lang-css").then((m) => m.css()),
  less: () => import("@codemirror/lang-css").then((m) => m.css()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  xml: () => import("@codemirror/lang-html").then((m) => m.html()),
  svg: () => import("@codemirror/lang-html").then((m) => m.html()),
  python: () => import("@codemirror/lang-python").then((m) => m.python()),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
};

const cache = new Map<string, LanguageSupport>();

/**
 * Get CM6 LanguageSupport for a Shiki language ID.
 * Returns null for unsupported languages (editor will show plain text).
 */
export async function getCM6Language(
  shikiLang: string
): Promise<LanguageSupport | null> {
  const cached = cache.get(shikiLang);
  if (cached) return cached;

  const loader = LANGUAGE_LOADERS[shikiLang];
  if (!loader) return null;

  const langSupport = await loader();
  cache.set(shikiLang, langSupport);
  return langSupport;
}
