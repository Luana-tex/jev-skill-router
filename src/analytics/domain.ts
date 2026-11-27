import { z } from 'zod';

export const operationIdSchema = z.uuid();
const metric = z.number().int().nonnegative().nullable();
const identifier = z.string().min(1).max(129).regex(/^[a-z0-9]+(?:[.:_-][a-z0-9]+)*$/i);

const skill = z.object({
  name: identifier,
  evaluated: z.boolean().nullable(),
  recommended: z.boolean().nullable(),
  used: z.null(),
  score: z.number().min(0).max(1).nullable(),
  reason: identifier.nullable(),
  coveredBy: identifier.nullable(),
});

export const attemptSchema = z.object({
  strategy: identifier,
  policyVersion: identifier,
  model: identifier.nullable(),
  requestedModel: identifier.nullable(),
  outcome: identifier.nullable(),
  fallback: identifier.nullable(),
  diagnostic: z.object({ code: identifier, httpStatus: z.number().int().min(100).max(599).nullable() }).nullable(),
  skills: z.array(skill),
  coverage: z.object({
    covered: z.array(z.number().int().nonnegative()),
    uncovered: z.array(z.number().int().nonnegative()),
    estimatedContextTokens: metric,
  }).nullable(),
  apiCalls: metric,
  inputTokens: metric,
  outputTokens: metric,
  apiLatencyMs: metric,
  routingLatencyMs: metric,
  estimatedCostUsd: z.number().nonnegative().nullable(),
  cacheHits: metric,
  cacheMisses: metric,
  callsAvoided: metric,
});

export const recoverySchema = z.strictObject({
  version: z.literal(1),
  id: operationIdSchema,
  attempt: z.union([z.literal(1), z.literal(2)]),
  source: z.enum(['cli', 'codex']),
  recordedAt: z.iso.datetime({ precision: 3 }),
  data: attemptSchema,
});

export type RecoveryEvent = z.infer<typeof recoverySchema>;
export type Attempt = z.infer<typeof attemptSchema>;
export type AnalyticsSkill = Attempt['skills'][number];
export type AnalyticsSource = 'cli' | 'codex';
export type AttemptEvent = {
  id: string;
  projectId: string;
  source: AnalyticsSource;
  recordedAt: string;
  attempt: 1 | 2;
  data: Attempt;
};
export interface HistoryFilter {
  since?: string;
  until?: string;
  projectId?: string;
  limit?: number;
}
