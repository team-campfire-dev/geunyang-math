'use client';

import { useState } from 'react';
import type { ContentBlock } from '@/shared/api';
import {
  moveBlock, newTerm, termBlockForms,
  type ClassChoice, type EditableTermScope, type SkillChoice, type TermEdit, type TermSummary,
} from '@/shared/authoring';
import { Icon } from '@/features/learning/icons';
import { AddBlock, BlockCard } from './block-editor';
import { useExpertMode } from './expert-mode';

const refusal = '용어 풀이 안에는 놓아 보는 그림을 둘 수 없어요. 풀이는 문항이 기다리는 동안 읽는 설명이라 조작을 요구하지 않아요.';

function TermForm({ edit, skills, busy, existing, onChange, onPublish, onClose }: {
  edit: TermEdit; skills: SkillChoice[]; busy: boolean; existing: TermSummary | null;
  onChange: (next: TermEdit) => void; onPublish: () => void; onClose: () => void;
}) {
  const expert = useExpertMode();
  const taken = edit.blocks.map((block) => block.blockId);
  const writeBlocks = (blocks: ContentBlock[]) => onChange({ ...edit, blocks });
  const ready = !!edit.termKey.trim() && !!edit.label.trim() && !!edit.summary.trim() && !!edit.skillKey && edit.blocks.length > 0;
  return <fieldset className="editor-panel">
    <legend>{existing ? `${existing.label} 고치기` : '새 용어'}</legend>
    <p className="editor-note">
      {existing
        ? `발행하면 ${expert ? existing.versionId : existing.label}의 다음 판이 새로 생기고, 이 용어를 쓰는 모든 수업에 바로 반영돼요. 이전 판은 그대로 남습니다.`
        : '발행하면 바로 쓸 수 있어요. 용어 키는 나중에 바꿀 수 없으니 본문에서 부를 이름으로 정해 주세요.'}
    </p>
    {(!existing || expert) && <label className="editor-field"><span className="editor-label">용어 키</span>
      <input value={edit.termKey} disabled={!!existing} placeholder="term.denominator"
        onChange={(event) => onChange({ ...edit, termKey: event.target.value.trim() })} />
      <small>이 용어를 부르는 이름이에요. 글에서 @로 고를 때는 쓸 일이 없고, 발행한 뒤에는 바꿀 수 없어요.</small></label>}
    <label className="editor-field"><span className="editor-label">표시 이름</span>
      <input value={edit.label} maxLength={191} onChange={(event) => onChange({ ...edit, label: event.target.value })} /></label>
    <label className="editor-field"><span className="editor-label">한 줄 요약</span>
      <input value={edit.summary} maxLength={500} onChange={(event) => onChange({ ...edit, summary: event.target.value })} /></label>
    <label className="editor-field"><span className="editor-label">다루는 개념</span>
      <select value={edit.skillKey} onChange={(event) => onChange({ ...edit, skillKey: event.target.value })}>
        {skills.map((skill) => <option key={skill.key} value={skill.key}>{expert ? `${skill.label} · ${skill.key}` : skill.label}</option>)}
      </select>
      <small>이 개념을 배우는 중이거나 평가하는 동안에는 이 용어가 숨겨져요. 발행한 뒤에는 바꿀 수 없어요.</small></label>

    <div className="editor-problem-part">
      <span className="editor-label">설명</span>
      {edit.blocks.map((block, index) => <BlockCard key={block.blockId} block={block} index={index} total={edit.blocks.length}
        arrangingRefusal={refusal}
        onChange={(next) => writeBlocks(edit.blocks.map((item, position) => (position === index ? next : item)))}
        onMove={(delta) => writeBlocks(moveBlock(edit.blocks, index, delta))}
        onRemove={() => writeBlocks(edit.blocks.filter((_, position) => position !== index))} />)}
      <AddBlock label="설명 블록 추가" forms={termBlockForms}
        blockId={() => { for (let index = 1; ; index++) { const id = `term:block:${index}`; if (!taken.includes(id)) return id; } }}
        onAdd={(block) => writeBlocks([...edit.blocks, block])} />
    </div>

    <div className="editor-actions">
      <button type="button" className="button primary" disabled={busy || !ready} onClick={onPublish}>
        {existing ? '새 판본 발행' : '발행'}<Icon name="arrow" size={16} /></button>
      <button type="button" className="text-button" disabled={busy} onClick={onClose}>닫기</button>
      {!ready && <span className="editor-note">키·이름·요약·설명이 모두 있어야 발행할 수 있어요.</span>}
    </div>
  </fieldset>;
}

/**
 * Definitions are published, not drafted: saving writes the next version and every reader sees it
 * at once. That is the bargain the glossary already makes — a class links a term by key, so a
 * correction reaches every class that links it without republishing any of them.
 */
export function TermPanel({ classes, skills, terms, busy, mayEditDictionary, onList, onSave }: {
  classes: ClassChoice[]; skills: SkillChoice[]; terms: TermSummary[] | null; busy: boolean; mayEditDictionary: boolean;
  onList: (scopeKind: EditableTermScope, scopeKey: string) => void; onSave: (edit: TermEdit) => void;
}) {
  const [scopeKind, setScopeKind] = useState<EditableTermScope>(mayEditDictionary ? 'global' : 'class');
  const [scopeKey, setScopeKey] = useState(classes[0]?.classKey ?? '');
  const [edit, setEdit] = useState<TermEdit | null>(null);
  const [existing, setExisting] = useState<TermSummary | null>(null);
  const expert = useExpertMode();
  const skillLabel = (key: string) => skills.find((skill) => skill.key === key)?.label ?? key;
  const scope = { scopeKind, scopeKey: scopeKind === 'class' ? scopeKey : '' };
  const open = (term: TermSummary | null) => {
    setExisting(term);
    // Only what may be written: the version and its date belong to the record, not to the edit.
    setEdit(term
      ? { termKey: term.termKey, scopeKind: term.scopeKind, scopeKey: term.scopeKey, skillKey: term.skillKey,
          label: term.label, summary: term.summary, blocks: structuredClone(term.blocks) }
      : newTerm(scope.scopeKind, scope.scopeKey, skills[0]?.key ?? ''));
  };
  const pick = (kind: EditableTermScope, key: string) => { setScopeKind(kind); setScopeKey(key); setEdit(null); setExisting(null); };

  return <section className="dashboard-section">
    <div className="section-heading"><div><span className="eyebrow">GLOSSARY</span><h2>용어 풀이</h2></div></div>
    <fieldset className="editor-panel">
      <legend>어디 용어</legend>
      <p className="editor-note">공통 사전은 운영자가 모아 두는 용어이고, 클래스 용어는 그 수업 안에서만 쓰는 풀이예요. 같은 키라도 서로 다른 용어입니다.</p>
      <div className="editor-actions">
        <label className="editor-field"><span className="editor-label">범위</span>
          <select value={scopeKind} onChange={(event) => pick(event.target.value as EditableTermScope, scopeKey)}>
            {mayEditDictionary && <option value="global">공통 사전</option>}
            <option value="class">클래스 용어</option>
          </select></label>
        {scopeKind === 'class' && <label className="editor-field"><span className="editor-label">클래스</span>
          <select value={scopeKey} onChange={(event) => pick('class', event.target.value)}>
            {classes.map((item) => <option key={item.classKey} value={item.classKey}>{item.title}</option>)}
          </select></label>}
        <button type="button" className="button secondary" disabled={busy || (scopeKind === 'class' && !scopeKey)}
          onClick={() => onList(scope.scopeKind, scope.scopeKey)}>불러오기</button>
      </div>

      {terms !== null && (terms.length === 0
        ? <p className="empty-inline">아직 이 범위에 용어가 없어요.</p>
        : <div className="role-list">
          {terms.map((term) => <div key={term.versionId} className="role-row">
            <span className="role-who">
              <strong>{term.label}</strong>
              <small>{expert ? `${term.termKey} · ${term.skillKey} · ${term.versionId}` : `${skillLabel(term.skillKey)} · ${term.summary}`}</small>
            </span>
            <button type="button" className="button secondary" disabled={busy} onClick={() => open(term)}>고치기</button>
          </div>)}
        </div>)}
      {terms !== null && <button type="button" className="text-button" disabled={busy || !skills.length}
        onClick={() => open(null)}><Icon name="plus" size={14} />새 용어</button>}
    </fieldset>

    {edit && <TermForm edit={edit} skills={skills} busy={busy} existing={existing}
      onChange={setEdit} onPublish={() => onSave(edit)} onClose={() => { setEdit(null); setExisting(null); }} />}
  </section>;
}
