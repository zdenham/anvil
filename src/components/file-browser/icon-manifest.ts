import { generateManifest } from "material-icon-theme";
import type { Manifest } from "material-icon-theme";

const manifest: Manifest = generateManifest();

/**
 * Convert the manifest's relative iconPath (e.g., "./../icons/typescript.svg")
 * to a node_modules-resolvable path (e.g., "material-icon-theme/icons/typescript.svg").
 */
function resolveIconPath(iconId: string): string {
  const def = manifest.iconDefinitions?.[iconId];
  if (!def?.iconPath) return "";
  // iconPath is "./../icons/foo.svg" — strip leading "./../" or "./"
  return `material-icon-theme/${def.iconPath.replace(/^\.\/(?:\.\.\/)?/, "")}`;
}

// Pre-resolve the three fallback icon paths
const defaultFileIconPath = resolveIconPath(manifest.file ?? "");
const defaultFolderIconPath = resolveIconPath(manifest.folder ?? "");
const defaultFolderExpandedIconPath = resolveIconPath(
  manifest.folderExpanded ?? ""
);

export {
  manifest,
  resolveIconPath,
  defaultFileIconPath,
  defaultFolderIconPath,
  defaultFolderExpandedIconPath,
};
