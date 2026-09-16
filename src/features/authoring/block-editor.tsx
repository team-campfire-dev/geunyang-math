'use client';

import type { ReactNode } from 'react';
import type { ContentBlock } from '@/shared/api';
import { classBlockForms, blockFormOf, moveBlock, readPath, writePath, type BlockField, type BlockForm, type TermChoice } from '@/shared/authoring';
import type { TermAnnotation } from '@/shared/rich-text';
import { TermText } from './term-mentions';
import { useRemovalNotice } from './edit-history';
import { useExpertMode } from './expert-mode';
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
  if (field.kind === 'select') {
    return <label className="editor-field">
      {label}
      <select value={text(value)} onChange={(event) => onChange(event.target.value)}>
        {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {field.hint && <small>{field.hint}</small>}
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

function Rows({ form, payload, onChange }: { form: BlockForm; payload: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }) {
  const notifyRemoval = useRemovalNotice();
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
          onClick={() => { write(rows.filter((_, position) => position !== index)); notifyRemoval(list.label); }}><Icon name="close" size={14} /></button>
      </div>
    </div>)}
  </div>;
}

/**
 * The term links a paragraph carries, shown as the words they sit on. They are put there by typing
 * `@` in the text above, which is also what decides which occurrence of a word is meant, so this is
 * only where one is taken back off.
 */
function TermLinks({ payload, onChange }: { payload: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }) {
  const notifyRemoval = useRemovalNotice();
  const terms = Array.isArray(payload.terms) ? (payload.terms as TermAnnotation[]) : [];
  if (!terms.length) return null;
  return <div className="editor-links">
    <span className="editor-label">연결한 용어</span>
    <div className="editor-link-list">
      {terms.map((term, index) => <span key={`${term.termKey}:${term.surface}:${index}`} className="editor-link">
        {term.surface}
        <button type="button" className="icon-button" aria-label={`${term.surface} 용어 연결 끊기`}
          onClick={() => { onChange({ ...payload, terms: terms.filter((_, position) => position !== index) }); notifyRemoval('용어 연결'); }}>
          <Icon name="close" size={12} /></button>
      </span>)}
    </div>
  </div>;
}

export function BlockEditor({ block, problems, arrangingRefusal, termChoices, omit, onChange }: {
  block: ContentBlock; problems?: ReactNode; arrangingRefusal?: string; termChoices?: TermChoice[];
  /** Fields the caller writes somewhere else — a paragraph's body is typed where it will be read. */
  omit?: string[];
  onChange: (next: ContentBlock) => void;
}) {
  const form = blockFormOf(block);
  const expert = useExpertMode();
  const setPayload = (payload: Record<string, unknown>) => onChange({ ...block, payload });
  if (!form) {
    return <p className="editor-note">이 앱이 모르는 블록이에요({block.kind}@{block.typeVersion}). 여기서는 고칠 수 없고, 대체 설명만 바꿀 수 있어요.</p>;
  }
  // A paragraph that may link terms writes its body through the picker instead of a plain field.
  const writesTerms = form.list?.key === 'terms';
  return <>
    {form.fields.filter((field) => !omit?.includes(field.key)).map((field) => (writesTerms && field.key === 'text'
      ? <TermText key={field.key} payload={block.payload} terms={termChoices ?? []} onChange={setPayload} />
      : <Field key={field.key} field={field} value={readPath(block.payload, field.key)}
          onChange={(value) => setPayload(writePath(block.payload, field.key, value))} />))}
    {form.list && (writesTerms && !expert
      // The picker above writes these. Its table names a term by key and counts which occurrence it
      // meant, which is the app's bookkeeping, not a decision anyone makes while writing a lesson.
      ? <TermLinks payload={block.payload} onChange={setPayload} />
      : <Rows form={form} payload={block.payload} onChange={setPayload} />)}
    {form.editsScene && <SceneEditor payload={block.payload} arrangingRefusal={arrangingRefusal} onChange={setPayload} />}
    {form.editsProblems && problems}
  </>;
}

export function BlockCard({ block, index, total, problems, arrangingRefusal, termChoices, omit, onChange, onMove, onCopy, onRemove }: {
  block: ContentBlock; index: number; total: number; problems?: ReactNode; arrangingRefusal?: string; termChoices?: TermChoice[];
  omit?: string[];
  onChange: (next: ContentBlock) => void; onMove: (delta: number) => void; onCopy?: () => void; onRemove: () => void;
}) {
  const form = blockFormOf(block);
  const expert = useExpertMode();
  const notifyRemoval = useRemovalNotice();
  return <section className="editor-block">
    <header>
      <div>
        <strong>{form?.label ?? `${block.kind}@${block.typeVersion}`}</strong>
        {expert && <small>{block.blockId}</small>}
      </div>
      <div className="editor-block-tools">
        {/* Whether an app too old to draw this block may still finish the lesson, and what it says
            instead. That is a question about released apps, not about the lesson being written. */}
        {expert && <label className="editor-check inline">
          <input type="checkbox" checked={block.required} onChange={(event) => onChange({ ...block, required: event.target.checked })} />
          <span className="editor-label">필수</span>
        </label>}
        {onCopy && <button type="button" className="icon-button" aria-label="블록 복제" title="블록 복제"
          onClick={onCopy}><Icon name="copy" size={15} /></button>}
        <button type="button" className="icon-button" aria-label="위로" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
        <button type="button" className="icon-button" aria-label="아래로" disabled={index === total - 1} onClick={() => onMove(1)}>↓</button>
        <button type="button" className="icon-button" aria-label="블록 삭제"
          onClick={() => { notifyRemoval(form?.label ?? '블록'); onRemove(); }}><Icon name="close" size={15} /></button>
      </div>
    </header>
    {form?.hint && <p className="editor-note">{form.hint}</p>}
    <BlockEditor block={block} problems={problems} arrangingRefusal={arrangingRefusal} termChoices={termChoices}
      omit={omit} onChange={onChange} />
    {expert && !block.required && <Field field={{ key: 'fallback', label: '대체 설명', kind: 'text', optional: true, hint: '이 블록을 모르는 앱 버전에서 대신 보여줄 문장이에요.' }}
      value={block.fallback} onChange={(value) => onChange({ ...block, fallback: typeof value === 'string' ? value : '' })} />}
  </section>;
}

/** The caller names the new block, since where a block lands decides what its name should read as. */
export function AddBlock({ label = '블록 추가', forms = classBlockForms, blockId, onAdd }: {
  label?: string; forms?: BlockForm[]; blockId: (kind: string) => string; onAdd: (block: ContentBlock) => void;
}) {
  return <div className="editor-add">
    <span className="editor-label">{label}</span>
    <div className="editor-add-buttons">
      {forms.filter((form) => !form.retired).map((form) => <button key={`${form.kind}@${form.typeVersion}`} type="button" className="button secondary"
        onClick={() => onAdd({ blockId: blockId(form.kind), kind: form.kind,
          typeVersion: form.typeVersion, required: true, payload: form.create() })}>
        <Icon name="plus" size={14} />{form.label}</button>)}
    </div>
  </div>;
}

export { moveBlock };
