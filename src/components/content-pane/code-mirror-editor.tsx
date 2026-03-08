/**
 * CodeMirrorEditor
 *
 * Wraps CodeMirror 6 in a React component. Manages editor lifecycle,
 * dynamic language/readOnly reconfiguration via compartments, and
 * exposes onChange/onSave callbacks.
 */

import { useRef, useEffect, useCallback } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { getCM6Language } from "@/lib/cm6-languages";

interface CodeMirrorEditorProps {
  value: string;
  language: string;
  readOnly?: boolean;
  lineNumber?: number;
  onSave?: (content: string) => void;
  onChange?: (content: string) => void;
}

export function CodeMirrorEditor({
  value,
  language,
  readOnly = false,
  lineNumber,
  onSave,
  onChange,
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  // Stable refs for callbacks so we don't recreate the editor on every render
  const onSaveRef = useRef(onSave);
  const onChangeRef = useRef(onChange);
  onSaveRef.current = onSave;
  onChangeRef.current = onChange;

  // Create editor on mount, destroy on unmount
  useEffect(() => {
    if (!containerRef.current) return;

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: (view) => {
          onSaveRef.current?.(view.state.doc.toString());
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current?.(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        oneDark,
        saveKeymap,
        updateListener,
        languageCompartment.current.of([]),
        readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    // Load language async, then reconfigure
    loadLanguage(view, language);

    // Scroll to line if specified
    if (lineNumber) {
      scrollToLine(view, lineNumber);
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only run on mount — value/language changes are handled by separate effects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLanguage = useCallback(
    async (view: EditorView, lang: string) => {
      const langSupport = await getCM6Language(lang);
      // Guard: view may have been destroyed while awaiting
      if (!viewRef.current) return;
      view.dispatch({
        effects: languageCompartment.current.reconfigure(
          langSupport ? [langSupport] : []
        ),
      });
    },
    []
  );

  // Reconfigure language when it changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    loadLanguage(view, language);
  }, [language, loadLanguage]);

  // Reconfigure readOnly when it changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        EditorState.readOnly.of(readOnly)
      ),
    });
  }, [readOnly]);

  // Replace document when value prop changes externally (e.g. file reload)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="cm-editor-container flex-1 min-h-0 overflow-hidden"
    />
  );
}

function scrollToLine(view: EditorView, line: number) {
  requestAnimationFrame(() => {
    const clampedLine = Math.min(line, view.state.doc.lines);
    if (clampedLine < 1) return;
    const lineInfo = view.state.doc.line(clampedLine);
    view.dispatch({
      effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
    });
  });
}
