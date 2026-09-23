import type { TableColumn, TableElement } from '@inkflow/elements';
import type { TableLayout } from '../types';
import { textWidth } from './measure';

export const TABLE_PADDING = 10;
export const TABLE_MIN_WIDTH = 140;
const NAME_TYPE_GAP = 24;

/** Key badge shown in the first column: PK, FK, both, or UQ for unique non-key columns. */
export function getColumnKeyBadge(col: Pick<TableColumn, 'primaryKey' | 'foreignKey' | 'unique'>): string {
  if (col.primaryKey && col.foreignKey) return 'PK FK';
  if (col.primaryKey) return 'PK';
  if (col.foreignKey) return 'FK';
  if (col.unique) return 'UQ';
  return '';
}

export function tableMetrics(fontSize: number) {
  const headerFontSize = fontSize + 1;
  return {
    headerFontSize,
    badgeFontSize: Math.max(8, Math.round(fontSize * 0.8)),
    rowHeight: Math.round(fontSize * 2),
    headerHeight: Math.round(headerFontSize * 2.4),
  };
}

function natural(table: Pick<TableElement, 'name' | 'columns' | 'fontFamily' | 'fontSize'>) {
  const m = tableMetrics(table.fontSize);
  const family = table.fontFamily;
  const badgeWidth = Math.max(
    textWidth('PK', { fontFamily: family, fontSize: m.badgeFontSize, bold: true }),
    ...table.columns.map((c) => textWidth(getColumnKeyBadge(c), { fontFamily: family, fontSize: m.badgeFontSize, bold: true })),
  );
  const keyColumnWidth = Math.ceil(TABLE_PADDING + badgeWidth + 8);
  const nameWidth = Math.max(
    0,
    ...table.columns.map((c) => textWidth(c.name, { fontFamily: family, fontSize: table.fontSize, bold: c.primaryKey })),
  );
  const typeWidth = Math.max(0, ...table.columns.map((c) => textWidth(c.dataType, { fontFamily: family, fontSize: table.fontSize })));
  const typeColumnX = Math.ceil(keyColumnWidth + nameWidth + NAME_TYPE_GAP);
  const headerWidth = textWidth(table.name, { fontFamily: family, fontSize: m.headerFontSize, bold: true }) + TABLE_PADDING * 2;
  const width = Math.ceil(Math.max(TABLE_MIN_WIDTH, typeColumnX + typeWidth + TABLE_PADDING, headerWidth));
  const height = m.headerHeight + Math.max(1, table.columns.length) * m.rowHeight;
  return { ...m, keyColumnWidth, typeColumnX, width, height };
}

/** Minimum size that fits the table name, every column row and the key/name/type columns. */
export function measureTable(table: TableElement): { width: number; height: number } {
  const n = natural(table);
  return { width: n.width, height: n.height };
}

/**
 * Row/column layout inside the table's box (local coordinates): a header with the table name,
 * then one row per column with the key badge, the column name and its data type. A box larger
 * than the natural size keeps rows at the top; the type column stays left aligned.
 */
export function computeTableLayout(table: TableElement): TableLayout {
  const n = natural(table);
  return {
    width: Math.max(table.width, 0),
    height: Math.max(table.height, 0),
    headerHeight: n.headerHeight,
    rowHeight: n.rowHeight,
    keyColumnWidth: n.keyColumnWidth,
    nameColumnX: n.keyColumnWidth,
    typeColumnX: n.typeColumnX,
    rows: table.columns.map((c, i) => ({
      columnId: c.id,
      y: n.headerHeight + i * n.rowHeight,
      height: n.rowHeight,
      badge: getColumnKeyBadge(c),
    })),
    padding: TABLE_PADDING,
    fontSize: table.fontSize,
    headerFontSize: n.headerFontSize,
  };
}
