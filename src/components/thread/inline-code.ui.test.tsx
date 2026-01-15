import { describe, it, expect } from "vitest";
import { render, screen } from "@/test/helpers";
import { InlineCode } from "./inline-code";

describe("InlineCode", () => {
  it("renders children as code element", () => {
    render(<InlineCode>console.log</InlineCode>);

    const codeElement = screen.getByText("console.log");
    expect(codeElement).toBeInTheDocument();
    expect(codeElement.tagName).toBe("CODE");
  });

  it("applies custom className when provided", () => {
    render(<InlineCode className="custom-class">test</InlineCode>);

    const codeElement = screen.getByText("test");
    expect(codeElement).toHaveClass("custom-class");
  });

  it("has correct base styling classes", () => {
    render(<InlineCode>styled</InlineCode>);

    const codeElement = screen.getByText("styled");
    expect(codeElement).toHaveClass("text-amber-400");
    expect(codeElement).toHaveClass("bg-zinc-800/50");
    expect(codeElement).toHaveClass("px-1");
    expect(codeElement).toHaveClass("py-0.5");
    expect(codeElement).toHaveClass("rounded");
    expect(codeElement).toHaveClass("before:content-none");
    expect(codeElement).toHaveClass("after:content-none");
  });
});
