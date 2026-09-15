// Shared by the authoring API and the editor screen. Field descriptions live here so the editor can
// offer a form for every published block kind without importing the server's validation schemas,
// and so the server can prune the same optional fields before it validates what the editor sent.
import type { ClassSection, ContentBlock, PublicProblem } from './api';
import { builderLimits, sequenceLimits } from './manipulatives';

/** A role on an account, not a property of one operator: a teacher system grants the same roles. */
export type AuthoringRole = 'admin' | 'author';
export const mayPublish = (role: AuthoringRole | null) => role === 'admin';
export const mayEditEveryDraft = (role: AuthoringRole | null) => role === 'admin';

export type DraftSummary = {
  id: string; classKey: string; versionId: string; baseVersionId: string | null; title: string;
  status: 'draft' | 'published'; publishedVersionId: string | null; updatedAt: string;
  authorName: string; mine: boolean;
};
export type DraftMeta = { versionId: string; title: string; summary: string; estimatedMinutes: number };
/**
 * What an editor may change. Problems, grading rules, hints and solutions are carried from the base
 * version on the server and never travel to the browser, so answers stay where they already live.
 */
export type DraftEdit = { meta: DraftMeta; sections: ClassSection[] };
export type DraftDetail = DraftSummary & { edit: DraftEdit; problems: PublicProblem[]; issues: string[] };
export type ClassChoice = { classKey: string; title: string; latestVersionId: string; suggestedVersionId: string; hasDraft: boolean };
export type AuthoringWorkspace = { role: AuthoringRole | null; drafts: DraftSummary[]; classes: ClassChoice[] };
export type AuthoringAction =
  | { action: 'draft.create'; classKey: string }
  | { action: 'draft.save'; draftId: string; edit: DraftEdit }
  | { action: 'draft.validate'; draftId: string }
  | { action: 'draft.publish'; draftId: string }
  | { action: 'draft.delete'; draftId: string };
export type AuthoringResponse = { workspace: AuthoringWorkspace; draft?: DraftDetail; publishedVersionId?: string };

const versionSuffix = /:v(\d+)$/;
/** Published versions are immutable, so every edit becomes the next version of the same class. */
export function suggestVersionId(classKey: string, existing: string[]): string {
  const numbers = existing.map((id) => versionSuffix.exec(id)).filter((match) => match !== null).map((match) => Number(match[1]));
  return `${classKey}:v${Math.max(0, ...numbers) + 1}`;
}

/** Block IDs only need to be unique inside one document; the shape follows the published records. */
export function nextBlockId(classKey: string, sectionId: string, kind: string, versionId: string, taken: string[]): string {
  const role = sectionId.split(':')[1] ?? 'section';
  const name = kind.split('.')[1] ?? 'block';
  const suffix = versionSuffix.test(versionId) ? versionId.slice(versionId.lastIndexOf(':') + 1) : 'v1';
  for (let index = 1; ; index++) {
    const id = `${classKey}:${role}:${name}${index === 1 ? '' : `-${index}`}:${suffix}`;
    if (!taken.includes(id)) return id;
  }
}

/** Sections are identified the same way blocks are: readable, and unique inside one document. */
export function nextSectionId(classKey: string, role: string, versionId: string, taken: string[]): string {
  const suffix = versionSuffix.test(versionId) ? versionId.slice(versionId.lastIndexOf(':') + 1) : 'v1';
  for (let index = 1; ; index++) {
    const id = `${classKey}:${role}${index === 1 ? '' : `-${index}`}:${suffix}`;
    if (!taken.includes(id)) return id;
  }
}

export function moveBlock(blocks: ContentBlock[], index: number, delta: number): ContentBlock[] {
  const target = index + delta;
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) return blocks;
  const next = [...blocks];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export type BlockField = {
  key: string; label: string; kind: 'text' | 'multiline' | 'number' | 'boolean';
  optional?: boolean; min?: number; max?: number; hint?: string;
};
export type BlockList = { key: string; label: string; addLabel: string; max: number; fields: BlockField[]; create: () => Record<string, unknown> };
export type BlockForm = {
  kind: string; typeVersion: number; label: string; hint: string;
  fields: BlockField[]; list?: BlockList; picksProblems?: boolean; editsScene?: boolean;
  create: () => Record<string, unknown>;
};

const altHint = '화면 낭독용 이름이에요. 수식 표기 없이 평문으로 씁니다.';
export const blockForms: BlockForm[] = [
  {
    kind: 'core.rich_text', typeVersion: 1, label: '본문', hint: '$...$ 안에 수식을 넣을 수 있어요.',
    create: () => ({ text: '여기에 설명을 씁니다.' }),
    fields: [{ key: 'text', label: '본문', kind: 'multiline' }],
  },
  {
    kind: 'core.rich_text', typeVersion: 2, label: '본문 + 용어 풀이', hint: '본문에 실제로 있는 낱말을 용어로 연결해요. 지금 배우는 개념의 용어는 서버가 알아서 숨깁니다.',
    create: () => ({ text: '여기에 설명을 씁니다.', terms: [] }),
    fields: [{ key: 'text', label: '본문', kind: 'multiline' }],
    list: {
      key: 'terms', label: '연결할 용어', addLabel: '용어 연결 추가', max: 20,
      create: () => ({ termKey: '', surface: '' }),
      fields: [
        { key: 'termKey', label: '용어 키', kind: 'text', hint: '발행된 TermVersion의 termKey' },
        { key: 'surface', label: '본문의 낱말', kind: 'text' },
        { key: 'occurrence', label: '몇 번째', kind: 'number', optional: true, min: 1, max: 100 },
      ],
    },
  },
  {
    kind: 'core.figure', typeVersion: 1, label: '그림', hint: '캡션에는 수식을 써도 되고, 그림 전체의 이름은 alt가 맡아요.',
    create: () => ({ alt: '4등분한 막대 중 3칸을 채운 그림', caption: '', primitive: { kind: 'fraction_strip', parts: 4, filled: 3 } }),
    fields: [
      { key: 'alt', label: '그림 이름', kind: 'text', hint: altHint },
      { key: 'caption', label: '캡션', kind: 'text', optional: true },
      { key: 'primitive.parts', label: '전체 칸 수', kind: 'number', min: 1, max: 100 },
      { key: 'primitive.filled', label: '채운 칸 수', kind: 'number', min: 0, max: 100 },
    ],
  },
  {
    kind: 'math.fraction_strip', typeVersion: 1, label: '분수 막대', hint: '캡션에 수식을 쓰면 평문 낭독용 이름을 함께 넣어야 해요.',
    create: () => ({ parts: 4, filled: 3, label: '' }),
    fields: [
      { key: 'parts', label: '전체 칸 수', kind: 'number', min: 1, max: 100 },
      { key: 'filled', label: '채운 칸 수', kind: 'number', min: 0, max: 100 },
      { key: 'label', label: '캡션', kind: 'text', optional: true },
      { key: 'labelAlt', label: '낭독용 이름', kind: 'text', optional: true, hint: '캡션에 수식을 쓸 때 필수예요.' },
    ],
  },
  {
    kind: 'core.scene', typeVersion: 1, label: '그림 (자유)',
    hint: '도형을 마우스로 놓고 옮겨 그립니다. 그림 전체의 이름은 평문으로 따로 적어요.',
    create: () => ({ alt: '설명을 담은 그림', caption: '', width: 320, height: 200,
      items: [{ kind: 'rect', x: 100, y: 70, width: 120, height: 60, fill: 'fill-soft', stroke: 'fill', strokeWidth: 1, radius: 2 }] }),
    fields: [
      { key: 'alt', label: '그림 이름', kind: 'text', hint: altHint },
      { key: 'caption', label: '캡션', kind: 'text', optional: true },
    ],
    editsScene: true,
  },
  {
    kind: 'math.fraction_sequence', typeVersion: 1, label: '움직이는 분수 막대', hint: '같은 막대를 장면으로 이어 보여줘요. 재생·멈춤·앞뒤 버튼은 항상 함께 그립니다.',
    create: () => ({ parts: 4, alt: '4등분한 막대가 세 칸까지 채워지는 장면', frames: [{ filled: 0 }, { filled: 3 }] }),
    fields: [
      { key: 'parts', label: '전체 칸 수', kind: 'number', min: 1, max: 100 },
      { key: 'alt', label: '장면 전체의 이름', kind: 'text', hint: altHint },
      { key: 'frameMs', label: '장면 간격(ms)', kind: 'number', optional: true, min: sequenceLimits.minMs, max: sequenceLimits.maxMs },
      { key: 'loop', label: '반복 재생', kind: 'boolean', optional: true },
      { key: 'autoplay', label: '자동 재생', kind: 'boolean', optional: true, hint: '동작 줄이기를 켠 기기에서는 자동으로 재생하지 않아요.' },
    ],
    list: {
      key: 'frames', label: `장면 (${sequenceLimits.minFrames}~${sequenceLimits.maxFrames}개)`, addLabel: '장면 추가', max: sequenceLimits.maxFrames,
      create: () => ({ filled: 0 }),
      fields: [
        { key: 'filled', label: '채운 칸 수', kind: 'number', min: 0, max: 100 },
        { key: 'caption', label: '캡션', kind: 'text', optional: true },
      ],
    },
  },
  {
    kind: 'math.fraction_builder', typeVersion: 1, label: '직접 놓는 조각', hint: '학습자가 칸을 눌러 조각을 놓아요. 채점하지 않으며 문항 안에는 넣을 수 없어요.',
    create: () => ({ parts: 6, target: 4, prompt: '6칸 중 4칸을 채워 보세요.' }),
    fields: [
      { key: 'parts', label: '전체 칸 수', kind: 'number', min: builderLimits.minParts, max: builderLimits.maxParts, hint: '손가락으로 누를 수 있도록 최대 12칸이에요.' },
      { key: 'target', label: '목표 칸 수', kind: 'number', min: 0, max: builderLimits.maxParts },
      { key: 'start', label: '미리 놓인 조각', kind: 'number', optional: true, min: 0, max: builderLimits.maxParts },
      { key: 'prompt', label: '안내 문장', kind: 'text' },
      { key: 'promptAlt', label: '낭독용 안내', kind: 'text', optional: true, hint: '안내에 수식을 쓸 때 필수예요.' },
      { key: 'successText', label: '맞췄을 때 문구', kind: 'text', optional: true },
    ],
  },
  {
    kind: 'core.problem_set', typeVersion: 1, label: '문항 묶음', hint: '이 판본의 문항 중에서 고릅니다. 한 문항은 한 활동에만 넣을 수 있어요.',
    create: () => ({ problemVersionIds: [] }),
    fields: [], picksProblems: true,
  },
];
export const blockKey = (block: { kind: string; typeVersion: number }) => `${block.kind}@${block.typeVersion}`;
export const blockFormOf = (block: { kind: string; typeVersion: number }) =>
  blockForms.find((form) => form.kind === block.kind && form.typeVersion === block.typeVersion);

export const readPath = (payload: Record<string, unknown>, key: string): unknown =>
  key.split('.').reduce<unknown>((value, part) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined), payload);

export function writePath(payload: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = key.split('.');
  if (!rest.length) return { ...payload, [head]: value };
  const nested = payload[head];
  return { ...payload, [head]: writePath(nested && typeof nested === 'object' ? { ...(nested as Record<string, unknown>) } : {}, rest.join('.'), value) };
}

/**
 * An empty form field means "not set". Publishing validation rejects an empty optional string, so
 * both sides drop those before anything is checked; the server repeats it because it decides.
 */
export function pruneBlock(block: ContentBlock): ContentBlock {
  const form = blockFormOf(block);
  if (!form) return block;
  const empty = (value: unknown) => value === '' || value === undefined || value === null || (typeof value === 'number' && !Number.isFinite(value));
  const prune = (payload: Record<string, unknown>, fields: BlockField[]) => {
    let next = payload;
    for (const field of fields) {
      if (!field.optional || !empty(readPath(next, field.key))) continue;
      const [head, ...rest] = field.key.split('.');
      if (rest.length) next = writePath(next, field.key, undefined);
      else { next = { ...next }; delete next[head]; }
    }
    return next;
  };
  let payload = prune({ ...block.payload }, form.fields);
  if (form.list) {
    const rows = Array.isArray(payload[form.list.key]) ? (payload[form.list.key] as Record<string, unknown>[]) : [];
    payload = { ...payload, [form.list.key]: rows.map((row) => prune({ ...row }, form.list!.fields)) };
  }
  const pruned: ContentBlock = { ...block, payload };
  if (!pruned.fallback?.trim()) delete pruned.fallback;
  return pruned;
}

export function pruneSections(sections: ClassSection[]): ClassSection[] {
  return sections.map((section) => ({ ...section, contentBlocks: section.contentBlocks.map(pruneBlock) }));
}
