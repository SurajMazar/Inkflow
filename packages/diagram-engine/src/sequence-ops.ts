import type {
  SequenceElement,
  SequenceMessage,
  SequenceMessageKind,
  SequenceNote,
  SequenceParticipant,
  SequenceParticipantKind,
} from '@inkflow/elements';
import { generateId } from '@inkflow/shared';
import { measureSequence } from './layouts/sequence';

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice();
  const [item] = out.splice(from, 1);
  if (item === undefined) return out;
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item);
  return out;
}

/** Recomputes the element size from its content (never shrinks below the natural size). */
function resize(el: SequenceElement): SequenceElement {
  const size = measureSequence(el);
  return { ...el, width: size.width, height: size.height };
}

function addParticipant(el: SequenceElement, name: string, kind: SequenceParticipantKind = 'participant', index = el.participants.length): SequenceElement {
  const p: SequenceParticipant = { id: generateId(10), name, kind };
  const participants = el.participants.slice();
  participants.splice(Math.max(0, Math.min(index, participants.length)), 0, p);
  return resize({ ...el, participants });
}

/** Removes a participant, every message from/to it, and its note references (empty notes go too). */
function removeParticipant(el: SequenceElement, participantId: string): SequenceElement {
  const removedIdx: number[] = [];
  el.messages.forEach((m, i) => {
    if (m.from === participantId || m.to === participantId) removedIdx.push(i);
  });
  const messages = el.messages.filter((m) => m.from !== participantId && m.to !== participantId);
  const shiftAfter = (after: number) => after - removedIdx.filter((i) => i <= after).length;
  const notes = el.notes
    .map((n) => ({ ...n, participants: n.participants.filter((p) => p !== participantId), afterMessage: Math.max(-1, shiftAfter(n.afterMessage)) }))
    .filter((n) => n.participants.length > 0);
  return resize({ ...el, participants: el.participants.filter((p) => p.id !== participantId), messages, notes });
}

function renameParticipant(el: SequenceElement, participantId: string, name: string): SequenceElement {
  return resize({ ...el, participants: el.participants.map((p) => (p.id === participantId ? { ...p, name } : p)) });
}

function setParticipantKind(el: SequenceElement, participantId: string, kind: SequenceParticipantKind): SequenceElement {
  return resize({ ...el, participants: el.participants.map((p) => (p.id === participantId ? { ...p, kind } : p)) });
}

function moveParticipant(el: SequenceElement, participantId: string, toIndex: number): SequenceElement {
  const from = el.participants.findIndex((p) => p.id === participantId);
  if (from < 0) return el;
  return resize({ ...el, participants: move(el.participants, from, toIndex) });
}

function addMessage(
  el: SequenceElement,
  from: string,
  to: string,
  label: string,
  kind: SequenceMessageKind = 'sync',
  index = el.messages.length,
): SequenceElement {
  if (!el.participants.some((p) => p.id === from) || !el.participants.some((p) => p.id === to)) return el;
  const msg: SequenceMessage = { id: generateId(10), from, to, label, kind };
  const at = Math.max(0, Math.min(index, el.messages.length));
  const messages = el.messages.slice();
  messages.splice(at, 0, msg);
  // Notes placed after later messages keep their position relative to those messages.
  const notes = el.notes.map((n) => (n.afterMessage >= at ? { ...n, afterMessage: n.afterMessage + 1 } : n));
  return resize({ ...el, messages, notes });
}

function updateMessage(el: SequenceElement, messageId: string, patch: Partial<Omit<SequenceMessage, 'id'>>): SequenceElement {
  const valid = (id: string | undefined) => id === undefined || el.participants.some((p) => p.id === id);
  if (!valid(patch.from) || !valid(patch.to)) return el;
  return resize({ ...el, messages: el.messages.map((m) => (m.id === messageId ? { ...m, ...patch, id: m.id } : m)) });
}

function removeMessage(el: SequenceElement, messageId: string): SequenceElement {
  const idx = el.messages.findIndex((m) => m.id === messageId);
  if (idx < 0) return el;
  const notes = el.notes.map((n) => (n.afterMessage >= idx ? { ...n, afterMessage: n.afterMessage - 1 } : n));
  return resize({ ...el, messages: el.messages.filter((m) => m.id !== messageId), notes });
}

/** Moves a message to `toIndex`; notes stay attached to their message positions. */
function moveMessage(el: SequenceElement, messageId: string, toIndex: number): SequenceElement {
  const from = el.messages.findIndex((m) => m.id === messageId);
  if (from < 0) return el;
  return resize({ ...el, messages: move(el.messages, from, toIndex) });
}

function addNote(el: SequenceElement, participants: string[], text: string, afterMessage = el.messages.length - 1): SequenceElement {
  const ids = participants.filter((id) => el.participants.some((p) => p.id === id)).slice(0, 2);
  if (ids.length === 0) return el;
  const note: SequenceNote = { id: generateId(10), participants: ids, afterMessage: Math.max(-1, Math.min(afterMessage, el.messages.length - 1)), text };
  return resize({ ...el, notes: [...el.notes, note] });
}

function updateNote(el: SequenceElement, noteId: string, patch: Partial<Omit<SequenceNote, 'id'>>): SequenceElement {
  return resize({ ...el, notes: el.notes.map((n) => (n.id === noteId ? { ...n, ...patch, id: n.id } : n)) });
}

function removeNote(el: SequenceElement, noteId: string): SequenceElement {
  return resize({ ...el, notes: el.notes.filter((n) => n.id !== noteId) });
}

/** Pure operations on the sequence model; each returns a new, resized element. */
export const sequenceOps = {
  addParticipant,
  removeParticipant,
  renameParticipant,
  setParticipantKind,
  moveParticipant,
  addMessage,
  updateMessage,
  removeMessage,
  moveMessage,
  addNote,
  updateNote,
  removeNote,
  resize,
};
