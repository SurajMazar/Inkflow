import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@inkflow/ui';
import { DiagramFromText } from '../panels/LibraryPanel';

/** "Diagram from text": converts Mermaid into editable elements. */
export function MermaidDialog({ onClose }: { onClose(): void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl" data-inkflow-ui data-testid="mermaid-dialog">
        <DialogHeader>
          <DialogTitle>Diagram from text</DialogTitle>
          <DialogDescription>Write or paste Mermaid and insert it as shapes and connectors you can edit.</DialogDescription>
        </DialogHeader>
        <DiagramFromText onInserted={onClose} autoFocus />
      </DialogContent>
    </Dialog>
  );
}
