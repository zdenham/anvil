/**
 * Result of resolving a thread by ID.
 */
export interface ThreadResolution {
  /** The thread's unique ID */
  threadId: string;
  /** Full path to thread directory */
  threadDir: string;
  /** Agent type (e.g., "execution", "research") - optional for backwards compatibility */
  agentType?: string;
}
