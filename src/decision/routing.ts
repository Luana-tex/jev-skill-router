import type { CoverageResult } from './adaptive.js';
import type { Skill } from '../discovery.js';
import type { createSelectionCache } from './cache.js';
import { localTaskReason } from './prefilter.js';
import type { JudgmentProvider } from './judgment.js';
import { selectSkills, selectionBatchSize, selectionLimits } from './selection.js';
import type { SelectedSkill, SelectionOptions } from './selection.js';

interface RoutingOptions extends SelectionOptions {
  model: string;
  baseline?: boolean;
  prefilter?: boolean;
  cache?: ReturnType<typeof createSelectionCache>;
  excludeSkills?: readonly string[];
  onlySkills?: readonly string[];
}

// Increment when routing, selection or judgment semantics change.
export const legacyPolicyVersion = 'routing-3.1';
export const adaptivePolicyVersion = 'adaptive-4.3';

export async function routeSkills(
  catalog: readonly Skill[],
  task: string,
  provider: JudgmentProvider,
  options: RoutingOptions,
) {
  task = task.trim();
  if (!task) throw new Error('Informe uma solicitação para avaliar.');

  const limits = selectionLimits.parse(options);
  const exclusions = new Set(options.excludeSkills);
  const allowed = new Set(options.onlySkills);
  const skills = catalog.filter(({ name }) => !exclusions.has(name) && (!allowed.size || allowed.has(name)));
  const minimumSkipped = limits.maxSkills ? Math.ceil(skills.length / selectionBatchSize) : 0;
  if (!skills.length || !limits.maxSkills) {
    return { selected: [], reason: limits.maxSkills ? 'no-candidates' : 'zero-limit', outcome: 'selection-skipped', cache: 'bypassed', callsAvoided: 0 } as const;
  }

  const baseline = options.baseline === true;
  const adaptive = !baseline && !!options.needs?.length && !!provider.judgeCoverage;
  const customCriteria = options.relevanceCriteria || options.redundancyCriteria;
  if (!baseline && options.prefilter !== false && !customCriteria && !adaptive && !allowed.size) {
    const reason = localTaskReason(task, new Set(catalog.map(({ name }) => name)));
    if (reason) {
      return { selected: [], reason, outcome: 'local-no-judgment', cache: 'bypassed', callsAvoided: minimumSkipped } as const;
    }
  }

  let cacheStatus: 'bypassed' | 'miss' | 'unavailable' = 'bypassed';
  let entry: Awaited<ReturnType<NonNullable<RoutingOptions['cache']>['entry']>> | undefined;
  if (!baseline && options.cache) {
    try {
      entry = await options.cache.entry([
        legacyPolicyVersion, task, catalog.map(({ name, description, path, scope }) => [name, description, path, scope]),
        options.model, limits, options.relevanceCriteria, options.redundancyCriteria,
        options.technologies, [...exclusions].sort(), [...allowed].sort(), options.prefilter !== false,
        ...(adaptive ? [adaptivePolicyVersion, options.needs, options.maxContextTokens, catalog.map(({ contextTokens }) => contextTokens)] : []),
      ]);
      const saved = await entry.read();
      if (saved && saved.selected.length <= limits.maxSkills
          && new Set(saved.selected.map(({ index }) => index)).size === saved.selected.length
          && saved.selected.every(({ index, relevance }) => skills[index] && relevance >= limits.minRelevance)) {
        const selected = saved.selected.map(({ index, relevance }) => ({ ...skills[index]!, relevance }));
        return {
          selected, reason: 'cached-selection', outcome: selected.length ? 'skills-selected' : 'no-relevant-skills',
          cache: 'hit', callsAvoided: saved.baselineCalls, ...(saved.coverage ? { coverage: saved.coverage } : {}),
        } as const;
      }
      cacheStatus = 'miss';
    } catch {
      cacheStatus = 'unavailable';
    }
  }

  let coverage: CoverageResult | undefined;
  let baselineCalls = 0;
  let actualCalls = 0;
  const selected: SelectedSkill[] = await selectSkills(skills, task, provider, {
    ...options, ...limits, optimizeRedundancy: !baseline, needs: adaptive ? options.needs : undefined,
    onCoverage: (result) => { coverage = result; },
    onCallCounts: (baselineCount, actualCount) => {
      baselineCalls = baselineCount;
      actualCalls = actualCount;
    },
  });
  if (entry) {
    try {
      await entry.write({
        baselineCalls,
        coverage,
        selected: selected.map(({ name, relevance }) => ({
          index: skills.findIndex((skill) => skill.name === name), relevance,
        })),
      });
    } catch {
      cacheStatus = 'unavailable';
    }
  }
  return {
    selected,
    reason: baseline ? 'baseline' : adaptive ? 'adaptive-coverage' : options.prefilter === false ? 'prefilter-disabled' : 'needs-judgment',
    outcome: selected.length ? 'skills-selected' : 'no-relevant-skills',
    cache: cacheStatus,
    ...(coverage ? { coverage } : {}),
    callsAvoided: Math.max(0, baselineCalls - actualCalls),
  } as const;
}
