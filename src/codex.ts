import { basename, isAbsolute, parse } from 'node:path';
import { z } from 'zod';
import type { createSelectionCache } from './decision/cache.js';
import type { JudgmentProvider } from './decision/judgment.js';
import { JevError } from './decision/jev-error.js';
import type { SelectionDecision } from './decision/selection.js';
import { routeSkills } from './decision/routing.js';

const routerName = 'jev-skill-router';
const skillName = z.string().regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*:)?[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine((name) => name.split(':').every((segment) => segment.length <= 64));
const skillPath = z.string().refine((path) => {
  const root = parse(path).root;
  return isAbsolute(path) && !!root && basename(path) === 'SKILL.md'
    && !/[\x00-\x1f\x7f]/.test(path) && !path.split(/[\\/]/).some((part) => part === '..' || part === '.');
});
const candidateSchema = z.strictObject({
  name: skillName,
  description: z.string().trim().min(1).max(1024),
  path: skillPath,
  contextTokens: z.number().int().positive().max(100_000).optional(),
});
const requestSchema = z.strictObject({
  task: z.string().trim().min(1).max(1000),
  needs: z.array(z.string().trim().min(1).max(240)).min(1).max(8).optional(),
  availableSkills: z.array(z.unknown()),
  explicitlySelected: z.array(z.string().min(1)).default([]),
});

interface CodexOptions {
  model: string;
  cache?: ReturnType<typeof createSelectionCache>;
  disabled?: boolean;
  explain?: boolean;
  onEvaluated?: (name: string, score: number) => void;
  onDecision?: (decision: SelectionDecision) => void;
  baseline?: boolean;
  maxSkills?: number;
  minRelevance?: number;
  minRedundancy?: number;
  maxContextTokens?: number;
}

type FallbackReason = 'disabled' | 'invalid-input' | 'explicit-selection' | 'private-input' | 'judgment-failed' | 'network-approval-denied';

export function nativeFallback(reason: FallbackReason, explicit: string[] = []) {
  return { status: 'native-fallback', reason, explicitlySelected: explicit, recommendations: [] } as const;
}

export function codexEarlyFallback(disabled: boolean, approvalDenied: boolean) {
  if (approvalDenied) return nativeFallback('network-approval-denied');
  if (disabled) return nativeFallback('disabled');
  return undefined;
}

export function codexNetworkAction(
  code: JevError['code'] | undefined,
  afterNetworkApproval: boolean,
  receivedHttpResponse: boolean,
) {
  if (afterNetworkApproval || receivedHttpResponse) return undefined;
  if (code === 'network-unavailable' || code === 'network-blocked') return 'request-network-approval-once';
  return undefined;
}

export async function recommendForCodex(input: unknown, provider: JudgmentProvider, options: CodexOptions) {
  if (options.disabled) return nativeFallback('disabled');
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return nativeFallback('invalid-input');
  const { task, needs, availableSkills, explicitlySelected } = parsed.data;

  const explicit = explicitlySelected.filter((name) => name !== routerName);
  if (explicit.length) return nativeFallback('explicit-selection', explicit);

  const accepted: z.infer<typeof candidateSchema>[] = [];
  const rejectedCandidates: Array<{ index: number; fields: string[] }> = [];
  for (const [index, value] of availableSkills.entries()) {
    const candidate = candidateSchema.safeParse(value);
    if (candidate.success) accepted.push(candidate.data);
    else rejectedCandidates.push({
      index,
      fields: [...new Set(candidate.error.issues.map(({ path }) => String(path[0] ?? 'candidate')))],
    });
  }
  const isRouter = (name: string) => name.split(':').at(-1) === routerName;
  const candidates = accepted.filter(({ name }) => !isRouter(name));
  const inputIssues = {
    rejectedCandidates,
    excludedRouter: accepted.some(({ name }) => isRouter(name)),
    excludedDuplicates: [] as string[],
  };
  const credential = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[a-z0-9._~-]{8,}|\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?\S+/i;
  if ([task, ...(needs ?? []), ...candidates.map(({ description }) => description)].some((value) => credential.test(value))) {
    return nativeFallback('private-input');
  }
  const counts = new Map<string, number>();
  for (const { name } of candidates) counts.set(name, (counts.get(name) ?? 0) + 1);

  inputIssues.excludedDuplicates = [...counts].filter(([, count]) => count > 1).map(([name]) => name);
  const decisions: SelectionDecision[] = [];
  const explanation = () => options.explain ? {
    explanation: {
      submitted: [...new Set(accepted.map(({ name }) => name))],
      excludedDuplicates: inputIssues.excludedDuplicates,
      excludedRouter: inputIssues.excludedRouter,
      decisions,
    },
  } : {};
  try {
    const result = await routeSkills(
      candidates.filter(({ name }) => counts.get(name) === 1).map((skill) => ({ ...skill, scope: 'local' })),
      task, provider, { ...options, needs: needs ? [...new Set(needs)] : undefined, onDecision: (decision) => {
        if (options.explain) decisions.push(decision);
        options.onDecision?.(decision);
      } },
    );
    return {
      status: 'advisory',
      reason: result.reason,
      outcome: result.outcome,
      cache: result.cache,
      callsAvoided: result.callsAvoided,
      ...inputIssues,
      ...('coverage' in result ? { coverage: result.coverage } : {}),
      ...explanation(),
      recommendations: result.selected.map(({ name, path, relevance }) => ({ name, path, relevance })),
    } as const;
  } catch (error) {
    const fallback = { ...nativeFallback('judgment-failed'), ...(rejectedCandidates.length || inputIssues.excludedDuplicates.length ? inputIssues : {}), ...explanation() };
    if (!(error instanceof JevError)) return fallback;
    return { ...fallback, diagnostic: { code: error.code, httpStatus: error.httpStatus } };
  }
}
