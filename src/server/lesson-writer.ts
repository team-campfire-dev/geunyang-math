import 'server-only';
import { ZodError } from 'zod';
import { validateLesson, type StoredLesson } from '@/core/content';
import { courseStageLabels, type ContentBlock, type CourseStage } from '@/shared/api';
import { itemBounds, sceneColors, type SceneItem } from '@/shared/scene';
import { beyondStage, notYet } from './stage-range';
import { writingGuide } from './writing-guide';

/**
 * Writing a lesson's prose again — the explanation, the worked example and the summary — around the
 * questions it already asks. Everything that decides what is assessed stays put: the lesson's key,
 * concepts, prerequisites and time, its problem sets, its review pool. Only what a learner reads and
 * watches is new, and it is a new version, because a published lesson never changes in place.
 */

const roles = ['explanation', 'worked_example', 'summary'] as const;
type ProseRole = typeof roles[number];
/** A block as the writer hands it back: plain, before it has an id or a version. */
export type DraftBlock =
  | { type: 'text'; text: string; definitions?: { conceptKey: string; surface: string }[] }
  | { type: 'scene'; scene: Record<string, unknown> }
  | { type: 'table'; table: Record<string, unknown> };
export type LessonDraft = Record<ProseRole, DraftBlock[]>;

export type LessonInput = {
  lesson: StoredLesson;
  course: { title: string; stage: CourseStage | null };
  /** Every concept there is a shared definition for, by key, with what it is called. */
  concepts: { key: string; label: string }[];
  /** What the lesson's steps and review pool ask, so the explanation leads to them. */
  problems: { prompt: string; answer: string }[];
};


export const lessonWriterSystem = `${writingGuide}

---

## 이번 일: 발행된 수업의 본문을 다시 쓰기

수업은 단계로 나뉘고 학습자는 한 번에 한 단계만 본다. 다시 쓰는 것은 세 단계다 — 개념 만나기(explanation), 함께 풀어 보기(worked_example), 배운 개념 돌아보기(summary). 문제를 푸는 단계와 문제는 그대로 두고, 아래에 적힌 문제들을 풀 수 있게 설명한다.

### 담백하게

- **한 문장은 40자 안쪽**으로 쓴다. 「~하는데」「~이므로」로 두 생각을 잇지 말고 두 문장으로 나눈다.
- 한 블록은 2~3문장이다. 같은 말을 되풀이하지 않고, 정리하는 문장을 덧붙이지 않는다.
- 개념 만나기는 글 블록 3~5개와 그림 1~2개, 함께 풀어 보기는 예제 한두 개를 끝까지 푸는 글, 돌아보기는 짧은 문장 3~4개의 글 한 블록이면 된다.
- 지금 수업의 사실·범위·용어를 지킨다. 새 공식이나 요령, 뒤 수업의 내용을 들이지 않는다.

### 그림을 쓴다

말로만 하면 다시 해석해야 하는 관계는 그림으로 보인다. **개념 만나기에는 움직이는 그림을 하나 이상** 넣는다. 손으로 옮겨 보면 이해가 되는 것(대응하는 변 짝짓기, 경우를 칸에 놓기, 조각 옮기기)이 있으면 **끌어다 놓는 그림**도 하나 넣는다. 그림 하나는 움직이거나 끌어다 놓거나 둘 중 하나다.

그림(scene)의 형식:
- \`width\` 320~360, \`height\` 180~240. 좌표는 왼쪽 위가 (0, 0)이다. **모든 도형과 글자가 이 안에 있어야 한다** — 움직인 뒤의 위치까지.
- \`alt\`: 그림 전체를 한 문장으로(수식 기호 $ 없이). \`caption\`: 그림 아래 한 줄(수식 가능).
- \`items\`: 도형 목록. 종류와 필드:
  - \`{"kind":"polygon","points":[[x,y],...],"closed":true}\` · \`{"kind":"line","x1","y1","x2","y2","arrow":"none|end|both"}\` · \`{"kind":"rect","x","y","width","height","radius"}\` · \`{"kind":"ellipse","cx","cy","rx","ry"}\` · \`{"kind":"text","x","y","text","size","anchor":"start|middle|end","weight":"regular|bold"}\` · \`{"kind":"strip","x","y","width","height","parts","filled"}\`(분수 막대)
  - 공통 필드: \`id\`(영문·숫자·-·_, 움직이거나 끄는 도형에 필수), \`fill\`, \`stroke\`, \`strokeWidth\`(0.25~20), \`dash\`, \`opacity\`(0~1), \`rotate\`.
  - 색은 이름으로만: ${sceneColors.join(', ')}. 역할로 고른다 — 기본 선과 글자는 ink, 보조 글자는 muted, 지금 가리키는 것은 orange, 그대로 있는 두 번째 대상은 green, 칠하는 면은 fill-soft·sand·sky·light-green, 칠하지 않으면 none.
  - 글자의 \`text\`에는 짧은 수식을 $...$로 쓸 수 있다. 글자 크기는 10~16.
  - 점·변의 이름(A, B, C)은 본문과 같게 쓴다. 본문에서도 점 이름은 그냥 A, B, C로 쓴다($\\text{}$로 감싸지 않는다).
- **그림이 캔버스를 채운다**: 주된 도형이 가로·세로의 60% 이상을 차지하게 크게 그리고, 사방 여백은 12~20으로 둔다.
- **사각형끼리 겹치지 않는다.** 큰 판 안에 작은 칸을 담는 것은 괜찮다. 색을 바꾸려고 같은 자리에 도형을 하나 더 겹치지 말고, 프레임에서 그 도형의 \`fill\`을 바꾼다.
- **글자는 서로 겹치지 않는다**: 글자 상자(대략 글자 수 × 크기 × 0.6 너비, 크기 높이)끼리 4 이상 띄우고, 선 바로 위가 아니라 6 이상 떨어뜨린다. 움직인 뒤의 장면에서도 마찬가지다.
- **움직이는 그림**: \`frames\`(2~8개)와 \`frameMs\`(1200~2200). 각 프레임은 \`{"caption":"...","changes":[{"id","dx","dy","opacity","rotate","fill","hidden"}]}\`. **프레임의 변화는 앞 프레임에 쌓이지 않는다** — 매번 처음 그림에 그 프레임의 변화만 적용된다. 그래서 계속 보여야 하는 변화는 뒤 프레임마다 다시 적는다. 처음엔 숨겼다가 나타날 도형은 items에서 \`"opacity":0\`으로 두고 보일 프레임마다 \`{"id":…, "opacity":1}\`을 적는다. 첫 프레임은 보통 변화가 없는 처음 상태다. 프레임 caption이 그 장면에서 볼 것을 말한다.
- **끌어다 놓는 그림**: 옮길 도형에 \`"draggable":true\`, \`id\`, \`label\`(그 도형의 이름, 수식 없이). \`zones\`: \`[{"id","x","y","width","height","label","accepts":[옮길 도형의 id]}]\`. \`task\`: \`{"prompt":"무엇을 어디에 놓을지","promptAlt":"수식 없는 같은 문장(prompt에 $가 있으면 필수)","successText":"다 놓았을 때 보일 한 문장(수식 없이)"}\`. 칸은 도형이 들어갈 만큼 크게, 서로 겹치지 않게 둔다. **칸 이름은 칸 바로 아래 16 높이에 그려지니 그 자리를 비워 둔다.** 옮길 도형은 칸과 칸 이름에서 떨어진 곳(예: 그림 아래쪽 한 줄)에 처음 둔다. 끌어다 놓는 그림에는 frames를 쓰지 않는다.

표(table)의 형식: \`{"caption":"표 이름(수식 없이)","columns":[{"label":"..."}],"rows":[{"cells":["..."]}]}\` — 경우를 나열하거나 값을 비교할 때 쓴다.

### 글 블록과 뜻풀이

- 글 블록은 \`{"type":"text","text":"...","definitions":[{"conceptKey":"...","surface":"..."}]}\`. 문단은 빈 줄로 나눈다. 수식은 $...$, 수식 안에 한글을 넣지 않는다.
- 처음 나오는 개념 이름에 뜻풀이를 단다 — \`surface\`는 그 블록의 글에 **그대로 있는** 낱말이고, \`conceptKey\`는 아래 「뜻풀이가 있는 개념」 목록의 키만 쓴다.

### 답의 모양

JSON 하나: \`{"explanation":[블록...],"worked_example":[블록...],"summary":[블록...]}\`. 블록은 \`{"type":"text",...}\`, \`{"type":"scene","scene":{...}}\`, \`{"type":"table","table":{...}}\` 중 하나다.`;

const textOf = (blocks: ContentBlock[]) => blocks.map((block) => {
  const payload = block.payload as Record<string, unknown>;
  if (block.kind === 'core.rich_text') return String(payload.text ?? '');
  if (block.kind === 'core.scene') return `[그림: ${payload.alt}${payload.caption ? ` — ${payload.caption}` : ''}]`;
  if (block.kind === 'core.table') return `[표: ${payload.caption}]`;
  return '';
}).filter(Boolean).join('\n\n');

/** The one request for a lesson: what it is, what it says now, what it has to lead to, what to link. */
export function lessonRequest(input: LessonInput): string {
  const { lesson, course } = input;
  const label = (key: string) => input.concepts.find((concept) => concept.key === key)?.label ?? key;
  const now = lesson.sections.filter((section) => (roles as readonly string[]).includes(section.role))
    .map((section) => `### ${section.title} (${section.role})\n${textOf(section.contentBlocks)}`).join('\n\n');
  return [
    `코스: ${course.title}${course.stage ? ` (${courseStageLabels[course.stage]})` : ''}`,
    `수업: ${lesson.public.title}`,
    `가르치는 개념: ${lesson.public.conceptKeys.map((key) => `${label(key)}(${key})`).join(', ')}`,
    `이미 배운 것으로 치는 개념: ${lesson.public.prerequisiteConceptKeys.map((key) => `${label(key)}(${key})`).join(', ') || '없음'}`,
    ...(course.stage && notYet[course.stage] ? [`학년 범위: ${notYet[course.stage]}`] : []),
    '',
    '## 지금의 본문 (다시 쓸 재료 — 사실과 범위를 지킨다)',
    now,
    '',
    '## 이 수업의 문제 (풀 수 있게 설명한다, 그대로 풀어 주지는 않는다)',
    ...input.problems.map((problem) => `- ${problem.prompt} → ${problem.answer}`),
    '',
    '## 뜻풀이가 있는 개념 (키: 이름)',
    input.concepts.map((concept) => `${concept.key}: ${concept.label}`).join('\n'),
  ].join('\n');
}

/** The next version of an id: `similar-triangles:v2` → `similar-triangles:v3`. */
export const nextVersion = (versionId: string, version: number) => versionId.replace(/:v\d+$/, `:v${version}`);
const versionOf = (versionId: string) => Number(/:v(\d+)$/.exec(versionId)?.[1] ?? 1);
const short: Record<ProseRole, string> = { explanation: 'explanation', worked_example: 'example', summary: 'summary' };

function blockOf(draft: DraftBlock, blockId: string): ContentBlock {
  if (draft.type === 'text') {
    return { blockId, kind: 'core.rich_text', typeVersion: 3, required: true, payload: {
      text: draft.text, definitions: (draft.definitions ?? []).map((link) => ({ conceptKey: link.conceptKey, surface: link.surface, scopeKind: 'global' })) } } as ContentBlock;
  }
  if (draft.type === 'scene') return { blockId, kind: 'core.scene', typeVersion: 1, required: true, payload: draft.scene } as ContentBlock;
  return { blockId, kind: 'core.table', typeVersion: 1, required: true, payload: draft.table } as ContentBlock;
}

/**
 * The lesson as it will be published: the same lesson under its next version, the three prose
 * steps replaced, the steps that ask questions carried over with only their ids moved on.
 */
export function assembleLesson(current: StoredLesson, draft: LessonDraft): StoredLesson {
  const version = versionOf(current.public.versionId) + 1;
  const key = current.public.lessonKey;
  const sections = current.sections.map((section) => {
    const sectionId = nextVersion(section.sectionId, version);
    if (!(roles as readonly string[]).includes(section.role)) {
      return { ...section, sectionId, contentBlocks: section.contentBlocks.map((block) => ({ ...block, blockId: nextVersion(block.blockId, version) })) };
    }
    const role = section.role as ProseRole;
    const counts: Record<string, number> = {};
    return { ...section, sectionId, contentBlocks: (draft[role] ?? []).map((block) => {
      counts[block.type] = (counts[block.type] ?? 0) + 1;
      return blockOf(block, `${key}:${short[role]}:${block.type}-${counts[block.type]}:v${version}`);
    }) };
  });
  return { ...current, public: { ...current.public, versionId: nextVersion(current.public.versionId, version), sectionCount: sections.length }, sections };
}

/**
 * Where a shape ends up in a frame: its own place moved by that frame's change. Typeset math runs
 * wider than its characters suggest — a superscript and a spaced operator each take room the count
 * misses — so text with math is measured a third wider, which is what the rendered page showed.
 */
function boundsIn(item: SceneItem, change?: { dx?: number; dy?: number }) {
  const measured = itemBounds(item);
  const box = item.kind === 'text' && item.text.includes('$')
    ? { ...measured, width: measured.width * 1.3, x: measured.x - (item.anchor === 'middle' ? measured.width * 0.15 : item.anchor === 'end' ? measured.width * 0.3 : 0) }
    : measured;
  return { ...box, x: box.x + (change?.dx ?? 0), y: box.y + (change?.dy ?? 0) };
}

/**
 * Everything wrong with a written lesson, in words the writer can act on: the schema's own refusals
 * first, then what the schema cannot see — a drawing that runs off its canvas, an explanation with
 * nothing that moves, the house style, the grade's range.
 */
export function lessonIssues(lesson: StoredLesson, stage: CourseStage | null): string[] {
  const issues: string[] = [];
  try { validateLesson(lesson); }
  catch (reason) {
    if (reason instanceof ZodError) {
      for (const issue of reason.issues.slice(0, 20)) issues.push(`${issue.path.join('.')}: ${issue.message}`);
    } else issues.push(reason instanceof Error ? reason.message : String(reason));
  }
  const explanation = lesson.sections.find((section) => section.role === 'explanation');
  const scenes = lesson.sections.flatMap((section) => section.contentBlocks.filter((block) => block.kind === 'core.scene').map((block) => ({ section, block })));
  if (!explanation?.contentBlocks.some((block) => block.kind === 'core.scene' && Array.isArray((block.payload as { frames?: unknown }).frames))) {
    issues.push('개념 만나기에 움직이는 그림(frames가 있는 scene)이 없어요.');
  }
  for (const { section, block } of scenes) {
    const scene = block.payload as { width?: number; height?: number; items?: SceneItem[]; frames?: { changes: { id: string; dx?: number; dy?: number }[] }[]; zones?: { id: string; x: number; y: number; width: number; height: number }[] };
    if (!scene.width || !scene.height || !Array.isArray(scene.items)) continue;
    const where = `${section.role}의 그림 ${block.blockId.split(':').at(-2)}`;
    const outside = (box: { x: number; y: number; width: number; height: number }) =>
      box.x < -2 || box.y < -2 || box.x + box.width > scene.width! + 2 || box.y + box.height > scene.height! + 2;
    for (const item of scene.items) {
      if (outside(boundsIn(item))) { issues.push(`${where}: 도형${item.id ? ` ${item.id}` : ''}(${item.kind})이 그림 밖으로 나가요.`); continue; }
      for (const [index, frame] of (scene.frames ?? []).entries()) {
        const change = item.id ? frame.changes.find((entry) => entry.id === item.id) : undefined;
        if (change && outside(boundsIn(item, change))) { issues.push(`${where}: 도형 ${item.id}이 ${index + 1}번째 프레임에서 그림 밖으로 나가요.`); break; }
      }
    }
    for (const zone of scene.zones ?? []) if (outside(zone)) issues.push(`${where}: 칸 ${zone.id}이 그림 밖으로 나가요.`);
    const zones = scene.zones ?? [];
    for (let a = 0; a < zones.length; a++) for (let b = a + 1; b < zones.length; b++) {
      const p = zones[a], q = zones[b];
      if (p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height) issues.push(`${where}: 칸 ${p.id}와 ${q.id}가 겹쳐요.`);
    }
  }
  for (const { section, block } of scenes) issues.push(...layoutIssues(block.payload as unknown as SceneLike, `${section.role}의 그림 ${block.blockId.split(':').at(-2)}`));
  const prose = lesson.sections.flatMap((section) => section.contentBlocks).filter((block) => block.kind === 'core.rich_text')
    .map((block) => String((block.payload as { text?: unknown }).text ?? ''));
  const plain = prose.join('\n').replace(/\$[^$]*\$/g, ' ');
  if (/(습니다|합니다|입니다|됩니다)(?=[.\s]|$)/.test(plain)) issues.push('「~습니다」가 섞였어요. 「~예요/~해요」로 써요.');
  const beyond = beyondStage(stage, prose.join('\n'));
  if (beyond) issues.push(beyond);
  for (const text of prose) if (text.length > 320) { issues.push(`글 블록 하나가 길어요(${text.length}자): 「${text.slice(0, 30)}…」 — 나누거나 줄여요.`); break; }
  const long = prose.flatMap((text) => text.replace(/\$[^$]*\$/g, '식').split(/(?<=[.?!요])\s+/)).filter((sentence) => sentence.trim().length > 60);
  if (long.length > 1) issues.push(`문장이 길어요(40자 안쪽으로 나눠요): ${long.slice(0, 3).map((sentence) => `「${sentence.trim().slice(0, 40)}…」`).join(' ')}`);
  return issues;
}

type SceneLike = { width: number; height: number; items: SceneItem[]; frames?: { changes: { id: string; dx?: number; dy?: number; opacity?: number; hidden?: boolean }[] }[];
  zones?: { id: string; x: number; y: number; width: number; height: number }[] };
const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
type Box = { x: number; y: number; width: number; height: number };
const words = (item: SceneItem) => (item.kind === 'text' ? item.text : '');

/**
 * What a drawing looks like that its schema cannot say: words on top of words in any scene it plays,
 * a shape to move that starts on a box or its name, and a picture that uses half its canvas or less.
 */
function layoutIssues(scene: SceneLike, where: string): string[] {
  if (!scene?.width || !Array.isArray(scene.items)) return [];
  const issues: string[] = [];
  const states = [undefined, ...(scene.frames ?? [])];
  const seen = new Set<string>();
  for (const [index, frame] of states.entries()) {
    const shown = scene.items.map((item) => {
      const change = item.id ? frame?.changes.find((entry) => entry.id === item.id) : undefined;
      const opacity = change?.opacity ?? item.opacity ?? 1;
      return { item, box: boundsIn(item, change), visible: opacity > 0 && !change?.hidden };
    }).filter((entry) => entry.visible && entry.item.kind === 'text');
    for (let a = 0; a < shown.length; a++) for (let b = a + 1; b < shown.length; b++) {
      const p = shown[a], q = shown[b];
      const smaller = Math.min(p.box.width * p.box.height, q.box.width * q.box.height) || 1;
      const key = [words(p.item), words(q.item)].sort().join('|');
      if (overlapArea(p.box, q.box) / smaller > 0.1 && !seen.has(key)) {
        seen.add(key);
        issues.push(`${where}: 글자 「${words(p.item)}」와 「${words(q.item)}」가 ${index ? `${index}번째 프레임에서 ` : ''}겹쳐요.`);
      }
    }
  }
  // Boxes on boxes, as tests/course-content.test.ts holds every installed drawing to: a panel may
  // hold smaller boxes, and nothing else may sit on another box in any scene it plays.
  for (const [index, frame] of states.entries()) {
    const boxes = scene.items.filter((item) => item.kind === 'rect' && !item.rotate).map((item) => {
      const change = item.id ? frame?.changes.find((entry) => entry.id === item.id) : undefined;
      const opacity = change?.opacity ?? item.opacity ?? 1;
      return { id: item.id ?? 'rect', box: boundsIn(item, change), visible: opacity > 0 && !change?.hidden };
    }).filter((entry) => entry.visible);
    const holds = (outer: Box, inner: Box) => inner.width * inner.height <= (outer.width * outer.height) / 2
      && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const p = boxes[a], q = boxes[b];
      if (holds(p.box, q.box) || holds(q.box, p.box) || overlapArea(p.box, q.box) <= 0.5) continue;
      const key = `${p.id}|${q.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(`${where}: 사각형 ${p.id}와 ${q.id}가 ${index ? `${index}번째 프레임에서 ` : ''}겹쳐요. 색을 바꾸려는 거라면 겹치지 말고 프레임에서 fill을 바꾸세요.`);
    }
  }
  for (const item of scene.items.filter((entry) => entry.draggable)) {
    const box = itemBounds(item);
    for (const zone of scene.zones ?? []) {
      if (overlapArea(box, { ...zone, height: zone.height + 16 }) > 0) { issues.push(`${where}: 옮길 도형 ${item.id}이 처음부터 칸 ${zone.id}(또는 그 이름 자리)에 겹쳐 있어요. 칸과 떨어진 곳에 두세요.`); break; }
    }
  }
  const boxes = states.flatMap((frame) => scene.items.map((item) => boundsIn(item, item.id ? frame?.changes.find((entry) => entry.id === item.id) : undefined)));
  const left = Math.min(...boxes.map((box) => box.x)), right = Math.max(...boxes.map((box) => box.x + box.width));
  const top = Math.min(...boxes.map((box) => box.y)), bottom = Math.max(...boxes.map((box) => box.y + box.height));
  if ((right - left) < scene.width * 0.55 && (bottom - top) < scene.height * 0.55) issues.push(`${where}: 그림이 작아요 — 도형이 캔버스의 절반 남짓만 차지해요. 크게 그려 캔버스를 채우세요.`);
  return issues;
}

/** The writer's answer read as a draft, or the reason it cannot be. */
export function readDraft(text: string): LessonDraft | string {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return 'JSON으로 읽을 수 없어요.'; }
  const draft = value as Partial<LessonDraft>;
  for (const role of roles) if (!Array.isArray(draft?.[role]) || !draft[role]!.length) return `${role}가 비었어요.`;
  return draft as LessonDraft;
}
