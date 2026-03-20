import type { LogEntry, LogLevel } from "@/entities/logs";

const levelStyles: Record<LogLevel, { text: string; bg: string }> = {
  trace: { text: "text-surface-500", bg: "" },
  debug: { text: "text-surface-400", bg: "" },
  info: { text: "text-accent-400", bg: "" },
  warn: { text: "text-amber-400", bg: "bg-amber-950/20" },
  error: { text: "text-red-400", bg: "bg-red-950/30" },
};

interface LogEntryRowProps {
  log: LogEntry;
}

export function LogEntryRow({ log }: LogEntryRowProps) {
  const style = levelStyles[log.level] ?? levelStyles.debug;
  const date = new Date(log.timestamp);
  const time = date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  const formattedTime = `${time}.${ms}`;

  return (
    <div className={`flex gap-2 px-2 py-0.5 font-mono text-xs ${style.bg}`}>
      <span className="text-surface-500 shrink-0">{formattedTime}</span>
      <span className={`w-12 shrink-0 uppercase ${style.text}`}>
        {log.level}
      </span>
      <span className="text-surface-500 shrink-0 truncate max-w-32">
        [{log.target}]
      </span>
      <span className="text-surface-300 truncate">{log.message}</span>
    </div>
  );
}
