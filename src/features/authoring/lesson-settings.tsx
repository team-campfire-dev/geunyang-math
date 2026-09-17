'use client';

import {
  looseProblems, problemGist, versionLabel,
  type ConceptChoice, type DefinitionEdit, type DefinitionSummary, type DraftDetail, type DraftEdit,
  type DraftIssue, type EditableConceptScope, type LessonChoice,
} from '@/shared/authoring';
import { Icon } from '@/features/learning/icons';
import { useRemovalNotice } from './edit-history';
import { useExpertMode } from './expert-mode';
import { ConceptPicker } from './problem-editor';
import { DefinitionPanel } from './definition-editor';

/**
 * What the lesson says about itself, on a page of its own.
 *
 * These used to sit in the inspector beside the block being written, which made one column answer
 * two different questions — what this lesson is, and what this paragraph is — and left an author
 * scrolling past the lesson's concepts to reach a question's hint. A lesson is named, scoped and
 * reviewed a few times; a paragraph is written all afternoon. Only the second one has earned a
 * permanent column.
 */
export function LessonSettings({
  edit, draft, concepts, lessons, published, issues, showDefinitions, mayEditDictionary,
  onEdit, onShowDefinitions, onDefinitionDirty, onListDefinitions, onSaveDefinition, onDelete, onClose,
}: {
  edit: DraftEdit; draft: DraftDetail; concepts: ConceptChoice[]; lessons: LessonChoice[];
  published: boolean; issues: DraftIssue[]; showDefinitions: boolean; mayEditDictionary: boolean;
  onEdit: (next: DraftEdit) => void;
  onShowDefinitions: (open: boolean) => void;
  onDefinitionDirty: (dirty: boolean) => void;
  onListDefinitions: (scopeKind: EditableConceptScope, scopeKey: string) => Promise<DefinitionSummary[]>;
  onSaveDefinition: (definition: DefinitionEdit) => Promise<DefinitionSummary[]>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const expert = useExpertMode();
  const notifyRemoval = useRemovalNotice();
  const assessable = concepts.filter((concept) => concept.assessable);
  /** Questions no activity in the lesson holds. They block publishing, so the lesson says so here. */
  const loose = looseProblems(edit);

  return <div className="editor-settings">
    <div className="editor-settings-head">
      <button type="button" className="back-button" onClick={onClose}><Icon name="back" size={16} />수업으로</button>
      <div><span className="eyebrow">수업 정보</span><h2>{edit.meta.title || '이름 없는 수업'}</h2></div>
    </div>

    <fieldset className="editor-panel" disabled={published}>
      <legend>이 수업</legend>
      {/* The name of the version being written. The server suggests it and nothing here needs to be
          told it, so only an operator is shown the field. */}
      {expert
        ? <label className="editor-field"><span className="editor-label">새 판본 ID</span>
          <input value={edit.meta.versionId} onChange={(event) => onEdit({ ...edit, meta: { ...edit.meta, versionId: event.target.value } })} />
          <small>발행한 판본은 고칠 수 없어서, 수정은 늘 새 판본이 돼요. 기준 판본: {draft.baseVersionId ?? '없음'}</small></label>
        : <p className="editor-note">{published ? `${versionLabel(edit.meta.versionId)} 발행판입니다.` : `발행하면 ${versionLabel(edit.meta.versionId)}이 돼요.`} 이미 발행한 판은 고칠 수 없어서,
          수정은 늘 새 판이 됩니다. 수강 중인 사람은 시작한 판을 끝까지 봅니다.</p>}
      <label className="editor-field"><span className="editor-label">한 줄 소개</span>
        <input aria-label="한 줄 소개" aria-invalid={issues.some((issue) => issue.field === 'summary')} value={edit.meta.summary}
          onChange={(event) => onEdit({ ...edit, meta: { ...edit.meta, summary: event.target.value } })} />
        <small>{issues.find((issue) => issue.field === 'summary')?.message ?? '수업을 고르는 화면에서 제목 아래에 보여요.'}</small></label>
      <label className="editor-field"><span className="editor-label">예상 시간(분)</span>
        <input aria-label="예상 시간(분)" type="number" min={1} max={240} value={edit.meta.estimatedMinutes}
          onChange={(event) => onEdit({ ...edit, meta: { ...edit.meta, estimatedMinutes: Number(event.target.value) } })} /></label>
    </fieldset>

    <fieldset className="editor-panel" disabled={published}>
      <legend>가르치는 것</legend>
      <ConceptPicker concepts={assessable} chosen={edit.meta.conceptKeys} label="수업에서 다루는 개념"
        onChange={(conceptKeys) => onEdit({ ...edit, meta: { ...edit.meta, conceptKeys,
          prerequisiteConceptKeys: edit.meta.prerequisiteConceptKeys?.filter((key) => !conceptKeys.includes(key)) } })} />
      <p className="editor-note">분수·분자·분모처럼 수업에서 배우는 작은 단위를 골라 주세요. 개념마다 뜻풀이를 연결할 수 있고, 각 문제는 이 중 무엇을 확인하는지 선택합니다.</p>
      <ConceptPicker concepts={assessable.filter((concept) => !edit.meta.conceptKeys.includes(concept.key))}
        chosen={edit.meta.prerequisiteConceptKeys ?? []} label="먼저 알아야 하는 개념"
        onChange={(prerequisiteConceptKeys) => onEdit({ ...edit, meta: { ...edit.meta, prerequisiteConceptKeys } })} />
    </fieldset>

    <fieldset className="editor-panel" disabled={published}>
      <legend>수업을 마친 뒤 복습</legend>
      <label className="editor-field"><span className="editor-label">복습에 낼 문제</span>
        <select value={edit.reviewBlockId === undefined ? 'keep' : edit.reviewBlockId ?? 'none'}
          onChange={(event) => onEdit({ ...edit, reviewBlockId: event.target.value === 'keep' ? undefined : event.target.value === 'none' ? null : event.target.value })}>
          {draft.review && draft.edit.reviewBlockId === undefined && <option value="keep">기존 복습 문제 유지</option>}
          <option value="none">복습 과제 만들지 않기</option>
          {edit.sections.flatMap((section) => section.contentBlocks.filter((block) => block.kind === 'core.problem_set')
            .map((block, index) => <option key={block.blockId} value={block.blockId}>{section.title} · 문제 {index + 1} 묶음</option>))}
        </select>
        <small>선택한 문제 중 학습자의 풀이와 목표에 맞게 복습 과제를 만들어요. 수업 안의 문제를 선택하면 이후 수정도 함께 반영됩니다.</small></label>
      <p className="editor-note">{draft.review
        ? `저장된 복습 문제: ${draft.review.problemVersionIds.length}개.`
        : '저장된 복습 문제가 없어요.'}</p>
    </fieldset>

    {!!loose.length && <fieldset className="editor-panel" disabled={published}>
      <legend>어디에도 속하지 않은 문항</legend>
      <p className="editor-note editor-warn">활동이 지워지면서 남은 문항이에요. 아무 단계에도 들어 있지 않아 이대로는 발행할 수 없어요.</p>
      <div className="editor-problems">
        {loose.map((problem) => <div key={problem.problemVersionId} className="editor-problem-row">
          <span className="editor-problem-open">
            <strong>{expert ? problem.problemVersionId : '문항'}</strong>
            <small>{problemGist(problem) || '아직 비어 있어요'}</small>
          </span>
          <button type="button" className="icon-button" aria-label="이 문항 지우기"
            onClick={() => {
              onEdit({ ...edit, problems: edit.problems.filter((item) => item.problemVersionId !== problem.problemVersionId) });
              notifyRemoval('문항');
            }}><Icon name="close" size={14} /></button>
        </div>)}
      </div>
    </fieldset>}

    {!published && <fieldset className="editor-panel">
      <legend>이 수업의 뜻풀이</legend>
      <p className="editor-note">이 수업에서만 쓰는 낱말의 뜻을 여기에서 씁니다. 공통 사전의 뜻풀이는 모든 수업이 함께 읽어요.</p>
      <button type="button" className="button secondary" aria-expanded={showDefinitions}
        onClick={() => onShowDefinitions(!showDefinitions)}>뜻풀이 {showDefinitions ? '닫기' : '관리'}</button>
      {showDefinitions && <div className="studio-inline-definitions">
        <DefinitionPanel onDirty={onDefinitionDirty} key={draft.id} initialLessonKey={draft.lessonKey}
          lessons={lessons} concepts={concepts} mayEditDictionary={mayEditDictionary}
          onList={onListDefinitions} onSave={onSaveDefinition} />
      </div>}
    </fieldset>}

    {!published && <div className="editor-settings-end">
      {/* Kept away from the writing screen's own actions: discarding an afternoon is not a thing to
          put next to the button that saves it. */}
      <button type="button" className="text-button editor-warn"
        onClick={() => { if (confirm('이 초안을 삭제할까요? 발행한 판본은 남습니다.')) onDelete(); }}>
        <Icon name="close" size={14} />이 초안 삭제</button>
    </div>}
  </div>;
}
