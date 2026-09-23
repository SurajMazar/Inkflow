import { describe, expect, it } from 'vitest';
import { createElement, createLabel, createTableColumn } from '@inkflow/elements';
import { extractSearchText, snippetAround } from './search-text';

describe('search text extraction', () => {
  it('collects text, labels, names and structured content', () => {
    expect(extractSearchText(createElement('text', { text: 'Hello world' }))).toBe('Hello world');
    expect(extractSearchText(createElement('rectangle', { label: createLabel('API gateway') }))).toBe('API gateway');
    expect(extractSearchText(createElement('frame', { name: 'Checkout flow' }))).toBe('Checkout flow');
    const table = createElement('table', { name: 'users', columns: [createTableColumn('email', { dataType: 'text' })] });
    expect(extractSearchText(table)).toBe('users\nemail text');
    expect(extractSearchText(createElement('freedraw'))).toBe('');
  });

  it('builds snippets around matches', () => {
    const text = `${'a'.repeat(100)} needle ${'b'.repeat(100)}`;
    const snippet = snippetAround(text, 'NEEDLE', 10);
    expect(snippet).toContain('needle');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });
});
