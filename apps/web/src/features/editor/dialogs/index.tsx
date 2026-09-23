import { useEditorUi } from '../hooks/ui-store';
import { AutoLayoutDialog } from './AutoLayoutDialog';
import { CommandPalette } from './CommandPalette';
import { ExportDialog } from './ExportDialog';
import { ImportDialog } from './ImportDialog';
import { LinkDialog } from './LinkDialog';
import { MermaidDialog } from './MermaidDialog';
import { ShortcutsDialog } from './ShortcutsDialog';

export { importFilesIntoEditor } from './import-files';

/** Renders the dialog selected in the editor UI store. */
export function DialogHost() {
  const dialog = useEditorUi((s) => s.dialog);
  const close = useEditorUi((s) => s.closeDialog);
  switch (dialog) {
    case 'export':
      return <ExportDialog onClose={close} />;
    case 'import':
      return <ImportDialog onClose={close} />;
    case 'shortcuts':
      return <ShortcutsDialog onClose={close} />;
    case 'command':
      return <CommandPalette onClose={close} />;
    case 'autolayout':
      return <AutoLayoutDialog onClose={close} />;
    case 'link':
      return <LinkDialog onClose={close} />;
    case 'mermaid':
      return <MermaidDialog onClose={close} />;
    default:
      return null;
  }
}
