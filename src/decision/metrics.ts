import type { RequestMetrics } from './jev.js';

export function routingMetrics(inputUsdPerMillion: number, outputUsdPerMillion: number) {
  const started = performance.now();
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let apiLatencyMs = 0;

  return {
    record(batch: RequestMetrics) {
      calls++;
      inputTokens += batch.usage?.input_tokens ?? 0;
      outputTokens += batch.usage?.output_tokens ?? 0;
      apiLatencyMs += batch.latencyMs;
    },
    summary() {
      return {
        calls, inputTokens, outputTokens, apiLatencyMs,
        latencyMs: Math.round(performance.now() - started),
        estimatedCostUsd: (inputTokens * inputUsdPerMillion + outputTokens * outputUsdPerMillion) / 1_000_000,
      };
    },
  };
}
