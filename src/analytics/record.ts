import { randomUUID } from 'node:crypto';
import { JevError } from '../decision/jev-error.js';
import { adaptivePolicyVersion, legacyPolicyVersion } from '../decision/routing.js';
import type { CoverageResult } from '../decision/adaptive.js';
import type { RequestMetrics } from '../decision/jev.js';
import type { SelectionDecision } from '../decision/selection.js';
import { persistenceDiagnostic } from './diagnostic.js';
import { operationIdSchema, recoverySchema } from './domain.js';
import type { AnalyticsSkill, AnalyticsSource } from './domain.js';
import { analyticsDirectory, analyticsService } from './service.js';

interface RouteReport {
  reason: string;
  outcome?: string;
  cache?: string;
  callsAvoided?: number;
  coverage?: CoverageResult;
  status?: string;
  diagnostic?: { code: string; httpStatus?: number };
  recommendations?: readonly { name: string; relevance: number }[];
  selected?: readonly { name: string; relevance: number }[];
}

function safeCode(value?: string) {
  return value && /^[a-z0-9]+(?:[.:_-][a-z0-9]+)*$/i.test(value) && value.length <= 129 ? value : null;
}

export function operationRecorder(source: AnalyticsSource, options: {
  disabled?: boolean;
  operationId?: string;
  secondAttempt?: boolean;
} = {}) {
  const operationId = operationIdSchema.safeParse(options.operationId);
  const id = operationId.success ? operationId.data : randomUUID();
  const attempt = options.secondAttempt && operationId.success ? 2 : 1;
  const recordedAt = new Date().toISOString();
  const started = performance.now();
  const skills = new Map<string, AnalyticsSkill>();
  const models = new Set<string>();
  let apiCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let unknownUsage = false;
  let apiLatencyMs = 0;
  let setupFailure = false;
  let service: ReturnType<typeof analyticsService> | undefined;
  if (!options.disabled && process.env.JEV_ANALYTICS !== 'off') {
    try {
      const candidate = analyticsService(analyticsDirectory());
      if (candidate.enabled()) service = candidate;
    } catch {
      setupFailure = true;
      console.error('Analytics local indisponível. O roteamento continuará.');
    }
  }

  function mark(name: string) {
    const previous = skills.get(name);
    if (previous) return previous;
    const entry: AnalyticsSkill = { name, evaluated: null, recommended: null, used: null, score: null, reason: null, coveredBy: null };
    skills.set(name, entry);
    return entry;
  }

  return {
    id,
    onEvaluated: service ? (name: string, score: number) => {
      const entry = mark(name);
      entry.evaluated = true;
      entry.score = score;
    } : undefined,
    onDecision: service ? ({ name, decision, relevance, coveredBy }: SelectionDecision) => {
      const entry = mark(name);
      entry.evaluated = true;
      entry.reason = decision;
      entry.score = relevance;
      entry.coveredBy = coveredBy ?? null;
    } : undefined,
    recordBatch(batch: RequestMetrics) {
      if (!service) return;
      apiCalls++;
      apiLatencyMs += batch.latencyMs;
      const model = safeCode(batch.model);
      if (model) models.add(model);
      if (!batch.usage) unknownUsage = true;
      else {
        inputTokens += batch.usage.input_tokens;
        outputTokens += batch.usage.output_tokens;
      }
    },
    async finish(report: RouteReport, config?: { model: string; inputUsdPerMillion: number; outputUsdPerMillion: number }) {
      if (!service) return setupFailure
        ? { status: 'failed', diagnostic: { code: 'configuration-invalid' } } as const
        : { status: 'disabled' } as const;
      const fallback = report.status === 'native-fallback' ? safeCode(report.reason) : null;
      const recommendations = report.recommendations ?? report.selected;
      if (recommendations && !fallback) {
        for (const entry of skills.values()) entry.recommended = false;
        for (const { name, relevance } of recommendations) {
          const entry = mark(name);
          entry.recommended = true;
          entry.score = relevance;
          entry.evaluated ??= apiCalls > 0 ? null : false;
        }
      }
      const snapshot = recoverySchema.safeParse({ version: 1, id, attempt, source, recordedAt, data: {
        strategy: fallback ? 'fallback' : safeCode(report.reason) ?? 'unknown',
        policyVersion: report.coverage || report.reason === 'adaptive-coverage' ? adaptivePolicyVersion : legacyPolicyVersion,
        model: models.size === 1 ? [...models][0]! : null,
        requestedModel: safeCode(config?.model),
        outcome: safeCode(report.outcome),
        fallback,
        diagnostic: report.diagnostic && safeCode(report.diagnostic.code)
          ? { code: report.diagnostic.code, httpStatus: report.diagnostic.httpStatus ?? null } : null,
        skills: [...skills.values()].filter(({ name }) => safeCode(name)),
        coverage: report.coverage ?? null,
        apiCalls,
        inputTokens: unknownUsage ? null : inputTokens,
        outputTokens: unknownUsage ? null : outputTokens,
        apiLatencyMs,
        routingLatencyMs: Math.round(performance.now() - started),
        estimatedCostUsd: unknownUsage ? null : apiCalls === 0 ? 0 : config
          ? (inputTokens * config.inputUsdPerMillion + outputTokens * config.outputUsdPerMillion) / 1_000_000 : null,
        cacheHits: report.cache && report.cache !== 'unavailable' ? Number(report.cache === 'hit') : null,
        cacheMisses: report.cache && report.cache !== 'unavailable' ? Number(report.cache === 'miss') : null,
        callsAvoided: report.callsAvoided ?? null,
      } });
      if (!snapshot.success) return { status: 'failed', diagnostic: { code: 'invalid-snapshot' } } as const;

      try {
        const status = await service.record(id, attempt, source, process.cwd(), snapshot.data.data, recordedAt);
        return { status };
      } catch (error) {
        const code = persistenceDiagnostic(error);
        console.error('Não foi possível registrar a operação no analytics local.');
        return {
          status: 'failed', diagnostic: { code }, recovery: snapshot.data,
          ...(code === 'write-denied' ? { nextAction: 'request-analytics-write-approval-once' } : {}),
        } as const;
      }
    },
    async fail(error: unknown, config: { model: string; inputUsdPerMillion: number; outputUsdPerMillion: number }) {
      return this.finish({
        reason: 'judgment-failed',
        status: 'native-fallback',
        diagnostic: error instanceof JevError ? { code: error.code, httpStatus: error.httpStatus } : { code: 'internal-error' },
      }, config);
    },
  };
}
