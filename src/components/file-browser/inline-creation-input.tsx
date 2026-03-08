import { useState, useRef, useEffect } from "react";
import { Folder } from "lucide-react";
import { getTreeIndentPx } from "@/lib/tree-indent";
import { getFileIconUrl } from "./file-icons";

interface InlineCreationInputProps {
  type: "file" | "directory";
  depth: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function InlineCreationInput({ type, depth, onConfirm, onCancel }: InlineCreationInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmedRef = useRef(false);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed && !trimmed.includes("/") && !trimmed.includes("\\")) {
        confirmedRef.current = true;
        onConfirm(trimmed);
      }
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div
      className="flex items-center gap-1 w-full py-0.5 text-xs"
      style={{ paddingLeft: getTreeIndentPx(depth) }}
    >
      {type === "directory" ? (
        <Folder size={12} className="flex-shrink-0 text-surface-400" />
      ) : (
        <img src={getFileIconUrl(value || "untitled")} alt="" className="w-3 h-3 flex-shrink-0" />
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (!confirmedRef.current) onCancel(); }}
        className="flex-1 bg-surface-800 text-surface-200 text-xs px-1.5 py-0.5 rounded border border-surface-600 outline-none focus:border-accent-500 min-w-0"
        placeholder={type === "file" ? "filename" : "folder name"}
      />
    </div>
  );
}
