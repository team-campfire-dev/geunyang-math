import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { AppError } from './errors';
import { solutionSchema, type Explainer } from './explanation';

/**
 * The writers of a 해설, each behind the same shape so a comparison can hand them the same request.
 *
 * Both run at their deepest ordinary setting — Claude at high effort, Gemini at its high thinking
 * level — because the question is which one explains better, not which one is cheaper at a lower
 * setting. What each was asked, what it answered and what it cost are kept by the caller.
 */

/**
 * Claude Opus. The server-side fallback is on, so a request a safety classifier declines is retried
 * on another model rather than failing; `served` says which model actually wrote it, and a
 * comparison should not count a fallback as Opus.
 */
export function claudeExplainer(client = new Anthropic()): Explainer {
  const model = 'claude-opus-5-5';
  return {
    name: model,
    async explain(system, user) {
      const response = await client.beta.messages.parse({
        model, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'high', format: betaZodOutputFormat(solutionSchema) },
      });
      if (response.stop_reason === 'refusal') throw new AppError(502, 'explanation_refused', '모델이 이 요청을 거절했어요.');
      if (response.stop_reason === 'max_tokens') throw new AppError(502, 'explanation_truncated', '해설을 끝까지 받지 못했어요.');
      if (!response.parsed_output) throw new AppError(502, 'explanation_unreadable', '모델의 답을 해설로 읽지 못했어요.');
      return { solution: response.parsed_output.solution, served: response.model,
        usage: { input: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
          output: response.usage.output_tokens } };
    },
  };
}

const geminiResponse = z.object({
  candidates: z.array(z.object({
    content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })) }).optional(),
    finishReason: z.string().optional(),
  })).optional(),
  modelVersion: z.string().optional(),
  usageMetadata: z.object({ promptTokenCount: z.number().optional(), candidatesTokenCount: z.number().optional(), thoughtsTokenCount: z.number().optional() }).optional(),
  error: z.object({ code: z.number().optional(), message: z.string().optional() }).optional(),
});

export type GeminiTurn = { role: 'user' | 'model'; text: string };
export type GeminiReply = { text: string; served: string; usage: { input: number; output: number; thinking?: number } };

/**
 * One generateContent call to Gemini, over the REST API — there is no SDK for it in this project. The
 * key goes in a header, never the URL. `turns` is the conversation so far, so a caller that sends a
 * reply back with what was wrong in it can ask for it again; `schema`, when given, is the JSON Schema
 * the answer must follow, and without it the answer is still asked for as JSON.
 */
export async function callGemini(system: string, turns: GeminiTurn[], options: { schema?: unknown; model?: string; apiKey?: string } = {}): Promise<GeminiReply> {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Set GEMINI_API_KEY.');
  const model = options.model ?? 'gemini-4-argon';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', signal: AbortSignal.timeout(600_000),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
      generationConfig: { responseMimeType: 'application/json', ...(options.schema ? { responseJsonSchema: options.schema } : {}),
        thinkingConfig: { thinkingLevel: 'high' } },
    }),
  });
  const body = geminiResponse.parse(await response.json());
  if (!response.ok || body.error) throw new AppError(response.status === 429 ? 429 : 502, 'gemini_failed', body.error?.message ?? `Gemini ${response.status}`);
  const candidate = body.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new AppError(502, 'gemini_unfinished', `Gemini가 ${candidate.finishReason}로 멈췄어요.`);
  return { text: (candidate?.content?.parts ?? []).filter((part) => !part.thought).map((part) => part.text ?? '').join(''), served: body.modelVersion ?? model,
    usage: { input: body.usageMetadata?.promptTokenCount ?? 0, output: body.usageMetadata?.candidatesTokenCount ?? 0, thinking: body.usageMetadata?.thoughtsTokenCount } };
}

/** Gemini as a writer of 해설: the same call, with the answer held to the 해설 shape. */
export function geminiExplainer(apiKey = process.env.GEMINI_API_KEY, model = 'gemini-4-argon'): Explainer {
  if (!apiKey) throw new Error('Set GEMINI_API_KEY.');
  const schema = z.toJSONSchema(solutionSchema);
  return {
    name: model,
    async explain(system, user) {
      const reply = await callGemini(system, [{ role: 'user', text: user }], { schema, model, apiKey });
      const parsed = solutionSchema.safeParse((() => { try { return JSON.parse(reply.text); } catch { return null; } })());
      if (!parsed.success) throw new AppError(502, 'explanation_unreadable', '모델의 답을 해설로 읽지 못했어요.');
      return { solution: parsed.data.solution, served: reply.served, usage: reply.usage };
    },
  };
}
