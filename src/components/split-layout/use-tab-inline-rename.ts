/**
 * useTabInlineRename — inline rename hook for tab items.
 *
 * Based on the same pattern as tree-menu's useInlineRename but decoupled
 * from treeMenuService and without space-to-hyphen replacement.
 */

import { useState, useRef, useEffect, useCallback } from "react";

interface UseTabInlineRenameOptions {
  currentName: string;
  onRename: (newName: string) => Promise<void>;
}

interface UseTabInlineRenameReturn {
  isRenaming: boolean;
  renameValue: string;
  inputRef: React.RefObject<HTMLInputElement>;
  startRename: () => void;
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleBlur: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

export function useTabInlineRename({
  currentName,
  onRename,
}: UseTabInlineRenameOptions): UseTabInlineRenameReturn {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isSubmittingRef = useRef(false);

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
    setIsRenaming(false);
  }, [currentName]);

  const submitRename = useCallback(async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    try {
      const trimmed = renameValue.trim();
      if (!trimmed || trimmed === currentName) {
        cancelRename();
        return;
      }
      await onRename(trimmed);
      setIsRenaming(false);
    } finally {
      isSubmittingRef.current = false;
    }
  }, [renameValue, currentName, onRename, cancelRename]);

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
