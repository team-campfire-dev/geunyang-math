// Shared by the publishing validator and the block renderers. Playback and placement rules live
// here so a class that passes publishing cannot behave differently in the learner's hands.

/** One still of a strip animation. A caption may carry math; the block's alt names the whole. */
export type StripFrame = { filled: number; caption?: string };

export const sequenceLimits = { minFrames: 2, maxFrames: 12, minMs: 400, maxMs: 6000, defaultMs: 1400 } as const;
/** Slots are tapped, so a strip the learner fills stays coarser than one that is only read. */
export const builderLimits = { minParts: 2, maxParts: 12 } as const;

/**
 * Playback stops on the last frame unless the author asked for a loop. The caller compares the
 * result with the index it passed to notice the end, so stopping never needs a second rule.
 */
export function nextFrameIndex(index: number, total: number, loop: boolean): number {
  if (index + 1 < total) return index + 1;
  return loop ? 0 : index;
}

/** Stepping by hand never wraps: back on the first frame and forward on the last stay put. */
export function stepFrameIndex(index: number, total: number, delta: number): number {
  return Math.min(Math.max(index + delta, 0), Math.max(total - 1, 0));
}

export function createSlots(parts: number, filled: number): boolean[] {
  return Array.from({ length: Math.max(parts, 0) }, (_, index) => index < filled);
}

/** Returns the same array when nothing changes, so a repeated drop does not re-render the strip. */
export function setSlot(slots: boolean[], index: number, filled: boolean): boolean[] {
  if (index < 0 || index >= slots.length || slots[index] === filled) return slots;
  const next = [...slots];
  next[index] = filled;
  return next;
}

export function placedCount(slots: readonly boolean[]): number {
  return slots.filter(Boolean).length;
}

/** 'empty' keeps a fresh manipulative silent: feedback belongs after the learner has acted. */
export type BuilderStatus = 'empty' | 'building' | 'matched' | 'over';

export function builderStatus(placed: number, target: number): BuilderStatus {
  if (placed === target) return 'matched';
  if (placed > target) return 'over';
  return placed === 0 ? 'empty' : 'building';
}
