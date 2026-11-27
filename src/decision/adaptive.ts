import type { Skill } from '../discovery.js';
import type { CoverageBatch, JudgmentProvider } from './judgment.js';
import type { SelectedSkill, SelectionDecision } from './selection.js';

export const defaultContextBudget = 8192;
const defaultSkillContextTokens = 1024;
const coverageQuestionsPerBatch = 32;
const coverageCandidatesPerBatch = 16;

export interface CoverageResult {
  covered: number[];
  uncovered: number[];
  estimatedContextTokens: number;
}

type Options = {
  minRelevance: number;
  maxSkills: number;
  maxContextTokens: number;
  onDecision?: (decision: SelectionDecision) => void;
};

interface Plan {
  mask: number;
  cost: number;
  quality: number;
  skills: SelectedSkill[];
}

function bitCount(mask: number) {
  let count = 0;
  for (; mask; mask &= mask - 1) count++;
  return count;
}

export async function adaptiveSelection(
  catalog: readonly Skill[],
  context: CoverageBatch,
  judge: NonNullable<JudgmentProvider['judgeCoverage']>,
  options: Options,
) {
  const { candidates, needs } = context;
  if (!options.maxContextTokens) {
    return {
      selected: [], calls: 0,
      coverage: { covered: [], uncovered: needs.map((_, index) => index), estimatedContextTokens: 0 },
    };
  }
  const batchSize = Math.min(coverageCandidatesPerBatch, Math.floor(coverageQuestionsPerBatch / needs.length));
  const probabilities: Array<readonly number[]> = [];
  let calls = 0;
  for (let index = 0; index < candidates.length; index += batchSize) {
    const chunk = candidates.slice(index, index + batchSize);
    const scores = await judge({ ...context, candidates: chunk });
    if (scores.length !== chunk.length || scores.some((row) =>
      row.length !== needs.length || row.some((score) => !Number.isFinite(score) || score < 0 || score > 1))) {
      throw new Error('Julgamento de cobertura inválido.');
    }
    probabilities.push(...scores);
    calls++;
  }

  const plans = new Map<string, Plan>([['0:0', { mask: 0, cost: 0, quality: 0, skills: [] }]]);
  const assessed = catalog.map((skill, index) => {
    const scores = probabilities[index]!;
    const mask = scores.reduce((mask, score, need) => score >= options.minRelevance ? mask | (1 << need) : mask, 0);
    return { skill: { ...skill, relevance: Math.max(...scores) }, mask };
  });
  for (const { skill, mask } of assessed) {
    if (!mask) continue;
    const estimatedCost = skill.contextTokens ?? defaultSkillContextTokens;
    for (const plan of [...plans.values()]) {
      const nextMask = plan.mask | mask;
      const length = plan.skills.length + 1;
      const cost = plan.cost + estimatedCost;
      if (nextMask === plan.mask || length > options.maxSkills || cost > options.maxContextTokens) continue;
      const key = `${nextMask}:${length}`;
      const previous = plans.get(key);
      const quality = plan.quality + skill.relevance;
      if (previous && (previous.cost < cost || (previous.cost === cost && previous.quality >= quality))) continue;
      plans.set(key, { mask: nextMask, cost, quality, skills: [...plan.skills, skill] });
    }
  }

  const best = [...plans.values()].sort((a, b) => bitCount(b.mask) - bitCount(a.mask)
    || a.skills.length - b.skills.length || a.cost - b.cost || b.quality - a.quality)[0]!;
  const selected = new Set(best.skills.map(({ name }) => name));
  for (const { skill, mask } of assessed) {
    const decision = selected.has(skill.name) ? 'selected' : !mask ? 'below-relevance'
      : (mask & best.mask) === mask ? 'covered-by-set' : 'adaptive-limit';
    options.onDecision?.({ name: skill.name, relevance: skill.relevance, decision });
  }
  const indices = needs.map((_, index) => index);
  const coverage: CoverageResult = {
    covered: indices.filter((index) => (best.mask & (1 << index)) !== 0),
    uncovered: indices.filter((index) => (best.mask & (1 << index)) === 0),
    estimatedContextTokens: best.cost,
  };
  return { selected: best.skills, calls, coverage };
}
