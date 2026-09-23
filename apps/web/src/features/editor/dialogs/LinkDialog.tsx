import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@inkflow/ui';
import { ExternalLink, Unlink } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router';
import { useBoardSession } from '../hooks/editor-context';
import { useEditorUi } from '../hooks/ui-store';
import { elementDisplayName } from '../panels/element-labels';
import { openLink, validateLink } from './link-utils';

/** Adds, edits, removes or opens the link of an element. */
export function LinkDialog({ onClose }: { onClose(): void }) {
  const { editor, canEdit } = useBoardSession();
  const navigate = useNavigate();
  const elementId = useEditorUi((s) => s.linkElementId);
  const element = elementId ? editor.getElement(elementId) : undefined;
  const [value, setValue] = React.useState(element?.link ?? '');
  const [error, setError] = React.useState<string | null>(null);
  const inputId = React.useId();
  const editable = canEdit && !!element && !element.locked;

  const save = () => {
    if (!element) return;
    const res = validateLink(value);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (res.href !== element.link)
      editor.updateElements(
        [[element.id, { link: res.href }]],
        element.link ? 'Edit link' : 'Add link',
      );
    onClose();
  };

  const remove = () => {
    if (!element) return;
    editor.updateElements([[element.id, { link: null }]], 'Remove link');
    onClose();
  };

  const current = element?.link ? validateLink(element.link) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-inkflow-ui data-testid="link-dialog">
        <DialogHeader>
          <DialogTitle>{element?.link ? 'Edit link' : 'Add link'}</DialogTitle>
          <DialogDescription>
            {element ? (
              <>Link for {elementDisplayName(element)}. Web, email and board links are supported.</>
            ) : (
              'The element no longer exists.'
            )}
          </DialogDescription>
        </DialogHeader>
        {element && (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (editable) save();
            }}
          >
            <Label htmlFor={inputId}>URL</Label>
            <Input
              id={inputId}
              value={value}
              autoFocus
              disabled={!editable}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              placeholder="https://example.com, mailto:team@example.com or /b/…"
              aria-invalid={!!error}
              aria-describedby={error ? `${inputId}-error` : undefined}
              data-testid="link-input"
            />
            {error && (
              <p id={`${inputId}-error`} className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <DialogFooter className="mt-2 gap-2 sm:justify-between">
              <div className="flex gap-2">
                {current?.ok && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openLink(current.href, navigate)}
                  >
                    <ExternalLink /> Open
                  </Button>
                )}
                {editable && element.link && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={remove}
                    data-testid="link-remove"
                  >
                    <Unlink /> Remove
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                {editable && (
                  <Button type="submit" size="sm" data-testid="link-save">
                    Save
                  </Button>
                )}
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
