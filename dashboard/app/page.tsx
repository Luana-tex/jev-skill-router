import { Overview } from "@/components/overview";
import { loadAnalytics, period } from "@/lib/analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const range = period((await searchParams).range);
  return <Overview data={await loadAnalytics(range)} range={range} />;
}
