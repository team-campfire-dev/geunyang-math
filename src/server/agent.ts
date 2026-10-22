import 'server-only';
import { randomBytes } from 'node:crypto';
import type { AgentKey, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { blockSchemas } from '@/core/content';
import { hashSessionToken } from './auth';
import { AuthoringService, authoringActionSchema, authoringRole } from './authoring';
import { AppError } from './errors';
import { keyOfAccessToken } from './agent-oauth';
import { writingGuide } from './writing-guide';
import { blockForms, mayPublish, type AuthoringAction, type AuthoringResponse, type AuthoringWorkspace } from '@/shared/authoring';
import {
  agentCodePattern, agentCodePrefix, agentKeyDays, agentKeyLimits,
  type AgentKeyResponse, type AgentKeysView, type AgentKeyView,
} from '@/shared/agent';

const keyActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('key.issue'), name: z.string().trim().min(1).max(agentKeyLimits.maxName),
    days: z.literal([...agentKeyDays]), mayPublish: z.boolean() }).strict(),
  z.object({ action: z.literal('key.revoke'), keyId: z.string().min(1).max(191) }).strict(),
]);

type KeyRow = AgentKey & { grants?: { lastUsedAt: Date | null; client: { name: string } }[] };
const viewOf = (key: KeyRow): AgentKeyView => ({
  id: key.id, name: key.name, hint: key.hint, mayPublish: key.mayPublish,
  expiresAt: key.expiresAt.toISOString(), lastUsedAt: key.lastUsedAt?.toISOString() ?? null, createdAt: key.createdAt.toISOString(),
  connections: (key.grants ?? []).map((grant) => ({ name: grant.client.name, lastUsedAt: grant.lastUsedAt?.toISOString() ?? null })),
});

/**
 * The codes an author makes for an AI, from the editor. Making one needs the author's own sign-in,
 * and a code can only ever do what that account may do; a code that publishes needs an account that
 * publishes. A code that has run out is of no use to anyone, so it is removed the next time its owner
 * looks rather than listed.
 */
export class AgentKeyService {
  constructor(private db: PrismaClient) {}

  private async require(userId: string) {
    const role = await authoringRole(this.db, userId);
    if (!role) throw new AppError(403, 'not_an_author', '콘텐츠를 편집할 권한이 없어요.');
    return role;
  }

  async view(userId: string): Promise<AgentKeysView> {
    const role = await this.require(userId);
    await this.db.agentKey.deleteMany({ where: { userId, expiresAt: { lte: new Date() } } });
    const keys = await this.db.agentKey.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      // A connection counts once it has tokens; one that stopped at the sign-in page is not one.
      include: { grants: { where: { accessHash: { not: null } }, orderBy: { createdAt: 'asc' }, select: { lastUsedAt: true, client: { select: { name: true } } } } } });
    return { keys: keys.map(viewOf), mayPublish: mayPublish(role) };
  }

  async act(userId: string, input: unknown): Promise<AgentKeyResponse> {
    const action = keyActionSchema.parse(input);
    const role = await this.require(userId);
    if (action.action === 'key.revoke') {
      await this.db.agentKey.deleteMany({ where: { id: action.keyId, userId } });
      return { view: await this.view(userId) };
    }
    if (action.mayPublish && !mayPublish(role)) throw new AppError(403, 'not_a_publisher', '발행은 관리자만 할 수 있어서, 발행하는 코드도 관리자만 만들 수 있어요.');
    const current = await this.view(userId);
    if (current.keys.length >= agentKeyLimits.maxPerAccount) {
      throw new AppError(409, 'too_many_keys', `코드는 한 계정에 ${agentKeyLimits.maxPerAccount}개까지예요. 쓰지 않는 코드를 먼저 거둬 주세요.`);
    }
    const code = `${agentCodePrefix}${randomBytes(32).toString('hex')}`;
    const key = await this.db.agentKey.create({ data: {
      userId, name: action.name, tokenHash: hashSessionToken(code), hint: code.slice(0, agentCodePrefix.length + 6),
      mayPublish: action.mayPublish, expiresAt: new Date(Date.now() + action.days * 86_400_000),
    } });
    return { view: await this.view(userId), issued: { key: viewOf(key), code } };
  }
}

/** How often a key's last use is written down. Each call need not be: the owner wants to know "today", not the second. */
const usageGranularityMs = 60_000;

/**
 * The key a request carries, or a refusal. Only the bearer header is read: a code is not a cookie, so
 * a browser never sends one on its own and there is no other site's request to guard against. The
 * bearer is the code itself, from a tool that can send a header, or a token a chat app was given
 * when it connected with the code.
 */
export async function agentOf(db: PrismaClient, request: Request): Promise<AgentKey> {
  const bearer = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  const refused = new AppError(401, 'agent_unauthenticated', '코드가 없거나 맞지 않아요. 편집 화면의 「AI 연결」에서 코드를 확인해 주세요.');
  if (!bearer) throw refused;
  const now = new Date();
  const key = agentCodePattern.test(bearer) ? await db.agentKey.findUnique({ where: { tokenHash: hashSessionToken(bearer) } })
    : await keyOfAccessToken(db, bearer);
  if (!key || key.expiresAt <= now) throw refused;
  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > usageGranularityMs) {
    await db.agentKey.update({ where: { id: key.id }, data: { lastUsedAt: now } });
  }
  return key;
}

/**
 * What a code may ask for, and what each does, in the words the guide gives the AI. Lessons only:
 * courses, the placement check, roles and the editor's own settings stay on the screen, and so does
 * deleting a draft, which may be someone's work. Asking a model to write questions is left out too —
 * the AI on the other end is already one, and it would be spending this service's budget to do it.
 */
const agentActions = {
  'lesson.read': '발행된 수업 판본 하나를 읽어요(versionId). 편집하려면 초안을 만들어요.',
  'lesson.create': '아직 없는 새 수업을 코스에 만들고 그 첫 초안을 열어요. lessonKey는 한 번 정하면 바꿀 수 없어요.',
  'draft.create': '수업의 최신 발행판을 복사한 새 초안을 만들어요. 그 수업에 이미 열린 초안이 있으면 새로 만들지 말고 그것을 쓰세요.',
  'draft.save': '초안의 edit 전체를 저장해요. 부분이 아니라 통째로 보내고, 마지막으로 읽은 초안의 updatedAt을 baseUpdatedAt으로 함께 보내요.',
  'draft.validate': '발행 규칙으로 초안을 검사해 draft.issues에 담아 돌려줘요. 발행 전에 issues가 비어야 해요.',
  'draft.review': '사람에게 검토를 요청하거나(asking: true) 거둬요(false). 발행할 수 없는 코드는 여기까지 하고 끝내요.',
  'draft.publish': '초안을 새 판본으로 발행해요. 그때부터 새로 시작하는 학습자가 이것을 받아요. 발행 권한이 있는 코드만 돼요.',
  'draft.tryAnswer': '초안의 문항에 답을 넣어 채점 결과를 봐요. 정답과 흔한 오답이 의도대로 채점되는지 확인할 때 써요.',
  'draft.openHint': '초안의 문항이 보여 줄 힌트를 봐요.',
  'problem.wrongAnswers': '학습자가 실제로 쓴 오답을 많은 순서로 봐요(발행된 문항의 problemVersionId).',
  'problemSet.read': '문제집 판본 하나를 읽어요. 다른 수업의 문항을 가져다 쓸 때 써요.',
  'definition.list': '뜻풀이 목록을 봐요. scopeKind global은 공통 사전, lesson은 그 수업만의 뜻풀이(scopeKey = lessonKey)예요.',
  'definition.save': '뜻풀이를 저장해요. 뜻풀이에는 판본이 없어서 저장하는 순간 학습자에게 보이므로, 발행 권한이 있는 코드만 돼요.',
} satisfies Partial<Record<AuthoringAction['action'], string>>;
type AgentAction = keyof typeof agentActions;
/** What changes what learners see the moment it is done. */
const reachesLearners = new Set<AgentAction>(['draft.publish', 'definition.save']);
const allowed = (action: string): action is AgentAction => Object.hasOwn(agentActions, action);

const envelope = z.object({ action: z.string().max(60) }).passthrough();
const saveEnvelope = z.object({ baseUpdatedAt: z.string().datetime() }).passthrough();

type AgentWorkspace = Omit<AuthoringWorkspace, 'accounts' | 'expertMode' | 'problemWriter'>;
/** The editor's lists, without what belongs to the screen: who holds which role, and its own settings. */
const workspaceOf = ({ accounts: _accounts, expertMode: _expert, problemWriter: _writer, ...rest }: AuthoringWorkspace): AgentWorkspace => rest;

/**
 * Lesson editing for an AI holding a code. Every action is the editor's own — the same service, the
 * same checks, written as the code's account — so nothing here decides what a lesson may be. What it
 * adds is the fence around them: which actions a code reaches, that publishing needs a code made for
 * it, and that a save states which draft it was made from, because an AI and a person in the editor
 * can both be writing the same draft and neither would otherwise know.
 */
export class AgentService {
  private authoring: AuthoringService;
  constructor(private db: PrismaClient, private key: AgentKey) {
    // No model writes questions on this path, so the editor's writer is never asked for.
    this.authoring = new AuthoringService(db, () => null);
  }

  async workspace(): Promise<AgentWorkspace> {
    const workspace = await this.authoring.workspace(this.key.userId);
    if (!workspace.role) throw new AppError(403, 'not_an_author', '이 코드의 계정에 더는 편집 권한이 없어요.');
    return workspaceOf(workspace);
  }

  draft(draftId: string) {
    return this.authoring.draft(this.key.userId, draftId);
  }

  async act(input: unknown): Promise<Omit<AuthoringResponse, 'workspace'>> {
    const { action } = envelope.parse(input);
    if (!allowed(action)) throw new AppError(403, 'agent_action', `이 코드로는 할 수 없는 동작이에요: ${action}. 쓸 수 있는 동작은 GET /api/v1/agent의 actions에 있어요.`);
    if (reachesLearners.has(action) && !this.key.mayPublish) {
      throw new AppError(403, 'agent_publish', '이 코드는 발행할 수 없어요. draft.review로 검토를 요청해 주세요.');
    }
    let body = input as Record<string, unknown>;
    if (action === 'draft.save') {
      const { baseUpdatedAt, ...rest } = saveEnvelope.parse(input);
      const row = await this.db.contentDraft.findUnique({ where: { id: String(rest.draftId ?? '') }, select: { updatedAt: true } });
      // A draft that is not there, or not this account's to open, is the service's to refuse.
      if (row && row.updatedAt.getTime() !== new Date(baseUpdatedAt).getTime()) {
        throw new AppError(409, 'draft_changed', `읽은 뒤에 초안이 바뀌었어요(지금 updatedAt ${row.updatedAt.toISOString()}). 초안을 다시 읽고, 바뀐 내용 위에 고친 것을 다시 얹어 주세요.`);
      }
      body = rest;
    }
    console.info(JSON.stringify({ event: 'agent_action', keyId: this.key.id, userId: this.key.userId, action }));
    const { workspace: _, ...rest } = await this.authoring.act(this.key.userId, body);
    return rest;
  }

  /** Everything an AI needs to begin, from the one call it is told to make first. */
  async guide() {
    const [account, role] = await Promise.all([
      this.db.user.findUnique({ where: { id: this.key.userId }, select: { displayName: true } }),
      authoringRole(this.db, this.key.userId),
    ]);
    if (!role) throw new AppError(403, 'not_an_author', '이 코드의 계정에 더는 편집 권한이 없어요.');
    return {
      you: { account: account?.displayName ?? '', role, key: this.key.name, mayPublish: this.key.mayPublish && mayPublish(role),
        expiresAt: this.key.expiresAt.toISOString() },
      endpoints: [
        { method: 'GET', path: '/api/v1/agent', says: '이 안내.' },
        { method: 'GET', path: '/api/v1/agent?view=workspace', says: '코스·수업·초안·개념·문제집 목록.' },
        { method: 'GET', path: '/api/v1/agent?draftId=<id>', says: '초안 하나. draft.edit가 저장할 때 보내는 형태 그대로예요.' },
        { method: 'POST', path: '/api/v1/agent', says: '동작 하나. 본문은 JSON {"action": "...", ...}. 응답은 그 동작의 결과(draft 등)예요.' },
      ],
      workflow: [
        'GET ?view=workspace로 고칠 수업의 lessonKey를 찾아요. lessons[].hasDraft가 true면 drafts에서 그 수업의 열린 초안(status가 published가 아닌 것)을 찾아요.',
        '열린 초안이 있으면 GET ?draftId=로 읽어요. 없으면 {"action":"draft.create","lessonKey":"..."}로 만들어요. 남이 쓰던 초안(mine: false)이면 고치기 전에 사람에게 물어요.',
        '받은 draft.edit를 고쳐 {"action":"draft.save","draftId":"...","baseUpdatedAt":"<draft.updatedAt>","edit":{...}}로 보내요. 서버가 정리한 응답의 draft.edit와 draft.updatedAt을 다음 저장의 기준으로 써요.',
        '{"action":"draft.validate","draftId":"..."}로 검사하고, draft.issues가 빌 때까지 고쳐요. issue에는 sectionId·blockId·problemVersionId·field가 붙어 어디가 문제인지 알려 줘요.',
        '문항을 고쳤으면 draft.tryAnswer로 정답과 흔한 오답이 의도대로 채점되는지 확인해요.',
        '끝나면 발행 권한이 없는 코드는 {"action":"draft.review","draftId":"...","asking":true}로 검토를 요청하고 끝내요. 발행 권한이 있어도, 사람이 발행하라고 하지 않았다면 검토 요청까지만 해요.',
        '무엇을 왜 바꿨는지 사람에게 짧게 보고해요.',
      ],
      rules: [
        '발행된 판본은 바뀌지 않아요. 고치면 다음 판본이 되고, 수강 중인 학습자는 시작한 판본을 끝까지 봐요.',
        'blockId는 문서 전체(단계의 블록과 문항의 지문·힌트·해설)에서 겹치면 안 돼요. 새 블록에는 쓰이지 않은 새 이름을 붙여요.',
        '발행된 문항을 고치면 서버가 새 problemVersionId를 붙이고 활동의 참조를 옮겨요. 저장 응답의 edit를 기준으로 이어 가요.',
        '사람이 같은 초안을 편집 화면에 열어 두면 서로의 저장이 덮어써요. draft_changed(409)를 받으면 초안을 다시 읽고, 바뀐 내용 위에 고친 것을 다시 얹어요.',
        '수식은 $...$ 안에 LaTeX로 써요. 수식 안에 한글을 넣지 않고, 단위와 조사는 수식 밖에 둬요. 단계 제목과 그림의 alt는 평문이에요.',
        '블록의 payload 형식은 blocks[].payloadSchema예요. 거기 다 담기지 않는 규칙(채운 칸 ≤ 전체 칸 등)은 draft.validate가 알려 줘요.',
        '수업 본문과 문항은 writingGuide를 따라 써요.',
        '오류 응답은 {"error":{"code","message"}}예요. message는 사람에게 그대로 보여 줘도 되는 말이에요.',
      ],
      actions: authoringActionSchema.options.flatMap((option) => {
        const action = option.shape.action.value;
        if (!allowed(action)) return [];
        const schema = z.toJSONSchema(option, { unrepresentable: 'any', io: 'input' }) as { properties?: Record<string, unknown>; required?: string[] };
        if (action === 'draft.save') {
          schema.properties = { ...schema.properties, baseUpdatedAt: { type: 'string', format: 'date-time', description: '마지막으로 읽은 초안의 updatedAt' } };
          schema.required = [...(schema.required ?? []), 'baseUpdatedAt'];
        }
        return [{ action, says: agentActions[action], mayUse: !reachesLearners.has(action) || this.key.mayPublish, schema }];
      }),
      blocks: blockForms.filter((form) => !form.retired).map((form) => ({
        kind: form.kind, typeVersion: form.typeVersion, label: form.label, hint: form.hint, example: form.create(),
        payloadSchema: z.toJSONSchema(blockSchemas[`${form.kind}@${form.typeVersion}` as keyof typeof blockSchemas], { unrepresentable: 'any', io: 'input' }),
      })),
      writingGuide,
    };
  }
}
