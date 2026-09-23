import type { ElementType } from '@inkflow/elements';
import { ScrollArea, Separator, Sheet, SheetContent, SheetHeader, SheetTitle, cn } from '@inkflow/ui';
import * as React from 'react';
import { useBoardSession, useEditorState, useSelectedElements } from '../hooks/editor-context';
import { useEditorUi } from '../hooks/ui-store';
import { ArrangeSection, ArrowSection, ElementSpecificSection, OpacitySection, StyleSection, TextSection } from './properties/sections';
import { TOOL_ELEMENT, capabilitiesFor } from './properties/values';

function PropertiesBody() {
  const { editor } = useBoardSession();
  const elements = useSelectedElements().filter((e) => !e.locked);
  const tool = useEditorState((s) => s.tool);
  const style = useEditorState((s) => s.style);
  const types = React.useMemo<ElementType[]>(() => {
    if (elements.length) return [...new Set(elements.map((e) => e.type))];
    const t = TOOL_ELEMENT[tool];
    return t ? [t] : [];
  }, [elements, tool]);
  const caps = capabilitiesFor(types, elements);
  const props = { editor, elements, style, caps };
  return (
    <div className="flex flex-col gap-3.5 p-3" data-testid="properties-panel">
      <StyleSection {...props} />
      {caps.arrowheads && <ArrowSection {...props} />}
      {caps.text && <TextSection {...props} />}
      <ElementSpecificSection {...props} />
      {caps.opacity && <OpacitySection {...props} />}
      {elements.length > 0 && (
        <>
          <Separator />
          <ArrangeSection {...props} />
        </>
      )}
    </div>
  );
}

/** Style/properties panel: right side on desktop, bottom sheet on phones. */
export function PropertiesPanel({ compact }: { compact: boolean }) {
  const { canEdit } = useBoardSession();
  const hasSelection = useEditorState((s) => s.selectedIds.length > 0);
  const tool = useEditorState((s) => s.tool);
  const editingText = useEditorState((s) => s.textEdit !== null);
  const panel = useEditorUi((s) => s.panel);
  const mobileOpen = useEditorUi((s) => s.mobilePropertiesOpen);
  const setMobileOpen = useEditorUi((s) => s.setMobilePropertiesOpen);
  const locked = useSelectedElements().every((e) => e.locked);
  const toolHasStyle = TOOL_ELEMENT[tool] !== undefined;
  const visible = canEdit && ((hasSelection && !locked) || toolHasStyle || editingText);

  if (compact) {
    return (
      <Sheet open={mobileOpen && canEdit} onOpenChange={setMobileOpen}>
        <SheetContent side="bottom" className="max-h-[65dvh] p-0" data-inkflow-ui>
          <SheetHeader className="px-4 pt-4">
            <SheetTitle className="text-sm">Style</SheetTitle>
          </SheetHeader>
          <ScrollArea className="max-h-[55dvh]">
            <PropertiesBody />
          </ScrollArea>
        </SheetContent>
      </Sheet>
    );
  }
  if (!visible) return null;
  return (
    <aside
      aria-label="Properties"
      data-inkflow-ui
      className={cn(
        'pointer-events-auto absolute top-16 z-20 w-60 overflow-hidden rounded-xl border bg-popover/95 shadow-sm backdrop-blur',
        panel ? 'right-[21rem]' : 'right-3',
      )}
      style={{ maxHeight: 'calc(100dvh - 8.5rem)' }}
    >
      <ScrollArea className="h-full max-h-[calc(100dvh-8.5rem)]">
        <PropertiesBody />
      </ScrollArea>
    </aside>
  );
}
