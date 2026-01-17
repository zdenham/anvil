import { useState } from "react";

interface GlobalErrorViewProps {
  message: string;
  stack?: string;
  onDismiss?: () => void;
}

export function GlobalErrorView({ message, stack, onDismiss }: GlobalErrorViewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyStack = async () => {
    const textToCopy = stack || message;
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="error-container fixed inset-0 bg-surface-900 p-4 overflow-auto rounded-xl border border-surface-700/50">
      <pre className="text-xs text-surface-300 whitespace-pre-wrap font-mono">
        {message}
        {stack && `\n\n${stack}`}
      </pre>
      <div className="mt-2 text-xs">
        <button
          onClick={handleCopyStack}
          className="text-surface-400 hover:text-surface-200 underline"
        >
          {copied ? "copied" : "copy"}
        </button>
        {onDismiss && (
          <>
            <span className="text-surface-500 mx-2">·</span>
            <button
              onClick={onDismiss}
              className="text-surface-400 hover:text-surface-200 underline"
            >
              dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}
