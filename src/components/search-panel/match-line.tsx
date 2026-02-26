/**
 * MatchLine
 *
 * Renders a single match line with the query text highlighted using <mark> tags.
 * Shared between file results and thread results.
 */

import { useMemo } from "react";

interface MatchLineProps {
  text: string;
  query: string;
  caseSensitive: boolean;
}

export function MatchLine({ text, query, caseSensitive }: MatchLineProps) {
  const parts = useMemo(() => splitByQuery(text, query, caseSensitive), [text, query, caseSensitive]);

  return (
    <span className="text-[11px] text-surface-200 whitespace-nowrap overflow-hidden text-ellipsis">
      {parts.map((part, i) =>
        part.isMatch ? (
          <mark key={i} className="bg-amber-500/30 text-surface-200 rounded-sm px-0">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </span>
  );
}

interface TextPart {
  text: string;
  isMatch: boolean;
}

function splitByQuery(text: string, query: string, caseSensitive: boolean): TextPart[] {
  if (!query) return [{ text, isMatch: false }];

  const flags = caseSensitive ? "g" : "gi";
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, flags);

  const parts: TextPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), isMatch: false });
    }
    parts.push({ text: match[0], isMatch: true });
    lastIndex = regex.lastIndex;

    // Prevent infinite loop on zero-length matches
    if (match[0].length === 0) {
      regex.lastIndex++;
    }
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isMatch: false });
  }

  return parts.length > 0 ? parts : [{ text, isMatch: false }];
}
