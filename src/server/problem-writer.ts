import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { AppError } from './errors';
import { planSchema } from './ai-practice';
import { solvedSchema, writtenSchema, type ProblemModel, type WrittenProblem } from './problem-generation';

/**
 * The problem writer and the independent solver, as Claude.
 *
 * Sonnet writes at medium effort. Its keys were right at low effort too, but the wrong answers it
 * named were often made up — a computation that does not reach the value, two names on one value —
 * and the checker threw those questions away: 16 of 30 passed at low against 25 of 25 at medium, for
 * about 1.7 times the output (docs/problem-verification.md, 2026-10-16). The solver also gets medium
 * for a short answer, because a slip there turns a good question into one an author has to read.
 *
 * Both requests opt into the server-side fallback, so a request a safety classifier declines is
 * retried on another model instead of failing; a decline that survives that is reported.
 */
const model = 'claude-sonnet-5-5';
const fallback = (): { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } => ({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });

/**
 * Whether this deployment can write questions. Without a key neither the editor nor a learner's
 * gathered set reaches for a model. Tests never do: a suite run from a shell that holds a key would
 * otherwise pay for every gathering it exercises, so a test hands in its own writer.
 */
export const problemWriterAvailable = () => !!process.env.ANTHROPIC_API_KEY && process.env.VITEST !== 'true';

function finished(response: { stop_reason: string | null; usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } }, step: string) {
  console.info(JSON.stringify({ event: 'problem_generation', step, model, stop: response.stop_reason,
    input: response.usage.input_tokens, output: response.usage.output_tokens,
    cached: response.usage.cache_read_input_tokens ?? 0, cacheWritten: response.usage.cache_creation_input_tokens ?? 0 }));
  if (response.stop_reason === 'refusal') throw new AppError(502, 'generation_refused', '모델이 이 요청을 거절했어요. 요청을 바꿔 다시 해 보세요.');
  if (response.stop_reason === 'max_tokens') throw new AppError(502, 'generation_truncated', '문제가 너무 길어 끝까지 받지 못했어요. 문제 수를 줄여 다시 해 보세요.');
}

export function claudeProblemModel(client = new Anthropic()): ProblemModel {
  return {
    name: model,
    async write(system, user): Promise<WrittenProblem[]> {
      const response = await client.beta.messages.parse({
        model, max_tokens: 16000, ...fallback(),
        // The instructions are the same for every request, so they are read from the cache after the first.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'medium', format: betaZodOutputFormat(writtenSchema) },
      });
      finished(response, 'write');
      if (!response.parsed_output) throw new AppError(502, 'generation_unreadable', '모델의 답을 문제로 읽지 못했어요. 다시 해 보세요.');
      return response.parsed_output.problems;
    },
    async plan(system, user): Promise<unknown> {
      const response = await client.beta.messages.parse({
        model, max_tokens: 8000, ...fallback(),
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'medium', format: betaZodOutputFormat(planSchema) },
      });
      finished(response, 'plan');
      if (!response.parsed_output) throw new AppError(502, 'generation_unreadable', '기록을 읽은 결과를 받지 못했어요. 다시 해 보세요.');
      return response.parsed_output;
    },
    async solve(system, user): Promise<string> {
      const response = await client.beta.messages.parse({
        model, max_tokens: 4000, ...fallback(),
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'medium', format: betaZodOutputFormat(solvedSchema) },
      });
      finished(response, 'solve');
      return response.parsed_output?.answer ?? '';
    },
  };
}

/** What the editor says when the model could not be reached at all. */
export function writerFailure(reason: unknown): AppError {
  if (reason instanceof AppError) return reason;
  if (reason instanceof Anthropic.RateLimitError) return new AppError(429, 'generation_busy', '지금은 문제를 만드는 요청이 많아요. 잠시 뒤에 다시 해 보세요.');
  if (reason instanceof Anthropic.AuthenticationError || reason instanceof Anthropic.PermissionDeniedError) {
    return new AppError(503, 'generation_unavailable', '문제 생성 설정에 문제가 있어요. 운영자에게 알려 주세요.');
  }
  if (reason instanceof Anthropic.APIError) return new AppError(502, 'generation_failed', '모델에 닿지 못했어요. 잠시 뒤에 다시 해 보세요.');
  throw reason;
}
