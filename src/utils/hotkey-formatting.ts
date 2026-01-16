/**
 * Utility functions for formatting hotkey display strings
 */

/**
 * Formats individual key names for display (e.g., "ArrowUp" -> "↑", "Down" -> "↓")
 */
export const formatKeyDisplay = (key: string): string => {
  if (key === " ") return "Space";
  if (key === "ArrowUp" || key === "Up") return "↑";
  if (key === "ArrowDown" || key === "Down") return "↓";
  if (key === "ArrowLeft" || key === "Left") return "←";
  if (key === "ArrowRight" || key === "Right") return "→";
  if (key === "Escape") return "Esc";
  if (key === "Tab") return "Tab";
  if (key.length === 1) return key.toUpperCase();
  return key;
};

/**
 * Formats a full hotkey string for display (e.g., "Shift+Down" -> "Shift+↓")
 */
export const formatHotkeyDisplay = (hotkeyString: string): string => {
  const parts = hotkeyString.split("+");

  return parts.map((part, index) => {
    // For the last part (the actual key), apply key formatting
    if (index === parts.length - 1) {
      return formatKeyDisplay(part);
    }
    // For modifier parts, keep as-is but ensure consistent capitalization
    return part;
  }).join("+");
};