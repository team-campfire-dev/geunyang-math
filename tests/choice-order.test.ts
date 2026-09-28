import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { choiceOrder } from '@/shared/choice-order';

type Choice = { problemVersionId: string; gradingSpec: { kind: string; options?: { id: string }[]; correct?: string } };
type Bundle = { problemSets: { problemSetId: string; problems: Choice[] }[] };

// The questions a learner meets now: the last version of each set in every course's seed.
function catalogueChoices(): Choice[] {
  const dir = join(__dirname, '..', 'prisma', 'seed');
  const out: Choice[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const bundle = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Bundle;
    const latest = new Map(bundle.problemSets.map((set) => [set.problemSetId, set]));
    for (const set of latest.values()) out.push(...set.problems.filter((p) => p.gradingSpec.kind === 'choice'));
  }
  return out;
}

describe('choiceOrder', () => {
  const options = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

  it('draws the same order for the same question every time, and loses no option', () => {
    const first = choiceOrder('ncs-condition:check-2:v1', options);
    expect(choiceOrder('ncs-condition:check-2:v1', options)).toEqual(first);
    expect([...first].sort((x, y) => x.id.localeCompare(y.id))).toEqual(options);
    expect(options.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('leaves no option list longer or shorter, down to one or none', () => {
    expect(choiceOrder('x', [])).toEqual([]);
    expect(choiceOrder('x', [{ id: 'a' }])).toEqual([{ id: 'a' }]);
  });

  it('no longer puts the catalogue\'s answers where authors wrote them — first', () => {
    const questions = catalogueChoices();
    expect(questions.length).toBeGreaterThan(100);
    const written = questions.filter((q) => q.gradingSpec.options![0].id === q.gradingSpec.correct).length;
    const drawn = questions.filter((q) => choiceOrder(q.problemVersionId, q.gradingSpec.options!)[0].id === q.gradingSpec.correct).length;
    // As written, most answers sit first; drawn, about one in the option count does.
    expect(written / questions.length).toBeGreaterThan(0.5);
    expect(drawn / questions.length).toBeLessThan(0.4);
  });
});
