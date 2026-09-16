'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AttemptView, LessonSection, ContentBlock } from '@/shared/api';
import {
  blockFormOf, lessonKeyPattern, copyBlock, copyProblem, copySection, draftStatusLabels, dropLooseProblems, editShape,
  insertAfter, issueText, looseProblems, mayGrantRoles, mayPublish, moveBlock, nextBlockId, nextSectionId,
  problemGist, sectionRoleLabels, sectionRoles, versionLabel,
  type AccountRole, type AuthoringRole, type AuthoringWorkspace as Workspace, type DraftDetail,
  type DraftEdit, type DraftIssue, type DraftProblem, type DraftSummary, type SkillChoice, type TermSummary,
} from '@/shared/authoring';
import { ApiError, learningApi, type Session } from '@/features/learning/api-client';
import { Icon } from '@/features/learning/icons';
import type { ProblemActions } from '@/features/learning/problem-card';
import { authoringApi } from './api-client';
import { RemovalNotice, useEditHistory } from './edit-history';
import { ExpertMode, useExpertMode } from './expert-mode';
import { AddBlock, BlockCard } from './block-editor';
import { LessonSheet, type Picked } from './lesson-sheet';
import { ProblemPanel, ProblemSetEditor, SkillPicker } from './problem-editor';
import { TermPanel } from './term-editor';

/** How long the editor waits after the last keystroke before it writes what is on screen. */
const autosaveMs = 1500;
/** A failed save is tried once more before the editor leaves it to the banner and the author. */
const retryMs = 8000;

export function AuthoringWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [draft, setDraft] = useState<DraftDetail | null>(null);
  const { value: edit, write: setEdit, replace, open: openEdit, undo, redo, canUndo, canRedo } = useEditHistory<DraftEdit>(editShape);
  const [sectionIndex, setSectionIndex] = useState(0);
  /** What is being worked on — a block or a question — or nothing, which means the lesson itself. */
  const [selected, setSelected] = useState<Picked | null>(null);
  /**
   * Trying the lesson rather than writing it. What happens here is not learning and is kept nowhere:
   * the answers live until the mode is left, which is why they are held on this screen and not sent
   * anywhere to be remembered.
   */
  const [trying, setTrying] = useState(false);
  const [attempts, setAttempts] = useState<Record<string, AttemptView>>({});
  const [assisted, setAssisted] = useState<Record<string, boolean>>({});
  const [tryBusy, setTryBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<AccountRole[] | null>(null);
  const [terms, setTerms] = useState<TermSummary[] | null>(null);
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState<'idle' | 'saving' | 'failed'>('idle');
  const [removed, setRemoved] = useState<{ what: string; at: number } | null>(null);

  const editJson = useMemo(() => (edit ? JSON.stringify(edit) : ''), [edit]);
  /**
   * Whether the editor holds something the server has not been told. It is measured against the
   * editor's own last word rather than the server's restatement of it: the server drops the blank
   * optional fields a form leaves behind, and comparing against that would read as a change nobody
   * made and keep the draft forever unsaved.
   */
  const dirty = !!draft && !!edit && editJson !== saved;
  // Work that has awaited something reads these instead: by then the rendered values are a moment old.
  const latest = useRef(editJson);
  latest.current = editJson;
  const savedRef = useRef(saved);
  const inFlight = useRef(false);
  const markSaved = useCallback((json: string) => { savedRef.current = json; setSaved(json); }, []);

  const open = useCallback((detail: DraftDetail) => {
    const next = structuredClone(detail.edit);
    setDraft(detail);
    openEdit(next);
    latest.current = JSON.stringify(next);
    markSaved(latest.current);
    setSaving('idle');
    setSectionIndex((current) => Math.min(current, Math.max(detail.edit.sections.length - 1, 0)));
    setSelected(null);
    setTrying(false);
    setAttempts({});
    setAssisted({});
    setConfirming(false);
  }, [openEdit, markSaved]);
  /**
   * Moving to another step starts at the top of it. The page is a lesson long, and keeping the old
   * scroll position drops an author into the middle of something they did not ask to see.
   */
  const goToSection = useCallback((index: number) => {
    setSectionIndex(index);
    setSelected(null);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);
  const closeDraft = useCallback(() => {
    setDraft(null); openEdit(null); latest.current = ''; markSaved(''); setSaving('idle'); setRemoved(null);
    setTrying(false); setAttempts({}); setAssisted({});
  }, [openEdit, markSaved]);
  const notifyRemoval = useCallback((what: string) => setRemoved({ what, at: Date.now() }), []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const current = await learningApi.session();
        if (!active) return;
        setSession(current);
        // The editor may be open without a sign-in, so the workspace answers this, not the session.
        try { setWorkspace((await authoringApi.workspace()).workspace); }
        catch (reason) { if (!(reason instanceof ApiError && reason.status === 401)) throw reason; }
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : '불러오지 못했어요.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(null); setNotice(null);
    try { await work(); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : '요청을 처리하지 못했어요.'); }
    finally { setBusy(false); }
  };
  const act = (action: Parameters<typeof authoringApi.act>[0], after?: (response: Awaited<ReturnType<typeof authoringApi.act>>) => void) =>
    run(async () => {
      const response = await authoringApi.act(action, session?.user?.id ?? '');
      setWorkspace(response.workspace);
      if (response.draft) open(response.draft);
      after?.(response);
    });

  /**
   * Writes what is on screen without taking the screen over. The server restates what it stored —
   * blank optional fields dropped, an edited question renamed — and that restatement is adopted only
   * when nothing has changed since this save left, because adopting it mid-sentence would throw the
   * sentence away.
   */
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (!draft || draft.status === 'published') return true;
    const snapshot = latest.current;
    if (!snapshot || snapshot === savedRef.current) return true;
    if (inFlight.current) return false;
    inFlight.current = true;
    setSaving('saving');
    try {
      const response = await authoringApi.act({ action: 'draft.save', draftId: draft.id, edit: JSON.parse(snapshot) as DraftEdit },
        session?.user?.id ?? '');
      setWorkspace(response.workspace);
      let acknowledged = snapshot;
      if (response.draft) {
        setDraft(response.draft);
        if (latest.current === snapshot) {
          const restated = structuredClone(response.draft.edit);
          const restatedJson = JSON.stringify(restated);
          // Not a step anyone took, so it never becomes one they can take back.
          if (restatedJson !== snapshot) { latest.current = restatedJson; replace(restated); acknowledged = restatedJson; }
        }
      }
      markSaved(acknowledged);
      setSaving('idle');
      setError(null);
      return true;
    } catch (reason) {
      setSaving('failed');
      setError(reason instanceof ApiError ? reason.message : '저장하지 못했어요. 창을 닫지 말아 주세요.');
      return false;
    } finally { inFlight.current = false; }
  }, [draft, session, replace, markSaved]);

  // Saving is the editor's job, not the author's: it follows the last keystroke rather than a button.
  useEffect(() => {
    if (!dirty || saving === 'saving') return;
    const timer = window.setTimeout(() => { void saveNow(); }, saving === 'failed' ? retryMs : autosaveMs);
    return () => window.clearTimeout(timer);
  }, [dirty, editJson, saving, saveNow]);

  // Closing the tab on unsaved work is the one loss autosave cannot catch, so the browser asks first.
  useEffect(() => {
    if (!dirty && saving !== 'saving') return;
    // Chrome honours the first; Safari still wants the second, and neither shows wording we choose.
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = true; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);

  useEffect(() => {
    if (!draft || draft.status === 'published') return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 's') { event.preventDefault(); void saveNow(); return; }
      // Every field here is controlled, so the browser's own undo cannot reach what was written.
      if (key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (key === 'y' && !event.metaKey) { event.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, saveNow, undo, redo]);

  useEffect(() => {
    if (!removed) return;
    const timer = window.setTimeout(() => setRemoved(null), 9000);
    return () => window.clearTimeout(timer);
  }, [removed]);

  /**
   * Saying the writing is done, or taking that back. It changes where the draft stands and nothing
   * in it, so the work and every step taken to reach it are left exactly as they are.
   */
  const reviewNow = (asking: boolean) => run(async () => {
    const response = await authoringApi.act({ action: 'draft.review', draftId: draft!.id, asking }, session?.user?.id ?? '');
    setWorkspace(response.workspace);
    if (response.draft) setDraft(response.draft);
    setNotice(asking ? '검토를 요청했어요. 발행은 관리자가 합니다.' : '검토 요청을 거뒀어요.');
  });

  /**
   * Checking a draft without disturbing it. It reads rather than writes, so the working copy and
   * every step taken to reach it stay as they are — running a check is not a reason to lose the
   * ability to take back what was checked.
   */
  const validateNow = () => run(async () => {
    const response = await authoringApi.act({ action: 'draft.validate', draftId: draft!.id }, session?.user?.id ?? '');
    setWorkspace(response.workspace);
    if (response.draft) setDraft(response.draft);
    setNotice(response.draft?.issues.length ? null : '발행 검증을 통과했어요.');
  });

  /** Leaving saves first. A draft list reached by losing an afternoon's writing is not worth reaching. */
  const leave = async () => {
    const waiting = '저장하는 중이에요. 잠시 뒤에 다시 눌러 주세요.';
    if (latest.current !== savedRef.current) {
      // A save already on its way carries an older snapshot, so waiting for it is the whole point.
      if (inFlight.current) { setError(waiting); return; }
      if (!(await saveNow())) return;
      if (latest.current !== savedRef.current) { setError(waiting); return; }
    }
    closeDraft();
  };

  if (loading) return <main className="authoring-page"><p className="editor-note">불러오는 중이에요.</p></main>;
  if (!workspace?.role && !session?.user) {
    return <Shell>{error
      ? <p className="error-banner" role="alert">{error}</p>
      : <p className="editor-note">로그인한 뒤 이용할 수 있어요. <a href="/">학습 화면으로</a></p>}</Shell>;
  }
  if (!workspace || !workspace.role) {
    // A failed load is not the same answer as a refusal, so it never borrows the refusal's wording.
    return <Shell>{error
      ? <p className="error-banner" role="alert">{error}</p>
      : <div className="gentle-empty">
        <span className="empty-drawing"><Icon name="pencil" size={22} /></span>
        <div><h3>콘텐츠를 편집할 권한이 없어요.</h3>
          <p>이 화면은 콘텐츠 작성 권한을 받은 계정만 사용할 수 있어요. 권한이 필요하면 관리자에게 요청해 주세요.</p></div>
      </div>}</Shell>;
  }

  const expert = workspace.expertMode;
  const onExpert = (on: boolean) => act({ action: 'editor.expertMode', on });

  if (!draft || !edit) {
    return <Shell role={workspace.role} expert={expert} busy={busy} onExpert={onExpert}>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {notice && <p className="notice-banner">{notice}</p>}
      <DraftList workspace={workspace} busy={busy}
        onOpen={(summary) => run(async () => open((await authoringApi.draft(summary.id)).draft))}
        onCreate={(lessonKey) => act({ action: 'draft.create', lessonKey })}
        onCreateLesson={(courseKey, lessonKey, title, skillKeys) => act({ action: 'lesson.create', courseKey, lessonKey, title, skillKeys })} />
      <TermPanel lessons={workspace.lessons} skills={workspace.skills} terms={terms} busy={busy}
        mayEditDictionary={mayPublish(workspace.role)}
        onList={(scopeKind, scopeKey) => act({ action: 'term.list', scopeKind, scopeKey }, (response) => setTerms(response.terms ?? []))}
        onSave={(edit) => act({ action: 'term.save', edit }, (response) => {
          setTerms(response.terms ?? []);
          setNotice(expert ? `${response.publishedTermVersionId} 판본을 발행했어요.` : '용어를 발행했어요.');
        })} />
      {mayGrantRoles(workspace.role) && <RolePanel accounts={workspace.accounts} busy={busy} matches={matches}
        onSearch={(query) => act({ action: 'account.search', query }, (response) => setMatches(response.matches ?? []))}
        onGrant={(userId, role) => act({ action: 'role.grant', userId, role }, () => setMatches(null))}
        onRevoke={(userId) => act({ action: 'role.revoke', userId }, () => setMatches(null))} />}
    </Shell>;
  }

  const section = edit.sections[Math.min(sectionIndex, edit.sections.length - 1)];
  // Block IDs are unique across the whole document, questions included, so a new one avoids them all.
  const blockIds = [
    ...edit.sections.flatMap((item) => item.contentBlocks.map((block) => block.blockId)),
    ...edit.problems.flatMap((problem) => [...problem.promptContent, ...problem.hints, ...problem.solution].map((block) => block.blockId)),
  ];
  const published = draft.status === 'published';
  const writeSection = (next: LessonSection) => setEdit({ ...edit, sections: edit.sections.map((item, index) => (index === sectionIndex ? next : item)) });
  const writeBlocks = (blocks: ContentBlock[]) => writeSection({ ...section, contentBlocks: blocks });
  const writeSectionBlock = (index: number, block: ContentBlock) =>
    edit.sections.map((item, position) => (position === sectionIndex
      ? { ...item, contentBlocks: item.contentBlocks.map((existing, place) => (place === index ? block : existing)) }
      : item));
  const problemIds = edit.problems.map((problem) => problem.problemVersionId);
  /** Questions no activity in the lesson holds. Homework holds some without any section showing them. */
  const loose = looseProblems(edit, draft.homeworkProblemIds);
  const chosenBlock = selected?.kind === 'block' ? section.contentBlocks[selected.index] : undefined;
  const chosenProblem = selected?.kind === 'problem'
    ? edit.problems.find((problem) => problem.problemVersionId === selected.id) : undefined;
  // A question is held by exactly one activity, and that activity is what says where it sits.
  const holderIndex = chosenProblem
    ? section.contentBlocks.findIndex((block) => Array.isArray(block.payload.problemVersionIds)
      && (block.payload.problemVersionIds as string[]).includes(chosenProblem.problemVersionId))
    : -1;
  const holder = holderIndex >= 0 ? section.contentBlocks[holderIndex] : undefined;
  const holderIds = holder && Array.isArray(holder.payload.problemVersionIds) ? holder.payload.problemVersionIds as string[] : [];
  const problemAt = chosenProblem ? holderIds.indexOf(chosenProblem.problemVersionId) : -1;
  const writeHolder = (ids: string[], problems: DraftProblem[]) => setEdit({ ...edit,
    sections: writeSectionBlock(holderIndex, { ...holder!, payload: { ...holder!.payload, problemVersionIds: ids } }),
    problems });
  const writeProblem = (next: DraftProblem) => setEdit({ ...edit,
    problems: edit.problems.map((item) => (item.problemVersionId === next.problemVersionId ? next : item)) });

  /** Every block the document holds, wherever it sits, so a rule's anchor can be read back. */
  const blockAt = (blockId?: string) => (blockId
    ? [...edit.sections.flatMap((item) => item.contentBlocks),
      ...edit.problems.flatMap((problem) => [...problem.promptContent, ...problem.hints, ...problem.solution])]
      .find((block) => block.blockId === blockId)
    : undefined);
  const describe = (issue: DraftIssue) => issueText(issue, blockAt(issue.blockId));
  const issuesOfBlock = (blockId: string) => draft.issues.filter((issue) => issue.blockId === blockId);
  const issuesOfProblem = (problemVersionId: string) =>
    draft.issues.filter((issue) => issue.problemVersionId === problemVersionId);
  /** Takes the screen to what a rule refused, rather than leaving an author to find it by its path. */
  const goToIssue = (issue: DraftIssue) => {
    const holds = (item: LessonSection) => (issue.sectionId ? item.sectionId === issue.sectionId : false)
      || (issue.blockId ? item.contentBlocks.some((block) => block.blockId === issue.blockId) : false)
      || (issue.problemVersionId ? item.contentBlocks.some((block) => Array.isArray(block.payload.problemVersionIds)
        && (block.payload.problemVersionIds as string[]).includes(issue.problemVersionId!)) : false);
    const at = edit.sections.findIndex(holds);
    const home = at >= 0 ? at : sectionIndex;
    setSectionIndex(home);
    setTrying(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (issue.problemVersionId) { setSelected({ kind: 'problem', id: issue.problemVersionId }); return; }
    const block = issue.blockId
      ? edit.sections[home].contentBlocks.findIndex((item) => item.blockId === issue.blockId) : -1;
    setSelected(block >= 0 ? { kind: 'block', index: block } : null);
  };

  /** A copy sits beside what it was copied from, and is what the screen turns to next. */
  const copyThisBlock = (index: number) => {
    const made = copyBlock({ block: section.contentBlocks[index], problems: edit.problems, lessonKey: draft.lessonKey,
      sectionId: section.sectionId, role: section.role, versionId: edit.meta.versionId, blockIds, problemIds });
    setEdit({ ...edit,
      sections: edit.sections.map((item, position) => (position === sectionIndex
        ? { ...item, contentBlocks: insertAfter(item.contentBlocks, index, made.block) } : item)),
      problems: [...edit.problems, ...made.problems] });
    setSelected({ kind: 'block', index: index + 1 });
  };
  const copyThisSection = () => {
    const made = copySection({ section, problems: edit.problems, lessonKey: draft.lessonKey, versionId: edit.meta.versionId,
      sectionIds: edit.sections.map((item) => item.sectionId), blockIds, problemIds });
    setEdit({ ...edit, sections: insertAfter(edit.sections, sectionIndex, made.section),
      problems: [...edit.problems, ...made.problems] });
    goToSection(sectionIndex + 1);
  };
  /**
   * Answering a question of this draft. Every try goes through the server, which holds the answer
   * and the grader; the editor knows the answer too, but grading here would be a second grader to
   * keep in step with the one that counts.
   */
  const tryActions = (problemVersionId: string): ProblemActions => ({
    submit: async (answer) => {
      setTryBusy(true);
      try {
        const helped = !!assisted[problemVersionId];
        const response = await authoringApi.act({ action: 'draft.tryAnswer', draftId: draft.id, problemVersionId, answer, assisted: helped },
          session?.user?.id ?? '');
        if (!response.tried) throw new Error('채점 결과를 받지 못했어요.');
        setAttempts((current) => ({ ...current,
          [problemVersionId]: { id: problemVersionId, problemVersionId, answer, result: response.tried!, hintUsed: helped } }));
      } finally { setTryBusy(false); }
    },
    openHint: async () => {
      const response = await authoringApi.act({ action: 'draft.openHint', draftId: draft.id, problemVersionId }, session?.user?.id ?? '');
      setAssisted((current) => ({ ...current, [problemVersionId]: true }));
      return response.hint ?? [];
    },
  });
  /** What the server holds is what gets answered, so anything unsaved goes first. */
  const enterTry = async () => {
    if (latest.current !== savedRef.current && !(await saveNow())) return;
    setSelected(null); setAttempts({}); setAssisted({}); setTrying(true);
  };
  const moveSection = (delta: number) => {
    setEdit({ ...edit, sections: moveBlock(edit.sections, sectionIndex, delta) });
    goToSection(Math.min(Math.max(sectionIndex + delta, 0), edit.sections.length - 1));
  };
  // A question may only claim a concept this lesson teaches, and it names them the way a catalogue does.
  const draftSkills: SkillChoice[] = edit.meta.skillKeys.map((key) =>
    workspace.skills.find((skill) => skill.key === key) ?? { key, label: key });

  const savedLabel = published
    ? `발행 완료 · ${expert ? draft.publishedVersionId : versionLabel(draft.publishedVersionId ?? '')}`
    : draft.status === 'review' && saving === 'idle' && !dirty ? '검토 요청함'
      : saving === 'saving' ? '저장하는 중'
      : saving === 'failed' ? '저장하지 못했어요'
        : dirty ? '곧 저장해요' : '저장됨';

  return <Shell role={workspace.role} expert={expert} busy={busy} onExpert={onExpert}>
    <RemovalNotice.Provider value={notifyRemoval}>
    <div className="editor-bar">
      <button type="button" className="back-button" onClick={() => void leave()}><Icon name="back" size={16} />초안 목록</button>
      <div className="editor-bar-side">
        {/* Writing the lesson, or reading it the way it will be read. */}
        <div className="editor-mode" role="group" aria-label="화면 모드">
          <button type="button" className={trying ? '' : 'active'} aria-pressed={!trying}
            onClick={() => { setTrying(false); setAttempts({}); setAssisted({}); }}>편집</button>
          <button type="button" className={trying ? 'active' : ''} aria-pressed={trying}
            onClick={() => void enterTry()}>해보기</button>
        </div>
        {!published && !trying && <>
          <button type="button" className="icon-button" aria-label="되돌리기" title="되돌리기 (⌘Z)" disabled={!canUndo} onClick={undo}>↶</button>
          <button type="button" className="icon-button" aria-label="다시 실행" title="다시 실행 (⇧⌘Z)" disabled={!canRedo} onClick={redo}>↷</button>
        </>}
        <span className={`pill${published ? ' green' : ''}${saving === 'failed' ? ' warn' : ''}`}>{savedLabel}</span>
      </div>
    </div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {notice && <p className="notice-banner">{notice}</p>}
    {published && <p className="notice-banner">발행한 판본은 고칠 수 없어요. 더 고치려면 새 초안을 만들어 주세요.</p>}
    {/* Said before anything is answered, because the card below says what a learner is told — and a
        learner is recorded, which is the one thing that is not true here. */}
    {trying && <p className="editor-note editor-trying-note">
      학습자가 보는 그대로예요. 답은 학습 화면과 같은 규칙으로 서버가 채점하고, 여기서 푼 것은 아무 데도 기록되지 않아요.
      해설은 학습자에게 보여 주지 않으니 여기에도 나오지 않고, 「편집」에서 씁니다.</p>}

    <div className={`editor-layout${trying ? ' trying' : ''}`}>
      <aside className="editor-steps">
        <span className="eyebrow">SECTIONS</span>
        {edit.sections.map((item, index) => <div key={item.sectionId} className={`editor-step${index === sectionIndex ? ' active' : ''}`}>
          <button type="button" className="editor-step-open" aria-current={index === sectionIndex ? 'step' : undefined}
            onClick={() => goToSection(index)}><small>{sectionRoleLabels[item.role]}</small>{item.title}</button>
          {index === sectionIndex && !published && !trying && edit.sections.length > 1 && <div className="editor-step-tools">
            <button type="button" className="icon-button" aria-label="이 단계 위로" disabled={index === 0}
              onClick={() => moveSection(-1)}>↑</button>
            <button type="button" className="icon-button" aria-label="이 단계 아래로" disabled={index === edit.sections.length - 1}
              onClick={() => moveSection(1)}>↓</button>
          </div>}
        </div>)}
        {!trying && <button type="button" className="text-button" disabled={published || edit.sections.length >= 50} onClick={() => {
          const role: LessonSection['role'] = 'explanation';
          const sectionId = nextSectionId(draft.lessonKey, role, edit.meta.versionId, edit.sections.map((item) => item.sectionId));
          setEdit({ ...edit, sections: [...edit.sections, { sectionId, role, title: '새 단계', contentBlocks: [] }] });
          goToSection(edit.sections.length);
        }}><Icon name="plus" size={14} />단계 추가</button>}
      </aside>

      <LessonSheet meta={edit.meta} section={section} index={sectionIndex} problems={edit.problems} terms={draft.terms}
        selected={selected} published={published} issues={draft.issues}
        trying={trying ? { actions: tryActions, attempts, busy: tryBusy } : undefined}
        onMeta={(meta) => setEdit({ ...edit, meta })} onSection={writeSection} onBlocks={writeBlocks}
        onProblem={writeProblem} onSelect={setSelected}
        add={<AddBlock blockId={(kind) => nextBlockId(draft.lessonKey, section.sectionId, kind, edit.meta.versionId, blockIds)}
          onAdd={(block) => { writeBlocks([...section.contentBlocks, block]); setSelected({ kind: 'block', index: section.contentBlocks.length }); }} />} />

      {/* What the chosen thing is made of. With nothing chosen, the lesson itself is what is chosen. */}
      {!trying && <aside className="editor-inspector" aria-label="고른 것">
        {chosenProblem && holder
          ? <fieldset className="editor-inspector-block" disabled={published}>
            <Amiss issues={issuesOfProblem(chosenProblem.problemVersionId)} describe={describe} expert={expert} />
            <ProblemPanel problem={chosenProblem} number={problemAt + 1} total={holderIds.length}
              skills={draftSkills} taken={blockIds} termChoices={draft.terms}
              onChange={writeProblem}
              onMove={(delta) => writeHolder(moveBlock(holderIds, problemAt, delta), edit.problems)}
              onCopy={() => {
                const made = copyProblem(chosenProblem, draft.lessonKey, section.role, edit.meta.versionId, problemIds);
                writeHolder(insertAfter(holderIds, problemAt, made.problemVersionId), [...edit.problems, made]);
                setSelected({ kind: 'problem', id: made.problemVersionId });
              }}
              onRemove={() => {
                writeHolder(holderIds.filter((id) => id !== chosenProblem.problemVersionId),
                  edit.problems.filter((item) => item.problemVersionId !== chosenProblem.problemVersionId));
                setSelected(null);
              }} />
          </fieldset>
          : chosenBlock !== undefined && selected?.kind === 'block'
          ? <fieldset className="editor-inspector-block" disabled={published}>
            <Amiss issues={issuesOfBlock(chosenBlock.blockId)} describe={describe} expert={expert} />
            <BlockCard block={chosenBlock} index={selected.index} total={section.contentBlocks.length}
              termChoices={draft.terms}
              // A paragraph is written in the sheet, so the form does not ask for its body again.
              omit={chosenBlock.kind === 'core.rich_text' ? ['text'] : undefined}
              problems={blockFormOf(chosenBlock)?.editsProblems && <ProblemSetEditor block={chosenBlock} problems={edit.problems}
                skills={draftSkills} lessonKey={draft.lessonKey} role={section.role} versionId={edit.meta.versionId}
                onPick={(id) => setSelected({ kind: 'problem', id })}
                onChange={(next, problems) => setEdit({ ...edit, sections: writeSectionBlock(selected.index, next), problems })} />}
              onChange={(next) => writeBlocks(section.contentBlocks.map((item, position) => (position === selected.index ? next : item)))}
              onMove={(delta) => {
                writeBlocks(moveBlock(section.contentBlocks, selected.index, delta));
                setSelected({ kind: 'block', index: Math.min(Math.max(selected.index + delta, 0), section.contentBlocks.length - 1) });
              }}
              onCopy={() => copyThisBlock(selected.index)}
              onRemove={() => {
                // An activity holds its questions, so they leave with it. Left behind, nothing in the
                // lesson would hold them and publishing refuses a lesson that carries one.
                setEdit(dropLooseProblems({ ...edit, sections: edit.sections.map((item, position) => (position === sectionIndex
                  ? { ...item, contentBlocks: item.contentBlocks.filter((_, place) => place !== selected.index) } : item)) },
                draft.homeworkProblemIds));
                setSelected(null);
              }} />
          </fieldset>
          : <fieldset className="editor-panel" disabled={published}>
            <legend>이 수업</legend>
            {/* The name of the version being written. The server suggests it and nothing here needs
                to be told it, so only an operator is shown the field. */}
            {expert
              ? <label className="editor-field"><span className="editor-label">새 판본 ID</span>
                <input value={edit.meta.versionId} onChange={(event) => setEdit({ ...edit, meta: { ...edit.meta, versionId: event.target.value } })} />
                <small>발행한 판본은 고칠 수 없어서, 수정은 늘 새 판본이 돼요. 기준 판본: {draft.baseVersionId ?? '없음'}</small></label>
              : <p className="editor-note">발행하면 {versionLabel(edit.meta.versionId)}이 돼요. 이미 발행한 판은 고칠 수 없어서,
                수정은 늘 새 판이 됩니다. 수강 중인 사람은 시작한 판을 끝까지 봅니다.</p>}
            <label className="editor-field"><span className="editor-label">한 줄 소개</span>
              <input value={edit.meta.summary} onChange={(event) => setEdit({ ...edit, meta: { ...edit.meta, summary: event.target.value } })} />
              <small>수업을 고르는 화면에서 제목 아래에 보여요.</small></label>
            <label className="editor-field"><span className="editor-label">예상 시간(분)</span>
              <input type="number" min={1} max={240} value={edit.meta.estimatedMinutes}
                onChange={(event) => setEdit({ ...edit, meta: { ...edit.meta, estimatedMinutes: Number(event.target.value) } })} /></label>
            <SkillPicker skills={workspace.skills} chosen={edit.meta.skillKeys} label="이 수업이 가르치는 개념"
              onChange={(skillKeys) => setEdit({ ...edit, meta: { ...edit.meta, skillKeys } })} />
            <p className="editor-note">문항은 여기 고른 개념 중에서만 고를 수 있어요. 하나 이상 있어야 발행할 수 있습니다.</p>

            {!!loose.length && <div className="editor-inspector-part">
              <span className="editor-label">어디에도 속하지 않은 문항</span>
              <p className="editor-note editor-warn">활동이 지워지면서 남은 문항이에요. 아무 단계에도 들어 있지 않아 이대로는 발행할 수 없어요.</p>
              <div className="editor-problems">
                {loose.map((problem) => <div key={problem.problemVersionId} className="editor-problem-row">
                  <span className="editor-problem-open">
                    <strong>{expert ? problem.problemVersionId : '문항'}</strong>
                    <small>{problemGist(problem) || '아직 비어 있어요'}</small>
                  </span>
                  <button type="button" className="icon-button" aria-label="이 문항 지우기"
                    onClick={() => {
                      setEdit({ ...edit, problems: edit.problems.filter((item) => item.problemVersionId !== problem.problemVersionId) });
                      notifyRemoval('문항');
                    }}><Icon name="close" size={14} /></button>
                </div>)}
              </div>
            </div>}

            <div className="editor-inspector-part">
              <span className="editor-label">이 단계</span>
              <label className="editor-field"><span className="editor-label">역할</span>
                <select value={section.role} onChange={(event) => writeSection({ ...section, role: event.target.value as LessonSection['role'] })}>
                  {sectionRoles.map((role) => <option key={role} value={role}>{sectionRoleLabels[role]}</option>)}
                </select>
                <small>학습 화면의 단계 목록과 시트 머리에 이 이름으로 나와요.</small></label>
              <div className="editor-actions">
                <button type="button" className="text-button" disabled={edit.sections.length >= 50}
                  onClick={copyThisSection}><Icon name="copy" size={14} />이 단계 복제</button>
                {edit.sections.length > 1 && <button type="button" className="text-button" onClick={() => {
                  setEdit(dropLooseProblems({ ...edit, sections: edit.sections.filter((_, index) => index !== sectionIndex) },
                    draft.homeworkProblemIds));
                  goToSection(Math.max(sectionIndex - 1, 0));
                  notifyRemoval('단계');
                }}><Icon name="close" size={14} />이 단계 삭제</button>}
              </div>
            </div>
          </fieldset>}
      </aside>}
    </div>

    <div className="editor-actions">
      <button type="button" className="button secondary" disabled={busy || published || !dirty || saving === 'saving'}
        onClick={() => void saveNow()}>지금 저장</button>
      <button type="button" className="button secondary" disabled={busy || dirty} onClick={() => void validateNow()}>검증</button>
      {/* A writer hands the work on rather than publishing it; whoever may publish takes it from there. */}
      {!published && draft.mine && (draft.status === 'review'
        ? <button type="button" className="button secondary" disabled={busy} onClick={() => void reviewNow(false)}>검토 요청 거두기</button>
        : <button type="button" className="button secondary" disabled={busy || dirty} onClick={() => void reviewNow(true)}>검토 요청</button>)}
      {!published && !draft.mine && draft.status === 'review' && mayPublish(workspace.role) &&
        <button type="button" className="button secondary" disabled={busy}
          onClick={() => void reviewNow(false)}>작성자에게 돌려보내기</button>}
      {mayPublish(workspace.role) && !published && <button type="button" className="button primary" disabled={busy || dirty || !!draft.issues.length}
        onClick={() => setConfirming(true)}>발행<Icon name="arrow" size={16} /></button>}
      <button type="button" className="text-button" disabled={busy}
        onClick={() => { if (confirm('이 초안을 삭제할까요? 발행한 판본은 남습니다.')) void act({ action: 'draft.delete', draftId: draft.id }, closeDraft); }}>
        초안 삭제</button>
      {dirty && <span className="editor-note">검증과 발행은 저장한 내용으로 해요.</span>}
    </div>

    {confirming && <div className="editor-confirm" role="alertdialog" aria-label="발행 확인">
      <strong>{expert ? edit.meta.versionId : versionLabel(edit.meta.versionId)} 판본을 발행할까요?</strong>
      <p>발행하면 되돌릴 수 없어요. 이미 수강 중인 사람은 이전 판본을 계속 보고, 새로 수강하는 사람부터 이 판본을 받습니다.
        {expert && ' 새 종류의 블록을 넣었다면 그 블록을 아는 앱이 먼저 배포되어 있어야 해요.'}</p>
      <div className="editor-actions">
        <button type="button" className="button primary" disabled={busy}
          onClick={() => act({ action: 'draft.publish', draftId: draft.id }, (response) => setNotice(`${response.publishedVersionId} 판본을 발행했어요.`))}>
          발행할게요</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirming(false)}>취소</button>
      </div>
    </div>}

    {!!draft.issues.length && <section className="editor-issues" aria-label="검증 결과">
      <strong>고칠 곳 {draft.issues.length}</strong>
      {/* Each one is a way there. A list of paths tells an author what is wrong and not where. */}
      <ul>{draft.issues.map((issue, index) => <li key={`${issue.path ?? ''}:${index}`}>
        <button type="button" className="text-button" onClick={() => goToIssue(issue)}>{describe(issue)}</button>
        {expert && issue.path && <small>{issue.path}</small>}
      </li>)}</ul>
    </section>}

    {removed && <div className="editor-toast" role="status">
      <span>{removed.what} 하나를 지웠어요.</span>
      <button type="button" className="text-button" disabled={!canUndo} onClick={() => { undo(); setRemoved(null); }}>
        <Icon name="back" size={13} />되돌리기</button>
      <button type="button" className="icon-button" aria-label="알림 닫기" onClick={() => setRemoved(null)}><Icon name="close" size={13} /></button>
    </div>}
    </RemovalNotice.Provider>
  </Shell>;
}

/** What publishing refused about the thing on screen, said where that thing is being worked on. */
function Amiss({ issues, describe, expert }: { issues: DraftIssue[]; describe: (issue: DraftIssue) => string; expert: boolean }) {
  if (!issues.length) return null;
  return <div className="editor-amiss" role="status">
    <strong>고칠 곳 {issues.length}</strong>
    <ul>{issues.map((issue, index) => <li key={`${issue.path ?? ''}:${index}`}>
      {describe(issue)}{expert && issue.path && <small>{issue.path}</small>}
    </li>)}</ul>
  </div>;
}

const roleNames: Record<AuthoringRole, string> = { admin: '관리자 · 발행까지', author: '작성자 · 자기 초안' };

/**
 * Who may write content. An administrator hands the role out here rather than through the
 * deployment, so adding a person needs no environment change and no restart.
 */
function RolePanel({ accounts, matches, busy, onSearch, onGrant, onRevoke }: {
  accounts: AccountRole[]; matches: AccountRole[] | null; busy: boolean;
  onSearch: (query: string) => void; onGrant: (userId: string, role: AuthoringRole) => void; onRevoke: (userId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const held = (account: AccountRole) => (account.source === 'environment'
    ? '배포 설정으로 지정된 관리자예요. 여기서는 거둘 수 없어요.'
    : `${new Date(account.grantedAt!).toLocaleDateString('ko-KR')}부터`);
  return <section className="dashboard-section">
    <div className="section-heading"><div><span className="eyebrow">ROLES</span><h2>편집 권한</h2></div></div>
    <fieldset className="editor-panel">
      <legend>권한을 가진 계정</legend>
      <p className="editor-note">관리자는 모든 초안을 보고 발행까지 하고, 작성자는 자기 초안만 고쳐요. 역할은 바로 반영되고 앱을 다시 띄울 필요가 없어요.</p>
      <div className="role-list">
        {accounts.map((account) => <div key={account.userId} className="role-row">
          <span className="role-who">
            <strong>{account.displayName}{account.me && <em>나</em>}</strong>
            <small>{held(account)}</small>
          </span>
          {account.source === 'environment'
            ? <span className="pill">관리자 · 배포 설정</span>
            : <>
              <select value={account.role ?? 'author'} disabled={busy || (account.me && account.role === 'admin')}
                onChange={(event) => onGrant(account.userId, event.target.value as AuthoringRole)}>
                {(Object.keys(roleNames) as AuthoringRole[]).map((role) => <option key={role} value={role}>{roleNames[role]}</option>)}
              </select>
              <button type="button" className="text-button" disabled={busy || account.me}
                onClick={() => onRevoke(account.userId)}><Icon name="close" size={14} />거두기</button>
            </>}
        </div>)}
      </div>
    </fieldset>

    <fieldset className="editor-panel">
      <legend>계정 찾기</legend>
      <p className="editor-note">이름의 일부로 찾습니다. 로그인한 적이 있는 계정만 나와요.</p>
      <div className="editor-actions">
        <label className="editor-field"><span className="editor-label">이름</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && query.trim().length >= 2) onSearch(query.trim()); }} /></label>
        <button type="button" className="button secondary" disabled={busy || query.trim().length < 2}
          onClick={() => onSearch(query.trim())}>찾기</button>
      </div>
      {matches !== null && (matches.length === 0
        ? <p className="empty-inline">찾은 계정이 없어요.</p>
        : <div className="role-list">
          {matches.map((account) => <div key={account.userId} className="role-row">
            <span className="role-who">
              <strong>{account.displayName}{account.me && <em>나</em>}</strong>
              <small>{account.role ? `지금 ${roleNames[account.role]}` : '권한 없음'}</small>
            </span>
            {account.source === 'environment'
              ? <span className="pill">관리자 · 배포 설정</span>
              : (Object.keys(roleNames) as AuthoringRole[]).map((role) => <button key={role} type="button" className="button secondary"
                  disabled={busy || account.role === role} onClick={() => onGrant(account.userId, role)}>
                  {role === 'admin' ? '관리자로' : '작성자로'}</button>)}
          </div>)}
        </div>)}
    </fieldset>
  </section>;
}

/**
 * The frame every state of this screen is drawn in, and where the account's reading of it is put
 * into the tree. The switch is a setting, not a permission: it changes what is named on screen and
 * nothing about what this account may write or publish.
 */
function Shell({ role, expert = false, busy, onExpert, children }: {
  role?: string; expert?: boolean; busy?: boolean; onExpert?: (on: boolean) => void; children: React.ReactNode;
}) {
  return <ExpertMode.Provider value={expert}><main className="authoring-page">
    <header className="authoring-head">
      <div><span className="eyebrow">CONTENT STUDIO</span><h1>콘텐츠 편집</h1></div>
      <div className="authoring-head-side">
        {onExpert && <label className="expert-toggle" title="블록과 판본의 이름, 앱 호환 설정을 함께 보여줘요.">
          <input type="checkbox" checked={expert} disabled={busy} onChange={(event) => onExpert(event.target.checked)} />
          <span>전문가 모드</span>
        </label>}
        {role && <span className="pill">{role === 'admin' ? '관리자 · 발행 가능' : '작성자 · 발행은 관리자가'}</span>}
        <a className="text-button" href="/">학습 화면으로<Icon name="arrow" size={14} /></a>
      </div>
    </header>
    {children}
  </main></ExpertMode.Provider>;
}

function DraftList({ workspace, busy, onOpen, onCreate, onCreateLesson }: {
  workspace: Workspace; busy: boolean; onOpen: (draft: DraftSummary) => void; onCreate: (lessonKey: string) => void;
  onCreateLesson: (courseKey: string, lessonKey: string, title: string, skillKeys: string[]) => void;
}) {
  const [lessonKey, setLessonKey] = useState(workspace.lessons[0]?.lessonKey ?? '');
  const [query, setQuery] = useState('');
  const [made, setMade] = useState({ courseKey: workspace.courses[0]?.key ?? '', key: '', title: '', skillKeys: [] as string[] });
  const expert = useExpertMode();
  const chosen = workspace.lessons.find((item) => item.lessonKey === lessonKey);
  const found = workspace.drafts.filter((item) => {
    const words = query.trim().toLowerCase();
    return !words || [item.title, item.authorName, item.versionId].some((value) => value.toLowerCase().includes(words));
  });
  const readyToMake = !!made.courseKey && lessonKeyPattern.test(made.key) && !!made.title.trim() && made.skillKeys.length > 0;

  return <>
    <fieldset className="editor-panel">
      <legend>새 초안</legend>
      <p className="editor-note">발행된 수업을 기준으로 다음 판본의 초안을 만듭니다. 문항과 채점 규칙은 기준 판본에서 그대로 이어받고, 이 화면에서는 단계와 블록을 고쳐요.</p>
      <div className="editor-actions">
        <label className="editor-field"><span className="editor-label">수업</span>
          <select value={lessonKey} onChange={(event) => setLessonKey(event.target.value)}>
            {workspace.lessons.map((item) => <option key={item.lessonKey} value={item.lessonKey}>
              {item.title} · {expert ? item.latestVersionId : versionLabel(item.latestVersionId)} →{' '}
              {expert ? item.suggestedVersionId : versionLabel(item.suggestedVersionId)}{item.hasDraft ? ' (초안 있음)' : ''}</option>)}
          </select></label>
        <button type="button" className="button primary" disabled={busy || !lessonKey} onClick={() => onCreate(lessonKey)}>초안 만들기</button>
      </div>
      {/* Two open drafts of one lesson both aim at the same next version, and only one of them can have it. */}
      {chosen?.hasDraft && <p className="editor-note editor-warn">
        이 수업에는 이미 작성 중인 초안이 있어요. 새로 만들면 둘 다 같은 판을 노리게 되고, 먼저 발행한 쪽이 그 판을 가집니다.</p>}
    </fieldset>

    <fieldset className="editor-panel">
      <legend>새 수업</legend>
      <p className="editor-note">아직 아무도 발행한 적 없는 수업을 처음부터 시작해요. 수업은 코스 하나에 속하고, 그 코스의 마지막 자리에 놓여요. 단계 하나만 있는 초안이 생기고, 나머지는 편집 화면에서 씁니다.</p>
      <label className="editor-field"><span className="editor-label">코스</span>
        <select value={made.courseKey} onChange={(event) => setMade({ ...made, courseKey: event.target.value })}>
          {workspace.courses.map((course) => <option key={course.key} value={course.key}>{course.title}{expert ? ` · ${course.key}` : ''}</option>)}
        </select></label>
      <label className="editor-field"><span className="editor-label">수업 이름</span>
        <input value={made.title} maxLength={191} placeholder="예: 소수, 자리와 크기"
          onChange={(event) => setMade({ ...made, title: event.target.value })} /></label>
      <label className="editor-field"><span className="editor-label">수업 키</span>
        <input value={made.key} maxLength={64} placeholder="decimal-place-value" spellCheck={false}
          onChange={(event) => setMade({ ...made, key: event.target.value.trim().toLowerCase() })} />
        {made.key && !lessonKeyPattern.test(made.key)
          ? <small className="editor-warn">영문 소문자·숫자·하이픈만 쓸 수 있고, 두 글자 이상이어야 해요.</small>
          : <small>이 수업 안의 모든 이름이 여기서 만들어져요. 발행한 뒤에는 바꿀 수 없어요.</small>}</label>
      <SkillPicker skills={workspace.skills} chosen={made.skillKeys} label="이 수업이 가르치는 개념"
        onChange={(skillKeys) => setMade({ ...made, skillKeys })} />
      <div className="editor-actions">
        <button type="button" className="button primary" disabled={busy || !readyToMake}
          onClick={() => onCreateLesson(made.courseKey, made.key, made.title.trim(), made.skillKeys)}>수업 만들기</button>
        {!readyToMake && <span className="editor-note">코스·이름·키·개념이 모두 있어야 만들 수 있어요.</span>}
      </div>
    </fieldset>

    <section className="dashboard-section">
      <div className="section-heading">
        <div><span className="eyebrow">DRAFTS</span><h2>초안</h2></div>
        {workspace.drafts.length > 3 && <label className="editor-field draft-search">
          <span className="editor-label">찾기</span>
          <input value={query} placeholder="제목이나 작성자" onChange={(event) => setQuery(event.target.value)} />
        </label>}
      </div>
      {found.length === 0
        ? <p className="empty-inline">{workspace.drafts.length ? '찾은 초안이 없어요.' : '아직 초안이 없어요.'}</p>
        : <div className="assignment-list">{found.map((item) => <button key={item.id} type="button" className="assignment-row" onClick={() => onOpen(item)}>
          <span className="assignment-icon"><Icon name="pencil" size={18} /></span>
          <span className="assignment-info"><strong>{item.title}</strong>
            <small>{expert ? item.versionId : versionLabel(item.versionId)} · {item.authorName}{item.mine ? '' : ' (다른 작성자)'} · {new Date(item.updatedAt).toLocaleString('ko-KR')}</small></span>
          <span className={`assignment-status${item.status === 'published' ? ' submitted' : ''}${item.status === 'review' ? ' waiting' : ''}`}>
            {draftStatusLabels[item.status]}</span>
          <Icon name="chevron" size={16} />
        </button>)}</div>}
    </section>
  </>;
}
