/**
 * Where the learner is standing, written where the browser can keep it.
 *
 * Until now the screen kept its place in memory alone: a reload in the middle of a twenty-question
 * set came back at 「내 학습」, the back button left the app instead of the question, and there was
 * no address to send anybody. The place lives in the query rather than the path because all of this
 * is one route — the mobile bundle is a single exported page, and a path it never built is a dead
 * link there. `lesson` keeps its name: it is the link people already have.
 */
export type Page = 'home' | 'lessons' | 'practice' | 'history' | 'lesson' | 'assignment' | 'diagnostic';

/**
 * A place, as much of it as an address can hold. A lesson and a set are named by what they are —
 * the lesson's key, the run's recipient — and everything else is just the screen it is on.
 */
export type Place = { page: Page; lessonKey?: string; step?: number; recipientId?: string };

/** The screens an address names by `page`. A lesson and a set are named by what they hold instead. */
const named: Page[] = ['home', 'lessons', 'practice', 'history', 'diagnostic'];

/**
 * What a query string says, or 「내 학습」 when it says nothing this screen knows.
 *
 * Nothing read here is trusted with more than its shape: a key out of the address bar is matched
 * against the catalogue, and a run against the learner's own, before anything is opened.
 */
export function readPlace(search: string): Place {
  const asked = new URLSearchParams(search);
  const lessonKey = asked.get('lesson');
  if (lessonKey) {
    const step = Number(asked.get('step'));
    return { page: 'lesson', lessonKey, ...(Number.isSafeInteger(step) && step > 0 ? { step } : {}) };
  }
  const recipientId = asked.get('set');
  if (recipientId) return { page: 'assignment', recipientId };
  const page = asked.get('page');
  return { page: named.find((entry) => entry === page) ?? 'home' };
}

/** The query a place is written as. 「내 학습」 is written as nothing, because it is where 「/」 lands. */
export function placeSearch(place: Place): string {
  if (place.page === 'lesson' && place.lessonKey) {
    const asked = new URLSearchParams({ lesson: place.lessonKey });
    // The first step of a lesson is where opening one lands, so it is left unsaid.
    if (place.step && place.step > 1) asked.set('step', String(place.step));
    return `?${asked}`;
  }
  if (place.page === 'assignment' && place.recipientId) return `?${new URLSearchParams({ set: place.recipientId })}`;
  if (place.page === 'lesson' || place.page === 'assignment' || place.page === 'home') return '';
  return `?${new URLSearchParams({ page: place.page })}`;
}

/**
 * Whether two places are the same piece of work, told apart from being the same place.
 *
 * Stepping through a lesson stays in the address so a reload comes back to the step, but it is not
 * somewhere the learner went: if every step were its own entry, leaving a five-step lesson would
 * take five presses of back. Same work, so the address is replaced rather than added to.
 */
export const sameWork = (a: Place, b: Place) =>
  a.page === b.page && a.lessonKey === b.lessonKey && a.recipientId === b.recipientId;
