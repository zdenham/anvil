import { useState, useRef, useEffect, useCallback } from "react";
import { treeMenuService } from "@/stores/tree-menu/service";

interface UseInlineRenameOptions {
  /** Current name of the item */
  currentName: string;
  /** Called with the new name when rename is confirmed */
  onRename: (newName: string) => Promise<void>;
  /** Validation function — return error message or null if valid */
  validate?: (name: string) => string | null;
}

interface UseInlineRenameReturn {
  /** Whether rename mode is active */
  isRenaming: boolean;
  /** Current value in the rename input */
  renameValue: string;
  /** Ref to attach to the input element */
  inputRef: React.RefObject<HTMLInputElement>;
  /** Start rename mode */
  startRename: () => void;
  /** Handle input value changes */
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Handle blur (submit) */
  handleBlur: () => void;
  /** Handle keydown (Enter to submit, Escape to cancel) */
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

/** Default validation: non-empty after trim. */
function defaultValidate(name: string): string | null {
  return name.trim().length > 0 ? null : "Name cannot be empty";
}

/**
 * Shared hook for inline rename behavior on tree items.
 * Encapsulates rename state, input focus/select, submit/cancel logic.
 * Matches the UX pattern from worktree-item.tsx rename.
 */
export function useInlineRename({
  currentName,
  onRename,
  validate = defaultValidate,
}: UseInlineRenameOptions): UseInlineRenameReturn {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isSubmittingRef = useRef(false);

  // Focus and select all text when rename mode activates
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const startRename = useCallback(() => {
    setRenameValue(currentName);
    setIsRenaming(true);
  }, [currentName]);

  const cancelRename = useCallback(() => {
    setRenameValue(currentName);
    treeMenuService.stopRename();
    setIsRenaming(false);
  }, [currentName]);

  const submitRename = useCallback(async () => {
    // Guard against double-submit (Enter causes blur which re-fires)
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    try {
      const trimmed = renameValue.trim();
      const error = validate(trimmed);

      if (error || trimmed === currentName) {
        cancelRename();
        return;
      }

      await onRename(trimmed);
      treeMenuService.stopRename();
      setIsRenaming(false);
    } finally {
      isSubmittingRef.current = false;
    }
  }, [renameValue, validate, currentName, onRename, cancelRename]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setRenameValue(e.target.value),
    [],
  );

  const handleBlur = useCallback(() => {
    void submitRename();
  }, [submitRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void submitRename();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelRename();
      }
    },
    [submitRename, cancelRename],
  );

  return {
    isRenaming,
    renameValue,
    inputRef,
    startRename,
    handleChange,
    handleBlur,
    handleKeyDown,
  };
}
