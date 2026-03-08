/**
 * TiptapToolbar
 *
 * Floating bubble toolbar for the Tiptap markdown editor.
 * Appears on text selection with inline formatting controls.
 */

import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  List,
  ListChecks,
} from "lucide-react";

interface TiptapToolbarProps {
  editor: Editor;
}

export function TiptapToolbar({ editor }: TiptapToolbarProps) {
  const toggleLink = () => {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("URL:");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  return (
    <div className="flex items-center gap-0.5 bg-surface-800 border border-surface-600 rounded-lg px-1 py-0.5 shadow-lg">
      <ToolbarButton
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold"
      >
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
      >
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
      >
        <Strikethrough size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="Code"
      >
        <Code size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("link")}
        onClick={toggleLink}
        title="Link"
      >
        <Link size={14} />
      </ToolbarButton>
      <Separator />
      <ToolbarButton
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Heading 1"
      >
        <Heading1 size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading 2"
      >
        <Heading2 size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Heading 3"
      >
        <Heading3 size={14} />
      </ToolbarButton>
      <Separator />
      <ToolbarButton
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Quote"
      >
        <Quote size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet List"
      >
        <List size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        title="Task List"
      >
        <ListChecks size={14} />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? "bg-surface-600 text-surface-100"
          : "text-surface-400 hover:text-surface-200 hover:bg-surface-700"
      }`}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <div className="w-px h-4 bg-surface-600 mx-0.5" />;
}
