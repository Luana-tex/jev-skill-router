import { Activity, ArrowUpRight, Database, Network, ScanLine, Sparkles, Timer } from "lucide-react";
import Link from "next/link";
import type { DashboardData, Operation, Range } from "@/lib/analytics";
import { MetricCards } from "@/components/metric-cards";
import { Neural } from "@/components/neural";
import { PerformanceChart } from "@/components/performance-chart";
import { Card, CardHeader } from "@/components/ui/card";

export const number = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 9 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const time = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
export const display = (value: number | null, format = number) => value === null ? "—" : format.format(value);
export const readable = (value: string | null) => value ? value.replaceAll("-", " ") : "Unavailable";

export function RangeLinks({ range, path = "/" }: { range: Range; path?: string }) {
  return <nav className="range" aria-label="Analytics period">{([["all", "All time"], ["7", "7 days"], ["30", "30 days"]] as const).map(([value, label]) =>
    <Link key={value} href={value === "all" ? path : `${path}?range=${value}`} aria-current={range === value ? "true" : undefined}>{label}</Link>)}</nav>;
}

export function Heading({ title, summary, range, path }: { title: string; summary: string; range: Range; path?: string }) {
  return <div className="intro"><div><h1>{title}</h1><p>{summary}</p></div><RangeLinks range={range} path={path} /></div>;
}

export function Blank({ children }: { children: React.ReactNode }) {
  return <div className="blank"><ScanLine size={20} aria-hidden="true" /><p>{children}</p></div>;
}

export function Metrics({ data }: { data: DashboardData }) {
  const { summary } = data;
  return <MetricCards values={[
    display(summary.operations), display(summary.apiCalls), display(data.consumed),
    display(summary.estimatedCostUsd, money), display(data.hitRate, percent), display(summary.callsAvoided),
  ]} />;
}

export function Performance({ data }: { data: DashboardData }) {
  const observed = data.performance.some(({ routing, api }) => routing !== null || api !== null);
  return <Card className="performance">
    <CardHeader><div><h2>Routing performance</h2><p>Latency across recent operations</p></div><Timer size={17} aria-hidden="true" /></CardHeader>
    {observed ? <>
      <div className="legend"><span><i />Total routing</span><span><i />API latency</span></div>
      <PerformanceChart points={data.performance} />
      <div className="sr-only"><table><caption>Routing performance data</caption><thead><tr><th>Operation time (UTC)</th><th>Routing latency</th><th>API latency</th></tr></thead>
        <tbody>{data.performance.map(({ index, time: occurred, routing, api }) =>
          <tr key={index}><td>{time.format(new Date(occurred))}</td><td>{routing === null ? "Unavailable" : `${routing} ms`}</td><td>{api === null ? "Unavailable" : `${api} ms`}</td></tr>)}</tbody>
      </table></div>
    </> : <Blank>Latency will appear after an operation is recorded.</Blank>}
  </Card>;
}

export function Sources({ data }: { data: DashboardData }) {
  const codex = data.sources.find(({ name }) => name === "codex")?.value ?? 0;
  const cli = data.sources.find(({ name }) => name === "cli")?.value ?? 0;
  const total = codex + cli;
  return <Card><CardHeader><div><h2>Decision sources</h2><p>Execution origin · Codex or CLI</p></div><Network size={17} aria-hidden="true" /></CardHeader>
    {total ? <div className="source-content"><div className="donut" style={{ background: `conic-gradient(var(--violet) 0 ${codex / total * 100}%, var(--accent) 0 100%)` }}>
      <div><strong>{number.format(total)}</strong><span>operations</span></div></div>
      <div className="source-legend"><span><i />Codex <strong>{number.format(codex)}</strong></span><span><i />CLI <strong>{number.format(cli)}</strong></span></div>
    </div> : <Blank>Decision sources will appear after an operation is recorded.</Blank>}
  </Card>;
}

export function Strategies({ data }: { data: DashboardData }) {
  const max = Math.max(1, ...data.decisionModes.map(({ value }) => value));
  return <Card className="strategy-panel"><CardHeader><div><h2>Decision strategies</h2><p>How each operation was resolved</p></div><Activity size={17} aria-hidden="true" /></CardHeader>
    {data.decisionModes.length ? <ul className="strategy-bars">{data.decisionModes.map(({ name, value }) =>
      <li key={name} data-mode={name}><div><span>{name}</span><strong>{number.format(value)}</strong></div><div className="strategy-track" aria-hidden="true"><span style={{ width: `${value / max * 100}%` }} /></div></li>)}</ul>
      : <Blank>No routing strategies recorded in this period.</Blank>}
  </Card>;
}

export function Coverage({ data }: { data: DashboardData }) {
  const total = data.coveredNeeds + data.uncoveredNeeds;
  return <Card><CardHeader><div><h2>Task coverage</h2><p>Estimated coverage of declared needs</p></div><ScanLine size={17} aria-hidden="true" /></CardHeader>
    {data.coverageCount ? <div className="coverage">
      <div className="coverage-number"><strong>{total ? percent.format(data.coveredNeeds / total) : "—"}</strong><span>{number.format(data.coverageCount)} operations assessed</span></div>
      <div className="progress" role="meter" aria-label="Covered task needs" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={data.coveredNeeds}><span style={{ width: `${total ? data.coveredNeeds / total * 100 : 0}%` }} /></div>
      <div className="coverage-labels"><span>{number.format(data.coveredNeeds)} covered</span><span>{number.format(data.uncoveredNeeds)} uncovered</span></div>
    </div> : <Blank>Coverage is available for adaptive operations with declared needs.</Blank>}
  </Card>;
}

export function SkillsPanel({ data }: { data: DashboardData }) {
  return <Card><CardHeader><div><h2>Most recommended skills</h2><p>{data.observedUsage ? "Usage evidence is available" : "Actual usage has not been observed"}</p></div><Link className="panel-link" href="/skills" aria-label="Open Skills"><ArrowUpRight size={17} /></Link></CardHeader>
    {data.skills.length ? <ul className="plain-list">{data.skills.map(({ name, recommendations }) =>
      <li key={name}><span className="skill-name"><Sparkles size={15} aria-hidden="true" />{name}</span><strong>{number.format(recommendations)}</strong></li>)}</ul>
      : <Blank>No skill recommendations in this period.</Blank>}
  </Card>;
}

export function ActivityTable({ history }: { history: Operation[] }) {
  return history.length ? <div className="activity-list">
    <div className="activity-head" aria-hidden="true"><span>Operation</span><span>Time (UTC)</span><span>Strategy</span><span>API calls</span><span>Outcome</span></div>
    <ul className="activity-rows">{history.map(({ id, createdAt, latest, metrics, missingAttempts }) => <li key={id} className="activity-row">
      <div className="operation-cell"><span className="operation-icon"><Network size={15} /></span><code title={id}>{id.slice(0, 8)}</code></div>
      <time dateTime={createdAt}>{time.format(new Date(createdAt))}</time><span className="strategy">{readable(latest.strategy)}</span>
      <span className="calls"><span className="mobile-label">API calls </span>{display(metrics.apiCalls)}</span>
      <span className={`tag ${missingAttempts.length ? "tag-warning" : latest.fallback ? "tag-neutral" : "tag-good"}`}>{missingAttempts.length ? "Incomplete" : latest.fallback ? "Fallback" : readable(latest.outcome)}</span>
    </li>)}</ul></div> : <Blank>No recorded operations in this period.</Blank>;
}

export function Diagnostics({ data }: { data: DashboardData }) {
  return <Card><CardHeader><div><h2>Diagnostics</h2><p>Incomplete operations and recorded errors</p></div><Activity size={17} aria-hidden="true" /></CardHeader>
    <ul className="plain-list"><li><span>Incomplete operations</span><strong>{number.format(data.summary.incompleteOperations)}</strong></li>
    <li><span>Operations ending in fallback</span><strong>{number.format(data.summary.fallbacks)}</strong></li>
    {data.diagnoses.slice(0, 8).map(({ id, attempt, code, httpStatus }) => <li key={`${id}:${attempt}`}><span>{readable(code)}</span><code>{httpStatus ?? id.slice(0, 8)}</code></li>)}</ul>
  </Card>;
}

export function Overview({ data, range }: { data: DashboardData; range: Range }) {
  return <>
    <Heading title="Overview" summary="Monitor skill routing, coverage, and API usage." range={range} />
    <section className="engine"><div className="engine-copy"><span className="engine-label"><Sparkles size={14} />Intelligence Engine</span>
      <h2>Agent skill routing</h2><p>See how the router selects skills and how much each operation costs.</p>
      <Link href="/decisions" className="engine-link">View decisions <ArrowUpRight size={14} /></Link>
    </div><Neural /></section>
    {data.partial ? <p role="status" className="notice"><Activity size={17} /> Some measurements are unavailable or belong to incomplete operations.</p> : null}
    {!data.history.length ? <p role="status" className="notice"><Database size={17} /> No analytics operations in this period. <Link href="/settings">View analytics setup</Link></p> : null}
    <Metrics data={data} />
    <div className="analysis-grid"><Performance data={data} /><Sources data={data} /></div>
    <div className="details-grid"><Strategies data={data} /><Coverage data={data} /><SkillsPanel data={data} /></div>
    <div className="analysis-grid"><Card><CardHeader><div><h2>Recent activity</h2><p>Latest recorded routing operations</p></div><Link className="panel-link" href="/decisions" aria-label="Open Decisions"><ArrowUpRight size={17} /></Link></CardHeader>
      <ActivityTable history={data.history.slice(0, 5)} />
    </Card><Diagnostics data={data} /></div>
  </>;
}
