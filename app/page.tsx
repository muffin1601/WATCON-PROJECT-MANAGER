import { StatsGrid } from "../components/StatsGrid/StatsGrid";
import { StatCard } from "../components/StatCard/StatCard";
import { DashboardClient } from "../components/Dashboard/DashboardClient";
import { listProjectsForDashboard, toFinProject } from "../modules/projects/data";
import { getGstRatePct } from "../lib/settings";
import { contractValue, dispatchedValue, paidTotal } from "../services/financials";
import { inr } from "../lib/format";

export const dynamic = "force-dynamic";

// Ported from renderDash() — the top stats row + searchable project list.
export default async function DashboardPage() {
  const [projects, gstRatePct] = await Promise.all([listProjectsForDashboard(), getGstRatePct()]);

  const rows = projects.map((p) => {
    const fin = toFinProject(p);
    return {
      id: p.id,
      name: p.name,
      client: p.client,
      site: p.site,
      type: p.type,
      status: p.status,
      contractValue: contractValue(fin, gstRatePct),
      dispatchedValue: dispatchedValue(fin),
      paidTotal: paidTotal(p.payments.map((x) => ({ amount: Number(x.amount) }))),
    };
  });

  const totC = rows.reduce((s, r) => s + r.contractValue, 0);
  const totD = rows.reduce((s, r) => s + r.dispatchedValue, 0);
  const totP = rows.reduce((s, r) => s + r.paidTotal, 0);
  const activeCount = projects.filter((p) => p.status !== "COMPLETED").length;

  return (
    <>
      <StatsGrid>
        <StatCard label="Active Projects" value={String(activeCount)} highlight />
        <StatCard label="Total Contract Value" value={inr(totC)} />
        <StatCard label="Material Sent (value)" value={inr(totD)} />
        <StatCard label="Payments Received" value={inr(totP)} tone="pos" />
        <StatCard label="Outstanding" value={inr(Math.max(totD - totP, 0))} tone={totD - totP > 0 ? "neg" : undefined} />
      </StatsGrid>
      <div style={{ marginTop: 20 }}>
        <DashboardClient projects={rows} />
      </div>
    </>
  );
}
