import { useState, useRef, useEffect } from "react";
import { cn } from "../../lib/utils";

interface HotkeyRecorderProps {
  onHotkeyChanged: (hotkey: string) => void;
  onConfirm?: () => void;
  defaultHotkey?: string;
  autoFocus?: boolean;
}

interface Hotkey {
  modifiers: Set<string>;
  key: string | null;
}

type RecorderState = "idle" | "recording" | "locked";

const MODIFIERS = ["Shift", "Control", "Alt", "Meta"] as const;
type Modifier = (typeof MODIFIERS)[number];

const MODIFIER_DISPLAY: Record<Modifier, string> = {
  Shift: "⇧",
  Control: "⌃",
  Alt: "⌥",
  Meta: "⌘",
};

const MODIFIER_LABELS: Record<Modifier, string> = {
  Shift: "shift",
  Control: "control",
  Alt: "option",
  Meta: "command",
};

const DEFAULT_HOTKEY: Hotkey = { modifiers: new Set(["Meta"]), key: " " };

const parseHotkey = (str: string): Hotkey => {
  const parts = str.split("+");
  const modifiers = new Set<string>();
  let key: string | null = null;

  for (const part of parts) {
    if (part === "Command") modifiers.add("Meta");
    else if (part === "Ctrl") modifiers.add("Control");
    else if (part === "Alt") modifiers.add("Alt");
    else if (part === "Shift") modifiers.add("Shift");
    else if (part === "Space") key = " ";
    // Handle compact arrow key format
    else if (part === "Up") key = "ArrowUp";
    else if (part === "Down") key = "ArrowDown";
    else if (part === "Left") key = "ArrowLeft";
    else if (part === "Right") key = "ArrowRight";
    else key = part.toLowerCase();
  }

  return { modifiers, key };
};

const formatHotkey = (hotkey: Hotkey): string => {
  const parts: string[] = [];
  if (hotkey.modifiers.has("Shift")) parts.push("Shift");
  if (hotkey.modifiers.has("Control")) parts.push("Ctrl");
  if (hotkey.modifiers.has("Alt")) parts.push("Alt");
  if (hotkey.modifiers.has("Meta")) parts.push("Command");
  if (hotkey.key) {
    // Convert arrow keys to compact format for storage
    let keyPart = hotkey.key;
    if (keyPart === "ArrowUp") keyPart = "Up";
    else if (keyPart === "ArrowDown") keyPart = "Down";
    else if (keyPart === "ArrowLeft") keyPart = "Left";
    else if (keyPart === "ArrowRight") keyPart = "Right";
    else if (keyPart === " ") keyPart = "Space";
    else if (keyPart.length === 1) keyPart = keyPart.toUpperCase();

    parts.push(keyPart);
  }
  return parts.join("+");
};

const normalizeKey = (e: React.KeyboardEvent): string => {
  if (e.code === "Space") return " ";
  if (e.code.startsWith("Key")) return e.code.slice(3).toLowerCase();
  if (e.code.startsWith("Digit")) return e.code.slice(5);
  return e.key;
};

const formatKeyDisplay = (key: string): string => {
  if (key === " ") return "Space";
  if (key === "ArrowUp") return "↑";
  if (key === "ArrowDown") return "↓";
  if (key === "ArrowLeft") return "←";
  if (key === "ArrowRight") return "→";
  if (key === "Escape") return "Esc";
  if (key === "Tab") return "Tab";
  if (key.length === 1) return key.toUpperCase();
  return key;
};

const getActiveModifiers = (e: React.KeyboardEvent): Set<string> => {
  const mods = new Set<string>();
  if (e.metaKey) mods.add("Meta");
  if (e.ctrlKey) mods.add("Control");
  if (e.altKey) mods.add("Alt");
  if (e.shiftKey) mods.add("Shift");
  return mods;
};

export const HotkeyRecorder = ({
  onHotkeyChanged,
  onConfirm,
  defaultHotkey = "Command+Space",
  autoFocus = true,
}: HotkeyRecorderProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hotkey, setHotkey] = useState<Hotkey>(
    () => parseHotkey(defaultHotkey) ?? DEFAULT_HOTKEY
  );
  const [state, setState] = useState<RecorderState>("idle");
  const [recordingModifiers, setRecordingModifiers] = useState<Set<string>>(
    new Set()
  );
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (autoFocus) containerRef.current?.focus();
  }, [autoFocus]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();

    // Enter confirms and moves on (only in idle state)
    if (e.key === "Enter" && state === "idle") {
      onConfirm?.();
      return;
    }

    // Backspace clears the hotkey (only in idle state)
    if (e.key === "Backspace" && state === "idle") {
      const cleared = { modifiers: new Set<string>(), key: null };
      setHotkey(cleared);
      onHotkeyChanged("");
      setState("locked");
      return;
    }

    // Ignore all input while locked
    if (state === "locked") return;

    const currentMods = getActiveModifiers(e);
    const isModifierKey = MODIFIERS.includes(e.key as Modifier);

    if (state === "idle" && currentMods.size > 0 && isModifierKey) {
      // Start recording when a modifier is pressed
      setState("recording");
      setRecordingModifiers(currentMods);
    } else if (state === "recording") {
      if (isModifierKey) {
        // Update modifiers while recording
        setRecordingModifiers(currentMods);
      } else if (currentMods.size > 0) {
        // Non-modifier pressed with modifiers held - commit hotkey
        const newHotkey = { modifiers: currentMods, key: normalizeKey(e) };
        setHotkey(newHotkey);
        onHotkeyChanged(formatHotkey(newHotkey));
        setState("locked");
        setRecordingModifiers(new Set());
      }
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    e.preventDefault();

    const currentMods = getActiveModifiers(e);

    if (state === "recording") {
      if (currentMods.size === 0) {
        // All modifiers released without setting - revert to idle
        setState("idle");
        setRecordingModifiers(new Set());
      } else {
        setRecordingModifiers(currentMods);
      }
    } else if (state === "locked") {
      // Wait for all keys to be released before returning to idle
      if (currentMods.size === 0) {
        setState("idle");
      }
    }
  };

  const displayModifiers =
    state === "recording" ? recordingModifiers : hotkey.modifiers;
  const displayKey = state === "recording" ? null : hotkey.key;

  const getStatusText = () => {
    if (!isFocused && state === "idle") return null; // Handled by overlay
    if (state === "idle" && isFocused)
      return "Press modifier keys (⌘ ⌃ ⌥ ⇧) then a letter or key";
    if (state === "recording") return "Now press a key to complete the shortcut...";
    if (state === "locked") return "✓ Hotkey set! Release all keys to continue";
    return null;
  };

  const statusText = getStatusText();

  return (
    <div className="my-4">
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        data-testid="hotkey-recorder"
        data-state={state}
        className={cn(
          "relative border-2 rounded-lg p-6 min-h-[80px] flex items-center justify-center gap-6 transition-all outline-none",
          state === "locked" && "border-green-500 bg-green-900/20",
          state === "recording" && "border-blue-500 bg-blue-900/20",
          state === "idle" &&
            isFocused &&
            "border-secondary-500 bg-secondary-900/20",
          state === "idle" && !isFocused && "border-surface-600 bg-surface-800"
        )}
      >
        {/* Gaussian blur overlay for unfocused idle state */}
        {!isFocused && state === "idle" && (
          <div
            className="absolute inset-0 rounded-lg backdrop-blur-sm bg-surface-900/30 flex items-center justify-center cursor-pointer z-10"
            onClick={() => containerRef.current?.focus()}
            data-testid="hotkey-recorder-overlay"
          >
            <span className="px-4 py-2 rounded-md bg-surface-700 text-surface-200 text-sm font-medium border border-surface-500 hover:bg-surface-600 transition-colors">
              Click to start recording
            </span>
          </div>
        )}

        <div className="flex gap-2">
          {MODIFIERS.map((mod) => (
            <div key={mod} className="relative flex flex-col items-center">
              <kbd
                data-testid={`modifier-${mod.toLowerCase()}`}
                className={cn(
                  "px-3 py-1.5 rounded-md font-mono text-lg min-w-[2.5rem] text-center font-semibold transition-all duration-100 border",
                  displayModifiers.has(mod)
                    ? "bg-surface-900 text-surface-100 shadow-md border-surface-500"
                    : "bg-surface-600 text-surface-400 border-surface-500"
                )}
              >
                {MODIFIER_DISPLAY[mod]}
              </kbd>
              <span className="absolute -bottom-4 text-[9px] text-surface-500">{MODIFIER_LABELS[mod]}</span>
            </div>
          ))}
        </div>

        <span className="text-surface-400 text-xl font-light">+</span>

        <kbd
          data-testid="hotkey-key"
          className={cn(
            "px-2 py-1.5 rounded-md font-mono text-lg w-[5rem] text-center font-semibold transition-all duration-100 border",
            displayKey
              ? "bg-surface-900 text-surface-100 shadow-md border-surface-500"
              : "bg-surface-600 text-surface-400 border-surface-500"
          )}
        >
          {displayKey ? formatKeyDisplay(displayKey) : "?"}
        </kbd>
      </div>

      {/* Status text indicator */}
      {statusText && (
        <p
          className={cn(
            "text-sm mt-2 text-center transition-colors",
            state === "locked" && "text-green-400",
            state === "recording" && "text-blue-400",
            state === "idle" && "text-surface-400"
          )}
          data-testid="hotkey-recorder-status"
        >
          {statusText}
        </p>
      )}
    </div>
  );
};
