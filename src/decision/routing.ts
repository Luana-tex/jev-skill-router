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
const cachePolicy = 'routing-3.1';

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
  const customCriteria = options.relevanceCriteria || options.redundancyCriteria;
  if (!baseline && options.prefilter !== false && !customCriteria && !allowed.size) {
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
        cachePolicy, task, catalog.map(({ name, description, path, scope }) => [name, description, path, scope]),
        options.model, limits, options.relevanceCriteria, options.redundancyCriteria,
        options.technologies, [...exclusions].sort(), [...allowed].sort(), options.prefilter !== false,
      ]);
      const saved = await entry.read();
      if (saved && saved.selected.length <= limits.maxSkills
          && new Set(saved.selected.map(({ index }) => index)).size === saved.selected.length
          && saved.selected.every(({ index, relevance }) => skills[index] && relevance >= limits.minRelevance)) {
        const selected = saved.selected.map(({ index, relevance }) => ({ ...skills[index]!, relevance }));
        return {
          selected, reason: 'cached-selection', outcome: selected.length ? 'skills-selected' : 'no-relevant-skills',
          cache: 'hit', callsAvoided: saved.baselineCalls,
        } as const;
      }
      cacheStatus = 'miss';
    } catch {
      cacheStatus = 'unavailable';
    }
  }

  let baselineCalls = 0;
  let actualCalls = 0;
  const selected: SelectedSkill[] = await selectSkills(skills, task, provider, {
    ...options, ...limits, optimizeRedundancy: !baseline,
    onCallCounts: (baselineCount, actualCount) => {
      baselineCalls = baselineCount;
      actualCalls = actualCount;
    },
  });
  if (entry) {
    try {
      await entry.write({
        baselineCalls,
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
    reason: baseline ? 'baseline' : options.prefilter === false ? 'prefilter-disabled' : 'needs-judgment',
    outcome: selected.length ? 'skills-selected' : 'no-relevant-skills',
    cache: cacheStatus,
    callsAvoided: Math.max(0, baselineCalls - actualCalls),
  } as const;
}
