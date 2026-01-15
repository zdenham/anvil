import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test/helpers";
import { usePermissionStore } from "@/entities/permissions/store";
import { PermissionModal } from "./permission-modal";

vi.mock("@/entities/permissions/service", () => ({
  permissionService: {
    respond: vi.fn(),
  },
}));

import { permissionService } from "@/entities/permissions/service";

describe("PermissionModal", () => {
  const threadId = "thread-123";

  beforeEach(() => {
    vi.clearAllMocks();
    usePermissionStore.setState({
      requests: {},
      focusedIndex: 0,
      displayMode: "modal",
    });
  });

  it("renders nothing when no pending request", () => {
    render(<PermissionModal threadId={threadId} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders dialog when request is pending", () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId,
      toolName: "Bash",
      toolInput: { command: "rm -rf /" },
      timestamp: Date.now(),
    });

    render(<PermissionModal threadId={threadId} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Allow Bash?")).toBeInTheDocument();
    expect(screen.getByText("$ rm -rf /")).toBeInTheDocument();
  });

  it("shows warning indicator for dangerous tools", () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId,
      toolName: "Bash",
      toolInput: { command: "echo hello" },
      timestamp: Date.now(),
    });

    render(<PermissionModal threadId={threadId} />);

    // The dialog container should have the amber border for dangerous tools
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("border-amber-500/50");
  });

  it("does not show warning indicator for non-dangerous tools", () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId,
      toolName: "Read",
      toolInput: { file_path: "/test.txt" },
      timestamp: Date.now(),
    });

    render(<PermissionModal threadId={threadId} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("border-surface-700");
    expect(dialog).not.toHaveClass("border-amber-500/50");
  });

  it("calls service.respond with approve on Approve click", async () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId,
      toolName: "Read",
      toolInput: { file_path: "/test.txt" },
      timestamp: Date.now(),
    });

    render(<PermissionModal threadId={threadId} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => {
      expect(permissionService.respond).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "req-1" }),
        "approve"
      );
    });
  });

  it("calls service.respond with deny on Deny click", async () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId,
      toolName: "Read",
      toolInput: {},
      timestamp: Date.now(),
    });

    render(<PermissionModal threadId={threadId} />);
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));

    await waitFor(() => {
      expect(permissionService.respond).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "req-1" }),
        "deny"
      );
    });
  });

  it("calls service.respond with deny on backdrop click", async () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId,
      toolName: "Read",
      toolInput: {},
      timestamp: Date.now(),
    });

    render(<PermissionModal threadId={threadId} />);

    // Find the backdrop (first child div with bg-black/60 class)
    const backdrop = document.querySelector(".bg-black\\/60");
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop!);

    await waitFor(() => {
      expect(permissionService.respond).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "req-1" }),
        "deny"
      );
    });
  });

  it("renders nothing when request status is not pending", () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId,
      toolName: "Read",
      toolInput: {},
      timestamp: Date.now(),
    });
    usePermissionStore.getState()._applyUpdateStatus("req-1", "approved");

    render(<PermissionModal threadId={threadId} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nothing for requests from different threads", () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId: "different-thread",
      toolName: "Bash",
      toolInput: { command: "ls" },
      timestamp: Date.now(),
    });

    render(<PermissionModal threadId={threadId} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("has proper accessibility attributes", () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId,
      toolName: "Write",
      toolInput: { file_path: "/test.txt" },
      timestamp: Date.now(),
    });

    render(<PermissionModal threadId={threadId} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "permission-dialog-title");
    expect(screen.getByText("Allow Write?")).toHaveAttribute("id", "permission-dialog-title");
  });

  it("displays file path for file operations", () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId,
      toolName: "Write",
      toolInput: { file_path: "/some/path/file.txt", content: "hello" },
      timestamp: Date.now(),
    });

    render(<PermissionModal threadId={threadId} />);
    expect(screen.getByText("/some/path/file.txt")).toBeInTheDocument();
  });
});
