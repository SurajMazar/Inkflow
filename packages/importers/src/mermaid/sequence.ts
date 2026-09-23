import type { SequenceMessageKind, SequenceParticipantKind } from '@inkflow/elements';
import { createSequenceDiagram, DiagramBuilder, sequenceOps } from '@inkflow/diagram-engine';
import { cleanLabel, IssueLog, type MermaidResult } from './common';

/** Limits of the sequence element schema. */
const MAX_PARTICIPANTS = 100;
const MAX_MESSAGES = 1000;
const MAX_NOTES = 500;

/** Arrow tokens, longest first. Dotted variants of plain/filled arrows are replies. */
const ARROWS: { token: string; kind: SequenceMessageKind }[] = [
  { token: '<<-->>', kind: 'sync' },
  { token: '<<->>', kind: 'sync' },
  { token: '-->>', kind: 'return' },
  { token: '->>', kind: 'sync' },
  { token: '--x', kind: 'async' },
  { token: '-x', kind: 'async' },
  { token: '--)', kind: 'async' },
  { token: '-)', kind: 'async' },
  { token: '-->', kind: 'return' },
  { token: '->', kind: 'sync' },
];

const PARTICIPANT_KINDS: Record<string, SequenceParticipantKind> = {
  participant: 'participant',
  actor: 'actor',
  boundary: 'boundary',
  control: 'control',
  entity: 'entity',
  database: 'database',
  collections: 'database',
  queue: 'entity',
};

const BLOCK_START = /^(loop|alt|else|opt|par|and|critical|option|break|rect|box)\b\s*(.*)$/i;

interface PendingNote {
  participants: string[];
  text: string;
  afterMessage: number;
}

/** Mermaid `sequenceDiagram` → one sequence element (activations are derived from sync/return nesting). */
export function importSequence(lines: string[]): MermaidResult {
  const issues = new IssueLog();
  const participants: { alias: string; name: string; kind: SequenceParticipantKind }[] = [];
  const index = new Map<string, number>();
  const messages: { from: number; to: number; label: string; kind: SequenceMessageKind }[] = [];
  const notes: PendingNote[] = [];
  let autonumber = 0;
  let pendingCreate: string | null = null;
  const pendingDestroy = new Set<string>();
  let title: string | null = null;

  const ensure = (alias: string, name = alias, kind: SequenceParticipantKind = 'participant') => {
    const key = alias.trim();
    const existing = index.get(key);
    if (existing !== undefined) return existing;
    if (participants.length >= MAX_PARTICIPANTS) {
      issues.add(`Too many participants; only the first ${MAX_PARTICIPANTS} were imported`);
      return -1;
    }
    index.set(key, participants.length);
    participants.push({ alias: key, name: cleanLabel(name).slice(0, 200) || key, kind });
    return participants.length - 1;
  };

  for (let li = 1; li < lines.length; li++) {
    const line = lines[li]!;
    let m: RegExpExecArray | null;
    if ((m = /^title\s*:?\s*(.+)$/i.exec(line))) {
      title = cleanLabel(m[1]!);
      continue;
    }
    if (/^autonumber\b/i.test(line)) {
      autonumber = 1;
      continue;
    }
    if (
      (m =
        /^(create\s+)?(participant|actor|boundary|control|entity|database|collections|queue)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(
          line,
        ))
    ) {
      const alias = m[3]!.replace(/^"(.*)"$/, '$1');
      ensure(alias, m[4] ?? alias, PARTICIPANT_KINDS[m[2]!.toLowerCase()]!);
      if (m[1]) pendingCreate = alias.trim();
      continue;
    }
    if ((m = /^destroy\s+(.+)$/i.exec(line))) {
      pendingDestroy.add(m[1]!.trim());
      continue;
    }
    if (/^(activate|deactivate)\s+/i.test(line)) continue; // activations are derived from call nesting
    if ((m = /^note\s+(over|left of|right of)\s+([^:]+):\s*(.*)$/i.exec(line))) {
      const ids = m[2]!
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 2);
      const refs = ids.map((id) => ensure(id)).filter((i) => i >= 0);
      if (refs.length)
        notes.push({
          participants: refs.map((i) => participants[i]!.alias),
          text: cleanLabel(m[3]!),
          afterMessage: messages.length - 1,
        });
      continue;
    }
    if ((m = BLOCK_START.exec(line))) {
      const kind = m[1]!.toLowerCase();
      if (kind === 'rect' || kind === 'box') continue;
      if (participants.length > 0) {
        const span = [participants[0]!.alias, participants[participants.length - 1]!.alias];
        notes.push({
          participants: [...new Set(span)],
          text: `${kind}${m[2] ? `: ${cleanLabel(m[2])}` : ''}`,
          afterMessage: messages.length - 1,
        });
      }
      issues.add('Mermaid blocks (loop/alt/opt/par/critical/break) are imported as notes');
      continue;
    }
    if (/^end$/i.test(line)) continue;
    const msg = parseMessage(line);
    if (!msg) {
      issues.add(`Could not parse sequence line: ${line.slice(0, 80)}`);
      continue;
    }
    if (messages.length >= MAX_MESSAGES) {
      issues.add(`Too many messages; only the first ${MAX_MESSAGES} were imported`);
      continue;
    }
    const from = ensure(msg.from);
    const to = ensure(msg.to);
    if (from < 0 || to < 0) continue;
    let kind = msg.kind;
    if (pendingCreate && msg.to === pendingCreate) {
      kind = 'create';
      pendingCreate = null;
    } else if (pendingDestroy.has(msg.to) || pendingDestroy.has(msg.from)) {
      kind = 'destroy';
      pendingDestroy.delete(msg.to);
      pendingDestroy.delete(msg.from);
    }
    const label = autonumber ? `${autonumber++}. ${cleanLabel(msg.label)}` : cleanLabel(msg.label);
    messages.push({ from, to, label, kind });
  }

  let seq = createSequenceDiagram(
    participants.map((p) => ({ name: p.name, kind: p.kind })),
    messages,
    { x: 0, y: title ? 50 : 0 },
  );
  for (const note of notes.slice(0, MAX_NOTES)) {
    const ids = note.participants.map((alias) => seq.participants[index.get(alias)!]!.id);
    seq = sequenceOps.addNote(seq, ids, note.text, note.afterMessage);
  }
  if (notes.length > MAX_NOTES)
    issues.add(`Too many notes; only the first ${MAX_NOTES} were imported`);
  const b = new DiagramBuilder();
  if (title) b.text(0, 0, title, { fontSize: 24, fontWeight: 'bold' });
  b.add(seq);
  return { elements: b.finish(), issues: issues.list() };
}

function parseMessage(
  line: string,
): { from: string; to: string; kind: SequenceMessageKind; label: string } | null {
  const colon = line.indexOf(':');
  const head = colon >= 0 ? line.slice(0, colon) : line;
  const label = colon >= 0 ? line.slice(colon + 1).trim() : '';
  for (const arrow of ARROWS) {
    const at = head.indexOf(arrow.token);
    if (at <= 0) continue;
    const from = head.slice(0, at).trim();
    const to = head
      .slice(at + arrow.token.length)
      .trim()
      .replace(/^[+-]/, '')
      .trim();
    if (!from || !to || /\s{2,}/.test(from)) continue;
    return {
      from: from.replace(/^"(.*)"$/, '$1'),
      to: to.replace(/^"(.*)"$/, '$1'),
      kind: arrow.kind,
      label,
    };
  }
  return null;
}
