import type { Editor } from '@inkflow/canvas-engine';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@inkflow/ui';
import { useBoardSession, useEditorState } from '../hooks/editor-context';
import { useEditorUi } from '../hooks/ui-store';

function Item({
  editor,
  action,
  label,
  shortcut,
  payload,
}: {
  editor: Editor;
  action: string;
  label: string;
  shortcut?: string;
  payload?: unknown;
}) {
  if (!editor.actions.get(action)) return null;
  return (
    <DropdownMenuItem
      disabled={!editor.actions.isEnabled(action)}
      onSelect={() => editor.actions.run(action, payload)}
      data-testid={`ctx-${action}`}
    >
      {label}
      {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
    </DropdownMenuItem>
  );
}

/** Right-click / long-press menu whose items depend on what is under the pointer. */
export function EditorContextMenu() {
  const { editor, canEdit, canComment } = useBoardSession();
  const menu = useEditorState((s) => s.contextMenu);
  const selectedCount = useEditorState((s) => s.selectedIds.length);
  const grid = useEditorState((s) => s.grid.visible);
  const snap = useEditorState((s) => s.snapping.toObjects);
  useEditorState((s) => s.sceneVersion);
  const ui = useEditorUi();

  if (!menu) return null;
  const close = (open: boolean) => {
    if (!open) editor.closeContextMenu();
  };
  const frames = editor.getFrames();
  const selected = editor.getSelectedElements();
  const hasFrameSelected = selected.some((e) => e.type === 'frame');
  const nonLinear = selected.filter(
    (e) => e.type !== 'arrow' && e.type !== 'line' && e.type !== 'connector',
  );

  return (
    <DropdownMenu open onOpenChange={close} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed size-px"
          style={{ left: menu.x, top: menu.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56"
        data-inkflow-ui
        data-testid="context-menu"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {menu.target === 'locked' && (
          <>
            <Item
              editor={editor}
              action="arrange.unlock"
              label="Unlock"
              payload={{ ids: menu.elementId ? [menu.elementId] : [] }}
            />
            <Item editor={editor} action="arrange.unlockAll" label="Unlock all" />
            <DropdownMenuSeparator />
          </>
        )}
        {menu.target === 'selection' && selectedCount > 0 ? (
          <>
            <Item editor={editor} action="edit.cut" label="Cut" shortcut="⌘X" />
            <Item editor={editor} action="edit.copy" label="Copy" shortcut="⌘C" />
            <Item editor={editor} action="edit.paste" label="Paste" shortcut="⌘V" />
            <Item editor={editor} action="edit.duplicate" label="Duplicate" shortcut="⌘D" />
            <Item editor={editor} action="edit.delete" label="Delete" shortcut="⌫" />
            <DropdownMenuSeparator />
            <Item editor={editor} action="edit.copyStyles" label="Copy styles" shortcut="⌥⌘C" />
            <Item editor={editor} action="edit.pasteStyles" label="Paste styles" shortcut="⌥⌘V" />
            {selectedCount === 1 && (
              <Item editor={editor} action="nav.editSelected" label="Edit text" shortcut="↩" />
            )}
            <DropdownMenuSeparator />
            <Item editor={editor} action="arrange.group" label="Group" shortcut="⌘G" />
            <Item editor={editor} action="arrange.ungroup" label="Ungroup" shortcut="⇧⌘G" />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Arrange</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-inkflow-ui>
                <Item
                  editor={editor}
                  action="arrange.bringToFront"
                  label="Bring to front"
                  shortcut="⇧⌘]"
                />
                <Item
                  editor={editor}
                  action="arrange.bringForward"
                  label="Bring forward"
                  shortcut="⌘]"
                />
                <Item
                  editor={editor}
                  action="arrange.sendBackward"
                  label="Send backward"
                  shortcut="⌘["
                />
                <Item
                  editor={editor}
                  action="arrange.sendToBack"
                  label="Send to back"
                  shortcut="⇧⌘["
                />
                <DropdownMenuSeparator />
                <Item
                  editor={editor}
                  action="arrange.flipHorizontal"
                  label="Flip horizontal"
                  shortcut="⇧H"
                />
                <Item
                  editor={editor}
                  action="arrange.flipVertical"
                  label="Flip vertical"
                  shortcut="⇧V"
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {selectedCount > 1 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Align & distribute</DropdownMenuSubTrigger>
                <DropdownMenuSubContent data-inkflow-ui>
                  <Item
                    editor={editor}
                    action="arrange.alignLeft"
                    label="Align left"
                    shortcut="⌥A"
                  />
                  <Item
                    editor={editor}
                    action="arrange.alignCenter"
                    label="Align center"
                    shortcut="⌥H"
                  />
                  <Item
                    editor={editor}
                    action="arrange.alignRight"
                    label="Align right"
                    shortcut="⌥D"
                  />
                  <Item editor={editor} action="arrange.alignTop" label="Align top" shortcut="⌥W" />
                  <Item
                    editor={editor}
                    action="arrange.alignMiddle"
                    label="Align middle"
                    shortcut="⌥V"
                  />
                  <Item
                    editor={editor}
                    action="arrange.alignBottom"
                    label="Align bottom"
                    shortcut="⌥S"
                  />
                  <DropdownMenuSeparator />
                  <Item
                    editor={editor}
                    action="arrange.distributeHorizontal"
                    label="Distribute horizontally"
                  />
                  <Item
                    editor={editor}
                    action="arrange.distributeVertical"
                    label="Distribute vertically"
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <Item editor={editor} action="arrange.lock" label="Lock" shortcut="⇧⌘L" />
            <Item editor={editor} action="arrange.hide" label="Hide" shortcut="⇧⌘H" />
            {canEdit && !hasFrameSelected && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Frame</DropdownMenuSubTrigger>
                <DropdownMenuSubContent data-inkflow-ui>
                  {frames.map((f) => (
                    <Item
                      key={f.id}
                      editor={editor}
                      action="frame.addSelection"
                      label={`Add to “${f.name}”`}
                      payload={{ frameId: f.id }}
                    />
                  ))}
                  {frames.length > 0 && <DropdownMenuSeparator />}
                  <Item editor={editor} action="frame.removeSelection" label="Remove from frame" />
                  <Item editor={editor} action="frame.wrapSelection" label="Wrap in new frame" />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {nonLinear.length > 1 && (
              <Item
                editor={editor}
                action="diagram.autoLayout"
                label="Auto layout…"
                shortcut="⌥⇧L"
              />
            )}
            <Item
              editor={editor}
              action="diagram.selectConnected"
              label="Select connected"
              shortcut="⌥⌘A"
            />
            {selectedCount === 1 && nonLinear.length === 1 && (
              <Item
                editor={editor}
                action="diagram.addConnected"
                label="Add connected node"
                shortcut="⌘↩"
              />
            )}
            {selectedCount === 1 && <Item editor={editor} action="element.link" label="Link…" />}
            <DropdownMenuSeparator />
            {canComment && (
              <DropdownMenuItem
                onSelect={() => ui.startComment({ world: menu.world, elementId: menu.elementId })}
              >
                Comment
              </DropdownMenuItem>
            )}
            {hasFrameSelected && (
              <Item editor={editor} action="export.frame" label="Export frame…" />
            )}
            <Item editor={editor} action="export.selection" label="Export selection…" />
          </>
        ) : (
          <>
            <Item editor={editor} action="edit.paste" label="Paste" shortcut="⌘V" />
            <Item editor={editor} action="edit.selectAll" label="Select all" shortcut="⌘A" />
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={grid}
              onCheckedChange={() => editor.actions.run('view.toggleGrid')}
            >
              Show grid
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={snap}
              onCheckedChange={() => editor.actions.run('view.toggleSnap')}
            >
              Snap to objects
            </DropdownMenuCheckboxItem>
            <Item editor={editor} action="view.fitContent" label="Zoom to fit all" shortcut="⇧1" />
            <Item editor={editor} action="arrange.showAll" label="Show hidden elements" />
            <Item editor={editor} action="arrange.unlockAll" label="Unlock all" />
            <DropdownMenuSeparator />
            {canComment && (
              <DropdownMenuItem
                onSelect={() => ui.startComment({ world: menu.world, elementId: null })}
              >
                Add comment here
              </DropdownMenuItem>
            )}
            <Item editor={editor} action="export.board" label="Export board…" shortcut="⇧⌘E" />
            <Item editor={editor} action="view.present" label="Present" shortcut="⌥P" />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
