'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { ActionResponse, AssignmentView, AttemptView, LessonDocument, ContentBlock, EnrollmentView, Goal, LearningAction, LearningState, PublicLesson, PublicProblem, PublicSkill } from '@/shared/api';
import { ApiError, learningApi, supportsWebAuthentication, type Session } from './api-client';
import { assertLearningResponseAccount, clearAuthReturn, GOOGLE_LOGIN_PATH, isNativeBrowser, LearningResponseError, parseAuthError, readAuthReturn, saveAuthReturn, type AuthReturn } from './auth-client';
import { DiagnosticPanel } from './diagnostic-panel';
import { GoogleLoginButton } from './google-login-button';
import { ServiceFooter } from './service-footer';
import { ContentBlocks, unsupportedRequiredBlocks, type GlossaryContext } from './content-blocks';
import { ProblemCard, type ProblemActions } from './problem-card';
import { Icon, type IconName } from './icons';

type Page = 'home' | 'lessons' | 'practice' | 'history' | 'lesson' | 'assignment' | 'diagnostic';
type Dispatch = (action: LearningAction) => Promise<ActionResponse>;
const goalLabels: Record<Goal, string> = { 'daily-math': '생활 속 수학 익히기', 'foundation-recovery': '기초부터 다시 배우기', 'algebra-ready': '대수학을 위한 준비' };
const roleLabels = { explanation: '개념 이해', worked_example: '함께 풀기', practice: '직접 연습', check: '확인 퀴즈', summary: '마무리' };
const navItems: { page: Page; label: string; icon: IconName }[] = [
  { page: 'home', label: '내 학습', icon: 'home' }, { page: 'lessons', label: '수업', icon: 'book' },
  { page: 'practice', label: '연습장', icon: 'pencil' }, { page: 'history', label: '학습 기록', icon: 'chart' },
];
const formatDate = (value: string) => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(new Date(value));
const messageOf = (error: unknown) => error instanceof Error ? error.message : '문제가 생겼어요. 다시 시도해 주세요.';

function Brand() {
  return <span className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>geunyang<span className="brand-sub">math</span></span></span>;
}

function LessonArt({ index, large = false }: { index: number; large?: boolean }) {
  return <div className={`class-art art-${index % 3}${large ? ' large' : ''}`} aria-hidden="true">
    {index % 3 === 0 ? <div className="fraction-art"><div className="fraction-circle"><span /><span /><span /><span /></div><span className="fraction-number"><b>3</b><i /><b>4</b></span><span className="art-star">✳</span></div>
      : index % 3 === 1 ? <div className="equivalence-art"><span><b>1</b><i /><b>2</b></span><em>=</em><span><b>2</b><i /><b>4</b></span></div>
      : <div className="addition-art"><span><i /><i /><i /><i /></span><b>+</b><span><i /><i /><i /><i /></span></div>}
  </div>;
}

function LessonCard({ item, index, enrollment, onOpen }: { item: PublicLesson; index: number; enrollment?: EnrollmentView; onOpen: () => void }) {
  const completed = enrollment?.status === 'completed';
  const percent = Math.min(100, Math.round((enrollment?.completedSectionIds.length ?? 0) / Math.max(1, item.sectionCount) * 100));
  return <button className="class-card" onClick={onOpen}>
    <LessonArt index={index} />
    <div className="class-card-content"><div className="class-card-meta"><span>기초 수학 · {String(index + 1).padStart(2, '0')}</span>{completed && <span className="completed-label"><Icon name="check" size={13} />완료</span>}</div>
      <h3>{item.title}</h3><p>{item.summary}</p>
      <div className="class-card-footer"><span><Icon name="clock" size={14} />{item.estimatedMinutes}분 <i />{item.sectionCount}개 단계</span><Icon name="arrow" size={18} /></div>
      {enrollment && <div className="card-progress" aria-label={`진도 ${percent}%`}><span style={{ width: `${percent}%` }} /></div>}
    </div>
  </button>;
}

export function LearningWorkspace() {
  const [page, setPage] = useState<Page>('home');
  const [session, setSession] = useState<Session | null>(null);
  const authenticatedUserId = useRef<string | null>(null);
  const [state, setState] = useState<LearningState | null>(null);
  const [catalog, setCatalog] = useState<PublicLesson[]>([]);
  const [catalogSkills, setCatalogSkills] = useState<PublicSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState('');
  const [webAuthentication, setWebAuthentication] = useState(false);
  const [googleStarting, setGoogleStarting] = useState(false);
  const googleStartingRef = useRef(false);
  const loadGeneration = useRef(0);
  const authReturn = useRef<{ message: string | null; returnTo: AuthReturn | null } | null>(null);
  const [document, setDocument] = useState<LessonDocument | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const lessonRequest = useRef(0);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [selectedAssignment, setSelectedAssignment] = useState<string | null>(null);
  const [finishedLesson, setFinishedLesson] = useState(false);
  const [modal, setModal] = useState<'login' | 'profile' | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [goal, setGoal] = useState<Goal>('foundation-recovery');
  const [minutes, setMinutes] = useState(10);
  const [dirtyProblems, setDirtyProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const submissionRequests = useRef(new Map<string, string>());
  const modalRef = useRef<HTMLDivElement>(null);
  const modalReturnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!modal) return;
    modalReturnFocus.current = window.document.activeElement as HTMLElement;
    const dialog = modalRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? []);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) setModal(null);
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (event.shiftKey && window.document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus(); }
      if (!event.shiftKey && window.document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus(); }
    };
    window.document.addEventListener('keydown', onKey);
    return () => { window.document.removeEventListener('keydown', onKey); modalReturnFocus.current?.focus(); };
  }, [modal]);

  function clearPersonalState() {
    authenticatedUserId.current = null;
    setState(null);
    setSession((previous) => previous ? { ...previous, user: null } : null);
    setSelectedAssignment(null); setDirtyProblems([]); submissionRequests.current.clear();
    lessonRequest.current += 1; setDocument(null); setLessonLoading(false);
    setSectionIndex(0); setFinishedLesson(false); setDisplayName('');
    setGoal('foundation-recovery'); setMinutes(10); setModal(null); setPage('home');
    if (authReturn.current) authReturn.current.returnTo = null;
    try { clearAuthReturn(window.sessionStorage); } catch { /* Browser storage may be restricted. */ }
  }

  async function refresh(restoreAfterLogin = false) {
    const generation = ++loadGeneration.current;
    setLoading(true); setError('');
    try {
      const nextSession = await learningApi.session();
      if (generation !== loadGeneration.current) return;
      // A pageshow listener keeps its initial closure; compare the confirmed account via a ref.
      // Clear the old account before fetching more data, even if the new account's load fails.
      if (authenticatedUserId.current && authenticatedUserId.current !== nextSession.user?.id) clearPersonalState();
      authenticatedUserId.current = nextSession.user?.id ?? null;
      setSession(nextSession);
      const [publicCatalog, nextState] = await Promise.all([
        learningApi.catalog(),
        nextSession.user ? learningApi.state() : Promise.resolve(null),
      ]);
      if (generation !== loadGeneration.current) return;
      assertLearningResponseAccount(
        { userId: nextSession.user?.id ?? null, generation },
        { userId: authenticatedUserId.current, generation: loadGeneration.current },
        nextState?.user.id ?? null,
      );
      setCatalog(publicCatalog.lessons); setCatalogSkills(publicCatalog.skills); setState(nextState);
      const pending = authReturn.current;
      if (restoreAfterLogin && pending?.returnTo && (nextState || pending.message)) {
        // Stored content keys are only used after matching the public catalogue, never as URLs.
        if (publicCatalog.lessons.some((item) => item.lessonKey === pending.returnTo?.lessonKey)) {
          await openLesson(pending.returnTo.lessonKey, nextState);
        }
        if (generation !== loadGeneration.current) return;
        if (nextState) {
          try { clearAuthReturn(window.sessionStorage); } catch { /* Navigation metadata is optional. */ }
          pending.returnTo = null;
        }
      }
      if (restoreAfterLogin && pending?.message) { setAuthError(pending.message); setModal('login'); }
    } catch (reason) {
      if (generation !== loadGeneration.current) return;
      if (reason instanceof LearningResponseError && reason.kind === 'stale') return;
      if ((reason instanceof ApiError && reason.status === 401) || reason instanceof LearningResponseError) clearPersonalState();
      setError(messageOf(reason));
    } finally { if (generation === loadGeneration.current) setLoading(false); }
  }

  useEffect(() => {
    const bridge = (window as Window & { Capacitor?: Parameters<typeof isNativeBrowser>[0] }).Capacitor;
    setWebAuthentication(supportsWebAuthentication(window.location.origin, isNativeBrowser(bridge)));
    if (!authReturn.current) {
      const returned = parseAuthError(window.location.search);
      let returnTo: AuthReturn | null = null;
      try { returnTo = readAuthReturn(window.sessionStorage); } catch { /* Storage may be unavailable. */ }
      authReturn.current = { message: returned?.message ?? null, returnTo };
      if (returned) {
        setAuthError(returned.message); setModal('login');
        // Only remove our own error parameter; preserve the current same-origin path, query and hash.
        try {
          const currentUrl = new URL(window.location.href);
          currentUrl.search = returned.cleanSearch;
          window.history.replaceState(window.history.state, '', currentUrl.href);
        } catch { /* The allowlisted message still works if this browser restricts history changes. */ }
      }
    }
    void refresh(true);
    const onPageShow = (event: PageTransitionEvent) => {
      googleStartingRef.current = false; setGoogleStarting(false);
      if (event.persisted) void refresh();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => { loadGeneration.current += 1; window.removeEventListener('pageshow', onPageShow); };
  }, []);

  function beginGoogleLogin() {
    if (!session?.googleLogin || !webAuthentication || busyRef.current || googleStartingRef.current) return;
    try { saveAuthReturn(window.sessionStorage, page === 'lesson' ? document?.lessonKey ?? null : null); }
    catch { /* OAuth can continue without optional lesson navigation metadata. */ }
    googleStartingRef.current = true; setGoogleStarting(true); setAuthError(''); setError('');
    window.location.assign(GOOGLE_LOGIN_PATH);
  }

  const reviewSkillKeys = state?.plan.readiness.filter((item) => item.readiness === 'needs-practice').map((item) => item.key) ?? [];
  function navigate(next: Page) { setPage(next); setNotice(''); setError(''); window.scrollTo({ top: 0, behavior: 'instant' }); }
  const lessons = state?.lessons ?? catalog;
  // Catalogue copy names the concepts the published lessons teach, so new subjects need no edit here.
  const conceptLabels = catalogSkills.map((skill) => skill.label);
  const catalogConcepts = conceptLabels.length
    ? conceptLabels.slice(0, 4).join(' · ') + (conceptLabels.length > 4 ? ` 외 ${conceptLabels.length - 4}개` : '')
    : '개념을 하나씩 익히는 기본 수업';
  const heroIntro = (conceptLabels.length > 1 ? `${conceptLabels[0]}부터 ${conceptLabels.at(-1)}까지.\n`
    : conceptLabels.length === 1 ? `${conceptLabels[0]}부터 차근차근.\n` : '') + '짧은 설명과 직접 푸는 연습으로 다시 만나요.';
  const currentEnrollment = state?.enrollments.find((entry) => entry.lessonKey === document?.lessonKey);
  const assignment = state?.assignments.find((entry) => entry.recipientId === selectedAssignment);
  const completedCount = state?.enrollments.filter((entry) => entry.status === 'completed').length ?? 0;
  const pendingAssignments = state?.assignments.filter((entry) => entry.status === 'assigned') ?? [];
  const recommended = lessons.find((item) => item.lessonKey === state?.recommendations[0]?.lessonKey) ?? lessons.find((item) => !state?.enrollments.some((entry) => entry.lessonKey === item.lessonKey && entry.status === 'completed')) ?? lessons[0];
  const activeNav = page === 'lesson' ? 'lessons' : page === 'assignment' ? 'practice' : page === 'diagnostic' ? 'home' : page;

  const dispatch: Dispatch = async (action) => {
    if (busyRef.current) throw new Error('앞선 요청을 저장하고 있어요. 잠시 기다려 주세요.');
    if (loading) throw new Error('학습 공간을 새로 불러오고 있어요. 잠시 기다려 주세요.');
    const requestAccount = { userId: authenticatedUserId.current, generation: loadGeneration.current };
    if (!requestAccount.userId) throw new Error('학습 공간을 새로 불러온 뒤 다시 시도해 주세요.');
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await learningApi.action(action, requestAccount.userId);
      assertLearningResponseAccount(requestAccount,
        { userId: authenticatedUserId.current, generation: loadGeneration.current }, response.state.user.id);
      setState(response.state); return response;
    }
    catch (reason) {
      // A previous tab/account's late success or failure cannot overwrite the current account.
      if (requestAccount.generation !== loadGeneration.current || requestAccount.userId !== authenticatedUserId.current) throw reason;
      if ((reason instanceof ApiError && reason.code === 'account_changed') || (reason instanceof LearningResponseError && reason.kind === 'account-changed')) {
        clearPersonalState(); void refresh(); setNotice(messageOf(reason)); throw reason;
      }
      if (reason instanceof ApiError && reason.status === 401) { clearPersonalState(); setModal('login'); }
      setError(messageOf(reason)); throw reason;
    } finally { busyRef.current = false; setBusy(false); }
  };

  async function openLesson(key: string, learningState = state) {
    const requestId = ++lessonRequest.current;
    navigate('lesson'); setLessonLoading(true); setDocument(null); setFinishedLesson(false);
    try {
      const nextDocument = await learningApi.lesson(key);
      if (requestId !== lessonRequest.current) return;
      setDocument(nextDocument);
      const enrollment = learningState?.enrollments.find((entry) => entry.lessonKey === key);
      const firstIncomplete = nextDocument.sections.findIndex((section) => !enrollment?.completedSectionIds.includes(section.sectionId));
      setSectionIndex(enrollment?.status === 'completed' ? 0 : Math.max(0, firstIncomplete));
    } catch (reason) { if (requestId === lessonRequest.current) setError(messageOf(reason)); }
    finally { if (requestId === lessonRequest.current) setLessonLoading(false); }
  }
  async function startLesson() {
    if (!document) return;
    if (!state) { setModal('login'); return; }
    try {
      const response = await dispatch({ action: 'enrollment.start', lessonKey: document.lessonKey });
      const enrolled = response.state.enrollments.find((entry) => entry.lessonKey === document.lessonKey);
      // A lesson may have been republished since its public preview was opened.
      if (enrolled && enrolled.lessonVersionId !== document.versionId) await openLesson(document.lessonKey);
      setSectionIndex(0); setNotice('수업을 시작했어요. 나의 속도로 한 단계씩 배워보세요.');
    }
    catch { /* The shared error banner retains the server message. */ }
  }
  async function nextSection() {
    if (!document) return;
    const section = document.sections[sectionIndex];
    if (!currentEnrollment) { if (sectionIndex < document.sections.length - 1) setSectionIndex((value) => value + 1); return; }
    if (currentEnrollment.status === 'completed') { if (sectionIndex < document.sections.length - 1) setSectionIndex((value) => value + 1); else navigate('home'); return; }
    try {
      await dispatch({ action: 'section.complete', enrollmentId: currentEnrollment.id, sectionId: section.sectionId });
      if (sectionIndex < document.sections.length - 1) { setSectionIndex((value) => value + 1); window.scrollTo({ top: 0, behavior: 'instant' }); }
      else { await dispatch({ action: 'lesson.complete', enrollmentId: currentEnrollment.id }); setFinishedLesson(true); window.scrollTo({ top: 0, behavior: 'instant' }); }
    } catch { /* Completion only advances after the server accepted the action. */ }
  }
  function openAssignment(item: AssignmentView) { setDirtyProblems([]); setSelectedAssignment(item.recipientId); navigate('assignment'); }
  async function submitAssignment() {
    if (!assignment || dirtyProblems.length) return;
    const requestId = submissionRequests.current.get(assignment.recipientId) ?? crypto.randomUUID();
    submissionRequests.current.set(assignment.recipientId, requestId);
    try { await dispatch({ action: 'assignment.submit', recipientId: assignment.recipientId, requestId }); submissionRequests.current.delete(assignment.recipientId); setNotice('과제를 제출했어요. 풀이 결과는 학습 기록에서 확인할 수 있어요.'); }
    catch { /* Keep the same idempotency key for retries. */ }
  }
  async function login(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || !webAuthentication || !session?.developmentLogin) return;
    busyRef.current = true; setBusy(true); setError(''); setAuthError('');
    const generation = ++loadGeneration.current;
    try {
      const nextSession = await learningApi.login(displayName.trim() || '학습자');
      if (generation !== loadGeneration.current) return;
      authenticatedUserId.current = nextSession.user?.id ?? null;
      setSession((previous) => ({ user: nextSession.user, developmentLogin: previous?.developmentLogin ?? false, googleLogin: previous?.googleLogin ?? false }));
      const nextState = await learningApi.state();
      assertLearningResponseAccount({ userId: nextSession.user?.id ?? null, generation },
        { userId: authenticatedUserId.current, generation: loadGeneration.current }, nextState.user.id);
      setState(nextState); setModal(null); setNotice('학습 공간이 준비됐어요. 첫 수업을 시작해 보세요.');
    }
    catch (reason) {
      if (generation !== loadGeneration.current || (reason instanceof LearningResponseError && reason.kind === 'stale')) return;
      if (reason instanceof LearningResponseError || (reason instanceof ApiError && reason.status === 401)) clearPersonalState();
      setError(messageOf(reason));
    }
    finally { busyRef.current = false; setBusy(false); if (generation === loadGeneration.current) setLoading(false); }
  }
  async function logout() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); loadGeneration.current += 1;
    try {
      await learningApi.logout(); clearPersonalState(); setAuthError(''); navigate('home');
      setNotice('로그아웃했어요. 다시 로그인하면 저장한 학습을 이어갈 수 있어요.');
    }
    catch (reason) { setError(messageOf(reason)); }
    finally { busyRef.current = false; setBusy(false); setLoading(false); }
  }
  function openProfile() {
    if (!state) { setModal('login'); return; }
    setGoal(state.user.goal); setMinutes(state.user.dailyMinutes); setModal('profile');
  }
  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    try { await dispatch({ action: 'profile.update', goal, dailyMinutes: minutes }); setModal(null); setNotice('목표와 시간을 반영했어요. 다음 추천과 새 복습 과제에 적용하며, 이미 받은 과제는 그대로 유지해요.'); } catch { /* Shown in dialog and page. */ }
  }

  function assignmentRow(item: AssignmentView) {
    const savedCount = item.items.filter((entry) => entry.attempt).length;
    return <button key={item.recipientId} className="assignment-row" onClick={() => openAssignment(item)}><span className="assignment-icon"><Icon name={item.status === 'submitted' ? 'check' : 'pencil'} size={23} /></span><span className="assignment-info"><strong>{item.title}</strong><small>{item.items.length}문제 · {formatDate(item.recommendedAt)} 권장{item.policy === 'fixed' ? ' · 내용 고정' : ''}</small></span><span className={`assignment-status ${item.status}`}>{item.status === 'submitted' ? '제출 완료' : savedCount ? `${savedCount}/${item.items.length} 저장` : '풀어보기'}</span><Icon name="chevron" size={18} /></button>;
  }

  function renderHome() {
    return <>
      <div className="page-heading"><div className="eyebrow">A LITTLE MATH, EVERY DAY</div><h1>{state ? `${state.user.displayName}님, 오늘도 한 걸음.` : '그냥, 다시 시작하는 수학.'}</h1><p>완벽하게 알지 못해도 괜찮아요. 작은 이해가 쌓이면 수학이 편해져요.</p></div>
      {state && <section className="personalization-card" aria-label="나에게 맞는 학습">
        <div className="section-heading"><div><span className="eyebrow">YOUR STARTING POINT</span><h2>{state.diagnostic?.status === 'completed' ? '풀이에 맞춰 다음 걸음을 골랐어요.' : state.diagnostic ? '시작점 확인을 이어가요.' : '나에게 맞는 시작점을 찾아요.'}</h2></div>
          <button className="button secondary" disabled={busy} onClick={() => navigate('diagnostic')}>{state.diagnostic?.status === 'completed' ? '진단 결과' : state.diagnostic ? `${state.diagnostic.answered}/${state.diagnostic.total} · 이어서 확인` : state.diagnosticOffering ? `${state.diagnosticOffering.total}문제로 확인하기` : '시작점 확인 안내'}</button></div>
        <p className="muted">진단 없이 바로 시작해도 괜찮아요. 실제 풀이와 제출한 복습을 반영해 추천이 달라져요.</p>
        <div className="recommendation-choice"><button className="text-button" disabled={busy} onClick={() => navigate('lessons')}>다른 수업 직접 고르기 →</button>{state.plan.preferredLessonKey && <button className="text-button" disabled={busy} onClick={() => { void dispatch({ action: 'recommendation.choose', lessonKey: null }).catch(() => {}); }}>자동 추천으로 돌아가기</button>}</div>
        <div className="readiness-list">{state.plan.readiness.map(skill => <span key={skill.key} className={`readiness ${skill.readiness}`}><strong>{skill.label}</strong> · {skill.readiness === 'ready' ? '다음 개념 준비' : skill.readiness === 'needs-practice' ? '한 번 더 연습' : '아직 확인 전'}{skill.source === 'diagnostic' ? ' (진단 기준)' : ''}</span>)}</div>
        {state.plan.review && <div className="review-callout"><p>{state.plan.review.reason}</p><button className="button primary" disabled={busy} onClick={() => { const review = state.assignments.find(a => a.recipientId === state.plan.review?.recipientId); if (review) openAssignment(review); }}>복습부터 시작하기</button></div>}
      </section>}
      <section className="daily-hero"><div className="hero-copy"><span className="hero-eyebrow"><span />{state ? '오늘의 추천 수업' : '기초부터 다시, 내 속도로'}</span><h2>{recommended?.title ?? '작은 조각에서\n시작하는 큰 이해'}</h2><p>{state?.recommendations[0]?.reason ?? heroIntro}</p><button className="button hero-button" onClick={() => recommended ? void openLesson(recommended.lessonKey) : setModal('login')} disabled={loading}>{state && recommended && state.enrollments.some((entry) => entry.lessonKey === recommended.lessonKey) ? state.recommendations[0]?.kind === 'revisit' ? '설명 다시 펼치기' : '이어서 학습하기' : state ? '오늘의 학습 시작' : '첫 수업 둘러보기'}<Icon name="arrow" size={18} /></button><span className="hero-duration"><Icon name="clock" size={13} />{state ? `오늘은 ${state.recommendations[0]?.suggestedMinutes ?? state.user.dailyMinutes}분씩 · 수업 전체 ${recommended?.estimatedMinutes ?? 15}분` : `약 ${recommended?.estimatedMinutes ?? 15}분 · 부담 없이 한 수업`}</span></div><div className="hero-art"><div className="hero-paper"><span className="paper-caption">작게 나누면, 더 쉬워져요.</span><LessonArt index={0} large /><div className="paper-equation"><span>하나를 나누어 보는 것부터.</span><span>¼ + ¼ + ¼ = ¾</span></div></div><span className="hero-doodle">+</span><span className="hero-dot" /></div></section>
      <div className="learning-overview"><div><span className="overview-icon"><Icon name="book" size={20} /></span><span><small>나의 학습</small><strong>{completedCount}<em>개 수업 완료</em></strong></span></div><div><span className="overview-icon"><Icon name="pencil" size={20} /></span><span><small>한 번 더 생각하기</small><strong>{pendingAssignments.length}<em>개 과제 남음</em></strong></span></div><button onClick={openProfile}><span className="overview-icon orange"><Icon name="clock" size={20} /></span><span><small>꾸준함을 위한 작은 약속</small><strong>하루 {state?.user.dailyMinutes ?? 10}<em>분씩 학습</em></strong></span><Icon name="chevron" size={16} /></button></div>
      <section className="dashboard-section"><div className="section-heading"><div><span className="eyebrow">BUILD YOUR FOUNDATION</span><h2>차근차근, 기본부터</h2></div><button className="text-button" onClick={() => navigate('lessons')}>전체 수업<Icon name="arrow" size={16} /></button></div><div className="class-grid">{lessons.slice(0, 3).map((item, index) => <LessonCard key={item.lessonKey} item={item} index={index} enrollment={state?.enrollments.find((entry) => entry.lessonKey === item.lessonKey)} onOpen={() => void openLesson(item.lessonKey)} />)}</div>{!loading && !lessons.length && <div className="empty-inline">{error ? '수업을 불러오지 못했어요. 상단에서 다시 시도해 주세요.' : '첫 번째 수업을 준비하고 있어요.'}</div>}</section>
      <section className="dashboard-section practice-preview"><div className="section-heading"><div><span className="eyebrow">MAKE IT YOURS</span><h2>배운 것을 내 것으로</h2></div><button className="text-button" onClick={() => navigate('practice')}>연습장<Icon name="arrow" size={16} /></button></div>{pendingAssignments.length ? <div className="assignment-list">{pendingAssignments.slice(0, 2).map(assignmentRow)}</div> : <div className="gentle-empty"><span className="empty-drawing"><Icon name="pencil" size={28} /></span><div><h3>오늘의 이해가 내일도 남도록</h3><p>수업을 마치면 복습 과제가 생겨요. 짧은 연습으로 배운 내용을 다시 꺼내보세요.</p></div><span className="small-note">한 번 더, 천천히.</span></div>}</section>
      <div className="page-footnote"><span>∴</span> 조금씩 이해하는 즐거움. <b>geunyang math</b></div>
    </>;
  }

  function renderLessons() {
    return <><div className="page-heading"><div className="eyebrow">YOUR LEARNING LIBRARY</div><h1>기초가 편안해지는 수업.</h1><p>개념을 이해하고, 함께 풀고, 직접 확인해요. 필요한 곳부터 시작하세요.</p></div><div className="catalog-banner"><Icon name="book" size={24} /><div><strong>다시 배우는 기초 수학</strong><p>{catalogConcepts}</p></div><span>{lessons.length}개 수업</span></div><div className="class-grid">{lessons.map((item, index) => <div className="class-option" key={item.lessonKey}><LessonCard item={item} index={index} enrollment={state?.enrollments.find((entry) => entry.lessonKey === item.lessonKey)} onOpen={() => void openLesson(item.lessonKey)} />{state && <button className="button secondary" disabled={busy} onClick={() => { void dispatch({ action: 'recommendation.choose', lessonKey: item.lessonKey }).then(() => navigate('home')).catch(() => {}); }}>{state.plan.preferredLessonKey === item.lessonKey ? '내가 고른 수업' : '이 수업을 내 추천으로'}</button>}</div>)}</div>{!lessons.length && <EmptyState title="수업을 준비하고 있어요" text="잠시 후 다시 확인해 주세요." />}</>;
  }

  function renderPractice() {
    const submitted = state?.assignments.filter((item) => item.status === 'submitted') ?? [];
    return <><div className="page-heading"><div className="eyebrow">A LITTLE PRACTICE GOES A LONG WAY</div><h1>이해를 오래 남기는 연습장.</h1><p>어제 배운 내용을 오늘 다시 떠올려보세요. 답안을 저장한 뒤 과제를 제출해요.</p></div><div className="section-heading"><h2>나에게 배정된 과제 <span className="count-label">{pendingAssignments.length}</span></h2></div>{pendingAssignments.length ? <div className="assignment-list">{pendingAssignments.map(assignmentRow)}</div> : <EmptyState title={state ? '남아 있는 과제가 없어요' : '나의 연습을 시작해 볼까요?'} text={state ? '수업을 완료하면 배운 개념을 복습할 과제가 배정돼요.' : '학습 공간을 시작하면 수업과 연결된 과제를 풀고 기록할 수 있어요.'} actionLabel={state ? '수업 둘러보기' : '내 학습 시작하기'} onAction={() => state ? navigate('lessons') : setModal('login')} />}{submitted.length > 0 && <section className="dashboard-section"><div className="section-heading"><h2>제출한 과제 <span className="count-label">{submitted.length}</span></h2></div><div className="assignment-list">{submitted.map(assignmentRow)}</div></section>}</>;
  }

  function renderHistory() {
    const labels = { unknown: '아직 시작 전', practicing: '연습하는 중', independent: '스스로 해결', retained: '꾸준히 기억' };
    return <><div className="page-heading"><div className="eyebrow">EVERY SMALL STEP COUNTS</div><h1>조금씩 쌓이는 나의 이해.</h1><p>빠르기보다, 어제보다 조금 더 이해하는 것. 여기까지 온 걸음을 확인해요.</p></div>{!state ? <EmptyState title="첫 걸음을 기록해 보세요" text="내 학습을 시작하면 수업 진도와 개념별 학습 기록이 여기에 모여요." actionLabel="내 학습 시작하기" onAction={() => setModal('login')} /> : <><div className="history-stats"><div><small>완료한 수업</small><strong>{completedCount}<span>개</span></strong></div><div><small>제출한 과제</small><strong>{state.assignments.filter((item) => item.status === 'submitted').length}<span>개</span></strong></div><div><small>풀어본 문제</small><strong>{state.enrollments.reduce((sum, item) => sum + new Set(item.attempts.map((attempt) => attempt.problemVersionId)).size, 0) + state.assignments.reduce((sum, item) => sum + item.items.filter((entry) => entry.attempt).length, 0)}<span>개</span></strong></div></div><section className="dashboard-section"><div className="section-heading"><h2>개념별 학습 상태</h2><span className="muted small">풀이와 복습 기록을 기준으로 반영해요</span></div><div className="skill-list">{state.skills.map((skill) => <div key={skill.key}><span className={`skill-dot ${skill.state}`} /><strong>{skill.label}</strong><span className={`skill-state ${skill.state}`}>{labels[skill.state]}</span></div>)}</div></section><section className="dashboard-section"><div className="section-heading"><h2>추천이 바뀐 기록</h2></div><p className="muted small">학습과 설정을 저장할 때 달라진 추천을 최근 10개까지 보여줘요.</p><div className="recommendation-history">{state.recommendationHistory.map(entry => <article key={entry.id}><small>{formatDate(entry.createdAt)}</small>{entry.recommendations.map(item => <div key={item.lessonKey}><strong>{lessons.find(c => c.lessonKey === item.lessonKey)?.title ?? '이전 수업'}</strong><p>{item.reason}</p><small>하루 계획 {item.suggestedMinutes}분</small></div>)}</article>)}</div></section><section className="dashboard-section"><div className="section-heading"><h2>학습 중인 수업</h2></div><div className="class-grid">{lessons.filter((item) => state.enrollments.some((enrollment) => enrollment.lessonKey === item.lessonKey)).map((item) => <LessonCard key={item.lessonKey} item={item} index={lessons.indexOf(item)} enrollment={state.enrollments.find((entry) => entry.lessonKey === item.lessonKey)} onOpen={() => void openLesson(item.lessonKey)} />)}</div>{!state.enrollments.length && <EmptyState title="아직 시작한 수업이 없어요" text="첫 수업에서 새로운 이해를 만나보세요." actionLabel="수업 둘러보기" onAction={() => navigate('lessons')} />}</section></>}</>;
  }

  function renderLesson() {
    if (lessonLoading) return <div className="loading-panel" role="status"><span className="loader" />수업을 펼치고 있어요…</div>;
    if (!document) return <EmptyState title="수업을 열 수 없어요" text="수업 목록으로 돌아가 다시 열어 주세요." actionLabel="수업 목록" onAction={() => navigate('lessons')} />;
    if (finishedLesson) return <div className="completion-panel"><span className="completion-mark"><Icon name="check" size={38} /></span><div className="eyebrow">ONE MORE STEP FORWARD</div><h1>오늘의 이해가 하나 더 쌓였어요.</h1><p>「{document.title}」 수업을 완료했어요.<br />배운 내용을 내 것으로 만드는 복습 과제도 확인해 보세요.</p><div className="completion-actions"><button className="button primary" onClick={() => navigate('practice')}>복습 과제 확인<Icon name="arrow" size={18} /></button><button className="button secondary" onClick={() => navigate('home')}>내 학습으로</button></div><div className="completion-bottom">잘 모르겠는 부분은 언제든 다시 펼쳐보세요.</div></div>;
    const section = document.sections[sectionIndex];
    if (!section) return <EmptyState title="수업 내용을 준비하고 있어요" text="아직 공개된 학습 단계가 없어요." />;
    const unsupported = unsupportedRequiredBlocks(section.contentBlocks, document.problems) || document.problems.some((problem) => unsupportedRequiredBlocks(problem.promptContent));
    const isLast = sectionIndex === document.sections.length - 1;
    // Answering belongs to the enrolment. Without one the card offers to start rather than to answer.
    const enrolled = currentEnrollment?.id ?? '';
    const lessonActions = (problemVersionId: string): ProblemActions => ({
      submit: (answer, requestId) => dispatch({ action: 'attempt.submit', context: 'lesson', contextId: enrolled, problemVersionId, answer, requestId }).then(() => undefined),
      openHint: () => dispatch({ action: 'hint.open', context: 'lesson', contextId: enrolled, problemVersionId }).then((response) => response.hint ?? []),
    });
    // The server already withheld the concepts this lesson teaches; readiness only sets how loudly
    // the remaining terms offer help.
    const glossary: GlossaryContext = { entries: document.glossary, reviewSkillKeys, currentLessonKey: document.lessonKey, onOpenLesson: (key) => void openLesson(key) };
    return <><button className="back-button" onClick={() => navigate('lessons')}><Icon name="back" size={17} />수업 목록</button><div className="lesson-header"><div><div className="eyebrow">기초 수학 · {document.estimatedMinutes}분 수업</div><h1>{document.title}</h1></div><span className={`pill ${currentEnrollment?.status === 'completed' ? 'green' : ''}`}>{currentEnrollment?.status === 'completed' ? '학습 완료' : currentEnrollment ? '학습 중' : '수업 미리보기'}</span></div>{!currentEnrollment && <div className="preview-banner"><div><strong>설명은 먼저 둘러볼 수 있어요.</strong><p>수업을 시작하면 문제를 풀고 진도를 저장할 수 있어요.</p></div><button className="button primary" disabled={busy} onClick={() => void startLesson()}>{state ? '이 수업 시작하기' : '내 학습 시작하기'}<Icon name="arrow" size={16} /></button></div>}{state && <div className="session-guidance"><strong>오늘은 {state.user.dailyMinutes}분씩, 나의 속도로.</strong><p>한 단계가 끝나면 쉬어도 괜찮아요. 다음 방문에 저장된 단계부터 이어가며 설명과 문제는 모두 남아 있어요.</p></div>}<div className="lesson-layout"><aside className="lesson-outline" aria-label="수업 학습 단계"><span className="eyebrow">LEARNING STEPS</span>{document.sections.map((item, index) => <button key={item.sectionId} className={index === sectionIndex ? 'active' : ''} aria-current={index === sectionIndex ? 'step' : undefined} disabled={busy} onClick={() => setSectionIndex(index)}><span className={currentEnrollment?.completedSectionIds.includes(item.sectionId) ? 'done' : ''}>{currentEnrollment?.completedSectionIds.includes(item.sectionId) ? <Icon name="check" size={13} /> : index + 1}</span><span><small>{roleLabels[item.role]}</small>{item.title}</span></button>)}<p>헷갈리면 앞 단계로 돌아가도 괜찮아요.</p></aside><div className="lesson-work"><article className="lesson-sheet"><div className="lesson-step-label">{String(sectionIndex + 1).padStart(2, '0')}<i />{roleLabels[section.role]}</div><h2>{section.title}</h2><ContentBlocks blocks={section.contentBlocks} problems={document.problems} glossary={glossary} renderProblem={(problem) => <ProblemCard key={`${currentEnrollment?.id ?? 'preview'}-${problem.problemVersionId}`} glossary={glossary} problem={problem} attempt={currentEnrollment?.attempts.filter((item) => item.problemVersionId === problem.problemVersionId).at(-1)} actions={lessonActions(problem.problemVersionId)} ready={!!currentEnrollment} busy={busy} disabled={currentEnrollment?.status === 'completed' || currentEnrollment?.completedSectionIds.includes(section.sectionId) || !!(currentEnrollment && document.sections.slice(0, sectionIndex).some((item) => !currentEnrollment.completedSectionIds.includes(item.sectionId)))} onReady={() => currentEnrollment ? setModal('login') : void startLesson()} readyNote="수업을 시작하면 풀이와 진도가 저장돼요." />} /></article>{unsupported && <div className="error-banner" role="alert">필수 콘텐츠를 표시할 수 없어 단계 완료를 멈췄어요. 지원되는 앱 버전에서 다시 열어 주세요.</div>}<div className="lesson-controls"><button className="button secondary" disabled={sectionIndex === 0 || busy} onClick={() => setSectionIndex((value) => value - 1)}><Icon name="back" size={17} />이전</button><span>{sectionIndex + 1} / {document.sections.length}</span>{!currentEnrollment && isLast ? <button className="button primary" disabled={busy || unsupported} onClick={() => void startLesson()}>수업 시작하기<Icon name="arrow" size={17} /></button> : <button className="button primary" disabled={busy || unsupported} onClick={() => void nextSection()}>{busy ? '저장 중…' : isLast ? currentEnrollment?.status === 'completed' ? '내 학습으로' : '수업 완료하기' : currentEnrollment?.status === 'active' ? '이해했어요, 다음으로' : '다음 단계'}<Icon name="arrow" size={17} /></button>}</div></div></div></>;
  }

  function renderAssignment() {
    if (!assignment) return <EmptyState title="과제를 찾을 수 없어요" text="학습 공간에 로그인한 뒤 나에게 배정된 과제를 열어 주세요." actionLabel="연습장으로" onAction={() => navigate('practice')} />;
    const submitted = assignment.status === 'submitted';
    const answered = assignment.items.filter((item) => item.attempt && item.attempt.result.status !== 'invalid').length;
    const unsupported = assignment.items.some((item) => unsupportedRequiredBlocks(item.problem.promptContent));
    const recipient = assignment.recipientId ?? '';
    const assignmentActions = (problemVersionId: string): ProblemActions => ({
      submit: (answer, requestId) => dispatch({ action: 'attempt.submit', context: 'assignment', contextId: recipient, problemVersionId, answer, requestId }).then(() => undefined),
      openHint: () => dispatch({ action: 'hint.open', context: 'assignment', contextId: recipient, problemVersionId }).then((response) => response.hint ?? []),
    });
    return <><button className="back-button" onClick={() => navigate('practice')}><Icon name="back" size={17} />연습장으로</button><div className="page-heading"><div className="eyebrow">MAKE WHAT YOU LEARNED YOURS</div><h1>{assignment.title}</h1><p>{formatDate(assignment.recommendedAt)} 권장 · {assignment.items.length}문제 · {assignment.policy === 'fixed' ? '지정된 내용으로 푸는 과제' : '나의 학습과 연결된 복습'}</p></div><div className={`assignment-instruction ${submitted ? 'is-submitted' : ''}`}><Icon name={submitted ? 'check' : 'pencil'} size={23} /><div><strong>{submitted ? '과제 제출을 완료했어요.' : '문제마다 답안을 저장하고, 마지막에 제출해 주세요.'}</strong><p>{submitted ? '제출한 답안과 풀이 결과를 아래에서 다시 확인할 수 있어요.' : '완벽하게 풀지 못해도 괜찮아요. 막히면 힌트를 확인하고 다시 생각해 보세요.'}</p></div><span>{submitted ? '제출 완료' : `${answered} / ${assignment.items.length} 저장`}</span></div>{assignment.reason && <p className="session-guidance">{assignment.reason}</p>}<div className="assignment-problems">{assignment.items.map((item, index) => <section key={item.id}><div className="assignment-number">문제 {String(index + 1).padStart(2, '0')}</div><ProblemCard problem={item.problem} attempt={item.attempt} actions={assignmentActions(item.problem.problemVersionId)} ready={!!assignment.recipientId} submitLabel="답안 저장" glossary={{ entries: assignment.glossary, reviewSkillKeys, onOpenLesson: (key) => void openLesson(key) }} busy={busy} disabled={submitted} onReady={() => setModal('login')} readyNote="수업을 시작하면 풀이와 진도가 저장돼요." onDraftChange={(id, dirty) => setDirtyProblems((previous) => dirty ? previous.includes(id) ? previous : [...previous, id] : previous.filter((item) => item !== id))} /></section>)}</div>{!submitted && <div className="assignment-submit"><div><strong>연습을 마무리해 볼까요?</strong><p>{dirtyProblems.length ? `아직 저장하지 않은 답안이 ${dirtyProblems.length}개 있어요. 먼저 답안을 저장해 주세요.` : '모든 문제의 답안을 저장하면 제출할 수 있어요.'}</p></div><button className="button primary" disabled={busy || unsupported || dirtyProblems.length > 0 || answered !== assignment.items.length || !assignment.items.length} onClick={() => void submitAssignment()}>{busy ? '제출 중…' : '과제 제출하기'}<Icon name="check" size={18} /></button></div>}</>;
  }

  return <div className="app-shell"><a href="#main-content" className="skip-link">본문으로 이동</a><aside className="sidebar"><button className="brand-button" aria-label="geunyang math 홈" onClick={() => navigate('home')}><Brand /></button><div className="sidebar-caption">그냥, 나의 속도로.</div><nav aria-label="주 메뉴">{navItems.map((item) => <button key={item.page} className={activeNav === item.page ? 'nav-item active' : 'nav-item'} aria-current={activeNav === item.page ? 'page' : undefined} onClick={() => navigate(item.page)}><Icon name={item.icon} size={19} /><span>{item.label}</span>{item.page === 'practice' && pendingAssignments.length > 0 && <span className="nav-badge">{pendingAssignments.length}</span>}</button>)}</nav><div className="sidebar-bottom"><button className="learning-goal" onClick={openProfile}><span className="goal-overline"><Icon name="spark" size={14} />나의 작은 목표</span><strong>{goalLabels[state?.user.goal ?? 'foundation-recovery']}</strong><span>하루 {state?.user.dailyMinutes ?? 10}분, 꾸준히<Icon name="chevron" size={14} /></span><div className="goal-line"><i /><i /><i /><i /><i /><i /><i /></div></button><div className="sidebar-signature">수학을 이해하는 즐거움<span>geunyang math © 2026</span></div></div></aside><div className="workspace"><header className="topbar"><div className="mobile-brand"><button className="brand-button" onClick={() => navigate('home')} aria-label="홈으로"><Brand /></button></div><div className="breadcrumb"><span>나의 학습 공간</span><Icon name="chevron" size={13} /><strong>{navItems.find((item) => item.page === activeNav)?.label}</strong></div><div className="account-controls">{session?.developmentLogin && <span className="dev-label">개발 미리보기</span>}{state ? <><button className="account-button" onClick={openProfile}><span className="avatar">{state.user.displayName.slice(0, 1)}</span><span>{state.user.displayName}</span></button><button className="icon-button logout" onClick={() => void logout()} disabled={busy || loading} aria-label="로그아웃" title="로그아웃"><Icon name="logout" size={17} /></button></> : <button className="login-link" onClick={() => setModal('login')} disabled={loading}>내 학습 시작<Icon name="arrow" size={15} /></button>}</div></header><nav className="mobile-nav" aria-label="모바일 주 메뉴">{navItems.map((item) => <button key={item.page} className={activeNav === item.page ? 'active' : ''} aria-current={activeNav === item.page ? 'page' : undefined} onClick={() => navigate(item.page)}><Icon name={item.icon} size={18} />{item.label}</button>)}</nav><main id="main-content" className={`main-content page-${page}`} tabIndex={-1}>{authError && <div className="auth-error-banner" role="alert"><Icon name="lightbulb" size={18} /><span>{authError}</span><button className="text-button" disabled={loading || busy} onClick={() => setModal('login')}>로그인 다시 하기</button><button className="icon-button" aria-label="로그인 안내 닫기" onClick={() => setAuthError('')}><Icon name="close" size={16} /></button></div>}{error && <div className="error-banner" role="alert"><span>{error}</span><button className="text-button" disabled={busy || loading} onClick={() => void refresh()}>다시 불러오기</button><button className="icon-button" aria-label="오류 알림 닫기" onClick={() => setError('')}><Icon name="close" size={16} /></button></div>}{notice && <div className="notice-banner" role="status"><Icon name="check" size={18} /><span>{notice}</span><button className="icon-button" aria-label="알림 닫기" onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}{loading ? <div className="loading-panel" role="status"><span className="loader" />나의 학습 공간을 준비하고 있어요…</div> : page === 'home' ? renderHome() : page === 'lessons' ? renderLessons() : page === 'practice' ? renderPractice() : page === 'history' ? renderHistory() : page === 'lesson' ? renderLesson() : page === 'diagnostic' ? state ? <DiagnosticPanel key={`${state.user.id}:${state.diagnostic?.currentProblem?.problemVersionId ?? state.diagnostic?.status ?? 'new'}`} diagnostic={state.diagnostic} offering={state.diagnosticOffering} dispatch={dispatch} busy={busy} onBack={() => navigate('home')} /> : null : renderAssignment()}</main><ServiceFooter /></div>{modal && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !busy) setModal(null); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={modalRef}><button className="icon-button modal-close" aria-label="닫기" disabled={busy} onClick={() => setModal(null)}><Icon name="close" /></button>{modal === 'login' ? <>
        <span className="modal-symbol"><Icon name="book" size={27} /></span>
        <div className="eyebrow">YOUR OWN LITTLE LEARNING SPACE</div>
        <h2 id="modal-title">나의 속도로 시작해 볼까요?</h2>
        <p>{!webAuthentication
          ? '앱에서의 계정 연결은 준비 중이에요. 지금은 웹브라우저에서 Google 로그인으로 학습을 이어갈 수 있어요.'
          : session?.googleLogin
            ? 'Google 계정으로 시작하면 나만의 학습 공간이 생겨요. 언제 다시 와도 진도와 풀이 기록을 이어갈 수 있어요.'
            : session?.developmentLogin
              ? '개발용 학습 공간에서 수업, 풀이, 과제 흐름을 체험할 수 있어요.'
              : 'Google 로그인을 준비하고 있어요. 그동안 수업 설명을 먼저 둘러보세요.'}</p>
        {authError && <p role="alert" className="field-error">{authError}</p>}
        {error && <p role="alert" className="field-error">{error}</p>}
        {webAuthentication && session?.googleLogin && <>
          <GoogleLoginButton pending={googleStarting} disabled={busy || loading} onClick={beginGoogleLogin} />
          <p className="google-login-note">같은 Google 계정으로 다시 로그인하면 학습을 이어갈 수 있어요.</p>
        </>}
        {webAuthentication && session?.developmentLogin && <form onSubmit={login}>
          {session.googleLogin && <div className="login-divider"><span>개발 환경에서만</span></div>}
          <label className="form-label">어떻게 불러드릴까요?<input type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="학습자" maxLength={30} disabled={busy || googleStarting} autoComplete="nickname" /></label>
          <div className="dev-login-note"><strong>개발용 로그인</strong><span>Google 계정과 별개의 개발용 계정이에요. 이 브라우저의 임시 세션으로 저장되며, 로그아웃하면 새 학습 공간이 만들어질 수 있어요.</span></div>
          <button className="button secondary full-width" type="submit" disabled={busy || googleStarting}>{busy ? '학습 공간 준비 중…' : '개발용 학습 시작하기'}<Icon name="arrow" size={17} /></button>
        </form>}
        <p className="login-privacy-note">계정과 학습 기록을 사용하는 방법은 <Link href="/privacy/" target="_blank" rel="noopener noreferrer">개인정보 안내<span className="sr-only"> (새 창)</span></Link>에서 확인할 수 있어요.</p>
        <button className="text-button login-browse" disabled={busy || googleStarting} onClick={() => { setModal(null); navigate('lessons'); }}>수업 먼저 둘러보기<Icon name="arrow" size={16} /></button>
      </> : <><span className="modal-symbol"><Icon name="spark" size={27} /></span><div className="eyebrow">SMALL STEPS, YOUR PACE</div><h2 id="modal-title">나에게 맞는 작은 목표.</h2><p>배우고 싶은 이유와 하루에 함께할 시간을 정해 보세요.</p><form onSubmit={saveProfile}><label className="form-label">무엇을 위해 배우고 싶나요?<select value={goal} onChange={(event) => setGoal(event.target.value as Goal)} disabled={busy}>{Object.entries(goalLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="form-label">하루에 얼마나 함께할까요?<select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} disabled={busy}>{[5, 10, 20].map((value) => <option key={value} value={value}>{value}분</option>)}</select></label>{error && <p role="alert" className="field-error">{error}</p>}<button className="button primary full-width" type="submit" disabled={busy}>{busy ? '저장 중…' : '나의 목표 저장하기'}<Icon name="check" size={17} /></button></form><button className="text-button profile-logout" disabled={busy || loading} onClick={() => void logout()}><Icon name="logout" size={16} />이 기기에서 로그아웃</button></>}</div></div>}</div>;
}

function EmptyState({ title, text, actionLabel, onAction }: { title: string; text: string; actionLabel?: string; onAction?: () => void }) {
  return <div className="empty-state"><span className="empty-drawing"><Icon name="book" size={29} /></span><h2>{title}</h2><p>{text}</p>{actionLabel && <button className="button secondary" onClick={onAction}>{actionLabel}<Icon name="arrow" size={17} /></button>}</div>;
}
