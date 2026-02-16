import {
  manifest,
  resolveIconPath,
  defaultFileIconPath,
  defaultFolderIconPath,
  defaultFolderExpandedIconPath,
} from "./icon-manifest";

/** Base URL path for icon assets copied to public/ */
const ICON_BASE = "/material-icons";

/**
 * Some common file extensions are not in the manifest's fileExtensions
 * because VS Code maps them via languageIds instead. This map provides
 * the fallback: extension -> VS Code language ID.
 */
const extensionToLanguageId: Record<string, string> = {
  ts: "typescript",
  cts: "typescript",
  mts: "typescript",
  js: "javascript",
  cjs: "javascript",
  html: "html",
  htm: "html",
  yaml: "yaml",
  yml: "yaml",
};

/**
 * Extract just the SVG filename from a resolved module path.
 * E.g., "material-icon-theme/icons/typescript.svg" -> "typescript.svg"
 */
function toIconUrl(modulePath: string): string {
  if (!modulePath) return "";
  const filename = modulePath.split("/").pop() ?? "";
  return `${ICON_BASE}/${filename}`;
}

/**
 * Get the icon URL for a file by its name.
 *
 * Lookup order:
 * 1. Exact filename match (e.g., "package.json", "Dockerfile")
 * 2. File extension match (e.g., "rs", "md") — tries longest extension first
 * 3. Language ID fallback for common extensions (e.g., "ts" -> "typescript")
 * 4. Fallback to generic file icon
 */
export function getFileIconUrl(filename: string): string {
  const lower = filename.toLowerCase();

  // 1. Exact filename match
  const fileNameIconId = manifest.fileNames?.[lower];
  if (fileNameIconId) {
    return toIconUrl(resolveIconPath(fileNameIconId));
  }

  // 2. Extension match — try longest extension first (e.g., "d.ts" before "ts")
  const parts = lower.split(".");
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join(".");
    const extIconId = manifest.fileExtensions?.[ext];
    if (extIconId) {
      return toIconUrl(resolveIconPath(extIconId));
    }
  }

  // 3. Language ID fallback for extensions not in fileExtensions
  const simpleExt = parts.length > 1 ? parts[parts.length - 1] : "";
  if (simpleExt) {
    const langId = extensionToLanguageId[simpleExt];
    if (langId) {
      const langIconId = manifest.languageIds?.[langId];
      if (langIconId) {
        return toIconUrl(resolveIconPath(langIconId));
      }
    }
  }

  // 4. Fallback
  return toIconUrl(defaultFileIconPath);
}

/**
 * Get the icon URL for a folder by its name.
 *
 * Returns the closed-folder variant by default. Pass `expanded = true`
 * for the open-folder variant.
 */
export function getFolderIconUrl(
  folderName: string,
  expanded = false
): string {
  const lower = folderName.toLowerCase();
  const lookup = expanded
    ? manifest.folderNamesExpanded
    : manifest.folderNames;
  const iconId = lookup?.[lower];

  if (iconId) {
    return toIconUrl(resolveIconPath(iconId));
  }

  const fallback = expanded
    ? defaultFolderExpandedIconPath
    : defaultFolderIconPath;
  return toIconUrl(fallback);
}
