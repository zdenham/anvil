/**
 * TiptapEditor
 *
 * WYSIWYG markdown editor using Tiptap. Used in the file content pane
 * for the "rendered" view of markdown files.
 *
 * Content is always stored as markdown — Tiptap is just the editing surface.
 * Uses tiptap-markdown for serialization/deserialization.
 */

import { useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Link } from "@tiptap/extension-link";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { Image } from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { TiptapToolbar } from "./tiptap-toolbar";
import { ShikiCodeBlock } from "./tiptap-code-block";

interface TiptapEditorProps {
  initialContent: string;
  onChange?: (markdown: string) => void;
  onSave?: (markdown: string) => void;
}

/** Type-safe accessor for tiptap-markdown storage */
function getEditorMarkdown(editor: Editor): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = (editor.storage as any).markdown as { getMarkdown?: () => string } | undefined;
  return store?.getMarkdown?.();
}

export function TiptapEditor({ initialContent, onChange, onSave }: TiptapEditorProps) {
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      ShikiCodeBlock,
      Link.configure({ openOnClick: false, autolink: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Image,
      Placeholder.configure({ placeholder: "Start writing..." }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: "-",
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: initialContent,
    editorProps: {
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
          event.preventDefault();
          const md = getMarkdown();
          if (md !== undefined) onSaveRef.current?.(md);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const md = getEditorMarkdown(ed);
        if (md !== undefined) onChangeRef.current?.(md);
      }, 300);
    },
  });

  const getMarkdown = useCallback((): string | undefined => {
    if (!editor) return undefined;
    return getEditorMarkdown(editor);
  }, [editor]);

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Sync content when initialContent changes (e.g. switching from source mode)
  useEffect(() => {
    if (!editor) return;
    const current = getEditorMarkdown(editor);
    if (current !== initialContent) {
      editor.commands.setContent(initialContent);
    }
  }, [editor, initialContent]);

  if (!editor) {
    return (
      <div className="tiptap-editor flex-1 min-h-0 overflow-y-auto pt-8">
        <div className="max-w-[900px] mx-auto p-4" />
      </div>
    );
  }

  return (
    <div className="tiptap-editor flex-1 min-h-0 overflow-y-auto pt-8">
      <BubbleMenu editor={editor}>
        <TiptapToolbar editor={editor} />
      </BubbleMenu>
      <div className="max-w-[900px] mx-auto p-4">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
