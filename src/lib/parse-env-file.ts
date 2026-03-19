/**
 * Parses a .env file into a key-value record.
 *
 * Rules:
 * - Skip empty lines and lines starting with #
 * - Split on first = only (values can contain =)
 * - Trim whitespace from keys
 * - Strip matching outer quotes from values ("..." or '...')
 * - Ignore lines without =
 * - No variable interpolation
 */
export function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1);
    // Strip matching quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  }
  return env;
}
