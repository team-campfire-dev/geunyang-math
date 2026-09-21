// A table described as data rather than as markup, the way a drawing is. The publishing validator,
// the learner's renderer and the editor's grid all read these rules, so a table that saves is a
// table that draws. Nothing here becomes markup: every value lands in the text of a cell element we
// create. A cell's `$...$` is no exception — it is the same string prose stores, handed to the same
// hardened KaTeX call, so an author writes TeX and never markup.
//
// Why a table is its own block rather than prose: the numbers in 자료해석 are read down a column and
// across a row, and a reader who cannot see the screen needs the header cells announced with each
// value. That is what `<th scope>` does and what a paragraph of numbers cannot.

export const tableLimits = {
  maxColumns: 8, maxRows: 20, maxCaption: 200, maxNote: 200, maxLabel: 60, maxCell: 80,
} as const;

/** Which way a column's values line up. Numbers read down a column when their digits line up. */
export type TableAlign = 'start' | 'end';
export type TableColumn = { label: string; align?: TableAlign };
export type TableRow = { cells: string[] };
export type Table = {
  /** The table's title and its accessible name, so it is plain text with no math in it. */
  caption: string;
  /** One line under the table for what the numbers are in — 「단위: 만 원」, a source, a year. */
  note?: string;
  columns: TableColumn[];
  rows: TableRow[];
  /** Whether each row's first cell names the row. A table of 지점별 매출 has one; a list of values does not. */
  rowHeader?: boolean;
};

export const alignLabels: Record<TableAlign, string> = { start: '왼쪽', end: '오른쪽' };

/** A new column, empty in every row that already exists. */
export const createColumn = (table: Table, label = '항목'): Table => ({
  ...table,
  columns: [...table.columns, { label, align: 'end' }],
  rows: table.rows.map((row) => ({ ...row, cells: [...row.cells, ''] })),
});

export const createRow = (table: Table): Table => ({
  ...table,
  rows: [...table.rows, { cells: table.columns.map(() => '') }],
});

export const removeColumn = (table: Table, index: number): Table => ({
  ...table,
  columns: table.columns.filter((_, at) => at !== index),
  rows: table.rows.map((row) => ({ ...row, cells: row.cells.filter((_, at) => at !== index) })),
});

export const removeRow = (table: Table, index: number): Table => ({ ...table, rows: table.rows.filter((_, at) => at !== index) });

export const writeCell = (table: Table, row: number, column: number, value: string): Table => ({
  ...table,
  rows: table.rows.map((item, at) => at === row
    ? { ...item, cells: item.cells.map((cell, position) => (position === column ? value : cell)) } : item),
});

export const writeColumn = (table: Table, index: number, change: Partial<TableColumn>): Table => ({
  ...table,
  columns: table.columns.map((column, at) => (at === index ? { ...column, ...change } : column)),
});

/**
 * Reads a table out of a block payload without trusting it. A malformed table opens as an empty one
 * rather than throwing an author out of the editor, and a row that is short or long is squared off
 * against the columns — the validator will still refuse to publish it, but at least it can be seen.
 */
export function readTable(payload: Record<string, unknown>): Table {
  const columns = Array.isArray(payload.columns)
    ? (payload.columns as TableColumn[]).filter((column) => !!column && typeof column === 'object')
      .map((column) => ({ label: typeof column.label === 'string' ? column.label : '',
        ...(column.align === 'start' || column.align === 'end' ? { align: column.align } : {}) }))
    : [];
  const rows = Array.isArray(payload.rows)
    ? (payload.rows as TableRow[]).filter((row) => !!row && Array.isArray(row.cells))
      .map((row) => ({ cells: columns.map((_, at) => (typeof row.cells[at] === 'string' ? row.cells[at] : '')) }))
    : [];
  return {
    caption: typeof payload.caption === 'string' ? payload.caption : '',
    ...(typeof payload.note === 'string' && payload.note ? { note: payload.note } : {}),
    columns, rows, ...(payload.rowHeader === true ? { rowHeader: true } : {}),
  };
}

/**
 * What is wrong with a table, or null when nothing is. One reader for the editor, which says it
 * while the author types, and for publication, which refuses it. The rules a schema can state —
 * lengths, counts — stay in the schema; this is the handful that are about the table as a whole.
 */
export function tableIssue(table: Table): string | null {
  if (!table.caption.trim()) return '표의 제목을 적어 주세요. 화면 낭독에서 이 표의 이름이 돼요.';
  if (!table.columns.length) return '열을 하나 이상 두어야 해요.';
  if (table.columns.some((column) => !column.label.trim())) return '이름이 빈 열이 있어요.';
  if (!table.rows.length) return '줄을 하나 이상 두어야 해요.';
  if (table.rows.some((row) => row.cells.length !== table.columns.length)) return '열의 수와 칸의 수가 서로 달라요.';
  // A row whose first cell names it cannot leave that cell empty: the name is what the other cells
  // are announced with, and an unnamed row is read as a value with nothing to belong to.
  if (table.rowHeader && table.rows.some((row) => !row.cells[0]?.trim())) return '줄 이름이 비어 있어요. 첫 칸이 그 줄의 이름이에요.';
  return null;
}
