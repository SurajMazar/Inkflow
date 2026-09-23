import { createErTable, createSequenceDiagram, measureTable } from '@inkflow/diagram-engine';
import type { SequenceElement, TableElement } from '@inkflow/elements';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetClientStateForTests } from '@/lib/api/client';
import { installFetchMock } from '@/test/fetch-mock';
import { StructuredEditorPanel } from '../StructuredEditorPanel';
import { createTestEditor, renderInSession } from './test-session';

beforeEach(() => {
  __resetClientStateForTests();
  installFetchMock([{ method: 'GET', path: '/auth/me', respond: { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'no' } } } }]);
});

function setup<T extends TableElement | SequenceElement>(el: T) {
  const editor = createTestEditor([el]);
  editor.setState({ structuredEditId: el.id });
  const update = vi.spyOn(editor, 'updateElements');
  const live = () => editor.getElement(el.id) as T;
  renderInSession(<StructuredEditorPanel />, editor);
  return { editor, update, live };
}

const table = () =>
  createErTable(
    'users',
    [
      { name: 'id', dataType: 'uuid', primaryKey: true },
      { name: 'email', dataType: 'text' },
    ],
    { id: 'tbl', x: 10, y: 20 },
  );

describe('StructuredEditorPanel — tables', () => {
  it('adds a column as one patch that also resizes the table', async () => {
    const { update, live } = setup(table());
    const user = userEvent.setup();
    await user.click(screen.getByTestId('table-add-column'));

    expect(update).toHaveBeenCalledTimes(1);
    const [patches, label] = update.mock.calls[0]!;
    expect(label).toBe('Add column');
    const [id, patch] = patches[0]!;
    expect(id).toBe('tbl');
    expect(patch.columns).toHaveLength(3);
    expect(patch.columns![2]).toMatchObject({ name: 'column_3', dataType: 'text', primaryKey: false });
    const size = measureTable(live());
    expect(patch).toMatchObject({ width: size.width, height: size.height });
    expect(live().columns).toHaveLength(3);
    expect(screen.getAllByTestId('table-column')).toHaveLength(3);
  });

  it('commits a column rename once, on blur', async () => {
    const { update, live } = setup(table());
    const user = userEvent.setup();
    const [, second] = screen.getAllByTestId('table-column');
    const name = within(second!).getByTestId('column-name');
    await user.clear(name);
    await user.type(name, 'email_address');
    expect(update).not.toHaveBeenCalled();
    await user.tab();

    expect(update).toHaveBeenCalledTimes(1);
    const [patches, label] = update.mock.calls[0]!;
    expect(label).toBe('Rename column');
    expect(patches[0]![1].columns!.map((c) => c.name)).toEqual(['id', 'email_address']);
    expect(live().columns[1]!.name).toBe('email_address');
    expect(live().width).toBe(measureTable(live()).width);
  });

  it('toggles key flags, reorders and removes columns', async () => {
    const { live } = setup(table());
    const user = userEvent.setup();
    const second = () => screen.getAllByTestId('table-column')[1]!;

    await user.click(within(second()).getByRole('checkbox', { name: 'Unique' }));
    expect(live().columns[1]!.unique).toBe(true);

    await user.click(within(second()).getByRole('checkbox', { name: 'Foreign key' }));
    expect(live().columns[1]!.foreignKey).toBe(true);
    const ref = within(second()).getByRole('textbox', { name: 'Column 2 references' });
    await user.type(ref, 'accounts.id{Enter}');
    expect(live().columns[1]!.references).toBe('accounts.id');

    await user.click(within(second()).getByRole('button', { name: 'Move column email up' }));
    expect(live().columns.map((c) => c.name)).toEqual(['email', 'id']);

    await user.click(within(screen.getAllByTestId('table-column')[0]!).getByRole('button', { name: 'Remove column email' }));
    expect(live().columns.map((c) => c.name)).toEqual(['id']);
  });
});

describe('StructuredEditorPanel — sequence diagrams', () => {
  const sequence = () =>
    createSequenceDiagram(
      [{ name: 'Client' }, { name: 'API' }, { name: 'DB', kind: 'database' }],
      [{ from: 0, to: 1, label: 'GET /users' }],
      { id: 'seq', x: 0, y: 0 },
    );

  it('adds a message between the first two participants and resizes', async () => {
    const { update, live } = setup(sequence());
    const before = live();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('sequence-add-message'));

    expect(update).toHaveBeenCalledTimes(1);
    const [patches, label] = update.mock.calls[0]!;
    expect(label).toBe('Add message');
    const patch = patches[0]![1];
    expect(patch.messages).toHaveLength(2);
    expect(patch.messages![1]).toMatchObject({ from: before.participants[0]!.id, to: before.participants[1]!.id, label: 'message', kind: 'sync' });
    expect(patch.height!).toBeGreaterThan(before.height);
    expect(screen.getAllByTestId('sequence-message')).toHaveLength(2);
  });

  it('edits message label, endpoints and kind, and removes messages', async () => {
    const { update, live } = setup(sequence());
    const user = userEvent.setup();
    const msg = () => screen.getAllByTestId('sequence-message')[0]!;

    const labelInput = within(msg()).getByTestId('message-label');
    await user.clear(labelInput);
    await user.type(labelInput, 'SELECT users{Enter}');
    expect(update).toHaveBeenLastCalledWith([['seq', expect.objectContaining({ messages: [expect.objectContaining({ label: 'SELECT users' })] })]], 'Edit message');

    const db = live().participants[2]!.id;
    await user.selectOptions(within(msg()).getByRole('combobox', { name: 'Message 1 to' }), db);
    expect(live().messages[0]!.to).toBe(db);

    await user.selectOptions(within(msg()).getByRole('combobox', { name: 'Message 1 kind' }), 'async');
    expect(live().messages[0]!.kind).toBe('async');

    await user.click(within(msg()).getByRole('button', { name: 'Remove message 1' }));
    expect(live().messages).toHaveLength(0);
  });

  it('renames and removes participants (removing their messages)', async () => {
    const { live } = setup(sequence());
    const user = userEvent.setup();
    const name = screen.getByRole('textbox', { name: 'Participant 2 name' });
    await user.clear(name);
    await user.type(name, 'Gateway{Enter}');
    expect(live().participants[1]!.name).toBe('Gateway');

    await user.click(screen.getByRole('button', { name: 'Remove Gateway' }));
    expect(live().participants.map((p) => p.name)).toEqual(['Client', 'DB']);
    expect(live().messages).toHaveLength(0);
  });
});

describe('StructuredEditorPanel — permissions', () => {
  it('disables editing for viewers', () => {
    const editor = createTestEditor([table()], { readOnly: true });
    editor.setState({ structuredEditId: 'tbl' });
    renderInSession(<StructuredEditorPanel />, editor, { role: 'VIEWER' });
    expect(screen.queryByTestId('table-add-column')).not.toBeInTheDocument();
    expect(screen.getByTestId('table-name')).toBeDisabled();
  });
});
