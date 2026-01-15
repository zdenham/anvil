export interface CalculatorEvaluation {
  isValid: boolean;
  result: number | null;
  displayExpression: string;
}

export class CalculatorService {
  // Matches strings containing digits and math operators (including display symbols × ÷)
  private static EXPRESSION_REGEX = /^[\d\s+\-*/().%^×÷]+$/;

  isExpression(query: string): boolean {
    const trimmed = query.trim();
    // Must match the regex AND contain at least one digit
    return (
      CalculatorService.EXPRESSION_REGEX.test(trimmed) && /\d/.test(trimmed)
    );
  }

  /** Convert * and / to display symbols × and ÷ */
  toDisplayFormat(expression: string): string {
    return expression.replace(/\*/g, "×").replace(/\//g, "÷");
  }

  /** Convert display symbols × and ÷ back to * and / for evaluation */
  private toEvalFormat(expression: string): string {
    return expression.replace(/×/g, "*").replace(/÷/g, "/");
  }

  evaluate(expression: string): CalculatorEvaluation {
    try {
      // Convert display symbols back to operators
      const normalized = this.toEvalFormat(expression);
      // Replace ^ with ** for exponentiation
      const sanitized = normalized.replace(/\^/g, "**");
      // eslint-disable-next-line no-eval
      const result = eval(sanitized);

      const isValid = typeof result === "number" && isFinite(result);
      return {
        isValid,
        result: isValid ? result : null,
        displayExpression: this.toDisplayFormat(expression),
      };
    } catch {
      return {
        isValid: false,
        result: null,
        displayExpression: this.toDisplayFormat(expression),
      };
    }
  }
}
