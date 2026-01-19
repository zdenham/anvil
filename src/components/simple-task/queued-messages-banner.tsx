interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
}

interface QueuedMessagesBannerProps {
  messages: QueuedMessage[];
}

export function QueuedMessagesBanner({ messages }: QueuedMessagesBannerProps) {
  if (messages.length === 0) return null;

  return (
    <div className="px-4 py-2 bg-surface-800 border-t border-surface-700">
      <div className="flex items-center gap-2 text-xs text-surface-400 mb-1">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        <span>
          Queued {messages.length === 1 ? 'message' : 'messages'} (will be sent when agent is ready)
        </span>
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
