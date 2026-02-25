import { z } from "zod";
/**
 * Schema for Claude Code's native AskUserQuestion tool input.
 *
 * This schema validates IPC data from agents -> frontend.
 * Placed in core/types/ per type-layering pattern since both
 * agents/ and src/ need access.
 *
 * @see https://platform.claude.com/docs/en/agent-sdk/typescript
 */
// ============================================
// CLAUDE CODE NESTED SCHEMA (primary)
// ============================================
export const AskUserQuestionOptionSchema = z.object({
    label: z.string(),
    description: z.string(),
});
/**
 * Note: No min/max constraints on options/questions arrays.
 * Claude may send varying numbers of options depending on context.
 * Being permissive here allows flexibility without breaking on edge cases.
 */
export const AskUserQuestionItemSchema = z.object({
    question: z.string(),
    header: z.string(),
    options: z.array(AskUserQuestionOptionSchema),
    multiSelect: z.boolean(),
});
export const AskUserQuestionInputSchema = z.object({
    questions: z.array(AskUserQuestionItemSchema),
    answers: z.record(z.string(), z.string()).optional(),
});
// ============================================
// FLAT SCHEMA (backward compatibility)
// ============================================
/**
 * Flat schema used by existing tests and potentially old saved states.
 * Support this for backward compatibility.
 */
export const FlatAskUserQuestionSchema = z.object({
    question: z.string(),
    options: z.array(z.string()).min(2),
    allow_multiple: z.boolean().optional(),
});
/**
 * Parse input and normalize to common format.
 * Tries Claude Code schema first, falls back to flat schema.
 */
export function parseAskUserQuestionInput(input) {
    // Try Claude Code nested schema first
    const nestedResult = AskUserQuestionInputSchema.safeParse(input);
    if (nestedResult.success && nestedResult.data.questions.length > 0) {
        const item = nestedResult.data.questions[0];
        return {
            question: item.question,
            header: item.header,
            options: item.options,
            multiSelect: item.multiSelect,
        };
    }
    // Fall back to flat schema
    const flatResult = FlatAskUserQuestionSchema.safeParse(input);
    if (flatResult.success) {
        return {
            question: flatResult.data.question,
            options: flatResult.data.options.map((label) => ({ label })),
            multiSelect: flatResult.data.allow_multiple ?? false,
        };
    }
    return null;
}
