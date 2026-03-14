import { describe, it, expect } from "vitest";
import { EventName, LIFECYCLE_EVENTS } from "../events.js";

describe("LIFECYCLE_EVENTS", () => {
  it("contains all sidebar-affecting thread events", () => {
    expect(LIFECYCLE_EVENTS.has(EventName.THREAD_OPTIMISTIC_CREATED)).toBe(true);
    expect(LIFECYCLE_EVENTS.has(EventName.THREAD_CREATED)).toBe(true);
    expect(LIFECYCLE_EVENTS.has(EventName.THREAD_UPDATED)).toBe(true);
    expect(LIFECYCLE_EVENTS.has(EventName.THREAD_STATUS_CHANGED)).toBe(true);
    expect(LIFECYCLE_EVENTS.has(EventName.THREAD_ARCHIVED)).toBe(true);
    expect(LIFECYCLE_EVENTS.has(EventName.THREAD_NAME_GENERATED)).toBe(true);
  });

  it("contains pending-input events (yellow dot)", () => {
    expect(LIFECYCLE_EVENTS.has(EventName.PERMISSION_REQUEST)).toBe(true);
    expect(LIFECYCLE_EVENTS.has(EventName.QUESTION_REQUEST)).toBe(true);
  });

  it("contains plan/PR/terminal/folder tree node events", () => {
    for (const name of [
      EventName.PLAN_DETECTED, EventName.PLAN_CREATED, EventName.PLAN_UPDATED, EventName.PLAN_ARCHIVED,
      EventName.PR_DETECTED, EventName.PR_CREATED, EventName.PR_UPDATED, EventName.PR_ARCHIVED,
      EventName.TERMINAL_CREATED, EventName.TERMINAL_UPDATED, EventName.TERMINAL_ARCHIVED,
      EventName.FOLDER_CREATED, EventName.FOLDER_UPDATED, EventName.FOLDER_DELETED, EventName.FOLDER_ARCHIVED,
    ]) {
      expect(LIFECYCLE_EVENTS.has(name)).toBe(true);
    }
  });

  it("contains worktree/repo/relation/global events", () => {
    for (const name of [
      EventName.WORKTREE_ALLOCATED, EventName.WORKTREE_RELEASED,
      EventName.WORKTREE_NAME_GENERATED, EventName.WORKTREE_SYNCED,
      EventName.REPOSITORY_CREATED, EventName.REPOSITORY_UPDATED, EventName.REPOSITORY_DELETED,
      EventName.RELATION_CREATED, EventName.RELATION_UPDATED,
      EventName.SETTINGS_UPDATED, EventName.API_DEGRADED,
    ]) {
      expect(LIFECYCLE_EVENTS.has(name)).toBe(true);
    }
  });

  it("does NOT contain high-frequency display events", () => {
    expect(LIFECYCLE_EVENTS.has(EventName.STREAM_DELTA)).toBe(false);
    expect(LIFECYCLE_EVENTS.has(EventName.THREAD_ACTION)).toBe(false);
    expect(LIFECYCLE_EVENTS.has(EventName.QUEUED_MESSAGE_ACK)).toBe(false);
  });

  it("does NOT contain thread-scoped display events", () => {
    for (const name of [
      EventName.AGENT_SPAWNED, EventName.AGENT_COMPLETED, EventName.AGENT_ERROR,
      EventName.AGENT_TOOL_COMPLETED, EventName.AGENT_CANCELLED,
      EventName.THREAD_FILE_CREATED, EventName.THREAD_FILE_MODIFIED,
      EventName.USER_MESSAGE_SENT, EventName.ACTION_REQUESTED,
      EventName.PERMISSION_RESPONSE, EventName.QUESTION_RESPONSE,
      EventName.PERMISSION_MODE_CHANGED,
      EventName.GATEWAY_EVENT, EventName.GATEWAY_STATUS, EventName.GITHUB_WEBHOOK_EVENT,
      EventName.COMMENT_ADDED, EventName.COMMENT_UPDATED,
      EventName.COMMENT_RESOLVED, EventName.COMMENT_DELETED,
    ]) {
      expect(LIFECYCLE_EVENTS.has(name)).toBe(false);
    }
  });

  it("defaults new/unknown event names to display-gated (not in set)", () => {
    expect(LIFECYCLE_EVENTS.has("some:new:event")).toBe(false);
  });
});
