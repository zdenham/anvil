import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test/helpers";
import { PermissionInline } from "./permission-inline";
import type { PermissionRequest, PermissionStatus } from "@core/types/permissions.js";

vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/entities/permissions/service", () => ({
  permissionService: {
    respond: vi.fn(),
  },
}));

import { permissionService } from "@/entities/permissions/service";

describe("PermissionInline", () => {
  const createRequest = (
    overrides: Partial<PermissionRequest & { status: PermissionStatus }> = {}
  ): PermissionRequest & { status: PermissionStatus } => ({
    requestId: "req-123",
    threadId: "thread-456",
    toolName: "Write",
    toolInput: { file_path: "/test.txt", content: "hello" },
    timestamp: Date.now(),
    status: "pending",
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("renders tool name and key parameters", () => {
      const request = createRequest();

      render(<PermissionInline request={request} isFocused={false} />);

      expect(screen.getByText("Permission Required")).toBeInTheDocument();
      // Tool name is displayed in a span with font-mono class
      expect(screen.getByText("Write")).toBeInTheDocument();
      expect(screen.getByText(/test\.txt/)).toBeInTheDocument();
    });

    it("shows 'Writes' badge for dangerous tools", () => {
      const request = createRequest({ toolName: "Bash", toolInput: { command: "rm -rf /" } });

      render(<PermissionInline request={request} isFocused={false} />);

      expect(screen.getByText("Writes")).toBeInTheDocument();
    });

    it("does not show 'Writes' badge for safe tools", () => {
      const request = createRequest({ toolName: "Read", toolInput: { file_path: "/test.txt" } });

      render(<PermissionInline request={request} isFocused={false} />);

      expect(screen.queryByText("Writes")).not.toBeInTheDocument();
    });
  });

  describe("focus styling", () => {
    it("shows focus ring when focused", () => {
      const request = createRequest();

      const { container } = render(<PermissionInline request={request} isFocused={true} />);

      expect(container.firstChild).toHaveClass("ring-2");
    });

    it("does not show focus ring when not focused", () => {
      const request = createRequest();

      const { container } = render(<PermissionInline request={request} isFocused={false} />);

      expect(container.firstChild).not.toHaveClass("ring-2");
    });
  });

  describe("approve action", () => {
    it("calls service.respond on Approve click", async () => {
      const request = createRequest();

      render(<PermissionInline request={request} isFocused={false} />);
      fireEvent.click(screen.getByRole("button", { name: /approve/i }));

      await waitFor(() => {
        expect(permissionService.respond).toHaveBeenCalledWith(request, "approve");
      });
    });

    it("does not call service.respond if status is not pending", async () => {
      const request = createRequest({ status: "approved" });

      render(<PermissionInline request={request} isFocused={false} />);

      // No approve button should be visible
      expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    });
  });

  describe("reject action", () => {
    it("shows reason input on first reject click", () => {
      const request = createRequest();

      render(<PermissionInline request={request} isFocused={false} />);
      fireEvent.click(screen.getByRole("button", { name: /reject/i }));

      expect(screen.getByPlaceholderText(/reason/i)).toBeInTheDocument();
    });

    it("submits reject with reason on second click", async () => {
      const request = createRequest();

      render(<PermissionInline request={request} isFocused={false} />);

      // First click shows input
      fireEvent.click(screen.getByRole("button", { name: /reject/i }));

      // Type reason
      const input = screen.getByPlaceholderText(/reason/i);
      fireEvent.change(input, { target: { value: "Not safe" } });

      // Second click submits
      fireEvent.click(screen.getByRole("button", { name: /reject/i }));

      await waitFor(() => {
        expect(permissionService.respond).toHaveBeenCalledWith(request, "deny", "Not safe");
      });
    });

    it("submits reject without reason if empty", async () => {
      const request = createRequest();

      render(<PermissionInline request={request} isFocused={false} />);

      // First click shows input
      fireEvent.click(screen.getByRole("button", { name: /reject/i }));

      // Second click submits without typing
      fireEvent.click(screen.getByRole("button", { name: /reject/i }));

      await waitFor(() => {
        expect(permissionService.respond).toHaveBeenCalledWith(request, "deny", undefined);
      });
    });

    it("submits on Enter key in reason input", async () => {
      const request = createRequest();

      render(<PermissionInline request={request} isFocused={false} />);

      // First click shows input
      fireEvent.click(screen.getByRole("button", { name: /reject/i }));

      // Type reason and press Enter
      const input = screen.getByPlaceholderText(/reason/i);
      fireEvent.change(input, { target: { value: "Bad command" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(permissionService.respond).toHaveBeenCalledWith(request, "deny", "Bad command");
      });
    });

    it("cancels reject input on Escape key", () => {
      const request = createRequest();

      render(<PermissionInline request={request} isFocused={false} />);

      // First click shows input
      fireEvent.click(screen.getByRole("button", { name: /reject/i }));
      expect(screen.getByPlaceholderText(/reason/i)).toBeInTheDocument();

      // Press Escape
      fireEvent.keyDown(screen.getByPlaceholderText(/reason/i), { key: "Escape" });

      // Input should be hidden
      expect(screen.queryByPlaceholderText(/reason/i)).not.toBeInTheDocument();
      expect(permissionService.respond).not.toHaveBeenCalled();
    });
  });

  describe("status badges", () => {
    it("shows Approved badge for approved status", () => {
      const request = createRequest({ status: "approved" });

      render(<PermissionInline request={request} isFocused={false} />);

      expect(screen.getByText("Approved")).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("shows Denied badge for denied status", () => {
      const request = createRequest({ status: "denied" });

      render(<PermissionInline request={request} isFocused={false} />);

      expect(screen.getByText("Denied")).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("hides action buttons when not pending", () => {
      const request = createRequest({ status: "approved" });

      render(<PermissionInline request={request} isFocused={false} />);

      expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /reject/i })).not.toBeInTheDocument();
    });
  });

  describe("status styles", () => {
    it("applies pending styles for pending status", () => {
      const request = createRequest({ status: "pending" });

      const { container } = render(<PermissionInline request={request} isFocused={false} />);

      expect(container.firstChild).toHaveClass("border-amber-500/50");
      expect(container.firstChild).toHaveClass("bg-amber-950/20");
    });

    it("applies approved styles for approved status", () => {
      const request = createRequest({ status: "approved" });

      const { container } = render(<PermissionInline request={request} isFocused={false} />);

      expect(container.firstChild).toHaveClass("border-green-500/50");
      expect(container.firstChild).toHaveClass("bg-green-950/20");
    });

    it("applies denied styles for denied status", () => {
      const request = createRequest({ status: "denied" });

      const { container } = render(<PermissionInline request={request} isFocused={false} />);

      expect(container.firstChild).toHaveClass("border-red-500/50");
      expect(container.firstChild).toHaveClass("bg-red-950/20");
    });
  });

  describe("accessibility", () => {
    it("has correct accessibility attributes", () => {
      const request = createRequest({ toolName: "Write" });

      render(<PermissionInline request={request} isFocused={false} />);

      expect(screen.getByRole("dialog")).toHaveAttribute(
        "aria-label",
        "Permission request for Write"
      );
    });

    it("has correct data-testid", () => {
      const request = createRequest({ requestId: "req-abc" });

      render(<PermissionInline request={request} isFocused={false} />);

      expect(screen.getByTestId("permission-prompt-req-abc")).toBeInTheDocument();
    });

    it("has correct data-status attribute", () => {
      const request = createRequest({ status: "pending" });

      render(<PermissionInline request={request} isFocused={false} />);

      expect(screen.getByRole("dialog")).toHaveAttribute("data-status", "pending");
    });

    it("has aria-label on approve button", () => {
      const request = createRequest();

      render(<PermissionInline request={request} isFocused={false} />);

      expect(screen.getByRole("button", { name: /approve/i })).toHaveAttribute(
        "aria-label",
        "Approve (y)"
      );
    });

    it("has aria-label on reject button", () => {
      const request = createRequest();

      render(<PermissionInline request={request} isFocused={false} />);

      expect(screen.getByRole("button", { name: /reject/i })).toHaveAttribute(
        "aria-label",
        "Reject (n)"
      );
    });
  });

  describe("tool input display", () => {
    it("displays bash command correctly", () => {
      const request = createRequest({
        toolName: "Bash",
        toolInput: { command: "npm install" },
      });

      render(<PermissionInline request={request} isFocused={false} />);

      expect(screen.getByText(/npm install/)).toBeInTheDocument();
    });

    it("displays file path correctly", () => {
      const request = createRequest({
        toolName: "Write",
        toolInput: { file_path: "/path/to/file.txt" },
      });

      render(<PermissionInline request={request} isFocused={false} />);

      expect(screen.getByText(/\/path\/to\/file\.txt/)).toBeInTheDocument();
    });
  });
});
