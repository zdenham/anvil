import { useEffect, useState } from "react";
import { getSavedHotkey } from "@/lib/hotkey-service";

export function EmptyTaskState() {
  const [hotkey, setHotkey] = useState<string>("...");

  useEffect(() => {
    getSavedHotkey().then(setHotkey).catch(() => setHotkey("your hotkey"));
  }, []);

  return (
    <div className="flex flex-col items-center h-full text-surface-400 px-8 pt-24">
      <div className="max-w-md space-y-6">
        <h2 className="text-xl font-medium font-mono text-surface-100">
          No Tasks Yet
        </h2>
        <p className="text-base">
          Get started by creating your first task:
        </p>
        <ol className="list-decimal list-inside space-y-3 text-base">
          <li>
            Press <kbd className="px-2 py-1 bg-surface-700 rounded text-surface-200 mx-1">{hotkey}</kbd>
          </li>
          <li>
            Type <span className="text-surface-200">"append hello world to the readme"</span>
          </li>
          <li>
            Press <kbd className="px-2 py-1 bg-surface-700 rounded text-surface-200 mx-1">Enter</kbd>
          </li>
        </ol>
      </div>
    </div>
  );
}
