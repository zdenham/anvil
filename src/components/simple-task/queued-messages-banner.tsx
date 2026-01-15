import { useState, useEffect } from "react";
import { X } from "lucide-react";

interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
}

interface QueuedMessagesBannerProps {
  messages: QueuedMessage[];
}

export function QueuedMessagesBanner({ messages }: QueuedMessagesBannerProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Reset collapsed state when messages change (e.g., new message added)
  useEffect(() => {
    if (messages.length > 0) {
      setCollapsed(false);
    }
  }, [messages.length]);

  if (messages.length === 0 || collapsed) return null;

  return (
    <div className="px-4 py-2 bg-surface-800 border-t border-surface-700">
      <div className="flex items-center gap-2 text-xs text-surface-400 mb-1">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        <span className="flex-1">
          Queued {messages.length === 1 ? 'message' : 'messages'} (will be sent when agent is ready)
        </span>
        <button
          onClick={() => setCollapsed(true)}
          className="p-0.5 hover:bg-surface-700 rounded transition-colors"
          aria-label="Hide queued messages"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="space-y-1">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className="text-sm text-surface-300 bg-surface-700/50 rounded px-2 py-1 truncate"
          >
            {msg.content}
          </div>
        ))}
      </div>
    </div>
  );
}
