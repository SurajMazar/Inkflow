import * as React from 'react';
import { useEditor, useEditorState } from '../hooks/editor-context';

/**
 * Native textarea positioned over the text being edited: gives real cursor movement, selection,
 * IME and accessibility. Enter inserts newlines; Escape or Mod+Enter commits; clicking away commits.
 */
export function TextEditorOverlay() {
  const editor = useEditor();
  const edit = useEditorState((s) => s.textEdit);
  const theme = useEditorState((s) => s.theme);
  useEditorState((s) => s.viewport);
  useEditorState((s) => s.sceneVersion);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const layout = edit ? editor.getTextEditorLayout() : null;
  const [value, setValue] = React.useState('');

  React.useEffect(() => {
    if (!edit) return;
    setValue(edit.initialText);
    const id = requestAnimationFrame(() => {
      const ta = ref.current;
      if (!ta) return;
      ta.focus({ preventScroll: true });
      if (edit.isNew) ta.setSelectionRange(ta.value.length, ta.value.length);
      else ta.select();
    });
    return () => cancelAnimationFrame(id);
  }, [edit]);

  if (!edit || !layout) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape' || (e.key === 'Enter' && mod)) {
      e.preventDefault();
      editor.commitTextEdit();
      requestAnimationFrame(() => (document.querySelector('[data-testid="canvas-container"]') as HTMLElement | null)?.focus());
      return;
    }
    if (e.key === 'Enter' && edit.kind === 'frame-name') {
      e.preventDefault();
      editor.commitTextEdit();
      return;
    }
    if (mod && (e.key === 'b' || e.key === 'i' || e.key === 'u')) {
      e.preventDefault();
      editor.actions.run(e.key === 'b' ? 'text.bold' : e.key === 'i' ? 'text.italic' : 'text.underline');
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart, selectionEnd } = ta;
      const next = `${value.slice(0, selectionStart)}    ${value.slice(selectionEnd)}`;
      setValue(next);
      editor.updateTextEdit(next);
      requestAnimationFrame(() => ta.setSelectionRange(selectionStart + 4, selectionStart + 4));
    }
  };

  const lineHeightPx = layout.fontSize * layout.lineHeight;
  const height = Math.max(layout.height, lineHeightPx);

  return (
    <textarea
      ref={ref}
      value={value}
      data-testid="text-editor"
      aria-label={edit.kind === 'text' ? 'Edit text' : edit.kind === 'frame-name' ? 'Frame name' : 'Edit label'}
      placeholder={layout.placeholder}
      spellCheck
      wrap={layout.autoWidth ? 'off' : 'soft'}
      onChange={(e) => {
        setValue(e.target.value);
        editor.updateTextEdit(e.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={() => editor.commitTextEdit()}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-10 m-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
      style={{
        left: layout.left,
        top: layout.top,
        width: layout.autoWidth ? Math.max(layout.width, layout.fontSize) + layout.fontSize : layout.width,
        height,
        transform: layout.angle ? `rotate(${layout.angle}rad)` : undefined,
        // Match the canvas, which is color-inverted in dark mode.
        filter: theme === 'dark' ? 'invert(93%) hue-rotate(180deg)' : undefined,
        transformOrigin: 'center center',
        fontFamily: layout.fontFamily,
        fontSize: layout.fontSize,
        fontWeight: layout.fontWeight,
        fontStyle: layout.fontStyle,
        textDecoration: layout.textDecoration,
        textAlign: layout.textAlign,
        lineHeight: `${lineHeightPx}px`,
        letterSpacing: layout.letterSpacing,
        color: layout.color,
        background: layout.background,
        whiteSpace: layout.autoWidth ? 'pre' : 'pre-wrap',
        overflowWrap: 'break-word',
        caretColor: layout.color,
      }}
    />
  );
}
