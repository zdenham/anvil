import { useCallback } from "react";
import { Play, Pause, SkipForward, Square } from "lucide-react";
import { useEventDebuggerStore } from "@/stores/event-debugger-store";

const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;

export function ReplayControls({ eventCount }: { eventCount: number }) {
  const replayState = useEventDebuggerStore((s) => s.replayState);
  const replayIndex = useEventDebuggerStore((s) => s.replayIndex);
  const replaySpeed = useEventDebuggerStore((s) => s.replaySpeed);
  const startReplay = useEventDebuggerStore((s) => s.startReplay);
  const pauseReplay = useEventDebuggerStore((s) => s.pauseReplay);
  const resumeReplay = useEventDebuggerStore((s) => s.resumeReplay);
  const stepForward = useEventDebuggerStore((s) => s.stepForward);
  const stopReplay = useEventDebuggerStore((s) => s.stopReplay);
  const setReplaySpeed = useEventDebuggerStore((s) => s.setReplaySpeed);

  const handlePlayPause = useCallback(() => {
    if (replayState === "idle") {
      startReplay();
    } else if (replayState === "playing") {
      pauseReplay();
    } else {
      resumeReplay();
    }
  }, [replayState, startReplay, pauseReplay, resumeReplay]);

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 border-b border-surface-800 flex-shrink-0 bg-surface-850">
      <button
        onClick={handlePlayPause}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-surface-300 hover:text-surface-100 hover:bg-surface-700 transition-colors"
        title={replayState === "playing" ? "Pause" : "Play"}
      >
        {replayState === "playing" ? <Pause size={10} /> : <Play size={10} />}
      </button>
      <button
        onClick={stepForward}
        disabled={replayState === "idle" && replayIndex === 0 && eventCount === 0}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-surface-300 hover:text-surface-100 hover:bg-surface-700 transition-colors disabled:opacity-40"
        title="Step forward"
      >
        <SkipForward size={10} />
      </button>
      <select
        value={replaySpeed}
        onChange={(e) => setReplaySpeed(Number(e.target.value))}
        className="bg-surface-800 text-[10px] text-surface-300 rounded px-1 py-0.5 outline-none border border-surface-700"
      >
        {REPLAY_SPEEDS.map((s) => (
          <option key={s} value={s}>{s}x</option>
        ))}
      </select>
      {replayState !== "idle" && (
        <button
          onClick={stopReplay}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
          title="Stop replay"
        >
          <Square size={10} />
        </button>
      )}
      {replayState !== "idle" && (
        <span className="text-[10px] text-surface-400 ml-auto">
          {replayIndex}/{eventCount}
        </span>
      )}
    </div>
  );
}
