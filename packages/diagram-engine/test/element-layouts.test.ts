import { describe, expect, it } from 'vitest';
import { createElement, validateElement } from '@inkflow/elements';
import {
  ACTIVATION_OFFSET,
  ACTIVATION_WIDTH,
  computeSequenceLayout,
  computeTableLayout,
  computeUmlClassLayout,
  createErTable,
  createSequenceDiagram,
  createUmlClass,
  measureSequence,
  measureTable,
  measureUmlClass,
  sequenceOps,
  tableMetrics,
} from '../src';

describe('table layout', () => {
  const table = createErTable('orders', [
    { name: 'id', dataType: 'uuid', primaryKey: true },
    { name: 'user_id', dataType: 'uuid', foreignKey: true, references: 'users.id' },
    { name: 'total_cents', dataType: 'integer' },
    { name: 'status', dataType: 'varchar(20)', unique: true },
  ]);
  it('stacks rows under the header with badge, name and type columns', () => {
    const l = computeTableLayout(table);
    const m = tableMetrics(table.fontSize);
    expect(l.headerHeight).toBe(m.headerHeight);
    expect(l.rows.map((r) => r.y)).toEqual(
      [0, 1, 2, 3].map((i) => m.headerHeight + i * m.rowHeight),
    );
    expect(l.rows.map((r) => r.badge)).toEqual(['PK', 'FK', '', 'UQ']);
    expect(l.nameColumnX).toBe(l.keyColumnWidth);
    expect(l.typeColumnX).toBeGreaterThan(l.nameColumnX);
    expect(l.width).toBe(table.width);
  });
  it('measures a minimum size that fits every row', () => {
    const size = measureTable(table);
    expect(size.height).toBe(
      computeTableLayout(table).headerHeight + 4 * tableMetrics(table.fontSize).rowHeight,
    );
    const wider = createErTable('orders', [
      { name: 'a_really_long_column_name_here', dataType: 'timestamp with time zone' },
    ]);
    expect(measureTable(wider).width).toBeGreaterThan(size.width);
    expect(measureTable({ ...table, columns: [] }).height).toBe(
      tableMetrics(14).headerHeight + tableMetrics(14).rowHeight,
    );
  });
});

describe('uml class layout', () => {
  it('stacks name, attributes and methods compartments', () => {
    const el = createUmlClass(
      'Shape',
      ['- id: string', '+ count: number$'],
      ['+ area(): number*', '+ draw(): void'],
      { stereotype: 'abstract', isAbstract: true },
    );
    const l = computeUmlClassLayout(el);
    expect(l.nameLines.map((n) => n.text)).toEqual(['«abstract»', 'Shape']);
    expect(l.nameLines[1]!.italic).toBe(true);
    expect(l.attributesY).toBe(l.nameHeight);
    expect(l.methodsY).toBe(l.attributesY + l.attributesHeight);
    expect(l.attributeLines[1]).toMatchObject({ text: '+ count: number', underline: true });
    expect(l.methodLines[0]).toMatchObject({ text: '+ area(): number', italic: true });
    expect(l.methodsY + l.methodsHeight).toBe(el.height);
    expect(measureUmlClass(el)).toEqual({ width: el.width, height: el.height });
    const taller = computeUmlClassLayout({ ...el, height: el.height + 50 });
    expect(taller.methodsHeight).toBe(l.methodsHeight + 50);
  });
});

describe('sequence layout', () => {
  const seq = createSequenceDiagram(
    [{ name: 'User', kind: 'actor' }, { name: 'App' }, { name: 'API' }],
    [
      { from: 0, to: 1, label: 'click' },
      { from: 1, to: 2, label: 'GET /items' },
      { from: 2, to: 2, label: 'validate' },
      { from: 2, to: 1, label: '200 OK', kind: 'return' },
      { from: 1, to: 0, label: 'render', kind: 'return' },
      { from: 1, to: 2, label: 'track', kind: 'async' },
    ],
  );
  it('places headers across the top and stacks messages by messageSpacing', () => {
    const l = computeSequenceLayout(seq);
    const xs = l.participants.map((p) => p.centerX);
    expect(xs[1]! - xs[0]!).toBeGreaterThanOrEqual(seq.participantSpacing);
    expect(Math.min(...l.participants.map((p) => p.headerX))).toBeGreaterThanOrEqual(0);
    const ys = l.messages.map((m) => m.y);
    expect(ys[1]! - ys[0]!).toBeCloseTo(seq.messageSpacing);
    // The self message adds its loop height.
    expect(ys[3]! - ys[2]!).toBeCloseTo(seq.messageSpacing + l.messages[2]!.loopHeight);
    expect(l.messages[2]!.self).toBe(true);
    expect(l.lifelineBottom).toBeGreaterThan(ys[5]!);
    expect(measureSequence(seq)).toEqual({ width: seq.width, height: seq.height });
  });
  it('derives nested activation bars from sync calls and returns', () => {
    const l = computeSequenceLayout(seq);
    const [user, app, api] = seq.participants.map((p) => p.id);
    const appActs = l.activations.filter((a) => a.participantId === app);
    const apiActs = l.activations.filter((a) => a.participantId === api);
    expect(appActs.length).toBe(1);
    expect(appActs[0]!.top).toBe(l.messages[0]!.y);
    expect(appActs[0]!.bottom).toBe(l.messages[4]!.y);
    expect(apiActs.map((a) => a.depth).sort()).toEqual([1, 2]);
    const nested = apiActs.find((a) => a.depth === 2)!;
    const outer = apiActs.find((a) => a.depth === 1)!;
    expect(nested.x - outer.x).toBe(ACTIVATION_OFFSET);
    expect(outer.width).toBe(ACTIVATION_WIDTH);
    expect(l.activations.some((a) => a.participantId === user)).toBe(false);
    // Messages attach to the activation bar edges.
    const apiCenter = l.participants[2]!.centerX;
    expect(l.messages[1]!.toX).toBeCloseTo(apiCenter - ACTIVATION_WIDTH / 2);
  });
  it('places notes after their message and supports model operations', () => {
    let el = sequenceOps.addNote(
      seq,
      [seq.participants[1]!.id, seq.participants[2]!.id],
      'Cache miss',
      1,
    );
    const l = computeSequenceLayout(el);
    const note = l.notes[0]!;
    expect(note.y).toBeGreaterThan(l.messages[1]!.y);
    expect(note.y + note.height).toBeLessThan(l.messages[2]!.y);
    el = sequenceOps.addParticipant(el, 'DB', 'database');
    expect(el.participants.length).toBe(4);
    expect(el.width).toBeGreaterThan(seq.width);
    const db = el.participants[3]!.id;
    el = sequenceOps.addMessage(el, el.participants[2]!.id, db, 'SELECT', 'sync', 2);
    expect(el.messages[2]!.label).toBe('SELECT');
    expect(el.notes[0]!.afterMessage).toBe(1);
    el = sequenceOps.moveMessage(el, el.messages[2]!.id, 0);
    expect(el.messages[0]!.label).toBe('SELECT');
    el = sequenceOps.renameParticipant(el, db, 'Postgres');
    expect(el.participants[3]!.name).toBe('Postgres');
    el = sequenceOps.moveParticipant(el, db, 0);
    expect(el.participants[0]!.id).toBe(db);
    el = sequenceOps.updateMessage(el, el.messages[1]!.id, { label: 'tap' });
    expect(el.messages[1]!.label).toBe('tap');
    el = sequenceOps.removeParticipant(el, db);
    expect(el.messages.some((m) => m.from === db || m.to === db)).toBe(false);
    el = sequenceOps.removeMessage(el, el.messages[0]!.id);
    el = sequenceOps.removeNote(el, el.notes[0]!.id);
    expect(el.notes.length).toBe(0);
    expect(validateElement(el).success).toBe(true);
    expect(sequenceOps.resize({ ...el, width: 1, height: 1 })).toMatchObject({
      width: el.width,
      height: el.height,
    });
  });
  it('lays out create and destroy messages', () => {
    const el = createSequenceDiagram(
      [{ name: 'A' }, { name: 'B' }],
      [
        { from: 0, to: 1, label: 'new', kind: 'create' },
        { from: 0, to: 1, label: 'work' },
        { from: 0, to: 1, label: 'bye', kind: 'destroy' },
      ],
    );
    const l = computeSequenceLayout(el);
    const b = l.participants[1]!;
    expect(b.headerY).toBeGreaterThan(0);
    expect(b.destroyed).toBe(true);
    expect(b.lifelineBottom).toBe(l.messages[2]!.y);
    expect(computeSequenceLayout(createElement('sequence')).participants).toEqual([]);
  });
});
