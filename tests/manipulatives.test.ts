import { describe, expect, it } from 'vitest';
import { builderStatus, createSlots, nextFrameIndex, placedCount, setSlot, stepFrameIndex } from '@/shared/manipulatives';

describe('strip animation playback', () => {
  it('stops on the last frame and reports the stop by returning the same index', () => {
    expect(nextFrameIndex(0, 3, false)).toBe(1);
    expect(nextFrameIndex(2, 3, false)).toBe(2);
  });
  it('returns to the first frame only when the author asked for a loop', () => {
    expect(nextFrameIndex(2, 3, true)).toBe(0);
    expect(nextFrameIndex(0, 1, true)).toBe(0);
  });
  it('clamps manual stepping at both ends instead of wrapping', () => {
    expect(stepFrameIndex(0, 4, -1)).toBe(0);
    expect(stepFrameIndex(3, 4, 1)).toBe(3);
    expect(stepFrameIndex(1, 4, 1)).toBe(2);
    expect(stepFrameIndex(0, 0, 1)).toBe(0);
  });
});

describe('pieces placed in a strip', () => {
  it('starts with the pieces the author left on the board', () => {
    expect(createSlots(4, 0)).toEqual([false, false, false, false]);
    expect(createSlots(4, 2)).toEqual([true, true, false, false]);
    expect(placedCount(createSlots(6, 3))).toBe(3);
  });
  it('places and removes one slot at a time without touching the rest', () => {
    const slots = createSlots(3, 0);
    expect(setSlot(slots, 1, true)).toEqual([false, true, false]);
    expect(slots).toEqual([false, false, false]);
    expect(setSlot([true, true, false], 0, false)).toEqual([false, true, false]);
  });
  it('keeps the same array when a drop changes nothing, so the strip does not redraw', () => {
    const slots = createSlots(3, 1);
    expect(setSlot(slots, 0, true)).toBe(slots);
    expect(setSlot(slots, 7, true)).toBe(slots);
    expect(setSlot(slots, -1, true)).toBe(slots);
  });
  it('stays silent until the learner acts, then names the distance to the target', () => {
    expect(builderStatus(0, 4)).toBe('empty');
    expect(builderStatus(2, 4)).toBe('building');
    expect(builderStatus(4, 4)).toBe('matched');
    expect(builderStatus(5, 4)).toBe('over');
  });
});
