import Link from "next/link";
import { ArrowUpRight, Network, Sparkles } from "lucide-react";
import { MetricCards } from "@/components/metric-cards";
import { Neural } from "@/components/neural";
import { Blank, Performance, Sources } from "@/components/overview";
import { Card, CardHeader } from "@/components/ui/card";
import { loadAnalytics } from "@/lib/analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DesignSystem() {
  const data = await loadAnalytics("all").catch(() => null);
  return <>
    <div className="intro"><div><h1>Design system</h1><p>Dashboard components and interaction states.</p></div></div>
    <section className="engine"><div className="engine-copy"><span className="engine-label"><Network size={15} aria-hidden="true" />Intelligence Engine</span>
      <h2>Neural scene</h2><p>Switch themes in the header to preview this surface in light or dark.</p>
      <Link href="/" className="engine-link">Back to Overview <ArrowUpRight size={14} aria-hidden="true" /></Link></div><Neural /></section>
    <section className="grid gap-3"><h2 className="library-heading">Analytical cards</h2><MetricCards values={[]} /></section>
    <div className="analysis-grid">
      <Card className="library-surface"><CardHeader><div><h2>Surfaces & controls</h2><p>Default, hover and keyboard focus</p></div><Sparkles size={17} aria-hidden="true" /></CardHeader>
        <div className="library-swatches"><span>Workspace</span><span>Surface</span><span>Gradient</span></div>
        <div className="library-controls">
          <Link className="panel-link" href="/routing" aria-label="Open Routing"><ArrowUpRight size={17} aria-hidden="true" /></Link>
          <span className="tag tag-good">Recorded</span><span className="tag tag-warning">Incomplete</span><span className="tag tag-neutral">Fallback</span>
        </div>
      </Card>
      <Card><CardHeader><h2>Empty state</h2></CardHeader><Blank>Measurements appear when analytics records an operation.</Blank></Card>
    </div>
    {data ? <div className="analysis-grid"><Performance data={data} /><Sources data={data} /></div> : <Blank>Local chart data is unavailable.</Blank>}
  </>;
}
