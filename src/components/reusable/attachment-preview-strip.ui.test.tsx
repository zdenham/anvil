import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test/helpers";
import { AttachmentPreviewStrip } from "./attachment-preview-strip";

vi.mock("@/lib/browser-stubs", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

describe("AttachmentPreviewStrip", () => {
  it("renders nothing for empty attachments", () => {
    const { container } = render(<AttachmentPreviewStrip attachments={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders thumbnails for image paths", () => {
    render(<AttachmentPreviewStrip attachments={["/tmp/photo.png", "/tmp/screenshot.jpg"]} />);
    expect(screen.getByAltText("photo.png")).toHaveAttribute("src", "asset:///tmp/photo.png");
    expect(screen.getByAltText("screenshot.jpg")).toHaveAttribute("src", "asset:///tmp/screenshot.jpg");
  });

  it("calls onRemove when remove button is clicked", () => {
    const onRemove = vi.fn();
    render(<AttachmentPreviewStrip attachments={["/tmp/photo.png"]} onRemove={onRemove} />);
    screen.getByLabelText("Remove photo.png").click();
    expect(onRemove).toHaveBeenCalledWith("/tmp/photo.png");
  });

  it("does not show remove button when onRemove is not provided", () => {
    render(<AttachmentPreviewStrip attachments={["/tmp/photo.png"]} />);
    expect(screen.queryByLabelText("Remove photo.png")).not.toBeInTheDocument();
  });
});
