"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { index: number; time: string; routing: number | null; api: number | null };

const date = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

export function PerformanceChart({ points }: { points: Point[] }) {
  return <div className="figure" role="group" aria-label="Recorded routing latency diagram">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart accessibilityLayer data={points} margin={{ left: -5, right: 15, top: 10, bottom: 2 }}>
        <defs><linearGradient id="routing-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--violet)" stopOpacity={0.31} />
          <stop offset="100%" stopColor="var(--violet)" stopOpacity={0.015} />
        </linearGradient><linearGradient id="api-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.19} />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
        </linearGradient></defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 5" />
        <XAxis dataKey="time" tickFormatter={(value: string) => date.format(new Date(value))} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
        <YAxis width={46} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} tickFormatter={(value: number) => `${value} ms`} />
        <Tooltip labelFormatter={(value) => date.format(new Date(String(value)))} labelStyle={{ color: "var(--foreground)" }} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px" }} />
        <Area dataKey="routing" name="Total routing" type="linear" unit=" ms" stroke="var(--violet)" strokeWidth={2} fill="url(#routing-fill)" isAnimationActive={false} dot={points.length < 2 ? { r: 4 } : false} />
        <Area dataKey="api" name="API latency" type="linear" unit=" ms" stroke="var(--accent)" strokeWidth={2} fill="url(#api-fill)" isAnimationActive={false} dot={points.length < 2 ? { r: 4 } : false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
