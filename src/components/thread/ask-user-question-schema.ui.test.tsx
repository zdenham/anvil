import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test/helpers";
import { AskUserQuestionBlock } from "./ask-user-question-block";
import {
  parseAskUserQuestionInput,
  AskUserQuestionInputSchema,
  FlatAskUserQuestionSchema,
} from "@core/types/ask-user-question.js";

vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("AskUserQuestionBlock - Schema Validation", () => {
  /**
   * Test that component works with normalized options format
   */
  it("renders with normalized options format", () => {
    render(
      <AskUserQuestionBlock
        id="test"
        question="Test question"
        options={[{ label: "Option A" }, { label: "Option B" }]}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText("Test question")).toBeInTheDocument();
    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(screen.getByText("Option B")).toBeInTheDocument();
  });

  /**
   * Test that descriptions are rendered when provided
   */
  it("renders options with descriptions", () => {
    render(
      <AskUserQuestionBlock
        id="test"
        question="Choose an option"
        options={[
          { label: "Option A", description: "First option description" },
          { label: "Option B", description: "Second option description" },
        ]}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText("First option description")).toBeInTheDocument();
    expect(screen.getByText("Second option description")).toBeInTheDocument();
  });

  /**
   * Test that header chip is rendered when provided
   */
  it("renders header chip when provided", () => {
    render(
      <AskUserQuestionBlock
        id="test"
        question="Choose an option"
        header="Category"
        options={[{ label: "Option A" }]}
        status="pending"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText("Category")).toBeInTheDocument();
  });
});

describe("Schema Validation Functions", () => {
  it("validates correct Claude Code nested format", () => {
    const input = {
      questions: [
        {
          question: "Which approach?",
          header: "Approach",
          options: [
            { label: "A", description: "First" },
            { label: "B", description: "Second" },
          ],
          multiSelect: false,
        },
      ],
    };
    expect(AskUserQuestionInputSchema.safeParse(input).success).toBe(true);
  });

  it("validates correct flat format", () => {
    const input = {
      question: "Which approach?",
      options: ["A", "B"],
      allow_multiple: false,
    };
    expect(FlatAskUserQuestionSchema.safeParse(input).success).toBe(true);
  });

  it("rejects malformed nested input", () => {
    const input = { questions: "not an array" };
    expect(AskUserQuestionInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects flat schema with insufficient options", () => {
    const input = {
      question: "Test?",
      options: ["Only one"],
    };
    expect(FlatAskUserQuestionSchema.safeParse(input).success).toBe(false);
  });

  it("parseAskUserQuestionInput normalizes nested schema", () => {
    const result = parseAskUserQuestionInput({
      questions: [
        {
          question: "Test?",
          header: "Header",
          options: [{ label: "A", description: "Desc A" }],
          multiSelect: true,
        },
      ],
    });
    expect(result).toEqual({
      question: "Test?",
      header: "Header",
      options: [{ label: "A", description: "Desc A" }],
      multiSelect: true,
    });
  });

  it("parseAskUserQuestionInput normalizes flat schema", () => {
    const result = parseAskUserQuestionInput({
      question: "Test?",
      options: ["A", "B"],
      allow_multiple: true,
    });
    expect(result).toEqual({
      question: "Test?",
      options: [{ label: "A" }, { label: "B" }],
      multiSelect: true,
    });
  });

  it("parseAskUserQuestionInput returns null for invalid input", () => {
    expect(parseAskUserQuestionInput({})).toBeNull();
    expect(parseAskUserQuestionInput({ foo: "bar" })).toBeNull();
    expect(parseAskUserQuestionInput(null)).toBeNull();
    expect(parseAskUserQuestionInput(undefined)).toBeNull();
  });

  it("parseAskUserQuestionInput returns null for empty questions array", () => {
    const result = parseAskUserQuestionInput({
      questions: [],
    });
    expect(result).toBeNull();
  });
});
