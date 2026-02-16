import { AlertTriangle, X } from "lucide-react";

interface FileBrowserErrorProps {
  error: string;
  currentPath: string;
  onClose: () => void;
}

export function FileBrowserError({
  error,
  currentPath,
  onClose,
}: FileBrowserErrorProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Minimal header with close button */}
      <div className="flex items-center justify-end px-3 py-2 border-b border-surface-700">
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Close file browser"
        >
          <X size={12} />
        </button>
      </div>

      {/* Error content — matches StalePlanView layout */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-full bg-amber-500/10">
              <AlertTriangle className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-medium text-surface-100">
                Directory not found
              </h2>
              <p className="text-sm text-surface-400">
                This directory may have been moved or deleted
              </p>
            </div>
          </div>

          <div className="mb-6 p-3 bg-surface-800 rounded-lg border border-surface-700">
            <div className="text-xs text-surface-400 mb-1">Path:</div>
            <code className="text-sm text-surface-200 font-mono break-all">
              {currentPath}
            </code>
            <div className="text-xs text-surface-500 mt-2 break-all">
              {error}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-2.5 text-surface-400 hover:text-surface-200 hover:bg-surface-800 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
