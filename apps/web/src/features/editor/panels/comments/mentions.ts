import { extractMentionIds } from '@inkflow/shared';

/** A person mentioned in a draft: the text shows `@Name`, the body sent to the API `@[Name](id)`. */
export interface MentionRef {
  id: string;
  name: string;
}

export type BodySegment =
  { type: 'text'; text: string } | { type: 'mention'; name: string; id: string };

const TOKEN_RE = /@\[([^\]]{1,80})\]\(([A-Za-z0-9_-]{1,64})\)/g;

/** Display name safe to embed in a mention token (no brackets/parentheses, ≤ 80 chars). */
export function sanitizeMentionName(name: string): string {
  const clean = name
    .replace(/[[\]()\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (clean || 'user').slice(0, 80);
}

/**
 * Active `@query` directly before the caret, if any: `@` at the start of the text or after
 * whitespace/punctuation, followed by up to 40 non-space characters.
 */
export function findMentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[\s([{,;:"'])@([^\s@[\]()]{0,40})$/.exec(before);
  if (!match) return null;
  const start = before.length - match[2]!.length - 1;
  return { start, query: match[2]! };
}

/** Replaces the `@query` at `start…caret` with `@Name ` and returns the new text and caret. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  user: MentionRef,
): { text: string; caret: number; mention: MentionRef } {
  const name = sanitizeMentionName(user.name);
  const insert = `@${name} `;
  const next = text.slice(0, start) + insert + text.slice(caret).replace(/^ /, '');
  return { text: next, caret: start + insert.length, mention: { id: user.id, name } };
}

/** Converts `@Name` occurrences of tracked mentions into API tokens `@[Name](id)`. */
export function encodeMentions(
  text: string,
  mentions: readonly MentionRef[],
): { body: string; mentions: string[] } {
  const unique = new Map<string, MentionRef>();
  for (const m of mentions) unique.set(`${m.name}\u0000${m.id}`, m);
  const byLength = [...unique.values()].sort((a, b) => b.name.length - a.name.length);
  let body = text;
  for (const m of byLength) {
    const plain = `@${m.name}`;
    // Only whole mentions: the name must not continue with a word character.
    let out = '';
    let i = 0;
    for (;;) {
      const at = body.indexOf(plain, i);
      if (at === -1) {
        out += body.slice(i);
        break;
      }
      const next = body.charAt(at + plain.length);
      if (next && /[\p{L}\p{N}_]/u.test(next)) {
        out += body.slice(i, at + plain.length);
      } else {
        out += `${body.slice(i, at)}@[${m.name}](${m.id})`;
      }
      i = at + plain.length;
    }
    body = out;
  }
  return { body, mentions: extractMentionIds(body) };
}

/** Converts API tokens back to `@Name` for editing and returns the mentions they referenced. */
export function decodeMentions(body: string): { text: string; mentions: MentionRef[] } {
  const mentions: MentionRef[] = [];
  const text = body.replace(TOKEN_RE, (_m, name: string, id: string) => {
    mentions.push({ id, name });
    return `@${name}`;
  });
  return { text, mentions };
}

/** Splits a comment body into text runs and mention tokens for rendering. */
export function parseCommentBody(body: string): BodySegment[] {
  const out: BodySegment[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: 'text', text: body.slice(last, at) });
    out.push({ type: 'mention', name: m[1]!, id: m[2]! });
    last = at + m[0].length;
  }
  if (last < body.length) out.push({ type: 'text', text: body.slice(last) });
  return out;
}
