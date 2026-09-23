import { describe, expect, it } from 'vitest';
import {
  getCommonBounds,
  isLinearElement,
  validateElement,
  type ConnectorElement,
  type SceneElement,
  type TableElement,
} from '@inkflow/elements';
import { CURRENT_DOCUMENT_VERSION, isValidOrderKey, parseDocument } from '@inkflow/scene';
import { TEMPLATE_CATEGORIES } from '@inkflow/shared';
import {
  LIBRARY_ITEMS,
  SEED_BOARDS,
  SYSTEM_TEMPLATES,
  createConnector,
  createErRelationship,
  createErTable,
  createNode,
  createSequenceDiagram,
  createUmlClass,
  createUmlRelation,
  getElementPorts,
  getTemplate,
  iconRegistry,
  measureSequence,
  measureTable,
  measureUmlClass,
  searchLibrary,
  shapeRegistry,
} from '../src';

function assertValidElements(elements: readonly SceneElement[], label: string) {
  const ids = new Set<string>();
  for (const el of elements) {
    const r = validateElement(el);
    expect(r.success, `${label}: ${el.type} ${r.success ? '' : r.error}`).toBe(true);
    expect(ids.has(el.id), `${label}: duplicate id`).toBe(false);
    ids.add(el.id);
    if (el.type === 'node') {
      expect(shapeRegistry.has(el.shape), `${label}: shape ${el.shape}`).toBe(true);
      if (el.icon) expect(iconRegistry.has(el.icon), `${label}: icon ${el.icon}`).toBe(true);
    }
  }
  for (const el of elements) {
    if (isLinearElement(el)) {
      for (const b of [el.startBinding, el.endBinding]) {
        if (!b) continue;
        const target = elements.find((e) => e.id === b.elementId);
        expect(target, `${label}: binding target exists`).toBeDefined();
        if (b.portId)
          expect(
            getElementPorts(target!).some((p) => p.id === b.portId),
            `${label}: port ${b.portId}`,
          ).toBe(true);
      }
    }
    if (el.frameId)
      expect(elements.find((e) => e.id === el.frameId)?.type, `${label}: frame exists`).toBe(
        'frame',
      );
  }
}

describe('templates and seed boards', () => {
  it('cover the required catalogue with valid categories and unique keys', () => {
    const keys = SYSTEM_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of [
      'microservices',
      'rest-api',
      'auth-flow',
      'oauth2-authorization-code',
      'ci-cd-pipeline',
      'database-erd',
      'cloud-architecture',
      'kubernetes',
      'event-driven',
      'frontend-backend',
      'payment-system',
      'user-registration',
      'flowchart-basics',
      'uml-class-diagram',
      'state-machine',
      'activity-diagram',
      'use-case-diagram',
      'component-diagram',
      'network-diagram',
      'data-flow-diagram',
      'org-chart',
      'mind-map',
      'user-flow',
      'kanban-board',
      'retrospective',
    ]) {
      expect(getTemplate(k), k).toBeDefined();
    }
    for (const t of [...SYSTEM_TEMPLATES, ...SEED_BOARDS])
      expect(TEMPLATE_CATEGORIES).toContain(t.category);
    expect(SEED_BOARDS.length).toBe(6);
    expect(getTemplate('seed-kanban')).toBe(SEED_BOARDS[5]);
    expect(getTemplate('nope')).toBeUndefined();
  });

  it.each([...SYSTEM_TEMPLATES, ...SEED_BOARDS].map((t) => [t.key, t] as const))(
    '%s builds valid, parseable content',
    (key, t) => {
      const first = t.build();
      const second = t.build();
      expect(first.elements.length).toBeGreaterThan(2);
      // Fresh ids every call.
      const ids1 = new Set(first.elements.map((e) => e.id));
      expect(second.elements.some((e) => ids1.has(e.id))).toBe(false);
      // Unique, valid, ascending fractional indices.
      const idx = first.elements.map((e) => e.index);
      for (const i of idx) expect(isValidOrderKey(i)).toBe(true);
      for (let i = 1; i < idx.length; i++) expect(idx[i - 1]! < idx[i]!).toBe(true);
      assertValidElements(first.elements, key);
      const parsed = parseDocument({
        type: 'inkflow',
        version: CURRENT_DOCUMENT_VERSION,
        elements: first.elements,
        appState: first.appState,
        files: {},
      });
      expect(parsed.issues).toEqual([]);
      expect(parsed.document.elements.length).toBe(first.elements.length);
      // Frames are drawn beneath their children.
      for (const el of first.elements) {
        if (!el.frameId) continue;
        const frame = first.elements.find((e) => e.id === el.frameId)!;
        expect(frame.index < el.index).toBe(true);
      }
    },
  );

  it('connect nodes with bound connectors in diagram templates', () => {
    for (const key of [
      'microservices',
      'database-erd',
      'uml-class-diagram',
      'auth-flow',
      'mind-map',
      'org-chart',
    ]) {
      const { elements } = getTemplate(key)!.build();
      const connectors = elements.filter((e): e is ConnectorElement => e.type === 'connector');
      expect(connectors.length, key).toBeGreaterThan(3);
      for (const c of connectors) {
        expect(c.startBinding, key).not.toBeNull();
        expect(c.endBinding, key).not.toBeNull();
      }
    }
    const erd = getTemplate('database-erd')!.build().elements;
    const tables = erd.filter((e): e is TableElement => e.type === 'table').map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['users', 'orders', 'products', 'order_items']));
    const rel = erd.filter((e): e is ConnectorElement => e.type === 'connector');
    expect(rel.every((r) => r.edgeKind === 'relationship' && r.routing === 'orthogonal')).toBe(
      true,
    );
    expect(rel.every((r) => r.startBinding!.portId!.startsWith('col:'))).toBe(true);
    const kanban = getTemplate('kanban-board')!.build().elements;
    expect(kanban.filter((e) => e.type === 'frame').length).toBe(5);
    expect(
      kanban
        .filter((e) => e.type === 'node' && e.shape === 'sticky')
        .every((e) => e.frameId !== null),
    ).toBe(true);
    const oauth = getTemplate('oauth2-authorization-code')!.build().elements;
    expect(oauth.some((e) => e.type === 'sequence')).toBe(true);
  });
});

describe('library', () => {
  it('provides at least 60 items across categories', () => {
    expect(LIBRARY_ITEMS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(LIBRARY_ITEMS.map((i) => i.id)).size).toBe(LIBRARY_ITEMS.length);
    const cats = new Set(LIBRARY_ITEMS.map((i) => i.category));
    for (const c of [
      'basic',
      'flowchart',
      'infrastructure',
      'network',
      'cloud',
      'software',
      'data',
      'people',
      'uml',
      'er',
    ])
      expect(cats.has(c as never), c).toBe(true);
    for (const id of [
      'three-tier-web-app',
      'er-table',
      'uml-class',
      'sequence-diagram',
      'decision-block',
    ])
      expect(
        LIBRARY_ITEMS.some((i) => i.id === id),
        id,
      ).toBe(true);
  });

  it.each(LIBRARY_ITEMS.map((i) => [i.id, i] as const))(
    '%s creates fresh, valid elements centred on the point',
    (_id, item) => {
      const center = { x: 500, y: -300 };
      const a = item.create(center);
      const b = item.create(center);
      expect(a.length).toBeGreaterThan(0);
      const ids = new Set(a.map((e) => e.id));
      expect(b.some((e) => ids.has(e.id))).toBe(false);
      assertValidElements(a, item.id);
      const bounds = getCommonBounds(a)!;
      expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(center.x, 0);
      expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(center.y, 0);
    },
  );

  it('searches by name, id and keyword', () => {
    expect(searchLibrary('database')[0]!.name).toBe('Database');
    expect(searchLibrary('kafka').some((i) => i.id === 'queue')).toBe(true);
    expect(searchLibrary('load bal').some((i) => i.id === 'load-balancer')).toBe(true);
    expect(searchLibrary('zzzz-no-match')).toEqual([]);
    expect(searchLibrary('').length).toBe(LIBRARY_ITEMS.length);
  });
});

describe('builders', () => {
  it('createNode uses shape defaults and validates', () => {
    const db = createNode('database', { label: 'Orders', x: 10 });
    expect(db.shape).toBe('database');
    expect(db.width).toBe(shapeRegistry.get('database')!.defaultSize.width);
    expect(db.label?.text).toBe('Orders');
    expect(db.x).toBe(10);
    expect(validateElement(db).success).toBe(true);
    expect(createNode('unknown-shape').shape).toBe('rectangle');
  });

  it('createConnector binds facing ports and routes', () => {
    const a = createNode('rectangle', { x: 0, y: 0 });
    const b = createNode('rectangle', { x: 400, y: 0 });
    const c = createConnector(a, b, { label: 'calls' });
    expect(c.startBinding).toMatchObject({ elementId: a.id, portId: 'right' });
    expect(c.endBinding).toMatchObject({ elementId: b.id, portId: 'left' });
    expect(c.points[0]).toEqual([0, 0]);
    expect(c.x).toBe(a.x + a.width + c.startBinding!.gap);
    expect(c.label?.text).toBe('calls');
    const floating = createConnector(a, b, { fromPort: null, toPort: null, routing: 'straight' });
    expect(floating.startBinding!.portId).toBeNull();
    const loose = createConnector(null, null);
    expect(loose.startBinding).toBeNull();
    for (const el of [c, floating, loose]) expect(validateElement(el).success).toBe(true);
    const below = createNode('rectangle', { x: 0, y: 300 });
    expect(createConnector(a, below).startBinding!.portId).toBe('bottom');
  });

  it('ER builders size tables and use crow-foot arrowheads on column ports', () => {
    const users = createErTable('users', [{ name: 'id', dataType: 'uuid', primaryKey: true }]);
    const orders = createErTable(
      'orders',
      [
        { name: 'id', dataType: 'uuid', primaryKey: true },
        { name: 'user_id', dataType: 'uuid', foreignKey: true },
      ],
      { x: 400 },
    );
    expect({ width: users.width, height: users.height }).toEqual(measureTable(users));
    expect(users.columns[0]!.nullable).toBe(false);
    const rel = createErRelationship(
      users,
      users.columns[0]!.id,
      orders,
      orders.columns[1]!.id,
      'one-to-many',
    );
    expect(rel.startArrowhead).toBe('er-one-only');
    expect(rel.endArrowhead).toBe('er-zero-many');
    expect(rel.edgeKind).toBe('relationship');
    expect(rel.routing).toBe('orthogonal');
    expect(rel.startBinding!.portId).toBe(`col:${users.columns[0]!.id}:right`);
    expect(rel.endBinding!.portId).toBe(`col:${orders.columns[1]!.id}:left`);
    expect(createErRelationship(users, null, orders, null, 'many-to-many').startArrowhead).toBe(
      'er-zero-many',
    );
    expect(createErRelationship(orders, null, users, null, 'one-to-one').endArrowhead).toBe(
      'er-one-only',
    );
    expect(validateElement(rel).success).toBe(true);
  });

  it('UML builders follow notation conventions', () => {
    const base = createUmlClass('Base', ['- id: string'], ['+ run(): void']);
    const sub = createUmlClass('Sub', [], [], { y: 300 });
    expect({ width: base.width, height: base.height }).toEqual(measureUmlClass(base));
    const inh = createUmlRelation(sub, base, 'inheritance');
    expect(inh.endArrowhead).toBe('triangle-outline');
    expect(inh.strokeStyle).toBe('solid');
    const real = createUmlRelation(sub, base, 'realization');
    expect(real.strokeStyle).toBe('dashed');
    expect(createUmlRelation(base, sub, 'composition').startArrowhead).toBe('diamond');
    expect(createUmlRelation(base, sub, 'aggregation').startArrowhead).toBe('diamond-outline');
    expect(createUmlRelation(base, sub, 'dependency')).toMatchObject({
      strokeStyle: 'dashed',
      endArrowhead: 'arrow',
      edgeKind: 'dependency',
    });
    expect(createUmlRelation(base, sub, 'association').edgeKind).toBe('association');
    expect(validateElement(inh).success).toBe(true);
  });

  it('createSequenceDiagram maps indices to participant ids and sizes the element', () => {
    const seq = createSequenceDiagram(
      [{ name: 'A' }, { name: 'B', kind: 'database' }],
      [
        { from: 0, to: 1, label: 'query' },
        { from: 1, to: 0, label: 'rows', kind: 'return' },
        { from: 5, to: 0, label: 'ignored' },
      ],
    );
    expect(seq.participants.map((p) => p.kind)).toEqual(['participant', 'database']);
    expect(seq.messages.length).toBe(2);
    expect(seq.messages[0]!.from).toBe(seq.participants[0]!.id);
    expect({ width: seq.width, height: seq.height }).toEqual(measureSequence(seq));
    expect(validateElement(seq).success).toBe(true);
  });
});
