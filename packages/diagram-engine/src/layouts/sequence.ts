import { layoutText, type SequenceElement, type SequenceParticipantKind } from '@inkflow/elements';
import type { SequenceLayout } from '../types';
import { textWidth } from './measure';

/** Width of an activation bar and horizontal offset of each nested bar. */
export const ACTIVATION_WIDTH = 10;
export const ACTIVATION_OFFSET = 5;
/** Horizontal extent of a self-message loop. */
export const SELF_LOOP_WIDTH = 36;
const HEADER_PAD = 12;
const MIN_HEADER_WIDTH = 90;
const NOTE_PAD = 8;
const ACTOR_FIGURE_HEIGHT = 36;

type Msg = SequenceLayout['messages'][number];
type Part = SequenceLayout['participants'][number];

function headerSize(kind: SequenceParticipantKind, name: string, el: SequenceElement, lh: number) {
  const w = Math.max(MIN_HEADER_WIDTH, textWidth(name, { fontFamily: el.fontFamily, fontSize: el.fontSize, bold: true }) + HEADER_PAD * 2);
  const boxH = Math.round(el.fontSize * 2.6);
  const h = kind === 'participant' || kind === 'database' ? (kind === 'database' ? boxH + 12 : boxH) : ACTOR_FIGURE_HEIGHT + lh + 4;
  return { width: Math.ceil(w), height: Math.ceil(h) };
}

function naturalLayout(el: SequenceElement): SequenceLayout {
  const lh = Math.round(el.fontSize * 1.4);
  const font = { fontFamily: el.fontFamily, fontSize: el.fontSize };
  const n = el.participants.length;
  const indexOf = new Map(el.participants.map((p, i) => [p.id, i]));
  const sizes = el.participants.map((p) => headerSize(p.kind, p.name, el, lh));
  const loopHeight = Math.max(16, Math.round(el.messageSpacing * 0.5));

  // Horizontal spacing: participantSpacing, but never narrower than headers or message labels need.
  const gaps: number[] = [];
  for (let i = 0; i < n - 1; i++) gaps.push(Math.max(el.participantSpacing, (sizes[i]!.width + sizes[i + 1]!.width) / 2 + 20));
  let rightOverflow = 0;
  const labelWidths = el.messages.map((m) => textWidth(m.label, font));
  el.messages.forEach((m, k) => {
    const a = indexOf.get(m.from);
    const b = indexOf.get(m.to);
    if (a === undefined || b === undefined) return;
    const lw = labelWidths[k]!;
    if (a === b) {
      const need = ACTIVATION_WIDTH + SELF_LOOP_WIDTH + 8 + lw + 16;
      if (a < n - 1) gaps[a] = Math.max(gaps[a]!, need);
      else rightOverflow = Math.max(rightOverflow, need);
      return;
    }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const need = lw + 40;
    let span = 0;
    for (let i = lo; i < hi; i++) span += gaps[i]!;
    if (span < need) {
      const extra = (need - span) / (hi - lo);
      for (let i = lo; i < hi; i++) gaps[i] = gaps[i]! + extra;
    }
  });
  const centers: number[] = [];
  for (let i = 0; i < n; i++) centers.push(i === 0 ? sizes[0]!.width / 2 : centers[i - 1]! + gaps[i - 1]!);

  const createdAt = new Map<string, number>();
  el.messages.forEach((m, k) => {
    if (m.kind === 'create' && m.from !== m.to && !createdAt.has(m.to)) createdAt.set(m.to, k);
  });
  let headerHeight = 0;
  el.participants.forEach((p, i) => {
    if (!createdAt.has(p.id)) headerHeight = Math.max(headerHeight, sizes[i]!.height);
  });
  if (headerHeight === 0) headerHeight = Math.round(el.fontSize * 2.6);

  const participants: Part[] = el.participants.map((p, i) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    centerX: centers[i]!,
    headerX: centers[i]! - sizes[i]!.width / 2,
    headerWidth: sizes[i]!.width,
    headerY: headerHeight - sizes[i]!.height,
    headerHeight: sizes[i]!.height,
    lifelineTop: headerHeight,
    lifelineBottom: 0,
    destroyed: false,
  }));

  const notes: SequenceLayout['notes'] = [];
  const notesAfter = new Map<number, typeof el.notes>();
  for (const note of el.notes) {
    const key = Math.max(-1, Math.min(note.afterMessage, el.messages.length - 1));
    const list = notesAfter.get(key) ?? [];
    list.push(note);
    notesAfter.set(key, list);
  }

  let cursor = headerHeight + 8;
  const placeNotes = (after: number) => {
    for (const note of notesAfter.get(after) ?? []) {
      const idx = note.participants.map((id) => indexOf.get(id)).filter((v): v is number => v !== undefined);
      if (idx.length === 0) continue;
      const left = Math.min(...idx.map((i) => centers[i]!));
      const right = Math.max(...idx.map((i) => centers[i]!));
      const span = idx.length > 1 ? right - left + 40 : 0;
      const wrap = Math.max(200, span) - NOTE_PAD * 2;
      const text = layoutText(note.text, { ...font, fontWeight: 'normal', fontStyle: 'normal', lineHeight: 1.4, letterSpacing: 0 }, wrap);
      const width = Math.ceil(Math.max(80, span, text.width + NOTE_PAD * 2));
      const height = Math.ceil(text.height + NOTE_PAD * 2);
      const top = cursor + 4;
      notes.push({ id: note.id, x: (left + right) / 2 - width / 2, y: top, width, height, text: note.text, lines: text.lines.map((l) => l.text) });
      cursor = top + height + 8;
    }
  };

  placeNotes(-1);
  const stacks = new Map<string, { top: number; depth: number }[]>(el.participants.map((p) => [p.id, []]));
  const activations: SequenceLayout['activations'] = [];
  const barLeft = (pid: string, depth: number) => centers[indexOf.get(pid)!]! + (depth - 1) * ACTIVATION_OFFSET - ACTIVATION_WIDTH / 2;
  const edge = (pid: string, depth: number, side: 1 | -1) => {
    if (depth <= 0) return centers[indexOf.get(pid)!]!;
    const left = barLeft(pid, depth);
    return side > 0 ? left + ACTIVATION_WIDTH : left;
  };
  const destroyedAt = new Map<string, number>();
  const messages: Msg[] = [];
  let lastY = cursor;

  el.messages.forEach((m, k) => {
    const a = indexOf.get(m.from);
    const b = indexOf.get(m.to);
    if (a === undefined || b === undefined) {
      placeNotes(k);
      return;
    }
    const self = a === b;
    const y = cursor + Math.max(el.messageSpacing * 0.6, lh + 6);
    const stackA = stacks.get(m.from)!;
    const stackB = stacks.get(m.to)!;
    const lw = labelWidths[k]!;
    let fromX: number;
    let toX: number;
    if (self) {
      fromX = edge(m.from, stackA.length, 1);
      if (m.kind === 'sync') {
        stackA.push({ top: y + loopHeight, depth: stackA.length + 1 });
        toX = edge(m.from, stackA.length, 1);
      } else if (m.kind === 'return' && stackA.length > 0) {
        const act = stackA.pop()!;
        activations.push({ participantId: m.from, x: barLeft(m.from, act.depth), width: ACTIVATION_WIDTH, top: act.top, bottom: y, depth: act.depth });
        toX = edge(m.from, stackA.length, 1);
      } else {
        toX = fromX;
      }
    } else {
      const dir: 1 | -1 = b > a ? 1 : -1;
      fromX = edge(m.from, stackA.length, dir);
      if (m.kind === 'return' && stackA.length > 0) {
        const act = stackA.pop()!;
        activations.push({ participantId: m.from, x: barLeft(m.from, act.depth), width: ACTIVATION_WIDTH, top: act.top, bottom: y, depth: act.depth });
      }
      if (m.kind === 'sync') {
        stackB.push({ top: y, depth: stackB.length + 1 });
        toX = edge(m.to, stackB.length, dir === 1 ? -1 : 1);
      } else if (m.kind === 'create' && createdAt.get(m.to) === k) {
        const p = participants[b]!;
        p.headerY = y - p.headerHeight / 2;
        p.lifelineTop = p.headerY + p.headerHeight;
        toX = dir === 1 ? p.headerX : p.headerX + p.headerWidth;
      } else {
        toX = edge(m.to, stackB.length, dir === 1 ? -1 : 1);
      }
      if (m.kind === 'destroy') {
        for (const act of stackB.splice(0)) {
          activations.push({ participantId: m.to, x: barLeft(m.to, act.depth), width: ACTIVATION_WIDTH, top: act.top, bottom: y, depth: act.depth });
        }
        destroyedAt.set(m.to, y);
      }
    }
    messages.push({
      id: m.id,
      y,
      fromX,
      toX,
      self,
      kind: m.kind,
      label: m.label,
      from: m.from,
      to: m.to,
      loopHeight: self ? loopHeight : 0,
      loopWidth: self ? SELF_LOOP_WIDTH : 0,
      labelX: self ? Math.max(fromX, toX) + SELF_LOOP_WIDTH + 6 + lw / 2 : (fromX + toX) / 2,
      labelY: self ? y + loopHeight / 2 : y - lh * 0.6,
      labelWidth: lw,
    });
    lastY = y + (self ? loopHeight : 0);
    cursor += el.messageSpacing + (self ? loopHeight : 0);
    placeNotes(k);
  });

  const lifelineBottom = Math.max(cursor + el.messageSpacing * 0.3, headerHeight + el.messageSpacing);
  const openEnd = Math.min(lifelineBottom - 4, lastY + el.messageSpacing * 0.4);
  for (const [pid, stack] of stacks) {
    for (const act of stack) {
      activations.push({ participantId: pid, x: barLeft(pid, act.depth), width: ACTIVATION_WIDTH, top: act.top, bottom: Math.max(act.top + 8, openEnd), depth: act.depth });
    }
  }
  activations.sort((p, q) => p.top - q.top || p.depth - q.depth);
  for (const p of participants) {
    const d = destroyedAt.get(p.id);
    p.destroyed = d !== undefined;
    p.lifelineBottom = d ?? lifelineBottom;
  }

  // Normalize so the leftmost drawn content is at x = 0.
  let minX = 0;
  let maxX = 0;
  for (const p of participants) {
    minX = Math.min(minX, p.headerX);
    maxX = Math.max(maxX, p.headerX + p.headerWidth);
  }
  for (const note of notes) {
    minX = Math.min(minX, note.x);
    maxX = Math.max(maxX, note.x + note.width);
  }
  for (const m of messages) {
    minX = Math.min(minX, m.labelX - m.labelWidth / 2);
    maxX = Math.max(maxX, m.labelX + m.labelWidth / 2, m.self ? Math.max(m.fromX, m.toX) + SELF_LOOP_WIDTH : 0);
  }
  if (n > 0) maxX = Math.max(maxX, centers[n - 1]! + rightOverflow);
  const shift = -minX;
  if (shift !== 0) {
    for (const p of participants) {
      p.centerX += shift;
      p.headerX += shift;
    }
    for (const note of notes) note.x += shift;
    for (const m of messages) {
      m.fromX += shift;
      m.toX += shift;
      m.labelX += shift;
    }
    for (const act of activations) act.x += shift;
  }
  let maxY = lifelineBottom;
  for (const note of notes) maxY = Math.max(maxY, note.y + note.height);
  return {
    width: Math.ceil(maxX - minX),
    height: Math.ceil(maxY),
    headerHeight,
    participants,
    lifelineTop: headerHeight,
    lifelineBottom,
    messages,
    activations,
    notes,
    fontSize: el.fontSize,
    lineHeight: lh,
  };
}

/** Natural size of the sequence diagram (the element box should be at least this big). */
export function measureSequence(el: SequenceElement): { width: number; height: number } {
  const layout = naturalLayout(el);
  return { width: Math.max(1, layout.width), height: Math.max(1, layout.height) };
}

/**
 * Sequence diagram layout in local coordinates: participant headers across the top, lifelines,
 * messages stacked by `messageSpacing` in model order (self messages as loops), activation bars
 * derived from sync-call / return nesting, and notes placed after `afterMessage`. When the element
 * box is larger than the natural size, lifelines stretch to the bottom of the box.
 */
export function computeSequenceLayout(el: SequenceElement): SequenceLayout {
  const layout = naturalLayout(el);
  const extra = el.height - layout.height;
  if (extra > 0) {
    layout.lifelineBottom += extra;
    for (const p of layout.participants) if (!p.destroyed) p.lifelineBottom = layout.lifelineBottom;
    layout.height = el.height;
  }
  layout.width = Math.max(layout.width, el.width);
  return layout;
}
