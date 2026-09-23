import { copyBlobToClipboard, downloadBlob, exportToPngBlob, suggestFileName } from '@inkflow/exporters';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Label,
  NativeSelect,
  Spinner,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  cn,
} from '@inkflow/ui';
import { Copy, Download } from 'lucide-react';
import * as React from 'react';
import { notify, toastApiError } from '@/features/notifications/notify';
import { useBoardSession, useEditorState } from '../hooks/editor-context';
import { useEditorUi, type ExportScope } from '../hooks/ui-store';
import { DEFAULT_EXPORT_SETTINGS, buildExportSource, describeExport, rasterOptions, runExport, type ExportFormat, type ExportSettings } from './export-run';

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: 'png', label: 'PNG', hint: 'Image for sharing and slides' },
  { value: 'svg', label: 'SVG', hint: 'Scalable vector image' },
  { value: 'pdf', label: 'PDF', hint: 'Document for printing' },
  { value: 'json', label: 'JSON', hint: 'Editable Inkflow file (.inkflow)' },
];
const SCALES = [1, 2, 3, 4];
const PADDINGS = [0, 16, 32, 64];
const PREVIEW_W = 480;
const PREVIEW_H = 300;
const PREVIEW_DEBOUNCE_MS = 250;

function Row({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="text-sm font-normal">
          {label}
        </Label>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function usePreview(settings: ExportSettings, enabled: boolean) {
  const { editor } = useBoardSession();
  const sceneVersion = useEditorState((s) => s.sceneVersion);
  const [state, setState] = React.useState<{ url: string | null; loading: boolean; error: boolean }>({ url: null, loading: false, error: false });

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let url: string | null = null;
    setState((s) => ({ ...s, loading: true, error: false }));
    const timer = setTimeout(async () => {
      try {
        const { bounds } = describeExport(editor, settings);
        const scale = Math.min(2, PREVIEW_W / Math.max(1, bounds.width), PREVIEW_H / Math.max(1, bounds.height)) * Math.min(2, window.devicePixelRatio || 1);
        const blob = await exportToPngBlob(buildExportSource(editor, settings), {
          ...rasterOptions(editor, settings),
          scale,
          embedScene: false,
          maxPixels: 1_500_000,
        });
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ url, loading: false, error: false });
      } catch (error) {
        console.warn('[inkflow] export preview failed', error);
        if (!cancelled) setState({ url: null, loading: false, error: true });
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [editor, settings, enabled, sceneVersion]);

  return state;
}

/** Export to PNG, SVG, PDF or JSON with scope, background, theme, scale and padding options. */
export function ExportDialog({ onClose }: { onClose(): void }) {
  const { editor, board } = useBoardSession();
  const initialScope = useEditorUi((s) => s.exportScope);
  const initialFrame = useEditorUi((s) => s.exportFrameId);
  const theme = useEditorState((s) => s.theme);
  useEditorState((s) => s.sceneVersion);
  const hasSelection = useEditorState((s) => s.selectedIds.length > 0);
  const frames = editor.getOrderedFrames();

  const [settings, setSettings] = React.useState<ExportSettings>(() => {
    const scope: ExportScope = initialScope === 'selection' && !hasSelection ? 'board' : initialScope;
    const frameId = initialFrame ?? editor.getSelectedElements().find((e) => e.type === 'frame')?.id ?? frames[0]?.id ?? null;
    return { ...DEFAULT_EXPORT_SETTINGS, scope: scope === 'frame' && !frameId ? 'board' : scope, frameId, darkMode: theme === 'dark' };
  });
  const [busy, setBusy] = React.useState<'download' | 'copy' | null>(null);
  const set = <K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));

  const { format, scope } = settings;
  const raster = format === 'png' || (format === 'pdf' && settings.pdfMode === 'raster');
  const summary = describeExport(editor, settings);
  const empty = summary.count === 0;
  const preview = usePreview(settings, format !== 'json' && !empty);
  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard && typeof ClipboardItem !== 'undefined';

  const download = async () => {
    setBusy('download');
    try {
      const out = await runExport(editor, settings);
      const name = scope === 'frame' ? (frames.find((f) => f.id === settings.frameId)?.name || board.title) : board.title;
      downloadBlob(out.blob, suggestFileName(name, out.ext));
      notify.success(`Exported ${out.ext.toUpperCase()}`);
      onClose();
    } catch (error) {
      toastApiError(error, 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    setBusy('copy');
    try {
      const out = await runExport(editor, { ...settings, format: 'png' });
      await copyBlobToClipboard(out.blob);
      notify.success('Copied PNG to the clipboard');
    } catch (error) {
      toastApiError(error, 'Could not copy to the clipboard');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] gap-4 sm:max-w-4xl" data-inkflow-ui data-testid="export-dialog">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>Download the board as an image, a document or an editable file.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
          <div
            className={cn(
              'flex min-h-48 items-center justify-center overflow-hidden rounded-lg border p-3 md:min-h-80',
              settings.background ? 'bg-muted/30' : 'bg-[conic-gradient(var(--color-muted)_25%,transparent_0_50%,var(--color-muted)_0_75%,transparent_0)] bg-[length:16px_16px]',
            )}
            aria-live="polite"
          >
            {format === 'json' ? (
              <div className="text-center text-sm text-muted-foreground">
                <div className="font-medium text-foreground">{summary.count} elements</div>
                Editable Inkflow file — re-import it into any board.
              </div>
            ) : empty ? (
              <span className="text-sm text-muted-foreground">Nothing to export in this scope.</span>
            ) : preview.url ? (
              <img
                src={preview.url}
                alt="Export preview"
                data-testid="export-preview"
                className={cn('max-h-[300px] max-w-full object-contain shadow-sm', preview.loading && 'opacity-60')}
              />
            ) : preview.error ? (
              <span className="text-sm text-muted-foreground">Preview unavailable.</span>
            ) : (
              <Spinner />
            )}
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground" id="export-format-label">
                Format
              </span>
              <ToggleGroup
                type="single"
                variant="outline"
                value={format}
                onValueChange={(v) => v && set('format', v as ExportFormat)}
                aria-labelledby="export-format-label"
                className="w-full"
              >
                {FORMATS.map((f) => (
                  <ToggleGroupItem key={f.value} value={f.value} className="flex-1 text-xs" data-testid={`export-format-${f.value}`} title={f.hint}>
                    {f.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-[11px] text-muted-foreground">{FORMATS.find((f) => f.value === format)!.hint}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="export-scope" className="text-xs font-medium text-muted-foreground">
                Export
              </Label>
              <NativeSelect
                id="export-scope"
                value={scope}
                onChange={(e) => set('scope', e.target.value as ExportScope)}
                data-testid="export-scope"
                wrapperClassName="w-full"
                className="h-8 text-sm"
              >
                <option value="board">Entire board</option>
                <option value="selection" disabled={!hasSelection}>
                  Selection{hasSelection ? '' : ' (nothing selected)'}
                </option>
                <option value="frame" disabled={frames.length === 0}>
                  Frame{frames.length === 0 ? ' (no frames)' : ''}
                </option>
                <option value="viewport">Current view</option>
              </NativeSelect>
              {scope === 'frame' && frames.length > 0 && (
                <NativeSelect
                  value={settings.frameId ?? ''}
                  onChange={(e) => set('frameId', e.target.value)}
                  aria-label="Frame to export"
                  data-testid="export-frame"
                  wrapperClassName="w-full"
                  className="h-8 text-sm"
                >
                  {frames.map((f, i) => (
                    <option key={f.id} value={f.id}>
                      {f.name || `Frame ${i + 1}`}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </div>

            {format !== 'json' && (
              <div className="divide-y rounded-md border px-3">
                <Row label="Background" htmlFor="export-bg" hint={settings.background ? undefined : 'Transparent'}>
                  <Switch id="export-bg" checked={settings.background} onCheckedChange={(v) => set('background', v)} data-testid="export-background" />
                </Row>
                <Row label="Dark mode" htmlFor="export-dark">
                  <Switch id="export-dark" checked={settings.darkMode} onCheckedChange={(v) => set('darkMode', v)} data-testid="export-dark" />
                </Row>
                {(format === 'png' || format === 'svg') && (
                  <Row label="Embed scene" htmlFor="export-embed" hint="Re-import the file to edit it again">
                    <Switch id="export-embed" checked={settings.embedScene} onCheckedChange={(v) => set('embedScene', v)} data-testid="export-embed" />
                  </Row>
                )}
                {format === 'svg' && (
                  <Row label="Embed fonts" htmlFor="export-fonts" hint="Looks identical everywhere">
                    <Switch id="export-fonts" checked={settings.embedFonts} onCheckedChange={(v) => set('embedFonts', v)} />
                  </Row>
                )}
                {format === 'pdf' && (
                  <>
                    {scope === 'board' && frames.length > 0 && (
                      <Row label="Pages">
                        <NativeSelect value={settings.pdfPages} onChange={(e) => set('pdfPages', e.target.value as ExportSettings['pdfPages'])} aria-label="PDF pages" className="h-7 text-xs" data-testid="export-pdf-pages">
                          <option value="single">Single page</option>
                          <option value="frames">One page per frame</option>
                        </NativeSelect>
                      </Row>
                    )}
                    <Row label="Rendering">
                      <NativeSelect value={settings.pdfMode} onChange={(e) => set('pdfMode', e.target.value as ExportSettings['pdfMode'])} aria-label="PDF rendering" className="h-7 text-xs" data-testid="export-pdf-mode">
                        <option value="vector">Vector</option>
                        <option value="raster">Raster</option>
                      </NativeSelect>
                    </Row>
                  </>
                )}
                {raster && (
                  <Row label="Scale">
                    <ToggleGroup type="single" size="sm" value={String(settings.scale)} onValueChange={(v) => v && set('scale', Number(v))} aria-label="Scale">
                      {SCALES.map((s) => (
                        <ToggleGroupItem key={s} value={String(s)} className="px-2 text-xs" data-testid={`export-scale-${s}`}>
                          {s}×
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </Row>
                )}
                {(scope === 'board' || scope === 'selection') && (
                  <Row label="Padding">
                    <NativeSelect value={String(settings.padding)} onChange={(e) => set('padding', Number(e.target.value))} aria-label="Padding" className="h-7 text-xs" data-testid="export-padding">
                      {PADDINGS.map((p) => (
                        <option key={p} value={p}>
                          {p}px
                        </option>
                      ))}
                    </NativeSelect>
                  </Row>
                )}
              </div>
            )}

            {format !== 'json' && !empty && (
              <p className="text-[11px] text-muted-foreground">
                {Math.round(summary.bounds.width * (raster ? settings.scale : 1))} × {Math.round(summary.bounds.height * (raster ? settings.scale : 1))}
                {raster ? ' px' : ' units'} · {summary.count} elements
              </p>
            )}

            <div className="flex gap-2 pt-1">
              {canCopy && format !== 'json' && (
                <Button variant="outline" className="flex-1" onClick={() => void copy()} disabled={!!busy || empty} data-testid="export-copy">
                  {busy === 'copy' ? <Spinner className="size-4" /> : <Copy />}
                  Copy PNG
                </Button>
              )}
              <Button className="flex-1" onClick={() => void download()} disabled={!!busy || empty} data-testid="export-download">
                {busy === 'download' ? <Spinner className="size-4" /> : <Download />}
                Download
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
