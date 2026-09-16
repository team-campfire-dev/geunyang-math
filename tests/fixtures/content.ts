import initial from '../../prisma/seed/fractions.json';
import { parseContentBundle } from '@/core/content-bundle';

// The platform's own content, as db:seed installs it. Tests read it; the application never imports it.
const bundle = parseContentBundle(initial);
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
export const seedLessons = deepFreeze(bundle.lessons);
export const conceptLabels = deepFreeze(Object.fromEntries(bundle.concepts.map(s => [s.key, s.label])));
export const diagnosticProblems = deepFreeze(bundle.diagnostics[0].problems);
export const diagnosticVersion = bundle.diagnostics[0].versionId;
