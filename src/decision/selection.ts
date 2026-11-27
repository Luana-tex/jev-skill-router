import { adaptiveSelection, defaultContextBudget } from './adaptive.js';
import type { CoverageResult } from './adaptive.js';
import { z } from 'zod';
import type { Skill } from '../discovery.js';
import { redundancyCriteria, relevanceCriteria } from './judgment.js';
import type { JudgmentBatch, JudgmentCriteria, JudgmentProvider, RedundancyPair } from './judgment.js';

export const selectionLimits = z.object({
  minRelevance: z.number().min(0).max(1).default(0.7),
  minRedundancy: z.number().min(0).max(1).default(0.8),
  maxSkills: z.number().int().nonnegative().default(5),
});

export interface SelectionOptions extends z.input<typeof selectionLimits> {
  relevanceCriteria?: JudgmentCriteria;
  redundancyCriteria?: JudgmentCriteria;
  technologies?: readonly string[];
  optimizeRedundancy?: boolean;
  needs?: readonly string[];
  maxContextTokens?: number;
  onCoverage?: (result: CoverageResult) => void;
  onEvaluated?: (name: string, score: number) => void;
  onDecision?: (decision: SelectionDecision) => void;
  onCallCounts?: (baselineCalls: number, actualCalls: number) => void;
}

export type SelectionDecision = {
  name: string;
  decision: 'selected' | 'below-relevance' | 'redundant' | 'selection-limit' | 'covered-by-set' | 'adaptive-limit';
  relevance: number;
  coveredBy?: string;
};

export const selectionBatchSize = 16;
export type SelectedSkill = Skill & { relevance: number };

function validProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function toJudgmentText(text: string, skillNames?: ReadonlySet<string>): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, '[código omitido]')
    .replace(/`([^`\r\n]+)`/g, (_match, name: string) =>
      skillNames?.has(name.toLowerCase()) ? name : '[trecho omitido]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL omitida]')
    .replace(/(?:file:\/\/|[a-z]:[\\/]|\\\\|~\/|\.\.?\/|(?<![\w:/])\/(?!\/))[^\s<>"'`]+/gi, '[caminho omitido]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[e-mail omitido]');
}

export async function selectSkills(
  skills: readonly Skill[],
  task: string,
  provider: JudgmentProvider,
  options: SelectionOptions = {},
) {
  const limits = selectionLimits.parse(options);
  const cleanTask = toJudgmentText(task.trim(), new Set(skills.map(({ name }) => name)));
  if (!cleanTask) throw new Error('Informe uma solicitação para avaliar.');

  const selected: SelectedSkill[] = [];
  if (skills.length === 0 || limits.maxSkills === 0) return selected;

  const candidates = skills.map((skill) => ({
    skill,
    data: { name: skill.name, description: toJudgmentText(skill.description) },
  }));
  const judgeCoverage = provider.judgeCoverage?.bind(provider);
  if (options.needs?.length && judgeCoverage) {
    const needs = z.array(z.string().trim().min(1)).min(1).max(8).parse(options.needs);
    const result = await adaptiveSelection(skills, {
      task: cleanTask,
      needs: needs.map((need) => toJudgmentText(need)),
      candidates: candidates.map(({ data }) => data),
      technologies: options.technologies?.map((technology) => toJudgmentText(technology)),
    }, judgeCoverage, {
      ...limits,
      maxContextTokens: options.maxContextTokens ?? defaultContextBudget,
      onDecision: options.onDecision,
      onEvaluated: options.onEvaluated,
    });
    options.onCallCounts?.(result.calls, result.calls);
    options.onCoverage?.(result.coverage);
    return result.selected;
  }

  let baselineCalls = 0;
  let actualCalls = 0;
  function context(criteria: JudgmentCriteria) {
    return {
      task: cleanTask,
      criteria: { true: toJudgmentText(criteria.true), false: toJudgmentText(criteria.false) },
      ...(options.technologies?.length ? { technologies: options.technologies.map((technology) => toJudgmentText(technology)) } : {}),
    };
  }
  async function judge(batch: Omit<JudgmentBatch, 'task'>) {
    const probabilities = new Map<string, number>();
    for (let start = 0; start < batch.candidates.length; start += selectionBatchSize) {
      const group = batch.candidates.slice(start, start + selectionBatchSize);
      actualCalls++;
      const result = await provider.judge({ ...batch, ...context(batch.criteria), candidates: group });
      if (result.size !== group.length) throw new Error('Quantidade inválida de julgamentos.');
      for (const { name } of group) {
        const probability = result.get(name);
        if (!validProbability(probability)) {
          throw new Error('Probabilidade de julgamento ausente ou inválida.');
        }
        if (!batch.against) options.onEvaluated?.(name, probability);
        probabilities.set(name, probability);
      }
    }
    return probabilities;
  }

  const relevance = await judge({
    candidates: candidates.map(({ data }) => data),
    criteria: options.relevanceCriteria ?? relevanceCriteria,
  });
  baselineCalls += Math.ceil(candidates.length / selectionBatchSize);
  let remaining = candidates
    .map((candidate) => ({ ...candidate, relevance: relevance.get(candidate.data.name)! }))
    .filter(({ data, relevance }) => {
      if (relevance >= limits.minRelevance) return true;
      options.onDecision?.({ name: data.name, decision: 'below-relevance', relevance });
      return false;
    })
    .sort((a, b) => b.relevance - a.relevance || a.data.name.localeCompare(b.data.name, 'en'));

  const overlapCriteria = options.redundancyCriteria ?? redundancyCriteria;
  let prefetched: Map<string, number> | undefined;
  while (remaining.length > 0) {
    const [best, ...others] = remaining;
    if (!best) break;
    selected.push({ ...best.skill, relevance: best.relevance });
    options.onDecision?.({ name: best.data.name, decision: 'selected', relevance: best.relevance });
    if (selected.length === limits.maxSkills) {
      for (const { data, relevance } of others) {
        options.onDecision?.({ name: data.name, decision: 'selection-limit', relevance });
      }
      break;
    }
    if (!others.length) break;

    const referenceName = best.data.name;
    function retain(name: string, relevance: number, overlap: number) {
      if (overlap < limits.minRedundancy) return true;
      options.onDecision?.({ name, decision: 'redundant', relevance, coveredBy: referenceName });
      return false;
    }

    baselineCalls += Math.ceil(others.length / selectionBatchSize);
    if (prefetched) {
      remaining = others.filter(({ data, relevance }) =>
        retain(data.name, relevance, prefetched!.get(JSON.stringify([best.data.name, data.name]))!));
      continue;
    }
    const redundancy = await judge({
      candidates: others.map(({ data }) => data), against: best.data, criteria: overlapCriteria,
    });
    remaining = others.filter(({ data, relevance }) => retain(data.name, relevance, redundancy.get(data.name)!));

    const count = remaining.length;
    if (options.optimizeRedundancy && selected.length === 1 && count >= 3
        && count < limits.maxSkills && count * (count - 1) / 2 <= selectionBatchSize
        && provider.judgeRedundancyPairs) {
      const pairs: RedundancyPair[] = remaining.flatMap(({ data: reference }, index) =>
        remaining.slice(index + 1).map(({ data: candidate }) => ({ reference, candidate })));
      actualCalls++;
      const probabilities = await provider.judgeRedundancyPairs({ ...context(overlapCriteria), pairs });
      if (probabilities.length !== pairs.length || pairs.some((_, index) => !validProbability(probabilities[index]))) {
        throw new Error('Probabilidade de redundância ausente ou inválida.');
      }
      prefetched = new Map(pairs.map(({ reference, candidate }, index) =>
        [JSON.stringify([reference.name, candidate.name]), probabilities[index]!]));
    }
  }
  options.onCallCounts?.(baselineCalls, actualCalls);
  return selected;
}
