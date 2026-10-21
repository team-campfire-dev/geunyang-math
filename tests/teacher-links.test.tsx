// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
import { TeacherLinks, assignedLabel } from '@/features/learning/teacher-links';
import type { PublicCourse } from '@/shared/api';
import type { LearnerTeaching } from '@/shared/teaching';

const courses: PublicCourse[] = [
  { key: 'similarity', title: '도형의 닮음', summary: '', track: 'middle', stage: 'middle-2' },
  { key: 'probability', title: '경우의 수와 확률', summary: '', track: 'middle', stage: 'middle-2' },
];
const alone: LearnerTeaching = { teachers: [], assignedCourses: [] };
const taught: LearnerTeaching = {
  teachers: [{ linkId: 'link', kind: 'person', name: '김선생', since: '2026-10-21T00:00:00.000Z' }],
  assignedCourses: [
    { courseKey: 'similarity', setBy: { kind: 'person', name: '김선생' }, assignedAt: '2026-10-21T00:00:00.000Z' },
    // Kept from this learner since it was set: nowhere they can go, so not listed.
    { courseKey: 'kept', setBy: { kind: 'operator' }, assignedAt: '2026-10-21T00:00:00.000Z' },
  ],
};
const links = (teaching: LearnerTeaching, over: Partial<Parameters<typeof TeacherLinks>[0]> = {}) => {
  const onJoin = vi.fn(async () => true), onLeave = vi.fn(async () => true);
  render(<TeacherLinks teaching={teaching} courses={courses} busy={false} onJoin={onJoin} onLeave={onLeave} {...over} />);
  return { onJoin, onLeave };
};

describe('who teaches a learner, in their own settings', () => {
  it('says first that nobody has to, and links only once a whole code is typed', async () => {
    const { onJoin } = links(alone);
    expect(screen.getByText(/혼자서도 모든 공개 과정을 배울 수 있어요/)).toBeTruthy();
    const button = screen.getByRole('button', { name: /연결하기/ }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText('초대 코드'), { target: { value: 'abcd-23' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('초대 코드'), { target: { value: 'abcd-2345' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(onJoin).toHaveBeenCalledWith('abcd-2345'));
    await waitFor(() => expect((screen.getByLabelText('초대 코드') as HTMLInputElement).value).toBe(''));
  });

  it('lists what was set and who set it, and asks before ending a link', async () => {
    const { onLeave } = links(taught);
    expect(screen.getByText('도형의 닮음')).toBeTruthy();
    expect(screen.queryByText('kept')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '연결 끊기' }));
    expect(screen.getByText(/정해 준 과정도 함께 빠져요/)).toBeTruthy();
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '끊기' }));
    await waitFor(() => expect(onLeave).toHaveBeenCalledWith('link'));
  });

  it('names a set course by who set it', () => {
    expect(assignedLabel({ kind: 'person', name: '김선생' })).toBe('김선생님이 정한 과정');
    expect(assignedLabel({ kind: 'person', name: '김민재 선생님' })).toBe('김민재 선생님이 정한 과정');
    expect(assignedLabel({ kind: 'ai' })).toBe('AI 선생님이 정한 과정');
    expect(assignedLabel({ kind: 'operator' })).toBe('정해진 과정');
  });
});
