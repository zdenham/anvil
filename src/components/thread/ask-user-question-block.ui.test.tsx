import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { AskUserQuestionBlock } from "./ask-user-question-block";

vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Helper to convert string array to options format
const toOptions = (labels: string[]) => labels.map((label) => ({ label }));

// Helper to create default props
const createDefaultProps = (
  overrides: Partial<Parameters<typeof AskUserQuestionBlock>[0]> = {}
) => ({
  id: "test-id",
  question: "Choose one",
  options: toOptions(["Option A", "Option B", "Option C"]),
  allowMultiple: false,
  status: "pending" as const,
  onSubmit: vi.fn(),
  ...overrides,
});

describe("AskUserQuestionBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("renders question text", () => {
      render(
        <AskUserQuestionBlock
          {...createDefaultProps({ question: "What would you like to do?" })}
        />
      );

      expect(screen.getByText("What would you like to do?")).toBeInTheDocument();
    });

    it("renders radio buttons for single-select mode", () => {
      render(
        <AskUserQuestionBlock {...createDefaultProps({ allowMultiple: false })} />
      );

      expect(screen.getAllByRole("radio")).toHaveLength(3);
    });

    it("renders checkboxes for multi-select mode", () => {
      render(
        <AskUserQuestionBlock {...createDefaultProps({ allowMultiple: true })} />
      );

      expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    });

    it("shows single-select keyboard hint", () => {
      render(
        <AskUserQuestionBlock {...createDefaultProps({ options: toOptions(["A", "B"]) })} />
      );

      expect(screen.getByText(/Press 1-2/)).toBeInTheDocument();
    });

    it("shows multi-select keyboard hints", () => {
      render(
        <AskUserQuestionBlock
          {...createDefaultProps({ allowMultiple: true, options: toOptions(["X", "Y"]) })}
        />
      );

      // The text is split across kbd and text nodes: "<kbd>a</kbd> All <kbd>n</kbd> None"
      expect(screen.getByText(/All/)).toBeInTheDocument();
      expect(screen.getByText(/None/)).toBeInTheDocument();
      expect(screen.getByText(/Submit \(0\)/)).toBeInTheDocument();
    });

    it("hides keyboard hints when answered", () => {
      render(
        <AskUserQuestionBlock
          {...createDefaultProps({
            status: "answered",
            result: "A",
            options: toOptions(["A", "B"]),
          })}
        />
      );

      expect(screen.queryByText(/Press 1-2/)).not.toBeInTheDocument();
    });
  });

  describe("single-select behavior", () => {
    it("selects and submits on number key", () => {
      const onSubmit = vi.fn();
      render(<AskUserQuestionBlock {...createDefaultProps({ onSubmit })} />);

      fireEvent.keyDown(window, { key: "2" });

      expect(onSubmit).toHaveBeenCalledWith("Option B");
    });

    it("selects and submits on click", () => {
      const onSubmit = vi.fn();
      render(<AskUserQuestionBlock {...createDefaultProps({ onSubmit })} />);

      fireEvent.click(screen.getByTestId("option-item-1"));

      expect(onSubmit).toHaveBeenCalledWith("Option B");
    });

    it("navigates with arrow keys and submits on Space", () => {
      const onSubmit = vi.fn();
      render(<AskUserQuestionBlock {...createDefaultProps({ onSubmit })} />);

      fireEvent.keyDown(window, { key: "ArrowDown" });
      fireEvent.keyDown(window, { key: " " });

      expect(onSubmit).toHaveBeenCalledWith("Option B");
    });

    it("navigates with vim keys (j/k)", () => {
      const onSubmit = vi.fn();
      render(<AskUserQuestionBlock {...createDefaultProps({ onSubmit })} />);

      fireEvent.keyDown(window, { key: "j" });
      fireEvent.keyDown(window, { key: "j" });
      fireEvent.keyDown(window, { key: "k" });
      fireEvent.keyDown(window, { key: " " });

      expect(onSubmit).toHaveBeenCalledWith("Option B");
    });

    it("clamps navigation at bounds", () => {
      const onSubmit = vi.fn();
      render(<AskUserQuestionBlock {...createDefaultProps({ onSubmit })} />);

      // Try to go above first item
      fireEvent.keyDown(window, { key: "ArrowUp" });
      fireEvent.keyDown(window, { key: "ArrowUp" });
      fireEvent.keyDown(window, { key: " " });

      expect(onSubmit).toHaveBeenCalledWith("Option A");
    });

    it("ignores number keys beyond option count", () => {
      const onSubmit = vi.fn();
      render(<AskUserQuestionBlock {...createDefaultProps({ onSubmit })} />);

      fireEvent.keyDown(window, { key: "9" });

      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe("multi-select behavior", () => {
    const multiSelectProps = createDefaultProps({
      options: toOptions(["Option A", "Option B", "Option C", "Option D"]),
      allowMultiple: true,
    });

    it("toggles selection without submitting on number key", () => {
      const onSubmit = vi.fn();
      render(<AskUserQuestionBlock {...multiSelectProps} onSubmit={onSubmit} />);

      fireEvent.keyDown(window, { key: "1" });

      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByTestId("option-item-0")).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });

    it("toggles selection off on second press", () => {
      render(<AskUserQuestionBlock {...multiSelectProps} />);

      fireEvent.keyDown(window, { key: "1" });
      expect(screen.getByTestId("option-item-0")).toHaveAttribute(
        "aria-checked",
        "true"
      );

      fireEvent.keyDown(window, { key: "1" });
      expect(screen.getByTestId("option-item-0")).toHaveAttribute(
        "aria-checked",
        "false"
      );
    });

    it("allows multiple selections", () => {
      render(<AskUserQuestionBlock {...multiSelectProps} />);

      fireEvent.keyDown(window, { key: "1" });
      fireEvent.keyDown(window, { key: "3" });

      expect(screen.getByTestId("option-item-0")).toHaveAttribute(
        "aria-checked",
        "true"
      );
      expect(screen.getByTestId("option-item-1")).toHaveAttribute(
        "aria-checked",
        "false"
      );
      expect(screen.getByTestId("option-item-2")).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });

    it("updates selection count in hint", () => {
      render(<AskUserQuestionBlock {...multiSelectProps} />);

      expect(screen.getByText(/Submit \(0\)/)).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "1" });
      expect(screen.getByText(/Submit \(1\)/)).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "2" });
      expect(screen.getByText(/Submit \(2\)/)).toBeInTheDocument();
    });

    it("selects all with 'a' key", () => {
      render(<AskUserQuestionBlock {...multiSelectProps} />);

      fireEvent.keyDown(window, { key: "a" });

      expect(screen.getByTestId("option-item-0")).toHaveAttribute(
        "aria-checked",
        "true"
      );
      expect(screen.getByTestId("option-item-1")).toHaveAttribute(
        "aria-checked",
        "true"
      );
      expect(screen.getByTestId("option-item-2")).toHaveAttribute(
        "aria-checked",
        "true"
      );
      expect(screen.getByTestId("option-item-3")).toHaveAttribute(
        "aria-checked",
        "true"
      );
      expect(screen.getByText(/Submit \(4\)/)).toBeInTheDocument();
    });

    it("deselects all with 'n' key", () => {
      render(<AskUserQuestionBlock {...multiSelectProps} />);

      fireEvent.keyDown(window, { key: "1" });
      fireEvent.keyDown(window, { key: "2" });
      fireEvent.keyDown(window, { key: "n" });

      expect(screen.getByTestId("option-item-0")).toHaveAttribute(
        "aria-checked",
        "false"
      );
      expect(screen.getByTestId("option-item-1")).toHaveAttribute(
        "aria-checked",
        "false"
      );
      expect(screen.getByText(/Submit \(0\)/)).toBeInTheDocument();
    });

    it("submits comma-separated values on Enter", () => {
      const onSubmit = vi.fn();
      render(<AskUserQuestionBlock {...multiSelectProps} onSubmit={onSubmit} />);

      fireEvent.keyDown(window, { key: "1" });
      fireEvent.keyDown(window, { key: "3" });
      fireEvent.keyDown(window, { key: "Enter" });

      expect(onSubmit).toHaveBeenCalledWith("Option A, Option C");
    });

    it("maintains index order regardless of selection order", () => {
      const onSubmit = vi.fn();
      render(<AskUserQuestionBlock {...multiSelectProps} onSubmit={onSubmit} />);

      fireEvent.keyDown(window, { key: "4" });
      fireEvent.keyDown(window, { key: "2" });
      fireEvent.keyDown(window, { key: "1" });
      fireEvent.keyDown(window, { key: "Enter" });

      expect(onSubmit).toHaveBeenCalledWith("Option A, Option B, Option D");
    });

    it("does not submit when nothing selected", () => {
      const onSubmit = vi.fn();
      render(<AskUserQuestionBlock {...multiSelectProps} onSubmit={onSubmit} />);

      fireEvent.keyDown(window, { key: "Enter" });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("'a' and 'n' keys are ignored in single-select mode", () => {
      const onSubmit = vi.fn();
      render(<AskUserQuestionBlock {...createDefaultProps({ onSubmit })} />);

      fireEvent.keyDown(window, { key: "a" });

      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByTestId("option-item-0")).toHaveAttribute(
        "aria-checked",
        "false"
      );
    });
  });

  describe("answered state", () => {
    it("shows result text", () => {
      render(
        <AskUserQuestionBlock
          {...createDefaultProps({
            status: "answered",
            result: "Selected Option",
            options: toOptions(["X", "Y"]),
          })}
        />
      );

      expect(screen.getByText("Selected Option")).toBeInTheDocument();
    });

    it("disables keyboard interaction", () => {
      const onSubmit = vi.fn();
      render(
        <AskUserQuestionBlock
          {...createDefaultProps({
            status: "answered",
            result: "Selected",
            options: toOptions(["X", "Y"]),
            onSubmit,
          })}
        />
      );

      fireEvent.keyDown(window, { key: "2" });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("sets tabIndex to -1", () => {
      render(
        <AskUserQuestionBlock
          {...createDefaultProps({
            status: "answered",
            result: "Selected",
            options: toOptions(["X", "Y"]),
          })}
        />
      );

      const block = screen.getByTestId("ask-user-question-test-id");
      expect(block).toHaveAttribute("tabindex", "-1");
    });
  });

  describe("accessibility", () => {
    it("has proper ARIA group label", () => {
      render(
        <AskUserQuestionBlock
          {...createDefaultProps({ question: "What do you want?" })}
        />
      );

      expect(
        screen.getByRole("group", { name: /What do you want/i })
      ).toBeInTheDocument();
    });

    it("has proper listbox role", () => {
      render(<AskUserQuestionBlock {...createDefaultProps()} />);

      expect(
        screen.getByRole("listbox", { name: /Options/i })
      ).toBeInTheDocument();
    });

    it("updates aria-checked when selection changes", () => {
      render(
        <AskUserQuestionBlock {...createDefaultProps({ allowMultiple: true })} />
      );

      const checkbox = screen.getByTestId("option-item-0");
      expect(checkbox).toHaveAttribute("aria-checked", "false");

      fireEvent.keyDown(window, { key: "1" });
      expect(checkbox).toHaveAttribute("aria-checked", "true");
    });

    it("focused item has tabindex 0, others have -1", () => {
      render(<AskUserQuestionBlock {...createDefaultProps()} />);

      expect(screen.getByTestId("option-item-0")).toHaveAttribute("tabindex", "0");
      expect(screen.getByTestId("option-item-1")).toHaveAttribute("tabindex", "-1");
      expect(screen.getByTestId("option-item-2")).toHaveAttribute("tabindex", "-1");
    });
  });

  describe("edge cases", () => {
    it("handles empty options array", () => {
      render(
        <AskUserQuestionBlock
          {...createDefaultProps({ question: "No options?", options: [] })}
        />
      );

      expect(screen.getByText("No options?")).toBeInTheDocument();
      expect(screen.queryAllByRole("radio")).toHaveLength(0);
    });

    it("handles single option", () => {
      const onSubmit = vi.fn();
      render(
        <AskUserQuestionBlock
          {...createDefaultProps({
            question: "Confirm?",
            options: toOptions(["Yes"]),
            onSubmit,
          })}
        />
      );

      fireEvent.keyDown(window, { key: "1" });
      expect(onSubmit).toHaveBeenCalledWith("Yes");
    });

    it("handles 9 options (max number key support)", () => {
      const options = toOptions(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
      const onSubmit = vi.fn();

      render(
        <AskUserQuestionBlock {...createDefaultProps({ options, onSubmit })} />
      );

      fireEvent.keyDown(window, { key: "9" });
      expect(onSubmit).toHaveBeenCalledWith("I");
    });

    it("handles 10+ options (arrow navigation for 10th+)", () => {
      const options = toOptions(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);

      render(
        <AskUserQuestionBlock
          {...createDefaultProps({ options, allowMultiple: true })}
        />
      );

      // Navigate to 10th option
      for (let i = 0; i < 9; i++) {
        fireEvent.keyDown(window, { key: "ArrowDown" });
      }
      fireEvent.keyDown(window, { key: " " });

      expect(screen.getByTestId("option-item-9")).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });

    it("handles very long option text", () => {
      const longOption =
        "This is a very long option that should be displayed correctly";

      render(
        <AskUserQuestionBlock {...createDefaultProps({ options: toOptions([longOption]) })} />
      );

      expect(screen.getByText(longOption)).toBeInTheDocument();
    });
  });
});
