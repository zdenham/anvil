/**
 * Rollback function returned by apply operations.
 */
export type Rollback = () => void;

/**
 * Executes an optimistic update with automatic rollback on failure.
 * Type parameter ensures the applied data matches what's persisted.
 *
 * @param data - The data to apply and persist (ensures type safety between apply and persist)
 * @param apply - Function that applies the update to state and returns a rollback function
 * @param persist - Async function that persists the change
 * @returns Promise that resolves when persistence completes
 * @throws Re-throws persistence errors after rollback
 *
 * @example
 * ```typescript
 * const updated: TaskMetadata = { ...existing, ...updates };
 *
 * await optimistic(
 *   updated,
 *   (task) => useTaskStore.getState()._applyUpdate(id, task),
 *   (task) => persistence.writeJson(`tasks/${task.slug}/metadata.json`, task)
 * );
 * ```
 */
export async function optimistic<T>(
  data: T,
  apply: (data: T) => Rollback,
  persist: (data: T) => Promise<void>
): Promise<void> {
  const rollback = apply(data);
  try {
    await persist(data);
  } catch (error) {
    rollback();
    throw error;
  }
}
