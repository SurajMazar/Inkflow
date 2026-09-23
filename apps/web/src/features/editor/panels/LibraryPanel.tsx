import {
  SYSTEM_TEMPLATES,
  createNode,
  searchLibrary,
  shapeRegistry,
  type LibraryCategory,
  type LibraryItem,
  type NodeShapeDefinition,
  type TemplateDefinition,
} from '@inkflow/diagram-engine';
import type { SceneElement } from '@inkflow/elements';
import { importMermaid } from '@inkflow/importers';
import { Button, Input, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, cn } from '@inkflow/ui';
import { Search, TriangleAlert } from 'lucide-react';
import * as React from 'react';
import { notify } from '@/features/notifications/notify';
import { useBoardSession, useEditorState } from '../hooks/editor-context';
import { formatIssue, insertElementSet, viewportCenterWorld } from './insert-elements';
import { startLibraryDrag } from './library-drop';
import { ScenePreview } from './ScenePreview';

const CATEGORY_LABELS: Record<LibraryCategory, string> = {
  basic: 'Basic',
  flowchart: 'Flowchart',
  infrastructure: 'Infrastructure',
  network: 'Network',
  cloud: 'Cloud',
  software: 'Software',
  data: 'Data',
  people: 'People',
  uml: 'UML',
  er: 'Entity relationship',
};

function useDarkCanvas(): boolean {
  return useEditorState((s) => s.theme === 'dark');
}

function LibraryTile({ item, canEdit }: { item: LibraryItem; canEdit: boolean }) {
  const { editor } = useBoardSession();
  const dark = useDarkCanvas();
  const preview = React.useMemo(() => item.create({ x: 0, y: 0 }), [item]);
  const insert = () => {
    const created = editor.addElements(item.create(viewportCenterWorld(editor)), {
      label: `Insert ${item.name}`,
    });
    if (created.length) editor.setTool('selection');
  };
  const body = (
    <>
      <ScenePreview elements={preview} width={64} height={44} padding={6} dark={dark} />
      <span className="line-clamp-2 w-full text-center text-[11px] leading-tight text-muted-foreground">
        {item.name}
      </span>
    </>
  );
  const cls =
    'flex flex-col items-center gap-1 rounded-lg border border-transparent p-1.5 outline-none hover:border-border hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring';
  if (!canEdit) {
    return (
      <div className={cls} data-testid="library-item" title={item.name}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cn(cls, 'cursor-grab active:cursor-grabbing')}
      data-testid="library-item"
      data-item-id={item.id}
      title={`${item.name} — click to insert or drag onto the canvas`}
      aria-label={`Insert ${item.name}`}
      draggable
      onDragStart={(e) => startLibraryDrag(e.dataTransfer, item.id)}
      onClick={insert}
    >
      {body}
    </button>
  );
}

function ShapesTab({ canEdit }: { canEdit: boolean }) {
  const [query, setQuery] = React.useState('');
  const items = React.useMemo(() => searchLibrary(query), [query]);
  const groups = React.useMemo(() => {
    const map = new Map<LibraryCategory, LibraryItem[]>();
    for (const item of items) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return [...map.entries()];
  }, [items]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative border-b p-3">
        <Search
          className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shapes (database, queue, actor…)"
          aria-label="Search shapes"
          className="h-8 pl-8"
          data-testid="library-search"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            No shapes match “{query.trim()}”.
          </p>
        ) : (
          groups.map(([category, list]) => (
            <section key={category} aria-label={CATEGORY_LABELS[category]} className="mb-3">
              <h3 className="px-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {CATEGORY_LABELS[category]}
              </h3>
              <div className="grid grid-cols-4 gap-1">
                {list.map((item) => (
                  <LibraryTile key={item.id} item={item} canEdit={canEdit} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function TemplateCard({ template, canEdit }: { template: TemplateDefinition; canEdit: boolean }) {
  const { editor } = useBoardSession();
  const dark = useDarkCanvas();
  const preview = React.useMemo(() => {
    try {
      return template.build().elements;
    } catch {
      return [] as SceneElement[];
    }
  }, [template]);
  const insert = () => {
    const created = insertElementSet(editor, template.build().elements, {
      label: `Insert template ${template.name}`,
    });
    if (created.length) {
      editor.fitToElements(
        created.map((e) => e.id),
        1,
      );
      notify.success(`Inserted “${template.name}”`);
    }
  };
  return (
    <li className="rounded-lg border p-2" data-testid="template-card">
      <ScenePreview
        elements={preview}
        width={272}
        height={120}
        padding={16}
        dark={dark}
        className="mx-auto rounded-md bg-muted/30"
        label={`Preview of ${template.name}`}
      />
      <div className="mt-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{template.name}</div>
          <p className="line-clamp-2 text-xs text-muted-foreground">{template.description}</p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={insert}
            data-testid="template-insert"
          >
            Insert
          </Button>
        )}
      </div>
    </li>
  );
}

function TemplatesTab({ canEdit }: { canEdit: boolean }) {
  const [query, setQuery] = React.useState('');
  const list = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SYSTEM_TEMPLATES;
    return SYSTEM_TEMPLATES.filter((t) =>
      `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q),
    );
  }, [query]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b p-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates"
          aria-label="Search templates"
          className="h-8"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {list.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">No templates found.</p>
        ) : (
          <ul className="space-y-3">
            {list.map((t) => (
              <TemplateCard key={t.key} template={t} canEdit={canEdit} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const MERMAID_EXAMPLE = `flowchart LR
  A[Client] --> B{Authenticated?}
  B -- yes --> C[API]
  B -- no --> D[Login]
  C --> E[(Database)]`;

/** Mermaid → editable diagram (also used by the "Diagram from text" dialog). */
export function DiagramFromText({
  onInserted,
  autoFocus,
}: {
  onInserted?(): void;
  autoFocus?: boolean;
}) {
  const { editor, canEdit } = useBoardSession();
  const [text, setText] = React.useState('');
  const [issues, setIssues] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const insert = () => {
    setError(null);
    setIssues([]);
    let result: ReturnType<typeof importMermaid>;
    try {
      result = importMermaid(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The diagram could not be parsed.');
      return;
    }
    const found = result.issues.map(formatIssue);
    setIssues(found);
    if (result.elements.length === 0) {
      setError('No diagram elements were found in this text.');
      return;
    }
    const created = insertElementSet(editor, result.elements, {
      label: 'Insert diagram from text',
    });
    if (created.length) {
      editor.fitToElements(
        created.map((e) => e.id),
        1,
      );
      notify.success(`Inserted a diagram with ${created.length} elements`, {
        description: found.length
          ? `${found.length} line${found.length === 1 ? ' was' : 's were'} skipped.`
          : undefined,
      });
      if (found.length === 0) setText('');
      onInserted?.();
    }
  };

  if (!canEdit) {
    return (
      <p className="p-4 text-center text-sm text-muted-foreground">
        You need edit access to add diagrams to this board.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Paste Mermaid syntax (flowchart, sequence, class, ER or state diagrams). It is converted
        into editable shapes and connectors.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (text.trim()) insert();
          }
        }}
        placeholder={MERMAID_EXAMPLE}
        aria-label="Mermaid diagram text"
        data-testid="mermaid-input"
        spellCheck={false}
        autoFocus={autoFocus}
        className="min-h-44 font-mono text-xs"
      />
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {issues.length > 0 && (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          role="status"
        >
          <div className="mb-1 flex items-center gap-1 font-medium">
            <TriangleAlert className="size-3.5" /> {issues.length} issue
            {issues.length === 1 ? '' : 's'}
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {issues.slice(0, 8).map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
            {issues.length > 8 && <li>…and {issues.length - 8} more</li>}
          </ul>
        </div>
      )}
      <div className="flex justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={() => setText(MERMAID_EXAMPLE)}>
          Use example
        </Button>
        <Button size="sm" onClick={insert} disabled={!text.trim()} data-testid="mermaid-insert">
          Insert diagram
        </Button>
      </div>
    </div>
  );
}

function NodeShapeTile({ def, active }: { def: NodeShapeDefinition; active: boolean }) {
  const { editor } = useBoardSession();
  const dark = useDarkCanvas();
  const preview = React.useMemo(() => [createNode(def.key, { x: 0, y: 0 })], [def]);
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Draw ${def.label} nodes`}
      title={def.label}
      data-testid="node-shape"
      onClick={() => {
        editor.applyStyle({ nodeShape: def.key });
        editor.setTool('node');
      }}
      className={cn(
        'flex flex-col items-center gap-1 rounded-lg border p-1.5 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-primary bg-primary/5' : 'border-transparent',
      )}
    >
      <ScenePreview elements={preview} width={56} height={40} padding={4} dark={dark} />
      <span className="line-clamp-1 w-full text-center text-[11px] text-muted-foreground">
        {def.label}
      </span>
    </button>
  );
}

function NodeShapesTab() {
  const current = useEditorState((s) => (s.tool === 'node' ? s.style.nodeShape : null));
  const shapes = React.useMemo(() => shapeRegistry.list().filter((s) => s.key !== 'custom'), []);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <p className="px-1.5 pb-2 text-xs text-muted-foreground">
        Pick a shape, then click or drag on the canvas to draw nodes (N).
      </p>
      <div className="grid grid-cols-4 gap-1">
        {shapes.map((def) => (
          <NodeShapeTile key={def.key} def={def} active={current === def.key} />
        ))}
      </div>
    </div>
  );
}

/** Shape library, templates, Mermaid import and node shapes. */
export function LibraryPanel() {
  const { canEdit } = useBoardSession();
  return (
    <Tabs
      defaultValue="shapes"
      className="flex min-h-0 flex-1 flex-col gap-0"
      data-testid="panel-library"
    >
      <TabsList className="mx-3 mt-2 mb-1 grid h-8 grid-cols-4">
        <TabsTrigger value="shapes" className="text-xs">
          Shapes
        </TabsTrigger>
        <TabsTrigger value="templates" className="text-xs">
          Templates
        </TabsTrigger>
        <TabsTrigger value="text" className="text-xs">
          From text
        </TabsTrigger>
        <TabsTrigger value="nodes" className="text-xs" disabled={!canEdit}>
          Nodes
        </TabsTrigger>
      </TabsList>
      {!canEdit && (
        <p className="px-3 pb-1 text-[11px] text-muted-foreground">
          You can browse the library; editing requires edit access.
        </p>
      )}
      <TabsContent value="shapes" className="mt-0 flex min-h-0 flex-1 flex-col">
        <ShapesTab canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="templates" className="mt-0 flex min-h-0 flex-1 flex-col">
        <TemplatesTab canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="text" className="mt-0 min-h-0 flex-1 overflow-y-auto p-3">
        <DiagramFromText />
      </TabsContent>
      <TabsContent value="nodes" className="mt-0 flex min-h-0 flex-1 flex-col">
        <NodeShapesTab />
      </TabsContent>
    </Tabs>
  );
}
