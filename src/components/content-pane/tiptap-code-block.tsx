/**
 * ShikiCodeBlock
 *
 * Custom TipTap CodeBlock extension with Shiki syntax highlighting.
 * Uses ProseMirror decorations for token coloring and a React NodeView
 * for the header bar (language label + copy button).
 */

import { useState, useCallback, useEffect } from "react";
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { CodeBlock } from "@tiptap/extension-code-block";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Copy, Check } from "lucide-react";
import { getCachedTokens, highlightCode } from "@/lib/syntax-highlighter";

const COPY_FEEDBACK_MS = 2000;
const shikiPluginKey = new PluginKey("shiki");

// --- ProseMirror Decoration Plugin ---

function computeDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return;

    const language = node.attrs.language || "plaintext";
    const code = node.textContent;
    const tokens = getCachedTokens(code, language);
    if (!tokens) return;

    let offset = pos + 1;
    for (let i = 0; i < tokens.length; i++) {
      for (const token of tokens[i]) {
        if (token.color) {
          decorations.push(
            Decoration.inline(offset, offset + token.content.length, {
              style: `color: ${token.color}`,
            }),
          );
        }
        offset += token.content.length;
      }
      if (i < tokens.length - 1) {
        offset += 1; // newline between lines
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}

function createShikiPlugin(): Plugin {
  const pendingHighlights = new Set<string>();

  return new Plugin({
    key: shikiPluginKey,

    state: {
      init(_, { doc }) {
        return computeDecorations(doc);
      },
      apply(tr, decorationSet, _oldState, newState) {
        if (tr.getMeta(shikiPluginKey) || tr.docChanged) {
          return computeDecorations(newState.doc);
        }
        return decorationSet.map(tr.mapping, tr.doc);
      },
    },

    props: {
      decorations(state) {
        return shikiPluginKey.getState(state);
      },
    },

    view(editorView) {
      function triggerHighlighting() {
        const { doc } = editorView.state;
        const toHighlight: Array<{ code: string; language: string }> = [];

        doc.descendants((node) => {
          if (node.type.name !== "codeBlock") return;
          const language = node.attrs.language || "plaintext";
          const code = node.textContent;
          const key = `${language}:${code}`;

          if (!getCachedTokens(code, language) && !pendingHighlights.has(key)) {
            toHighlight.push({ code, language });
            pendingHighlights.add(key);
          }
        });

        if (toHighlight.length === 0) return;

        Promise.all(
          toHighlight.map(({ code, language }) =>
            highlightCode(code, language).finally(() => {
              pendingHighlights.delete(`${language}:${code}`);
            }),
          ),
        ).then(() => {
          if (editorView.isDestroyed) return;
          const tr = editorView.state.tr.setMeta(shikiPluginKey, true);
          editorView.dispatch(tr);
        });
      }

      triggerHighlighting();

      return {
        update() {
          triggerHighlighting();
        },
      };
    },
  });
}

// --- React NodeView ---

function CodeBlockView({ node }: { node: ProseMirrorNode }) {
  const language = node.attrs.language || "";
  const code = node.textContent;
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setIsCopied(true);
  }, [code]);

  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [isCopied]);

  return (
    <NodeViewWrapper className="tiptap-shiki-code-block">
      <div
        className="flex items-center justify-between px-2 py-1.5 border-b border-zinc-800"
        contentEditable={false}
      >
        <span className="text-xs text-zinc-400 font-mono">
          {language || "plaintext"}
        </span>
        <button
          onClick={handleCopy}
          className={`p-1.5 rounded transition-colors ${
            isCopied
              ? "text-green-400"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
          }`}
          aria-label={
            isCopied ? "Copied to clipboard" : "Copy code to clipboard"
          }
        >
          {isCopied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
      <NodeViewContent className="tiptap-code-content" />
    </NodeViewWrapper>
  );
}

// --- Extension ---

export const ShikiCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), createShikiPlugin()];
  },
});
