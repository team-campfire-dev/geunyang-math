'use client';

import { useEffect, useRef, useState } from 'react';
import type { ContentBlock, GlossaryEntry } from '@/shared/api';
import {
  moveBlock, newDefinition, definitionBlockForms,
  type ConceptChoice, type DefinitionEdit, type DefinitionSummary, type EditableConceptScope, type LessonChoice,
} from '@/shared/authoring';
import { useUnsavedForm, discardChanges } from './unsaved-form';
import { Icon } from '@/features/learning/icons';
import { AddBlock, BlockCard } from './block-editor';
import { useExpertMode } from './expert-mode';
import { ConceptExplorer } from '@/features/learning/concept-explorer';
import { definitionRefId } from '@/shared/rich-text';

const refusal = '뜻풀이 안에는 놓아 보는 그림을 둘 수 없어요. 뜻풀이는 문제가 기다리는 동안 읽는 설명이라 조작을 요구하지 않아요.';
const conceptKeyPattern = /^[a-z0-9][a-z0-9.-]{0,99}$/;

/**
 * How one scope calls and explains a concept. The concept is picked from the ones that exist, or
 * named here for the first time — that is how a concept comes to be: a teacher writes a lesson that
 * teaches something no lesson taught before, and the operator merges duplicates afterwards.
 */
function DefinitionForm({ edit, concepts, busy, existing, onChange, onSave, onClose, fixedConcept, available }: {
  available: DefinitionSummary[]; fixedConcept?: boolean; edit: DefinitionEdit; concepts: ConceptChoice[]; busy: boolean; existing: DefinitionSummary | null;
  onChange: (next: DefinitionEdit) => void; onSave: () => void; onClose: () => void;
}) {
  const expert = useExpertMode();
  const taken = edit.blocks.map((block) => block.blockId);
  const writeBlocks = (blocks: ContentBlock[]) => onChange({ ...edit, blocks });
  const known = concepts.find((concept) => concept.key === edit.conceptKey);
  const making = !existing && !known && !!edit.conceptKey;
  const conceptOk = !!known || (making && conceptKeyPattern.test(edit.conceptKey) && !!edit.newConcept?.label.trim());
  const preview: GlossaryEntry = { ...edit, label: edit.label || known?.label || edit.newConcept?.label || '새 개념',
    lessonKey: null };
  const entries: GlossaryEntry[] = [...available.filter(item => definitionRefId(item) !== definitionRefId(edit)).map(item => ({
    ...item, label: item.label || item.conceptLabel, lessonKey: null,
  })), preview];
  const choices = entries.filter(item => item.blocks.length).map(item => ({ ...item, scopeKind: item.scopeKind as EditableConceptScope }));
  const ready = conceptOk && (!!edit.summary.trim() || edit.blocks.length > 0 || !!edit.label.trim());
  return <fieldset className="editor-panel" disabled={busy}>
    <legend>{existing ? `${existing.label || existing.conceptLabel} 고치기` : '새 뜻풀이'}</legend>
    <p className="editor-note">
      {existing
        ? '저장하면 이 뜻풀이를 건 모든 수업에 바로 반영돼요. 뜻풀이는 판본이 없어서 저장이 곧 최신입니다.'
        : '뜻을 풀어 줄 낱말을 고르거나 새로 적어 주세요. 여기서 새로 만든 개념은 수업과 문제에서도 선택할 수 있어요.'}
    </p>
    {existing
      ? <p className="editor-note"><strong>{existing.conceptLabel}</strong>{expert ? ` · ${existing.conceptKey}` : ''}</p>
      : <>
        <label className="editor-field"><span className="editor-label">개념</span>
          <select disabled={fixedConcept} value={known ? edit.conceptKey : ''} onChange={(event) => onChange({ ...edit, conceptKey: event.target.value || `concept-${crypto.randomUUID()}`, newConcept: event.target.value ? undefined : { label: '' } })}>
            <option value="">새 개념…</option>
            {concepts.map((concept) => <option key={concept.key} value={concept.key}>
              {concept.label}{expert ? ` · ${concept.key}` : ''}</option>)}
          </select></label>
        {!known && <>
          {expert && <label className="editor-field"><span className="editor-label">새 개념 키</span>
            <input value={edit.conceptKey} placeholder="coordinate" spellCheck={false}
              onChange={(event) => onChange({ ...edit, conceptKey: event.target.value.trim().toLowerCase(), newConcept: edit.newConcept ?? { label: '' } })} />
            <small>영문 소문자·숫자·점·하이픈. 한 번 저장하면 바꿀 수 없고, 코스를 건너 같은 개념을 가리키는 이름이에요.</small></label>}
          <label className="editor-field"><span className="editor-label">새 개념 이름</span>
            <input value={edit.newConcept?.label ?? ''} maxLength={191} placeholder="예: 좌표, 꼭짓점, 미지수"
              onChange={(event) => onChange({ ...edit, newConcept: { label: event.target.value } })} /></label>
        </>}
      </>}
    <label className="editor-field"><span className="editor-label">이 범위에서 부르는 이름</span>
      <input value={edit.label} maxLength={191} placeholder={existing?.conceptLabel ?? edit.newConcept?.label ?? known?.label ?? ''}
        onChange={(event) => onChange({ ...edit, label: event.target.value })} />
      <small>비워 두면 개념의 이름을 그대로 써요. 이 수업에서 더 쉬운 말로 바꾸어 부를 때 적습니다.</small></label>
    <label className="editor-field"><span className="editor-label">이 설명의 맥락 (선택)</span>
      <input value={edit.usageNote ?? ''} maxLength={500} placeholder="예: 실수 한 변수 함수, 전체를 같은 크기로 나누는 상황"
        onChange={(event) => onChange({ ...edit, usageNote: event.target.value })} />
      <small>난이도 대신 이 설명을 적용하는 범위와 전제를 적어요. 중요한 조건은 설명 본문에도 남겨 주세요.</small></label>
    <label className="editor-field"><span className="editor-label">요약 (선택)</span>
      <textarea value={edit.summary} rows={2} maxLength={500} onChange={(event) => onChange({ ...edit, summary: event.target.value })} />
      <small>한 문장으로 쉽게 줄일 필요는 없어요. 필요한 정의와 조건은 아래 설명에 적어요.</small></label>

    <div className="editor-problem-part">
      <span className="editor-label">설명</span>
      {edit.blocks.map((block, index) => <BlockCard key={block.blockId} block={block} index={index} total={edit.blocks.length}
        arrangingRefusal={refusal} definitionChoices={choices}
        onChange={(next) => writeBlocks(edit.blocks.map((item, position) => (position === index ? next : item)))}
        onMove={(delta) => writeBlocks(moveBlock(edit.blocks, index, delta))}
        onRemove={() => writeBlocks(edit.blocks.filter((_, position) => position !== index))} />)}
      <AddBlock label="설명 블록 추가" forms={definitionBlockForms}
        blockId={() => { for (let index = 1; ; index++) { const id = `definition:block:${index}`; if (!taken.includes(id)) return id; } }}
        onAdd={(block) => writeBlocks([...edit.blocks, block])} />
      <small className="editor-note">설명이 없으면 본문에서 걸 수 없고, 이 범위에서 부르는 이름만 남아요.</small>
    </div>

    <details className="definition-preview"><summary>학습자 미리보기</summary>
      <p className="definition-context-note">연결한 개념을 따라 읽고 돌아와 보세요. 서로를 가리키기만 하는 설명이 아닌지도 확인해 주세요.</p>
      <ConceptExplorer key={definitionRefId(edit)} glossary={{ entries }} browserHistory={false} allowSidePanel={false} returnLabel="편집으로 돌아가기" loadDefinition={async (path) => {
        const found = entries.find(item => definitionRefId(item) === definitionRefId(path.at(-1)!));
        if (!found) throw new Error('연결한 뜻풀이가 없어요. 범위와 저장 상태를 확인해 주세요.');
        return found;
      }}>{(glossary) => <button type="button" className="button secondary" onClick={(event) => glossary.onOpenDefinition?.(preview, event.currentTarget)}>{preview.label} 뜻풀이 열기</button>}</ConceptExplorer>
    </details>

    <div className="editor-actions">
      <button type="button" className="button primary" disabled={busy || !ready} onClick={onSave}>
        저장<Icon name="arrow" size={16} /></button>
      <button type="button" className="text-button" disabled={busy} onClick={onClose}>닫기</button>
      {!ready && <span className="editor-note">개념을 고르거나 새로 적고, 이름·요약·설명 중 하나는 있어야 저장할 수 있어요.</span>}
    </div>
  </fieldset>;
}

/**
 * Definitions are written in place, not drafted: saving is the latest and every reader sees it at
 * once. That is the bargain the glossary makes — a lesson links a concept by key, so a correction
 * reaches every lesson that links it without republishing any of them.
 */
export function DefinitionPanel({ lessons, concepts, mayEditDictionary, onList, onSave, initialLessonKey, onDirty, conceptKey }: {
  lessons: LessonChoice[]; concepts: ConceptChoice[]; mayEditDictionary: boolean; onDirty?: (dirty: boolean) => void; initialLessonKey?: string; conceptKey?: string;
  onList: (scopeKind: EditableConceptScope, scopeKey: string) => Promise<DefinitionSummary[]>;
  onSave: (edit: DefinitionEdit) => Promise<DefinitionSummary[]>;
}) {
  const [scopeKind, setScopeKind] = useState<EditableConceptScope>(initialLessonKey ? 'lesson' : mayEditDictionary ? 'global' : 'lesson');
  const [scopeKey, setScopeKey] = useState(initialLessonKey ?? lessons[0]?.lessonKey ?? '');
  const [edit, setEdit] = useState<DefinitionEdit | null>(null);
  const initial = useRef('');
  const dirty = !!edit && JSON.stringify(edit) !== initial.current;
  useUnsavedForm(dirty, onDirty);
  const [existing, setExisting] = useState<DefinitionSummary | null>(null);
  const [available, setAvailable] = useState<DefinitionSummary[]>([]);
  const [definitions, setDefinitions] = useState<DefinitionSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const list = useRef(onList); list.current = onList;
  const expert = useExpertMode();
  const scope = { scopeKind, scopeKey: scopeKind === 'lesson' ? scopeKey : '' };
  useEffect(() => {
    let active = true;
    setDefinitions(null); setError(''); setSaved(false);
    if (scopeKind === 'lesson' && !scopeKey) return;
    setBusy(true);
    Promise.all([list.current(scopeKind, scopeKind === 'lesson' ? scopeKey : ''),
      scopeKind === 'lesson' ? list.current('global', '') : Promise.resolve([])]).then(([rows, dictionary]) => {
      if (active) { setDefinitions(conceptKey ? rows.filter(row => row.conceptKey === conceptKey) : rows); setAvailable([...rows, ...dictionary]); }
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '뜻풀이를 불러오지 못했어요.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [scopeKind, scopeKey, reload, conceptKey]);
  const save = async () => {
    if (!edit || busy) return;
    setBusy(true); setError(''); setSaved(false);
    try { const rows = await onSave(edit); setDefinitions(conceptKey ? rows.filter(row => row.conceptKey === conceptKey) : rows); setAvailable(previous => [...rows, ...previous.filter(row => row.scopeKind !== edit.scopeKind || row.scopeKey !== edit.scopeKey)]); setEdit(null); setExisting(null); setSaved(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '저장하지 못했어요.'); }
    finally { setBusy(false); }
  };
  const open = (definition: DefinitionSummary | null) => {
    if (!discardChanges(dirty)) return;
    setExisting(definition);
    // Only what may be written: the concept's own name and the time belong to the record, not to the edit.
    const next = definition
      ? { conceptKey: definition.conceptKey, scopeKind: definition.scopeKind, scopeKey: definition.scopeKey,
          label: definition.label, summary: definition.summary, usageNote: definition.usageNote ?? '',
          blocks: structuredClone(definition.blocks).map(block => block.kind === 'core.rich_text' && block.typeVersion === 1
            ? { ...block, typeVersion: 3, payload: { ...block.payload, definitions: [] } } : block) }
      : { ...newDefinition(scope.scopeKind, scope.scopeKey), conceptKey: conceptKey ?? `concept-${crypto.randomUUID()}`, ...(conceptKey ? {} : { newConcept: { label: '' } }) };
    initial.current = JSON.stringify(next); setEdit(next);
  };
  const pick = (kind: EditableConceptScope, key: string) => { setDefinitions(null); setError(''); setSaved(false); setScopeKind(kind); setScopeKey(key); setEdit(null); setExisting(null); };

  return <section className="dashboard-section">
    <div className="section-heading"><div><span className="eyebrow">읽는 중에 펼치는 설명</span><h2>{conceptKey ? `${concepts.find(concept => concept.key === conceptKey)?.label ?? '개념'} 뜻풀이` : '뜻풀이 사전'}</h2></div></div>
    {error && <p className="error-banner" role="alert">{error}<button className="text-button" disabled={busy} onClick={() => setReload((value) => value + 1)}>다시 불러오기</button></p>}
    {saved && <p className="notice-banner" role="status">뜻풀이를 저장했어요.</p>}
    <fieldset className="editor-panel">
      <legend>{scopeKind === 'global' ? '공통 사전' : '수업에서 사용하는 뜻풀이'}</legend>
      <p className="editor-note">수업에서 고르는 개념에 붙는 설명이에요. 본문에서 그 개념을 누르면 이 뜻풀이가 열려요. 공통 사전의 설명을 함께 쓰거나 이 수업에 맞는 뜻풀이를 따로 쓸 수 있어요.</p>
      <div className="editor-actions">
        <label className="editor-field"><span className="editor-label">범위</span>
          <select disabled={busy || !!edit} value={scopeKind} onChange={(event) => pick(event.target.value as EditableConceptScope, scopeKey)}>
            {mayEditDictionary && <option value="global">공통 사전</option>}
            <option value="lesson">수업 뜻풀이</option>
          </select></label>
        {scopeKind === 'lesson' && <label className="editor-field"><span className="editor-label">수업</span>
          <select disabled={busy || !!edit} value={scopeKey} onChange={(event) => pick('lesson', event.target.value)}>
            {lessons.map((item) => <option key={item.lessonKey} value={item.lessonKey}>{item.title}</option>)}
          </select></label>}
      </div>

      {busy && definitions === null && <p className="editor-note" role="status">뜻풀이를 불러오는 중이에요.</p>}
      {definitions !== null && (definitions.length === 0
        ? <p className="empty-inline">아직 이 범위에 뜻풀이가 없어요.</p>
        : <div className="role-list">
          {definitions.map((definition) => <div key={`${definition.scopeKind}:${definition.scopeKey}:${definition.conceptKey}`} className="role-row">
            <span className="role-who">
              <strong>{definition.label || definition.conceptLabel}</strong>
              <small>{expert ? `${definition.conceptKey}${definition.label ? ` · ${definition.conceptLabel}` : ''}` : definition.summary || (definition.blocks.length ? '한 줄 설명 없이 본문만 있어요' : '이름만 있어요')}</small>
            </span>
            <button type="button" className="button secondary" disabled={busy} onClick={() => open(definition)}>고치기</button>
          </div>)}
        </div>)}
      {definitions !== null && !edit && (!conceptKey || !definitions.length) && <button type="button" className="text-button" disabled={busy}
        onClick={() => open(null)}><Icon name="plus" size={14} />새 뜻풀이</button>}
    </fieldset>

    {edit && <DefinitionForm available={available} fixedConcept={!!conceptKey} edit={edit} concepts={concepts} busy={busy} existing={existing}
      onChange={setEdit} onSave={() => void save()} onClose={() => { if (discardChanges(dirty)) { setEdit(null); setExisting(null); } }} />}
  </section>;
}
