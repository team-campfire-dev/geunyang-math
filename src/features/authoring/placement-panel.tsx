'use client';

import { useState } from 'react';
import { issueText, problemGist, type ConceptChoice, type DiagnosticChoice, type DiagnosticDraft, type DiagnosticEdit, type DraftProblem } from '@/shared/authoring';
import type { AnswerInput } from '@/shared/authoring-checks';
import { Icon } from '@/features/learning/icons';
import { useExpertMode } from './expert-mode';
import { ProblemList, ProblemPanel } from './problem-editor';

/**
 * Writing the placement.
 *
 * Its questions are the only ones no lesson holds, so until now the only way to change what the
 * service asks everybody first was to edit a file and deploy. The screen is deliberately plain: a
 * placement is a title, a sentence, a length and a list of questions, and every one of those
 * questions is written here because there is nowhere else it appears.
 */
export function PlacementPanel({
  diagnostics, draft, edit, concepts, busy, answerInputs, onAnswerInput, onOpen, onEdit, onSave, onPublish, onDelete,
}: {
  diagnostics: DiagnosticChoice[]; draft: DiagnosticDraft | null; edit: DiagnosticEdit | null;
  concepts: ConceptChoice[]; busy: boolean;
  answerInputs: Record<string, AnswerInput>;
  onAnswerInput: (problemVersionId: string, input: AnswerInput) => void;
  onOpen: (diagnosticKey: string) => void;
  onEdit: (next: DiagnosticEdit) => void;
  onSave: () => void; onPublish: () => void; onDelete: () => void;
}) {
  const expert = useExpertMode();
  const [open, setOpen] = useState<string | null>(null);
  if (!draft || !edit) {
    return <section className="studio-panel">
      <div className="page-heading"><div className="eyebrow">STARTING POINT</div><h1>시작점 확인</h1>
        <p>학습자가 처음 만나는 문항이에요. 어떤 수업에도 들어 있지 않아서, 여기에서만 고칠 수 있어요.</p></div>
      <div className="studio-cards">
        {diagnostics.map((item) => <article key={item.diagnosticKey} className="studio-card">
          <h2>{item.title}{item.current && <span className="pill green">지금 쓰는 것</span>}</h2>
          <p>문항 {item.problemCount}개{expert && item.latestVersionId ? ` · ${item.latestVersionId}` : ''}</p>
          <button className="button secondary" disabled={busy} onClick={() => onOpen(item.diagnosticKey)}>
            {item.hasDraft ? '작성 중인 초안 열기' : '다음 판본 쓰기'}<Icon name="arrow" size={14} />
          </button>
        </article>)}
        {!diagnostics.length && <p className="editor-note">아직 발행된 시작점 확인이 없어요.</p>}
      </div>
    </section>;
  }
  const chosen = edit.problemVersionIds.includes(open ?? '')
    ? edit.problems.find((problem) => problem.problemVersionId === open) : undefined;
  const blockIds = edit.problems.flatMap((problem) => [...problem.promptContent, ...problem.hints, ...problem.solution].map((block) => block.blockId));
  const write = (next: Partial<DiagnosticEdit>) => onEdit({ ...edit, ...next });
  const writeProblem = (next: DraftProblem) =>
    write({ problems: edit.problems.map((item) => (item.problemVersionId === next.problemVersionId ? next : item)) });
  return <section className="studio-panel">
    <div className="editor-settings-head">
      <button type="button" className="back-button" disabled={busy} onClick={onDelete}><Icon name="arrow" size={16} />초안 버리기</button>
      <div><span className="eyebrow">시작점 확인</span><strong>{edit.title || '제목 없는 시작점 확인'}</strong></div>
    </div>
    <fieldset className="editor-panel" disabled={draft.status === 'published'}>
      <legend>이 시작점 확인</legend>
      <label className="editor-field"><span className="editor-label">제목</span>
        <input value={edit.title} maxLength={191} onChange={(event) => write({ title: event.target.value })} /></label>
      <label className="editor-field"><span className="editor-label">설명</span>
        <textarea value={edit.description} maxLength={2000} rows={3} onChange={(event) => write({ description: event.target.value })} />
        <small>시작하기 전 화면에서 읽어요.</small></label>
      <label className="editor-field"><span className="editor-label">예상 시간(분)</span>
        <input type="number" min={1} max={120} value={edit.estimatedMinutes}
          onChange={(event) => write({ estimatedMinutes: Number(event.target.value) })} />
        <small>답에 따라 문항 수가 달라지므로 대강의 안내예요.</small></label>
      {expert && <p className="editor-note">{edit.versionId}</p>}
    </fieldset>
    <fieldset className="editor-panel" disabled={draft.status === 'published'}>
      <legend>묻는 문항</legend>
      <ProblemList ids={edit.problemVersionIds} problems={edit.problems} lessonKey={draft.diagnosticKey} role="check"
        versionId={edit.versionId} concepts={concepts}
        note="어떤 수업에도 나오지 않는 문항이에요. 여기에서 골라 고칩니다. 개념마다 두 문항이 있어야 그 개념을 확인할 수 있어요."
        onPick={setOpen}
        onChange={(problemVersionIds, problems) => { write({ problemVersionIds, problems });
          if (chosen && !problemVersionIds.includes(chosen.problemVersionId)) setOpen(null); }} />
      {chosen && <div className="editor-inspector-block">
        <ProblemPanel offSheet problem={chosen} number={edit.problemVersionIds.indexOf(chosen.problemVersionId) + 1}
          total={edit.problemVersionIds.length} concepts={concepts} taken={blockIds} definitionChoices={[]}
          answerInput={answerInputs[chosen.problemVersionId]}
          onAnswerInput={(input) => onAnswerInput(chosen.problemVersionId, input)}
          onChange={writeProblem}
          onMove={(delta) => {
            const at = edit.problemVersionIds.indexOf(chosen.problemVersionId);
            const ids = [...edit.problemVersionIds];
            const [moved] = ids.splice(at, 1);
            ids.splice(Math.min(Math.max(at + delta, 0), ids.length), 0, moved);
            write({ problemVersionIds: ids });
          }}
          onCopy={() => {}}
          onRemove={() => {
            write({ problemVersionIds: edit.problemVersionIds.filter((problemId) => problemId !== chosen.problemVersionId),
              problems: edit.problems.filter((item) => item.problemVersionId !== chosen.problemVersionId) });
            setOpen(null);
          }} />
      </div>}
    </fieldset>
    {draft.issues.length > 0 && <div className="editor-panel">
      <p className="editor-note editor-warn">발행 전에 고칠 곳 {draft.issues.length}개</p>
      <ul className="studio-issues">{draft.issues.map((issue, index) => <li key={index}>
        {issueText(issue)}{issue.problemVersionId && <small>{problemGist(edit.problems.find((problem) => problem.problemVersionId === issue.problemVersionId) ?? edit.problems[0]) || issue.problemVersionId}</small>}
      </li>)}</ul>
    </div>}
    <div className="editor-actions">
      <button className="button secondary" disabled={busy} onClick={onSave}>저장</button>
      <button className="button primary" disabled={busy || draft.issues.length > 0 || draft.status === 'published'} onClick={onPublish}>발행</button>
    </div>
  </section>;
}
