'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ClassSection, ContentBlock } from '@/shared/api';
import {
  blockFormOf, mayGrantRoles, mayPublish, moveBlock, nextBlockId, nextSectionId, toPublicProblem,
  type AccountRole, type AuthoringRole, type AuthoringWorkspace as Workspace, type DraftDetail, type DraftEdit,
  type DraftProblem, type DraftSummary, type TermSummary,
} from '@/shared/authoring';
import { ApiError, learningApi, type Session } from '@/features/learning/api-client';
import { ContentBlocks } from '@/features/learning/content-blocks';
import { Icon } from '@/features/learning/icons';
import { authoringApi } from './api-client';
import { AddBlock, BlockCard } from './block-editor';
import { ProblemSetEditor } from './problem-editor';
import { TermPanel } from './term-editor';

const roleLabels: Record<ClassSection['role'], string> = {
  explanation: '설명', worked_example: '예시', practice: '연습', check: '확인', summary: '정리',
};
const roles = Object.keys(roleLabels) as ClassSection['role'][];
const sameEdit = (left: DraftEdit, right: DraftEdit) => JSON.stringify(left) === JSON.stringify(right);

export function AuthoringWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [draft, setDraft] = useState<DraftDetail | null>(null);
  const [edit, setEdit] = useState<DraftEdit | null>(null);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<AccountRole[] | null>(null);
  const [terms, setTerms] = useState<TermSummary[] | null>(null);

  const dirty = !!draft && !!edit && !sameEdit(draft.edit, edit);
  const open = useCallback((detail: DraftDetail) => {
    setDraft(detail);
    setEdit(structuredClone(detail.edit));
    setSectionIndex((current) => Math.min(current, Math.max(detail.edit.sections.length - 1, 0)));
    setConfirming(false);
  }, []);

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

  if (!draft || !edit) {
    return <Shell role={workspace.role}>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {notice && <p className="notice-banner">{notice}</p>}
      <DraftList workspace={workspace} busy={busy}
        onOpen={(summary) => run(async () => open((await authoringApi.draft(summary.id)).draft))}
        onCreate={(classKey) => act({ action: 'draft.create', classKey })} />
      <TermPanel classes={workspace.classes} skills={workspace.skills} terms={terms} busy={busy}
        mayEditDictionary={mayPublish(workspace.role)}
        onList={(scopeKind, scopeKey) => act({ action: 'term.list', scopeKind, scopeKey }, (response) => setTerms(response.terms ?? []))}
        onSave={(edit) => act({ action: 'term.save', edit }, (response) => {
          setTerms(response.terms ?? []);
          setNotice(`${response.publishedTermVersionId} 판본을 발행했어요.`);
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
  const writeSection = (next: ClassSection) => setEdit({ ...edit, sections: edit.sections.map((item, index) => (index === sectionIndex ? next : item)) });
  const writeBlocks = (blocks: ContentBlock[]) => writeSection({ ...section, contentBlocks: blocks });
  const writeSectionBlock = (index: number, block: ContentBlock) =>
    edit.sections.map((item, position) => (position === sectionIndex
      ? { ...item, contentBlocks: item.contentBlocks.map((existing, place) => (place === index ? block : existing)) }
      : item));
  const previewProblems = edit.problems.map(toPublicProblem);

  return <Shell role={workspace.role}>
    <div className="editor-bar">
      <button type="button" className="back-button" onClick={() => { setDraft(null); setEdit(null); }}><Icon name="back" size={16} />초안 목록</button>
      <span className={`pill${published ? ' green' : ''}`}>{published ? `발행 완료 · ${draft.publishedVersionId}` : dirty ? '저장하지 않은 변경' : '저장됨'}</span>
    </div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {notice && <p className="notice-banner">{notice}</p>}
    {published && <p className="notice-banner">발행한 판본은 고칠 수 없어요. 더 고치려면 새 초안을 만들어 주세요.</p>}

    <div className="editor-layout">
      <aside className="editor-steps">
        <span className="eyebrow">SECTIONS</span>
        {edit.sections.map((item, index) => <button key={item.sectionId} type="button" className={index === sectionIndex ? 'active' : ''}
          onClick={() => setSectionIndex(index)}><small>{roleLabels[item.role]}</small>{item.title}</button>)}
        <button type="button" className="text-button" disabled={published || edit.sections.length >= 50} onClick={() => {
          const role: ClassSection['role'] = 'explanation';
          const sectionId = nextSectionId(draft.classKey, role, edit.meta.versionId, edit.sections.map((item) => item.sectionId));
          setEdit({ ...edit, sections: [...edit.sections, { sectionId, role, title: '새 단계', contentBlocks: [] }] });
          setSectionIndex(edit.sections.length);
        }}><Icon name="plus" size={14} />단계 추가</button>
      </aside>

      <div className="editor-main">
        <fieldset className="editor-panel" disabled={published}>
          <legend>클래스 정보</legend>
          <label className="editor-field"><span className="editor-label">새 판본 ID</span>
            <input value={edit.meta.versionId} onChange={(event) => setEdit({ ...edit, meta: { ...edit.meta, versionId: event.target.value } })} />
            <small>발행한 판본은 고칠 수 없어서, 수정은 늘 새 판본이 돼요. 기준 판본: {draft.baseVersionId ?? '없음'}</small></label>
          <label className="editor-field"><span className="editor-label">제목</span>
            <input value={edit.meta.title} onChange={(event) => setEdit({ ...edit, meta: { ...edit.meta, title: event.target.value } })} /></label>
          <label className="editor-field"><span className="editor-label">한 줄 소개</span>
            <input value={edit.meta.summary} onChange={(event) => setEdit({ ...edit, meta: { ...edit.meta, summary: event.target.value } })} /></label>
          <label className="editor-field"><span className="editor-label">예상 시간(분)</span>
            <input type="number" min={1} max={240} value={edit.meta.estimatedMinutes}
              onChange={(event) => setEdit({ ...edit, meta: { ...edit.meta, estimatedMinutes: Number(event.target.value) } })} /></label>
        </fieldset>

        <fieldset className="editor-panel" disabled={published}>
          <legend>단계</legend>
          <label className="editor-field"><span className="editor-label">단계 제목</span>
            <input value={section.title} onChange={(event) => writeSection({ ...section, title: event.target.value })} /></label>
          <label className="editor-field"><span className="editor-label">역할</span>
            <select value={section.role} onChange={(event) => writeSection({ ...section, role: event.target.value as ClassSection['role'] })}>
              {roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
            </select></label>
          {edit.sections.length > 1 && <button type="button" className="text-button" onClick={() => {
            setEdit({ ...edit, sections: edit.sections.filter((_, index) => index !== sectionIndex) });
            setSectionIndex(Math.max(sectionIndex - 1, 0));
          }}><Icon name="close" size={14} />이 단계 삭제</button>}
        </fieldset>

        {section.contentBlocks.map((block, index) => {
          const writeBlock = (next: ContentBlock) => writeBlocks(section.contentBlocks.map((item, position) => (position === index ? next : item)));
          return <BlockCard key={block.blockId} block={block} index={index} total={section.contentBlocks.length}
            termChoices={draft.terms}
            problems={blockFormOf(block)?.editsProblems && <ProblemSetEditor block={block} problems={edit.problems}
              skillKeys={draft.skillKeys} classKey={draft.classKey} role={section.role} versionId={edit.meta.versionId}
              taken={blockIds} termChoices={draft.terms}
              onChange={(next, problems) => setEdit({ ...edit, sections: writeSectionBlock(index, next), problems })} />}
            onChange={writeBlock}
            onMove={(delta) => writeBlocks(moveBlock(section.contentBlocks, index, delta))}
            onRemove={() => writeBlocks(section.contentBlocks.filter((_, position) => position !== index))} />;
        })}

        {!published && <AddBlock blockId={(kind) => nextBlockId(draft.classKey, section.sectionId, kind, edit.meta.versionId, blockIds)}
          onAdd={(block) => writeBlocks([...section.contentBlocks, block])} />}
      </div>

      <aside className="editor-preview">
        <span className="eyebrow">PREVIEW</span>
        <article className="lesson-sheet">
          <div className="lesson-step-label">{String(sectionIndex + 1).padStart(2, '0')}<i />{roleLabels[section.role]}</div>
          <h2>{section.title}</h2>
          {/* The learner's renderer, so an unsupported or malformed block looks here as it will there. */}
          <ContentBlocks blocks={section.contentBlocks} problems={previewProblems}
            renderProblem={(problem) => <div className="problem-card">
              <div className="problem-kicker"><Icon name="pencil" size={14} />문항 미리보기<span>{problem.problemVersionId}</span></div>
              <ContentBlocks blocks={problem.promptContent} />
            </div>} />
        </article>
      </aside>
    </div>

    <div className="editor-actions">
      <button type="button" className="button secondary" disabled={busy || published || !dirty}
        onClick={() => act({ action: 'draft.save', draftId: draft.id, edit }, () => setNotice('초안을 저장했어요.'))}>저장</button>
      <button type="button" className="button secondary" disabled={busy || dirty}
        onClick={() => act({ action: 'draft.validate', draftId: draft.id }, (response) =>
          setNotice(response.draft?.issues.length ? null : '발행 검증을 통과했어요.'))}>검증</button>
      {mayPublish(workspace.role) && !published && <button type="button" className="button primary" disabled={busy || dirty || !!draft.issues.length}
        onClick={() => setConfirming(true)}>발행<Icon name="arrow" size={16} /></button>}
      <button type="button" className="text-button" disabled={busy}
        onClick={() => { if (confirm('이 초안을 삭제할까요? 발행한 판본은 남습니다.')) void act({ action: 'draft.delete', draftId: draft.id }, () => { setDraft(null); setEdit(null); }); }}>
        초안 삭제</button>
      {dirty && <span className="editor-note">검증과 발행은 저장한 내용으로 해요.</span>}
    </div>

    {confirming && <div className="editor-confirm" role="alertdialog" aria-label="발행 확인">
      <strong>{edit.meta.versionId} 판본을 발행할까요?</strong>
      <p>발행하면 되돌릴 수 없어요. 이미 수강 중인 사람은 이전 판본을 계속 보고, 새로 수강하는 사람부터 이 판본을 받습니다.
        새 종류의 블록을 넣었다면 그 블록을 아는 앱이 먼저 배포되어 있어야 해요.</p>
      <div className="editor-actions">
        <button type="button" className="button primary" disabled={busy}
          onClick={() => act({ action: 'draft.publish', draftId: draft.id }, (response) => setNotice(`${response.publishedVersionId} 판본을 발행했어요.`))}>
          발행할게요</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirming(false)}>취소</button>
      </div>
    </div>}

    {!!draft.issues.length && <section className="editor-issues" aria-label="검증 결과">
      <strong>고칠 곳이 있어요</strong>
      <ul>{draft.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
    </section>}
  </Shell>;
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

function Shell({ role, children }: { role?: string; children: React.ReactNode }) {
  return <main className="authoring-page">
    <header className="authoring-head">
      <div><span className="eyebrow">CONTENT STUDIO</span><h1>콘텐츠 편집</h1></div>
      <div className="authoring-head-side">
        {role && <span className="pill">{role === 'admin' ? '관리자 · 발행 가능' : '작성자 · 검토 요청'}</span>}
        <a className="text-button" href="/">학습 화면으로<Icon name="arrow" size={14} /></a>
      </div>
    </header>
    {children}
  </main>;
}

function DraftList({ workspace, busy, onOpen, onCreate }: {
  workspace: Workspace; busy: boolean; onOpen: (draft: DraftSummary) => void; onCreate: (classKey: string) => void;
}) {
  const [classKey, setClassKey] = useState(workspace.classes[0]?.classKey ?? '');
  return <>
    <fieldset className="editor-panel">
      <legend>새 초안</legend>
      <p className="editor-note">발행된 클래스를 기준으로 다음 판본의 초안을 만듭니다. 문항과 채점 규칙은 기준 판본에서 그대로 이어받고, 이 화면에서는 단계와 블록을 고쳐요.</p>
      <div className="editor-actions">
        <label className="editor-field"><span className="editor-label">클래스</span>
          <select value={classKey} onChange={(event) => setClassKey(event.target.value)}>
            {workspace.classes.map((item) => <option key={item.classKey} value={item.classKey}>
              {item.title} · {item.latestVersionId} → {item.suggestedVersionId}{item.hasDraft ? ' (초안 있음)' : ''}</option>)}
          </select></label>
        <button type="button" className="button primary" disabled={busy || !classKey} onClick={() => onCreate(classKey)}>초안 만들기</button>
      </div>
    </fieldset>
    <section className="dashboard-section">
      <div className="section-heading"><div><span className="eyebrow">DRAFTS</span><h2>초안</h2></div></div>
      {workspace.drafts.length === 0
        ? <p className="empty-inline">아직 초안이 없어요.</p>
        : <div className="assignment-list">{workspace.drafts.map((item) => <button key={item.id} type="button" className="assignment-row" onClick={() => onOpen(item)}>
          <span className="assignment-icon"><Icon name="pencil" size={18} /></span>
          <span className="assignment-info"><strong>{item.title}</strong>
            <small>{item.versionId} · {item.authorName}{item.mine ? '' : ' (다른 작성자)'} · {new Date(item.updatedAt).toLocaleString('ko-KR')}</small></span>
          <span className={`assignment-status${item.status === 'published' ? ' submitted' : ''}`}>{item.status === 'published' ? '발행함' : '작성 중'}</span>
          <Icon name="chevron" size={16} />
        </button>)}</div>}
    </section>
  </>;
}
