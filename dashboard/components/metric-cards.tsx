"use client";

import { AudioLines, CircleDollarSign, Database, Layers3, Radio, Zap } from "lucide-react";
import type { PointerEvent } from "react";
import { Card } from "@/components/ui/card";

const metricDefinitions = [
  ["Total operations", "Recorded routing operations", "violet", Layers3],
  ["API calls", "Recorded transport attempts", "cyan", Radio],
  ["Tokens consumed", "Input and output tokens", "lilac", AudioLines],
  ["Estimated cost", "Across recorded attempts", "mint", CircleDollarSign],
  ["Cache hit rate", "Share of recorded lookups", "indigo", Database],
  ["Calls avoided", "Reported by the router", "magenta", Zap],
] as const;

function updateSpotlight(event: PointerEvent<HTMLElement>) {
  if (event.pointerType !== "mouse") return;
  const card = event.currentTarget;
  const bounds = card.getBoundingClientRect();
  card.style.setProperty("--spot-x", `${event.clientX - bounds.left}px`);
  card.style.setProperty("--spot-y", `${event.clientY - bounds.top}px`);
}

export function MetricCards({ values }: { values: readonly string[] }) {
  return <div className="metrics">{metricDefinitions.map(([label, caption, color, Icon], index) => {
    const value = values[index] ?? "—";
    return <Card className="metric" data-tone={color} key={label} onPointerMove={updateSpotlight}>
      <div className="metric-top"><h2>{label}</h2><span><Icon size={16} aria-hidden="true" /></span></div>
      <strong className="metric-value" data-dense={value.length > 10} aria-label={value === "—" ? "Unavailable" : undefined}>{value}</strong><p>{caption}</p>
    </Card>;
  })}</div>;
}
