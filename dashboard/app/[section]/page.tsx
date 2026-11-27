import { notFound } from "next/navigation";
import { ActivityTable, Blank, Coverage, Diagnostics, Heading, Metrics, Performance, SkillsPanel, Sources, Strategies, display, readable } from "@/components/overview";
import { Card, CardHeader } from "@/components/ui/card";
import { analyticsStatus, loadAnalytics, period } from "@/lib/analytics";
import { items } from "@/lib/navigation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const descriptions: Record<string, string> = {
  decisions: "Inspect recorded decisions and their outcomes.",
  skills: "See which skills the router recommends.",
  projects: "Compare operations by anonymized project.",
  routing: "Inspect strategies, performance, and task coverage.",
  benchmarks: "Run the repeatable offline comparison from the router.",
  usage: "Review recorded token consumption and estimated API costs.",
  diagnostics: "Inspect incomplete operations and provider errors.",
  settings: "Manage the dashboard’s local analytics source.",
};

export default async function Section({ params, searchParams }: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const [{ section }, query] = await Promise.all([params, searchParams]);
  const path = `/${section}`;
  const item = items.find(({ href }) => href === path);
  if (!item) notFound();
  const range = period(query.range);
  const summary = descriptions[section] ?? "";
  if (section === "benchmarks" || section === "settings") {
    return <><div className="intro"><div><h1>{item.label}</h1><p>{summary}</p></div></div>
      {section === "settings" ? <Card><CardHeader><div><h2>Local analytics</h2><p>{analyticsStatus() ? "Recording enabled" : "Recording disabled or unavailable"}</p></div></CardHeader>
        <p className="text-sm text-muted-foreground">Change recording preferences from the router CLI.</p>
        <code className="command">node dist/cli.js analytics enable</code><code className="command">node dist/cli.js analytics disable</code></Card>
        : <Card><CardHeader><div><h2>Offline benchmark</h2><p>Run from the repository root</p></div></CardHeader>
          <code className="command">npm run benchmark</code></Card>}</>;
  }
  const data = await loadAnalytics(range);
  return <><Heading title={item.label} summary={summary} range={range} path={path} />
    {data.partial && <p className="notice" role="status">This period includes unavailable measurements or incomplete operations.</p>}
    {section === "decisions" && <Card><ActivityTable history={data.history.slice(0, 100)} /></Card>}
    {section === "skills" && <SkillsPanel data={data} />}
    {section === "diagnostics" && <Diagnostics data={data} />}
    {section === "usage" && <Metrics data={data} />}
    {section === "routing" && <><div className="analysis-grid"><Performance data={data} /><Sources data={data} /></div><div className="analysis-grid"><Coverage data={data} /><Strategies data={data} /></div>
      <Card><CardHeader><h2>Observed strategies</h2></CardHeader>{data.strategies.length ? <ul className="plain-list">{data.strategies.map(({ name, value }) => <li key={name}><span>{readable(name)}</span><strong>{display(value)}</strong></li>)}</ul> : <Blank>No strategies recorded in this period.</Blank>}</Card></>}
    {section === "projects" && <Card><CardHeader><h2>Anonymized projects</h2></CardHeader>{data.projects.length ? <ul className="plain-list">{data.projects.map(({ project, operations }) => <li key={project}><code title={project}>{project?.slice(0, 12)}</code><span>{display(operations)} operations</span></li>)}</ul> : <Blank>No projects recorded in this period.</Blank>}</Card>}
  </>;
}
