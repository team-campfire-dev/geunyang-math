'use client';
import { useState } from 'react';
import { mayPublish, type AuthoringWorkspace, type AuthoringAction, type DraftSummary, type DefinitionEdit, type DefinitionSummary, type EditableConceptScope } from '@/shared/authoring';
import { DefinitionPanel } from './definition-editor';
import { useUnsavedForm, discardChanges } from './unsaved-form';

export function ConceptLibrary({ workspace, busy, onAction, onOpen, onDirty, onListDefinitions, onSaveDefinition }: {
  workspace: AuthoringWorkspace; busy: boolean; onAction: (action: AuthoringAction) => Promise<boolean>;
  onListDefinitions: (kind: EditableConceptScope, key: string) => Promise<DefinitionSummary[]>;
  onSaveDefinition: (edit: DefinitionEdit) => Promise<DefinitionSummary[]>;
  onOpen: (draft: DraftSummary) => void; onDirty: (dirty: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [definitionDirty, setDefinitionDirty] = useState(false);
  useUnsavedForm(!!name.trim() || definitionDirty, onDirty);
  const concepts = workspace.concepts.filter(c => c.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = workspace.concepts.find(c => c.key === chosen);
  const lessons = workspace.lessons.filter(l => l.conceptKeys?.includes(chosen ?? ''));
  return <section className="dashboard-section concept-library">
    <div className="section-heading"><div><span className="eyebrow">수업을 이루는 작은 단위</span><h2>개념과 관련 수업</h2>
      <p className="editor-note">분수·분자·분모처럼 수학의 작은 단위를 개념으로 관리해요. 개념을 고르면 그 뜻풀이와, 그 개념을 다루는 수업을 함께 볼 수 있어요.</p></div></div>
    <label className="editor-field"><span className="editor-label">개념 찾기</span><input type="search" value={query} placeholder="예: 분수, 분자, 분모" onChange={e => setQuery(e.target.value)} /></label>
    <div className="concept-cards">{concepts.map(c => <button key={c.key} className={`concept-card${chosen === c.key ? ' active' : ''}`} aria-pressed={chosen === c.key} onClick={() => { if (chosen !== c.key && discardChanges(definitionDirty)) { setDefinitionDirty(false); setChosen(c.key); } }}>
      <strong>{c.label}</strong><span>{workspace.lessons.filter(l => l.conceptKeys?.includes(c.key)).length}개 수업</span>
    </button>)}</div>
    {!concepts.length && <p className="empty-inline">찾은 개념이 없어요. 다른 이름으로 검색하거나 새 개념을 추가해 주세요.</p>}
    {mayPublish(workspace.role) && <form className="editor-panel" onSubmit={async e => { e.preventDefault(); if (!name.trim() || busy || !discardChanges(definitionDirty)) return;
      const key = `concept-${crypto.randomUUID()}`;
      if (await onAction({action:'concept.create',key,label:name.trim()})) { setName(''); setQuery(''); setDefinitionDirty(false); setChosen(key); }
    }}><label className="editor-field"><span className="editor-label">새 개념 이름</span><input value={name} maxLength={191} onChange={e => setName(e.target.value)} placeholder="예: 미지수" /></label>
      <div className="editor-actions"><button className="button secondary" disabled={busy || !name.trim()}>개념 추가</button><span className="editor-note">기존 이름을 먼저 확인해 주세요. 모든 코스가 함께 쓰는 개념입니다.</span></div></form>}
    {selected && <DefinitionPanel key={selected.key} conceptKey={selected.key} onDirty={setDefinitionDirty} lessons={workspace.lessons} concepts={workspace.concepts}
      mayEditDictionary={mayPublish(workspace.role)} onList={onListDefinitions} onSave={onSaveDefinition} />}
    {selected && <section className="dashboard-section"><h3>{selected.label} · {lessons.length}개 수업</h3>
      {lessons.length ? <div className="studio-lessons">{lessons.map(lesson => {
        const drafts = workspace.drafts.filter(d => d.lessonKey === lesson.lessonKey && d.status !== 'published');
        return <article className="studio-lesson" key={lesson.lessonKey}><div className="assignment-info"><h4>{lesson.title}</h4>
          <small>{workspace.courses.find(c => c.key === lesson.courseKey)?.title}</small>
          {drafts.map(draft => <button key={draft.id} className="studio-draft-link" disabled={busy} onClick={() => onOpen(draft)}>초안 이어 쓰기 · {draft.title}</button>)}</div>
          {lesson.latestVersionId && <button className="button secondary" disabled={busy} onClick={() => void onAction({action:'lesson.read',versionId:lesson.latestVersionId!})}>발행판 보기</button>}
        </article>;
      })}</div> : <p className="empty-inline">아직 이 개념을 다루는 수업이 없어요. 수업 설정의 ‘수업에서 다루는 개념’에서 선택해 주세요.</p>}
    </section>}
  </section>;
}
