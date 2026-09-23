import type { ElementType } from '@inkflow/elements';
import {
  ScrollArea,
  Separator,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  cn,
} from '@inkflow/ui';
import * as React from 'react';
import { useBoardSession, useEditorState, useSelectedElements } from '../hooks/editor-context';
import { useEditorUi } from '../hooks/ui-store';
import {
  ArrangeSection,
  ArrowSection,
  ElementSpecificSection,
  OpacitySection,
  StyleSection,
  TextSection,
} from './properties/sections';
import { TOOL_ELEMENT, capabilitiesFor } from './properties/values';
import { ScrollFade } from './ScrollFade';

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
    <div className="flex flex-col gap-3 px-3.5 pb-3.5 pt-3" data-testid="properties-panel">
      <StyleSection {...props} />
      {caps.arrowheads && <ArrowSection {...props} />}
      {caps.text && <TextSection {...props} />}
      <ElementSpecificSection {...props} />
      {caps.opacity && <OpacitySection {...props} />}
      {elements.length > 0 && (
        <>
          <Separator className="-mx-3.5 w-auto" />
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
        'pointer-events-auto absolute top-[4.25rem] z-20 flex w-[15.5rem] flex-col overflow-hidden rounded-xl border bg-popover/95 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_4px_16px_rgb(0_0_0/0.06)] backdrop-blur',
        panel ? 'right-[21rem]' : 'right-3',
      )}
      style={{ maxHeight: 'calc(100dvh - 9rem)' }}
    >
      <ScrollFade>
        <PropertiesBody />
      </ScrollFade>
    </aside>
  );
}
