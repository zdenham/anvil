import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test/helpers";
import { AttachmentPreviewStrip } from "./attachment-preview-strip";

vi.mock("@/lib/browser-stubs", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

describe("AttachmentPreviewStrip", () => {
  it("renders nothing for empty content", () => {
    const { container } = render(<AttachmentPreviewStrip content="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for non-image content", () => {
    const { container } = render(<AttachmentPreviewStrip content="just some text" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders thumbnails for image paths", () => {
    render(<AttachmentPreviewStrip content={"/tmp/photo.png\n/tmp/screenshot.jpg"} />);
    expect(screen.getByAltText("photo.png")).toHaveAttribute("src", "asset:///tmp/photo.png");
    expect(screen.getByAltText("screenshot.jpg")).toHaveAttribute("src", "asset:///tmp/screenshot.jpg");
  });

  it("ignores non-image paths in mixed content", () => {
    render(<AttachmentPreviewStrip content={"some text\n/tmp/photo.png\n/tmp/data.json"} />);
    expect(screen.getByAltText("photo.png")).toBeInTheDocument();
    expect(screen.queryByAltText("data.json")).not.toBeInTheDocument();
  });
});
