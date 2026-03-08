import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test/helpers";
import { UserMessage } from "./user-message";
import type { Turn } from "@/lib/utils/turn-grouping";

vi.mock("@/lib/browser-stubs", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

function makeTurn(content: string): Turn {
  return {
    type: "user",
    message: { role: "user", content },
    messageId: "msg-1",
  };
}

describe("UserMessage", () => {
  it("renders plain text in a bubble", () => {
    render(<UserMessage turn={makeTurn("hello world")} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders images for image paths", () => {
    render(<UserMessage turn={makeTurn("/tmp/photo.png")} />);
    const img = screen.getByAltText("photo.png");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "asset:///tmp/photo.png");
  });

  it("strips image paths from text bubble", () => {
    render(<UserMessage turn={makeTurn("look at this\n/tmp/photo.png")} />);
    expect(screen.getByText("look at this")).toBeInTheDocument();
    expect(screen.queryByText("/tmp/photo.png")).not.toBeInTheDocument();
    expect(screen.getByAltText("photo.png")).toBeInTheDocument();
  });

  it("omits text bubble when message is image-only", () => {
    const { container } = render(<UserMessage turn={makeTurn("/tmp/a.png\n/tmp/b.jpg")} />);
    expect(screen.getByAltText("a.png")).toBeInTheDocument();
    expect(screen.getByAltText("b.jpg")).toBeInTheDocument();
    // No text bubble rendered
    expect(container.querySelector("p")).not.toBeInTheDocument();
  });

  it("renders both images and text for mixed content", () => {
    render(<UserMessage turn={makeTurn("/tmp/cat.gif\ncheck this out\n/tmp/dog.webp")} />);
    expect(screen.getByAltText("cat.gif")).toBeInTheDocument();
    expect(screen.getByAltText("dog.webp")).toBeInTheDocument();
    expect(screen.getByText("check this out")).toBeInTheDocument();
  });

  it("does not render images for non-image absolute paths", () => {
    render(<UserMessage turn={makeTurn("/tmp/readme.md")} />);
    expect(screen.getByText("/tmp/readme.md")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
