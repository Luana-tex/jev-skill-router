import { describe, expect, it } from 'vitest';
import { createJevProvider } from '../src/decision/jev.js';
import { routingMetrics } from '../src/decision/metrics.js';
import { routeSkills } from '../src/decision/routing.js';
import { scenarios, skill } from './fixtures/routing.js';

async function run(scenario: typeof scenarios[number], baseline: boolean) {
  const scores = new Map(scenario.candidates.map((name, index) => [name, scenario.scores[index]]));
  const meter = routingMetrics(0.042, 0);
  let simulatedNetworkMs = 0;
  const provider = createJevProvider({
    apiKey: 'benchmark-key', model: 'jev-latest', timeoutMs: 1000, onMetrics: meter.record,
  }, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, value]) => {
      const { instructions } = value as { instructions: string };
      const names = [...instructions.matchAll(/state\.candidates\[(\d+)\]/g)]
        .map(([, index]) => body.state.candidates[Number(index)].name as string);
      const reference = body.state.reference?.name ?? (names.length === 2 ? names[0] : undefined);
      const candidate = names.at(-1)!;
      const overlap = scenario.redundancy?.some(([from, to]) => reference === from && candidate === to);
      return [id, { type: 'noul', noul: reference ? (overlap ? 0.95 : 0.1) : scores.get(candidate) }];
    }));
    const count = Object.keys(answers).length;
    simulatedNetworkMs += 50 + count;
    return Response.json({
      model: 'jev-latest', answers,
      usage: { input_tokens: Math.ceil(Buffer.byteLength(String(init?.body)) / 4), output_tokens: count * 2 },
    });
  });
  const result = await routeSkills(scenario.candidates.map(skill), scenario.task, provider, {
    ...scenario.options, model: 'jev-latest', baseline,
  });
  const names = result.selected.map(({ name }) => name);
  return {
    names, callsAvoided: result.callsAvoided, simulatedNetworkMs, ...meter.summary(),
    falsePositives: names.filter((name) => !scenario.expected.includes(name)),
    falseNegatives: scenario.expected.filter((name) => !names.includes(name)),
  };
}

describe('benchmark offline', () => {
  it('compara o baseline e o roteamento nas cinco fixtures', async () => {
    const report = [];
    for (const scenario of scenarios) {
      const baseline = await run(scenario, true);
      const optimized = await run(scenario, false);
      for (const result of [baseline, optimized]) {
        expect(result.falsePositives, scenario.name).toEqual([]);
        expect(result.falseNegatives, scenario.name).toEqual([]);
        expect(result.names, scenario.name).toEqual(scenario.expected);
      }
      expect(optimized.callsAvoided).toBe(baseline.calls - optimized.calls);
      report.push({ scenario: scenario.name, baseline, optimized });
    }
    const total = (strategy: 'baseline' | 'optimized', field: 'calls' | 'inputTokens' | 'simulatedNetworkMs') =>
      report.reduce((sum, row) => sum + row[strategy][field], 0);
    expect(total('optimized', 'calls')).toBeLessThan(total('baseline', 'calls'));
    expect(total('optimized', 'inputTokens')).toBeLessThan(total('baseline', 'inputTokens'));
    expect(total('optimized', 'simulatedNetworkMs')).toBeLessThan(total('baseline', 'simulatedNetworkMs'));
    console.table(report.map(({ scenario, baseline, optimized }) => ({
      cenário: scenario,
      chamadas: `${baseline.calls} → ${optimized.calls}`,
      entrada: `${baseline.inputTokens} → ${optimized.inputTokens}`,
      saída: `${baseline.outputTokens} → ${optimized.outputTokens}`,
      'rede simulada (ms)': `${baseline.simulatedNetworkMs} → ${optimized.simulatedNetworkMs}`,
    })));
  });
});
