'use client';

import { useState } from 'react';
import { draftStatusLabels, lessonKeyPattern, mayPublish, moveBlock, versionLabel,
  type AuthoringAction, type AuthoringWorkspace, type DraftSummary } from '@/shared/authoring';
import { Icon } from '@/features/learning/icons';
import { ConceptPicker } from './problem-editor';

const newKey = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function CourseLibrary({ workspace, busy, courseKey, onCourse, onOpen, onAction }: {
  workspace: AuthoringWorkspace; busy: boolean; courseKey: string | null; onCourse: (key: string | null) => void;
  onOpen: (draft: DraftSummary) => void; onAction: (action: AuthoringAction) => Promise<boolean>;
}) {
  const [query, setQuery] = useState('');
  const [newLesson, setNewLesson] = useState<{ key: string; title: string; conceptKeys: string[] } | null>(null);
  const [courseForm, setCourseForm] = useState<{ key: string; title: string; summary: string; creating: boolean } | null>(null);
  const [conceptName, setConceptName] = useState('');
  const course = workspace.courses.find((item) => item.key === courseKey);
  const lessons = workspace.lessons.filter((item) => item.courseKey === courseKey);
  const editor = workspace.expertMode;
  const admin = mayPublish(workspace.role);
  const found = (title: string) => title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const changeCourse = (key: string | null) => { onCourse(key); setQuery(''); setNewLesson(null); setCourseForm(null); };
  const openDraft = (draft: DraftSummary) => {
    onCourse(workspace.lessons.find((item) => item.lessonKey === draft.lessonKey)?.courseKey ?? null);
    onOpen(draft);
  };
  const drafts = workspace.drafts.filter((item) => item.status !== 'published' && (!course || lessons.some((lesson) => lesson.lessonKey === item.lessonKey)))
    .sort((a, b) => Number(b.status === 'review') - Number(a.status === 'review'));

  return <>
    {course && <button className="back-button" onClick={() => changeCourse(null)}><Icon name="back" size={16} />모든 코스</button>}
    <div className="section-heading studio-heading">
      <div><span className="eyebrow">{course ? '코스의 수업' : '수업 준비'}</span><h2>{course?.title ?? '어떤 코스를 준비할까요?'}</h2>
        <p className="editor-note">{course?.summary || (course ? '수업을 순서대로 준비하고, 초안을 검토해 발행하세요.' : '코스 안에서 수업을 만들고, 작성 중인 내용을 이어가세요.')}</p></div>
      <div className="editor-actions">{course ? <>
        {admin && <button className="button secondary" disabled={busy} onClick={() => setCourseForm({ ...course, creating: false })}>코스 정보</button>}
        <button className="button primary" disabled={busy} onClick={() => setNewLesson({ key: newKey('lesson'), title: '', conceptKeys: [] })}><Icon name="plus" size={16} />수업 추가</button>
      </> : admin && <button className="button primary" disabled={busy} onClick={() => setCourseForm({ key: newKey('course'), title: '', summary: '', creating: true })}><Icon name="plus" size={16} />코스 만들기</button>}</div>
    </div>

    {courseForm && <form className="editor-panel studio-form" onSubmit={async (event) => {
      event.preventDefault(); if (await onAction({ action: 'course.save', ...courseForm })) setCourseForm(null);
    }}><h3>{courseForm.creating ? '새 코스' : '코스 정보'}</h3>
      <label className="editor-field"><span className="editor-label">코스 이름</span><input required maxLength={191} value={courseForm.title} onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })} /></label>
      <label className="editor-field"><span className="editor-label">소개</span><textarea maxLength={500} value={courseForm.summary} onChange={(e) => setCourseForm({ ...courseForm, summary: e.target.value })} /></label>
      {editor && <label className="editor-field"><span className="editor-label">코스 키</span><input disabled={!courseForm.creating} value={courseForm.key} onChange={(e) => setCourseForm({ ...courseForm, key: e.target.value })} /></label>}
      <p className="editor-note">코스 정보는 저장하면 학습자의 수업 목록에 바로 반영돼요. 수업 내용은 별도로 발행합니다.</p>
      <div className="editor-actions"><button className="button primary" disabled={busy || !courseForm.title.trim() || (courseForm.creating && !lessonKeyPattern.test(courseForm.key))}>저장</button><button type="button" className="text-button" disabled={busy} onClick={() => setCourseForm(null)}>취소</button></div>
    </form>}

    {newLesson && course && <form className="editor-panel studio-form" onSubmit={async (event) => {
      event.preventDefault(); await onAction({ action: 'lesson.create', courseKey: course.key, lessonKey: newLesson.key, title: newLesson.title.trim(), conceptKeys: newLesson.conceptKeys });
    }}><h3>{course.title}에 수업 추가</h3><p className="editor-note">설명과 연습, 두 단계로 시작해요. 내용은 저장되지만 발행하기 전에는 학습자에게 보이지 않아요.</p>
      <label className="editor-field"><span className="editor-label">수업 이름</span><input required maxLength={191} placeholder="예: 소수, 자리와 크기" value={newLesson.title} onChange={(e) => setNewLesson({ ...newLesson, title: e.target.value })} /></label>
      {editor && <label className="editor-field"><span className="editor-label">수업 키</span><input value={newLesson.key} onChange={(e) => setNewLesson({ ...newLesson, key: e.target.value })} /><small>영문 소문자·숫자·하이픈으로 두 글자 이상 적어요. 자동으로 만든 키를 그대로 써도 됩니다.</small></label>}
      <ConceptPicker concepts={workspace.concepts.filter((item) => item.assessable)} chosen={newLesson.conceptKeys} label="이 수업에서 배우는 개념" onChange={(conceptKeys) => setNewLesson({ ...newLesson, conceptKeys })} />
      {admin && <details className="studio-new-concept"><summary>목록에 없는 개념 추가</summary><p className="editor-note">기존 개념을 먼저 검색해 주세요. 새 개념은 모든 코스에서 사용할 수 있고, 문제로 평가할 수 있어요.</p>
        <label className="editor-field"><span className="editor-label">새 개념 이름</span><input maxLength={191} value={conceptName} onChange={(e) => setConceptName(e.target.value)} /></label>
        <button type="button" className="button secondary" disabled={busy || !conceptName.trim()} onClick={async () => {
          const key = newKey('concept'); if (!(await onAction({ action: 'concept.create', key, label: conceptName.trim() }))) return;
          setNewLesson((value) => value ? { ...value, conceptKeys: [...value.conceptKeys, key] } : value); setConceptName('');
        }}>개념 추가하고 선택</button>
      </details>}
      <div className="editor-actions"><button className="button primary" disabled={busy || !newLesson.title.trim() || !newLesson.conceptKeys.length || !lessonKeyPattern.test(newLesson.key)}>수업 만들기</button><button type="button" className="text-button" disabled={busy} onClick={() => setNewLesson(null)}>취소</button></div>
    </form>}

    {!course && <div className="studio-courses">{workspace.courses.map((item) => {
      const held = workspace.lessons.filter((lesson) => lesson.courseKey === item.key);
      return <button className="studio-course" key={item.key} onClick={() => changeCourse(item.key)}>
        <span className="eyebrow">{held.length}개 수업 · {held.filter((lesson) => lesson.hasDraft).length}개 작성 중</span>
        <h3>{item.title}</h3><p>{item.summary || '수업을 추가하고 학습 순서를 준비하세요.'}</p><span className="text-button">수업 관리<Icon name="arrow" size={16} /></span>
      </button>;
    })}</div>}
    {!course && !workspace.courses.length && <p className="empty-inline">아직 코스가 없어요.{admin ? ' 첫 코스를 만들어 주세요.' : '관리자가 코스를 만들면 수업을 추가할 수 있어요.'}</p>}

    {course && <section className="dashboard-section"><div className="section-heading"><h3>수업 순서 <span className="count-label">{lessons.length}</span></h3>
      <label className="editor-field draft-search"><span className="editor-label">수업 찾기</span><input value={query} placeholder="수업 제목" onChange={(e) => setQuery(e.target.value)} /></label></div>
      {admin && lessons.length > 1 && <p className="editor-note">화살표로 바꾸면 학습자의 수업 목록에도 바로 반영돼요.</p>}
      <div className="studio-lessons">{lessons.map((lesson, index) => {
        if (!found(lesson.title)) return null;
        const open = workspace.drafts.filter((draft) => draft.lessonKey === lesson.lessonKey && draft.status !== 'published');
        return <article className="studio-lesson" key={lesson.lessonKey}><span className="studio-order">{String(index + 1).padStart(2, '0')}</span>
          <div className="assignment-info"><h3>{lesson.title}</h3><small>{lesson.latestVersionId ? `${versionLabel(lesson.latestVersionId)} 발행됨` : '아직 발행하지 않았어요'}{editor ? ` · ${lesson.lessonKey}` : ''}</small>
            {open.map((draft) => <button key={draft.id} className="studio-draft-link" disabled={busy} onClick={() => openDraft(draft)}><span className={`pill${draft.status === 'review' ? ' green' : ''}`}>{draftStatusLabels[draft.status]}</span>{draft.title} · {draft.authorName}<Icon name="arrow" size={14} /></button>)}
          </div><div className="editor-actions">
            {!open.length && lesson.latestVersionId && <button className="button secondary" disabled={busy} onClick={() => void onAction({ action: 'draft.create', lessonKey: lesson.lessonKey })}>수정 시작</button>}
            {admin && lessons.length > 1 && <div className="studio-order-actions"><button className="icon-button" disabled={busy || index === 0 || !!query} aria-label={`${lesson.title} 위로`} onClick={() => void onAction({ action: 'course.reorder', courseKey: course.key, lessonKeys: moveBlock(lessons, index, -1).map((item) => item.lessonKey) })}>↑</button><button className="icon-button" disabled={busy || index === lessons.length - 1 || !!query} aria-label={`${lesson.title} 아래로`} onClick={() => void onAction({ action: 'course.reorder', courseKey: course.key, lessonKeys: moveBlock(lessons, index, 1).map((item) => item.lessonKey) })}>↓</button></div>}
          </div></article>;
      })}</div>
      {!lessons.some((lesson) => found(lesson.title)) && <p className="empty-inline">{query ? '찾은 수업이 없어요.' : '첫 수업을 추가해 보세요.'}</p>}
    </section>}

    {!course && <section className="dashboard-section"><div className="section-heading"><h3>검토와 이어 쓰기</h3><span className="editor-note">검토 요청 먼저 · 최근 수정 순</span></div>
      {drafts.length ? <div className="assignment-list">{drafts.slice(0, 8).map((item) => <button key={item.id} className="assignment-row" disabled={busy} onClick={() => openDraft(item)}><span className="assignment-icon"><Icon name="pencil" size={18} /></span><span className="assignment-info"><strong>{item.title}</strong><small>{workspace.courses.find((course) => workspace.lessons.some((lesson) => lesson.lessonKey === item.lessonKey && lesson.courseKey === course.key))?.title} · {item.authorName} · {new Date(item.updatedAt).toLocaleDateString('ko-KR')}</small></span><span className="pill">{draftStatusLabels[item.status]}</span><Icon name="chevron" size={16} /></button>)}</div> : <p className="empty-inline">작성 중인 초안이 없어요. 코스에서 새 수업을 만들거나 발행한 수업을 수정해 보세요.</p>}
    </section>}
  </>;
}
