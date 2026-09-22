import { describe, expect, it } from 'vitest';
import { placeSearch, readPlace, sameWork } from '@/features/learning/app-url';

/**
 * The address a learner can reload, walk back through and send to somebody. It holds a place and
 * nothing else — never an answer, never who is reading — so the worst a stale one can do is name
 * something that is no longer there, and the screen checks every name before it opens anything.
 */
describe('where the learner is standing', () => {
  it('writes a place and reads the same one back', () => {
    for (const place of [
      { page: 'home' as const },
      { page: 'lessons' as const },
      { page: 'practice' as const },
      { page: 'history' as const },
      { page: 'diagnostic' as const },
      { page: 'lesson' as const, lessonKey: 'fraction-meaning', step: 1 },
      { page: 'lesson' as const, lessonKey: 'fraction-meaning', step: 3 },
      { page: 'assignment' as const, recipientId: 'r-1' },
    ]) {
      const read = readPlace(placeSearch(place));
      expect({ step: 1, ...read }, placeSearch(place)).toEqual({ step: 1, ...place });
    }
  });

  it('says nothing for 내 학습, because that is where the bare address lands', () => {
    expect(placeSearch({ page: 'home' })).toBe('');
    expect(readPlace('')).toEqual({ page: 'home' });
  });

  it('leaves the first step of a lesson unsaid', () => {
    expect(placeSearch({ page: 'lesson', lessonKey: 'fraction-meaning', step: 1 })).toBe('?lesson=fraction-meaning');
    expect(placeSearch({ page: 'lesson', lessonKey: 'fraction-meaning', step: 2 })).toBe('?lesson=fraction-meaning&step=2');
  });

  it('keeps the name the shared links already use', () => {
    // `?lesson=` is older than this and is the link people have; reading it must not change.
    expect(readPlace('?lesson=fraction-meaning')).toEqual({ page: 'lesson', lessonKey: 'fraction-meaning' });
  });

  it('falls back to 내 학습 rather than believing the address', () => {
    for (const search of ['?page=nowhere', '?page=', '?somethingelse=1', '?page=lesson', '?page=assignment']) {
      expect(readPlace(search), search).toEqual({ page: 'home' });
    }
    // A step that is not a step is no step at all, and the lesson opens where it would anyway.
    for (const step of ['0', '-2', 'abc', '1.5', '']) {
      expect(readPlace(`?lesson=fraction-meaning&step=${step}`), step).toEqual({ page: 'lesson', lessonKey: 'fraction-meaning' });
    }
  });

  it('holds a place with nothing to name to the screen it is on', () => {
    // A lesson still being fetched has no key yet; it is not an address, and is not written as one.
    expect(placeSearch({ page: 'lesson' })).toBe('');
    expect(placeSearch({ page: 'assignment' })).toBe('');
  });

  it('tells moving within one piece of work from going somewhere', () => {
    const lesson = { page: 'lesson' as const, lessonKey: 'fraction-meaning' };
    expect(sameWork({ ...lesson, step: 1 }, { ...lesson, step: 4 })).toBe(true);
    expect(sameWork(lesson, { page: 'lesson', lessonKey: 'decimal-meaning' })).toBe(false);
    expect(sameWork({ page: 'practice' }, { page: 'practice' })).toBe(true);
    expect(sameWork({ page: 'practice' }, { page: 'history' })).toBe(false);
    expect(sameWork({ page: 'assignment', recipientId: 'r-1' }, { page: 'assignment', recipientId: 'r-2' })).toBe(false);
  });
});
