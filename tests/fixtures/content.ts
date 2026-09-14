import initial from './initial-content.json';
import { parseContentBundle } from '@/core/content-bundle';

// Historical fixture only. Application and deployment code never import these values.
const bundle = parseContentBundle(initial);
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
export const seedClasses = deepFreeze(bundle.classes);
export const skillLabels = deepFreeze(Object.fromEntries(bundle.skills.map(s => [s.key, s.label])));
export const diagnosticProblems = deepFreeze(bundle.diagnostics[0].problems);
export const diagnosticVersion = bundle.diagnostics[0].versionId;
