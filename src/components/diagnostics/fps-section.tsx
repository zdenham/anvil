import { useState, useEffect } from "react";
import { getCurrentFps } from "@/lib/frame-rate-monitor";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 1_000;

function fpsColor(fps: number): string {
  if (fps >= 50) return "text-green-400";
  if (fps >= 30) return "text-amber-400";
  return "text-red-400";
}

function fpsDot(fps: number): string {
  if (fps >= 50) return "bg-green-500";
  if (fps >= 30) return "bg-amber-400";
  return "bg-red-500";
}

export function FpsSection() {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setFps(getCurrentFps());
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <section>
      <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-2">
        Frame Rate
      </h4>
      <div className="flex items-center gap-2 text-xs font-mono">
        {fps !== null ? (
          <>
            <span className={cn("inline-block w-2 h-2 rounded-full flex-shrink-0", fpsDot(fps))} />
            <span className={cn("flex-shrink-0", fpsColor(fps))}>
              {fps.toFixed(1)} FPS
            </span>
          </>
        ) : (
          <span className="text-surface-500 italic">Collecting data...</span>
        )}
      </div>
    </section>
  );
}
