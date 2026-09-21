'use client';

import {
  alignLabels, createColumn, createRow, readTable, removeColumn, removeRow, tableIssue, tableLimits, writeCell, writeColumn,
  type TableAlign,
} from '@/shared/table';
import { Icon } from '@/features/learning/icons';
import { useRemovalNotice } from './edit-history';

/**
 * A grid to type into, rather than a form describing a grid.
 *
 * The cells sit where they will sit for the learner, so what is arranged here is what ships. Only
 * the two things a cell cannot say for itself are asked separately: what the column is called and
 * which way its values line up. Everything this produces is the declarative table the validator
 * already checks, and `tableIssue` — the same reader publication uses — says what is missing while
 * the author is still typing rather than at the end of the work.
 */
export function TableEditor({ payload, onChange }: {
  payload: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void;
}) {
  const table = readTable(payload);
  const notifyRemoval = useRemovalNotice();
  const write = (next: ReturnType<typeof readTable>) => onChange({ ...payload, ...next });
  const issue = tableIssue(table);
  const columns = table.columns.length;
  return <div className="table-editor">
    <label className="form-label inline-check">
      <input type="checkbox" checked={!!table.rowHeader}
        onChange={(event) => write({ ...table, rowHeader: event.target.checked })} />
      첫 칸이 줄 이름
    </label>
    <div className="table-editor-grid">
      <table>
        <thead>
          <tr>
            {table.columns.map((column, index) => <th key={index}>
              <input aria-label={`${index + 1}번째 열 이름`} value={column.label} maxLength={tableLimits.maxLabel}
                onChange={(event) => write(writeColumn(table, index, { label: event.target.value }))} />
              <div className="table-editor-column-tools">
                <select aria-label={`${index + 1}번째 열 정렬`} value={column.align ?? 'start'}
                  onChange={(event) => write(writeColumn(table, index, { align: event.target.value as TableAlign }))}>
                  {(Object.keys(alignLabels) as TableAlign[]).map((key) => <option key={key} value={key}>{alignLabels[key]}</option>)}
                </select>
                <button type="button" className="icon-button" aria-label={`${index + 1}번째 열 지우기`}
                  disabled={columns <= 1}
                  onClick={() => { notifyRemoval('열'); write(removeColumn(table, index)); }}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            </th>)}
            <th className="table-editor-add">
              <button type="button" className="text-button" disabled={columns >= tableLimits.maxColumns}
                onClick={() => write(createColumn(table))}><Icon name="plus" size={14} />열</button>
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, at) => <tr key={at}>
            {row.cells.map((cell, index) => <td key={index}>
              <input aria-label={`${at + 1}번째 줄 ${index + 1}번째 칸`} value={cell} maxLength={tableLimits.maxCell}
                className={table.columns[index]?.align === 'end' ? 'is-end' : undefined}
                onChange={(event) => write(writeCell(table, at, index, event.target.value))} />
            </td>)}
            <td className="table-editor-add">
              <button type="button" className="icon-button" aria-label={`${at + 1}번째 줄 지우기`}
                disabled={table.rows.length <= 1}
                onClick={() => { notifyRemoval('줄'); write(removeRow(table, at)); }}>
                <Icon name="close" size={14} />
              </button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="table-editor-actions">
      <button type="button" className="text-button" disabled={table.rows.length >= tableLimits.maxRows}
        onClick={() => write(createRow(table))}><Icon name="plus" size={15} />줄 추가</button>
      <span>{table.rows.length}줄 · {columns}열</span>
    </div>
    {issue && <p className="editor-warn" role="alert">{issue}</p>}
  </div>;
}
