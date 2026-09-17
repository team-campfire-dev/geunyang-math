import { describe, expect, it } from 'vitest';
import { displayedAnswer, invalidAnswers, unfinishedIssues, lessonMatches } from '@/shared/authoring-checks';
import { newProblem, type DraftEdit, type DraftSummary, type LessonChoice } from '@/shared/authoring';

const edit = (): DraftEdit => ({ meta: {versionId:'lesson:v1',title:'정수',summary:'음수와 양수',estimatedMinutes:10,conceptKeys:['integers']},
  sections:[{sectionId:'s1',role:'explanation',title:'수직선',contentBlocks:[]}], problems:[newProblem('p1',['integers']),newProblem('p2',['integers'])] });
describe('authoring state transitions', () => {
  it('does not reuse another question’s answer or an answer from before undo', () => {
    const inputs = {p2:{text:'7',spec:JSON.stringify({kind:'integer',value:7})}};
    expect(displayedAnswer({kind:'integer',value:3}, inputs.p2)).toBe('3');
    expect(displayedAnswer({kind:'integer',value:7}, inputs.p2)).toBe('7');
    expect(displayedAnswer({kind:'integer',value:3})).toBe('3');
  });
  it('keeps invalid input blocking even when its question is not selected', () => {
    const doc=edit();
    expect(invalidAnswers(doc,{p1:{text:'abc',spec:JSON.stringify(doc.problems[0].gradingSpec)}}).map(p=>p.problemVersionId)).toEqual(['p1']);
  });
  it('anchors unfinished copy in prompts and metadata instead of approving starter content', () => {
    const doc=edit(); doc.meta.summary='한 줄 소개를 적어 주세요.';
    expect(unfinishedIssues(doc)).toEqual(expect.arrayContaining([expect.objectContaining({field:'summary'}),expect.objectContaining({problemVersionId:'p1',blockId:'p1:prompt'})]));
  });
  it('finds the visible draft title alongside the older published title', () => {
    const lesson={lessonKey:'a',title:'이전 제목'} as LessonChoice;
    const drafts=[{lessonKey:'a',title:'바뀐 초안',status:'draft'}] as DraftSummary[];
    expect(lessonMatches(lesson,drafts,'바뀐')).toBe(true);
    expect(lessonMatches(lesson,drafts,'없는 제목')).toBe(false);
  });
});
