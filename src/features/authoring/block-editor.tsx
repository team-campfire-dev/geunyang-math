'use client';

import type { ContentBlock, PublicProblem } from '@/shared/api';
import {
  blockForms, blockFormOf, moveBlock, nextBlockId, readPath, writePath,
  type BlockField, type BlockForm,
} from '@/shared/authoring';
import { splitRichText } from '@/shared/rich-text';
import { Icon } from '@/features/learning/icons';
import { SceneEditor } from './scene-editor';

const text = (value: unknown) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value));
/** A number field left empty stays empty rather than becoming 0; validation names what is missing. */
const numberValue = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value));

function Field({ field, value, onChange }: { field: BlockField; value: unknown; onChange: (next: unknown) => void }) {
  const label = <span className="editor-label">{field.label}{field.optional && <em>선택</em>}</span>;
  if (field.kind === 'boolean') {
    return <label className="editor-field editor-check">
      <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
      {label}{field.hint && <small>{field.hint}</small>}
    </label>;
  }
  return <label className="editor-field">
    {label}
    {field.kind === 'multiline'
      ? <textarea rows={4} value={text(value)} onChange={(event) => onChange(event.target.value)} />
      : <input type={field.kind === 'number' ? 'number' : 'text'} min={field.min} max={field.max}
          value={field.kind === 'number' ? numberValue(value) : text(value)}
          onChange={(event) => onChange(field.kind === 'number'
            ? (event.target.value === '' ? '' : Number(event.target.value))
            : event.target.value)} />}
    {field.hint && <small>{field.hint}</small>}
  </label>;
}

/** One line of a question, so an author choosing questions recognises them without opening each. */
function problemLine(problem: PublicProblem) {
  const first = problem.promptContent.find((block) => typeof block.payload.text === 'string');
  const raw = typeof first?.payload.text === 'string' ? first.payload.text : '';
  const plain = splitRichText(raw).map((segment) => (segment.kind === 'math' ? '(수식)' : segment.value)).join('').trim();
  return plain.length > 60 ? `${plain.slice(0, 60)}…` : plain || '(본문 없음)';
}

function ProblemPicker({ selected, problems, onChange }: { selected: string[]; problems: PublicProblem[]; onChange: (next: string[]) => void }) {
  if (!problems.length) return <p className="editor-note">이 판본에는 문항이 없어요.</p>;
  return <div className="editor-picker">
    {problems.map((problem) => {
      const checked = selected.includes(problem.problemVersionId);
      return <label key={problem.problemVersionId} className="editor-check">
        <input type="checkbox" checked={checked} onChange={() => onChange(checked
          ? selected.filter((id) => id !== problem.problemVersionId)
          : [...selected, problem.problemVersionId])} />
        <span><strong>{problem.problemVersionId}</strong><small>{problemLine(problem)}</small></span>
      </label>;
    })}
  </div>;
}

function Rows({ form, payload, onChange }: { form: BlockForm; payload: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }) {
  const list = form.list!;
  const rows = Array.isArray(payload[list.key]) ? (payload[list.key] as Record<string, unknown>[]) : [];
  const write = (next: Record<string, unknown>[]) => onChange({ ...payload, [list.key]: next });
  return <div className="editor-rows">
    <div className="editor-rows-head"><span className="editor-label">{list.label}</span>
      <button type="button" className="text-button" disabled={rows.length >= list.max}
        onClick={() => write([...rows, list.create()])}><Icon name="plus" size={14} />{list.addLabel}</button></div>
    {rows.map((row, index) => <div key={index} className="editor-row">
      {list.fields.map((field) => <Field key={field.key} field={field} value={row[field.key]}
        onChange={(value) => write(rows.map((item, position) => (position === index ? { ...item, [field.key]: value } : item)))} />)}
      <div className="editor-row-tools">
        <button type="button" className="icon-button" aria-label={`${index + 1}번째 항목 위로`} disabled={index === 0}
          onClick={() => { const next = [...rows]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; write(next); }}>↑</button>
        <button type="button" className="icon-button" aria-label={`${index + 1}번째 항목 아래로`} disabled={index === rows.length - 1}
          onClick={() => { const next = [...rows]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; write(next); }}>↓</button>
        <button type="button" className="icon-button" aria-label={`${index + 1}번째 항목 삭제`}
          onClick={() => write(rows.filter((_, position) => position !== index))}><Icon name="close" size={14} /></button>
      </div>
    </div>)}
  </div>;
}

export function BlockEditor({ block, problems, onChange }: { block: ContentBlock; problems: PublicProblem[]; onChange: (next: ContentBlock) => void }) {
  const form = blockFormOf(block);
  const setPayload = (payload: Record<string, unknown>) => onChange({ ...block, payload });
  if (!form) {
    return <p className="editor-note">이 앱이 모르는 블록이에요({block.kind}@{block.typeVersion}). 여기서는 고칠 수 없고, 대체 설명만 바꿀 수 있어요.</p>;
  }
  return <>
    {form.fields.map((field) => <Field key={field.key} field={field} value={readPath(block.payload, field.key)}
      onChange={(value) => setPayload(writePath(block.payload, field.key, value))} />)}
    {form.list && <Rows form={form} payload={block.payload} onChange={setPayload} />}
    {form.editsScene && <SceneEditor payload={block.payload} onChange={setPayload} />}
    {form.picksProblems && <ProblemPicker problems={problems}
      selected={Array.isArray(block.payload.problemVersionIds) ? (block.payload.problemVersionIds as string[]) : []}
      onChange={(next) => setPayload({ ...block.payload, problemVersionIds: next })} />}
  </>;
}

export function BlockCard({ block, index, total, problems, onChange, onMove, onRemove }: {
  block: ContentBlock; index: number; total: number; problems: PublicProblem[];
  onChange: (next: ContentBlock) => void; onMove: (delta: number) => void; onRemove: () => void;
}) {
  const form = blockFormOf(block);
  return <section className="editor-block">
    <header>
      <div>
        <strong>{form?.label ?? `${block.kind}@${block.typeVersion}`}</strong>
        <small>{block.blockId}</small>
      </div>
      <div className="editor-block-tools">
        <label className="editor-check inline">
          <input type="checkbox" checked={block.required} onChange={(event) => onChange({ ...block, required: event.target.checked })} />
          <span className="editor-label">필수</span>
        </label>
        <button type="button" className="icon-button" aria-label="위로" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
        <button type="button" className="icon-button" aria-label="아래로" disabled={index === total - 1} onClick={() => onMove(1)}>↓</button>
        <button type="button" className="icon-button" aria-label="블록 삭제" onClick={onRemove}><Icon name="close" size={15} /></button>
      </div>
    </header>
    {form?.hint && <p className="editor-note">{form.hint}</p>}
    <BlockEditor block={block} problems={problems} onChange={onChange} />
    {!block.required && <Field field={{ key: 'fallback', label: '대체 설명', kind: 'text', optional: true, hint: '이 블록을 모르는 앱 버전에서 대신 보여줄 문장이에요.' }}
      value={block.fallback} onChange={(value) => onChange({ ...block, fallback: typeof value === 'string' ? value : '' })} />}
  </section>;
}

export function AddBlock({ classKey, sectionId, versionId, taken, onAdd }: {
  classKey: string; sectionId: string; versionId: string; taken: string[]; onAdd: (block: ContentBlock) => void;
}) {
  return <div className="editor-add">
    <span className="editor-label">블록 추가</span>
    <div className="editor-add-buttons">
      {blockForms.map((form) => <button key={`${form.kind}@${form.typeVersion}`} type="button" className="button secondary"
        onClick={() => onAdd({ blockId: nextBlockId(classKey, sectionId, form.kind, versionId, taken), kind: form.kind,
          typeVersion: form.typeVersion, required: true, payload: form.create() })}>
        <Icon name="plus" size={14} />{form.label}</button>)}
    </div>
  </div>;
}

export { moveBlock };
