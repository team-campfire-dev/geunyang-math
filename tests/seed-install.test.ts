import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseContentBundle, validateReferences } from '@/core/content-bundle';

/**
 * Every seed bundle has to install into an **empty** database.
 *
 * `db:seed` validates each bundle against what the database already holds, so a bundle that borrows
 * a concept from another course passes on a database where that course is already installed — a
 * developer's — and fails on a fresh one. That is the deployment's database on a first install, and
 * it is where it failed: 자료해석 named `numeracy-scope` as a prerequisite, which 시작하기 declares,
 * and the release stopped at the eighth of fifteen bundles.
 *
 * The rule this holds each bundle to is stricter than install order would need, and deliberately so:
 * a bundle resolves against the shared dictionary and its own concepts, and nothing else. Anything
 * weaker would make the catalogue depend on the alphabet of file names.
 */
const bundles = readdirSync('prisma/seed').filter((name) => name.endsWith('.json')).sort()
  .map((name) => ({ name, bundle: parseContentBundle(JSON.parse(readFileSync(`prisma/seed/${name}`, 'utf8'))) }));
const dictionaries = readdirSync('content').filter((name) => name.startsWith('glossary-'))
  .map((name) => parseContentBundle(JSON.parse(readFileSync(`content/${name}`, 'utf8'))));
const dictionaryConcepts = dictionaries.flatMap((entry) => entry.concepts);
const dictionaryDefinitions = dictionaries.flatMap((entry) => entry.definitions);
const definitionKey = (definition: { conceptKey: string; scopeKind?: string; scopeKey?: string }) =>
  `${definition.scopeKind ?? 'global'}:${definition.scopeKey ?? ''}:${definition.conceptKey}`;

describe('a bundle installed on its own', () => {
  it('resolves every reference against the dictionary and itself', () => {
    for (const { name, bundle } of bundles) {
      // What `prisma/seed.ts` hands the importer: the shared dictionary, then the bundle's own word.
      const concepts = [...new Map([...dictionaryConcepts, ...bundle.concepts].map((concept) => [concept.key, concept])).values()];
      const definitions = [...new Map([...dictionaryDefinitions, ...bundle.definitions].map((entry) => [definitionKey(entry), entry])).values()];
      expect(() => validateReferences({ ...bundle, concepts, definitions }), name).not.toThrow();
    }
  });

  it('calls a concept by one name wherever it is declared', () => {
    // Concepts are upserted by key, so two bundles naming one key differently would rename it on
    // every install and the label a learner sees would depend on which seed ran last.
    const labels = new Map<string, { label: string; where: string }>();
    for (const { name, bundle } of [...bundles, ...dictionaries.map((bundle, index) => ({ name: `glossary ${index}`, bundle }))]) {
      for (const concept of bundle.concepts) {
        const known = labels.get(concept.key);
        if (known) expect(concept.label, `${concept.key}: ${known.where}와 ${name}이 다르게 부른다`).toBe(known.label);
        else labels.set(concept.key, { label: concept.label, where: name });
      }
    }
  });
});
