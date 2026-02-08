import { cn } from "@/lib/utils";
import type { Turn } from "@/lib/utils/turn-grouping";
import { getUserTurnPrompt } from "@/lib/utils/turn-grouping";
import { parseSkillsFromDisplayMessage } from "@/lib/skills/parse-skill-display";
import { SkillChip } from "./skill-chip";

interface UserMessageProps {
  /** The user turn containing the message */
  turn: Turn;
}

/**
 * Right-aligned user message bubble.
 */
export function UserMessage({ turn }: UserMessageProps) {
  // getUserTurnPrompt handles both string content and array content
  // (with text blocks and tool_result blocks) - returns just the text portion
  const content = getUserTurnPrompt(turn);

  // Don't render empty user messages (e.g., tool-result-only turns)
  if (!content) {
    return null;
  }

  // Parse skill invocations from the text content
  const { skills, remainingText } = parseSkillsFromDisplayMessage(content);

  return (
    <article
      role="article"
      aria-label="Your message"
      className="flex justify-end my-3"
    >
      <div
        className={cn(
          "max-w-[80%] px-4 py-3 rounded-2xl",
          "bg-accent-600 text-accent-900",
          "shadow-sm"
        )}
      >
        {/* Render skill chips first */}
        {skills.length > 0 && (
          <div className="skill-chips mb-2">
            {skills.map((skill, idx) => (
              <SkillChip
                key={`${skill.skillSlug}-${idx}`}
                slug={skill.skillSlug}
                args={skill.args}
              />
            ))}
          </div>
        )}

        {/* Render remaining text */}
        {remainingText && (
          <p className="whitespace-pre-wrap break-words">{remainingText}</p>
        )}
      </div>
    </article>
  );
}
