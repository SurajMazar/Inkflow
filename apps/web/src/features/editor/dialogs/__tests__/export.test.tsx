import { createElement } from '@inkflow/elements';
import * as exporters from '@inkflow/exporters';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetClientStateForTests } from '@/lib/api/client';
import { installFetchMock } from '@/test/fetch-mock';
import { useEditorUi } from '../../hooks/ui-store';
import { createTestEditor, renderInSession } from '../../panels/__tests__/test-session';
import { DialogHost } from '../index';
import { DEFAULT_EXPORT_SETTINGS, runExport, type ExportSettings } from '../export-run';

vi.mock('@inkflow/exporters', async (importOriginal) => {
  const actual = await importOriginal<typeof exporters>();
  return {
    ...actual,
    exportToPngBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
    exportToSvgString: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"/>'),
    exportToPdfBlob: vi.fn(async () => new Blob(['%PDF'], { type: 'application/pdf' })),
    exportToJson: vi.fn(() => '{"type":"inkflow"}'),
    downloadBlob: vi.fn(),
    copyBlobToClipboard: vi.fn(async () => undefined),
  };
});

const png = vi.mocked(exporters.exportToPngBlob);
const svg = vi.mocked(exporters.exportToSvgString);
const pdf = vi.mocked(exporters.exportToPdfBlob);
const json = vi.mocked(exporters.exportToJson);
const download = vi.mocked(exporters.downloadBlob);

function board() {
  const f1 = createElement('frame', {
    id: 'f1',
    name: 'Slide 1',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });
  const f2 = createElement('frame', {
    id: 'f2',
    name: 'Slide 2',
    x: 500,
    y: 0,
    width: 400,
    height: 300,
  });
  const inF1 = createElement('rectangle', {
    id: 'r1',
    x: 20,
    y: 20,
    width: 100,
    height: 60,
    frameId: 'f1',
  });
  const loose = createElement('ellipse', { id: 'e1', x: 1200, y: 900, width: 80, height: 80 });
  return createTestEditor([f1, f2, inF1, loose]);
}

const settings = (overrides: Partial<ExportSettings>): ExportSettings => ({
  ...DEFAULT_EXPORT_SETTINGS,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runExport option mapping', () => {
  it('maps PNG settings for the whole board', async () => {
    const editor = board();
    const out = await runExport(
      editor,
      settings({
        format: 'png',
        scale: 3,
        background: false,
        darkMode: true,
        padding: 32,
        embedScene: true,
      }),
    );
    expect(out.ext).toBe('png');
    const [source, options] = png.mock.calls[0]!;
    expect(source.elements.map((e) => e.id)).toEqual(['f1', 'f2', 'r1', 'e1']);
    expect(source.files).toBe(editor.files);
    expect(source.appState).toBe(editor.appState);
    expect(options).toMatchObject({
      scale: 3,
      background: false,
      darkMode: true,
      padding: 32,
      embedScene: true,
      frameId: null,
      bounds: null,
    });
    expect(options.loadImage).toEqual(expect.any(Function));
  });

  it('exports the selection including the children of selected frames', async () => {
    const editor = board();
    editor.select(['f1', 'e1'], { expandGroups: false });
    await runExport(editor, settings({ scope: 'selection' }));
    expect(png.mock.calls[0]![0].elements.map((e) => e.id)).toEqual(['f1', 'r1', 'e1']);
  });

  it('passes the frame id for frame exports and the visible rectangle for viewport exports', async () => {
    const editor = board();
    await runExport(editor, settings({ scope: 'frame', frameId: 'f2' }));
    expect(png.mock.calls[0]![1]).toMatchObject({ frameId: 'f2', bounds: null });

    editor.setViewport({ x: 100, y: 50, zoom: 2, width: 1000, height: 800 });
    await runExport(editor, settings({ scope: 'viewport', frameId: 'f2' }));
    expect(png.mock.calls[1]![1]).toMatchObject({
      frameId: null,
      bounds: { x: 100, y: 50, width: 500, height: 400 },
    });
  });

  it('maps SVG settings (vector scale, fonts, embedded images and scene)', async () => {
    const editor = board();
    const out = await runExport(
      editor,
      settings({ format: 'svg', scale: 4, embedScene: true, embedFonts: true }),
    );
    expect(out.ext).toBe('svg');
    expect(out.blob.type).toBe('image/svg+xml');
    const options = svg.mock.calls[0]![1];
    expect(options).toMatchObject({
      scale: 1,
      embedFonts: true,
      embedScene: true,
      background: true,
    });
    expect(options.loadImageDataUrl).toEqual(expect.any(Function));
    const families = new Set(options.fontSources!.map((f) => f.family));
    expect([...families].sort()).toEqual(['Inter Variable', 'JetBrains Mono', 'Kalam', 'Lora']);
  });

  it('maps PDF pages and rendering mode', async () => {
    const editor = board();
    editor.reorderFrame('f2', 0);
    await runExport(
      editor,
      settings({ format: 'pdf', pdfPages: 'frames', pdfMode: 'raster', scale: 2 }),
    );
    expect(pdf.mock.calls[0]![1]).toMatchObject({
      pages: 'frames',
      mode: 'raster',
      scale: 2,
      frameOrder: ['f2', 'f1'],
      embedScene: false,
    });

    editor.select(['e1']);
    await runExport(
      editor,
      settings({ format: 'pdf', scope: 'selection', pdfPages: 'frames', pdfMode: 'vector' }),
    );
    expect(pdf.mock.calls[1]![1]).toMatchObject({ pages: 'single', mode: 'vector' });
  });

  it('exports JSON of the chosen frame only', async () => {
    const editor = board();
    const out = await runExport(
      editor,
      settings({ format: 'json', scope: 'frame', frameId: 'f1' }),
    );
    expect(out.ext).toBe('inkflow');
    expect(json.mock.calls[0]![0].elements.map((e) => e.id).sort()).toEqual(['f1', 'r1']);
  });
});

describe('ExportDialog', () => {
  beforeEach(() => {
    __resetClientStateForTests();
    installFetchMock([
      {
        method: 'GET',
        path: '/auth/me',
        respond: { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'no' } } },
      },
    ]);
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    useEditorUi.getState().reset();
  });

  it('downloads the chosen format and scope', async () => {
    const editor = board();
    const user = userEvent.setup();
    renderInSession(<DialogHost />, editor);
    act(() => useEditorUi.getState().openExport('frame', 'f2'));

    expect(await screen.findByTestId('export-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('export-scope')).toHaveValue('frame');
    expect(screen.getByTestId('export-frame')).toHaveValue('f2');
    await waitFor(() => expect(png).toHaveBeenCalled()); // live preview

    await user.click(screen.getByTestId('export-format-svg'));
    await user.click(screen.getByTestId('export-background'));
    await user.click(screen.getByTestId('export-download'));

    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(svg).toHaveBeenCalledTimes(1);
    expect(svg.mock.calls[0]![1]).toMatchObject({ frameId: 'f2', background: false });
    expect(download.mock.calls[0]![1]).toBe('Slide 2.svg');
    await waitFor(() => expect(screen.queryByTestId('export-dialog')).not.toBeInTheDocument());
  });

  it('exports the board at the chosen scale as PNG', async () => {
    const editor = board();
    const user = userEvent.setup();
    renderInSession(<DialogHost />, editor);
    act(() => useEditorUi.getState().openExport('board'));
    await screen.findByTestId('export-dialog');
    await user.click(screen.getByTestId('export-scale-4'));
    await user.selectOptions(screen.getByTestId('export-padding'), '64');
    png.mockClear();
    await user.click(screen.getByTestId('export-download'));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(png.mock.calls.at(-1)![1]).toMatchObject({ scale: 4, padding: 64, frameId: null });
    expect(download.mock.calls[0]![1]).toBe('Roadmap.png');
  });
});
