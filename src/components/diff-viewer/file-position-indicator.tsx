interface FilePositionIndicatorProps {
  currentIndex: number;
  totalFiles: number;
}

export function FilePositionIndicator({
  currentIndex,
  totalFiles,
}: FilePositionIndicatorProps) {
  if (totalFiles === 0) return null;

  return (
    <span className="text-sm text-surface-400 tabular-nums">
      File {currentIndex + 1} of {totalFiles}
    </span>
  );
}
