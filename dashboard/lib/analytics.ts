import "server-only";
import { analyticsDirectory, analyticsService, groupStatistics, summarize, topSkills } from "../../src/analytics/service";
import type { Attempt } from "../../src/analytics/domain";

type History = Awaited<ReturnType<ReturnType<typeof analyticsService>["history"]>>;
export type Operation = History[number];
export type Range = "all" | "7" | "30";

export function analyticsStatus() {
  try { return process.env.JEV_ANALYTICS !== "off" && analyticsService(analyticsDirectory()).enabled(); }
  catch { return null; }
}

export function period(value: string | string[] | undefined): Range {
  return value === "7" || value === "30" ? value : "all";
}

function tally(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export async function loadAnalytics(range: Range) {
  const start = range === "all" ? undefined : new Date(Date.now() - Number(range) * 86_400_000).toISOString();
  const history = await analyticsService(analyticsDirectory()).history({ since: start });
  const summary = summarize(history);
  const consumed = summary.inputTokens !== null && summary.outputTokens !== null ? summary.inputTokens + summary.outputTokens : null;
  const cacheLookups = summary.cacheHits !== null && summary.cacheMisses !== null ? summary.cacheHits + summary.cacheMisses : null;
  const covered = history.flatMap(({ latest }) => latest.coverage ? [latest.coverage] : []);
  const coveredNeeds = covered.reduce((sum, entry) => sum + entry.covered.length, 0);
  const uncoveredNeeds = covered.reduce((sum, entry) => sum + entry.uncovered.length, 0);
  const diagnostics = history.flatMap(({ attempts, id }) => attempts.flatMap(({ attempt, data, recordedAt }) =>
    data.diagnostic ? [{ id, attempt, recordedAt, ...data.diagnostic }] : [])).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  return {
    history,
    summary,
    consumed,
    hitRate: cacheLookups && summary.cacheHits !== null ? summary.cacheHits / cacheLookups : null,
    coveredNeeds,
    uncoveredNeeds,
    coverageCount: covered.length,
    diagnoses: diagnostics,
    decisionModes: tally(history.map(({ latest }) => {
      if (latest.fallback) return "Fallback";
      if (latest.strategy === "cached-selection") return "Cache";
      if (latest.outcome === "local-no-judgment") return "Local";
      if (latest.apiCalls && latest.apiCalls > 0) return "JEV";
      return "Not classified";
    })),
    strategies: tally(history.map(({ latest }) => latest.strategy)),
    sources: tally(history.map(({ source }) => source)),
    skills: topSkills(history, 6),
    projects: groupStatistics(history, "project").flatMap((entry) =>
      "project" in entry && typeof entry.project === "string" ? [{ project: entry.project, operations: entry.operations }] : []),
    observedUsage: history.some(({ latest }) => latest.skills.some(({ used }) => used !== null)),
    performance: history.slice(0, 24).reverse().map(({ createdAt, metrics }, index) => ({
      index: index + 1, time: createdAt, routing: metrics.routingLatencyMs, api: metrics.apiLatencyMs,
    })),
    partial: summary.incompleteOperations > 0 || history.some(({ metrics }) => summaryMetrics.some((key) => metrics[key] === null)),
  };
}

const summaryMetrics: Array<keyof Pick<Attempt, "inputTokens" | "outputTokens" | "routingLatencyMs" | "cacheHits">> =
  ["inputTokens", "outputTokens", "routingLatencyMs", "cacheHits"];

export type DashboardData = Awaited<ReturnType<typeof loadAnalytics>>;
