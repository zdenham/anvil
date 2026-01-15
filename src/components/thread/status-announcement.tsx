type ThreadStatus = "idle" | "loading" | "running" | "completed" | "error" | "cancelled";

interface StatusAnnouncementProps {
  status: ThreadStatus;
  error?: string;
}

/**
 * Screen reader-only live region for status announcements.
 */
export function StatusAnnouncement({ status, error }: StatusAnnouncementProps) {
  let announcement = "";

  switch (status) {
    case "idle":
      announcement = ""; // No announcement needed
      break;
    case "loading":
      announcement = "Loading thread";
      break;
    case "running":
      announcement = "Assistant is responding";
      break;
    case "completed":
      announcement = "Response complete";
      break;
    case "error":
      announcement = error ? `Error: ${error}` : "An error occurred";
      break;
    case "cancelled":
      announcement = "Task cancelled";
      break;
  }

  if (!announcement) return null;

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );
}
