"use client";

import { useState } from "react";
import { Tabs } from "../Tabs/Tabs";
import { StatsGrid } from "../StatsGrid/StatsGrid";
import { StatCard } from "../StatCard/StatCard";
import { ProjectHeader } from "./ProjectHeader";
import { OverviewTab } from "./OverviewTab";
import { SalesOrderTab } from "./SalesOrderTab";
import { PaymentsTab } from "./PaymentsTab";
import { ChallansTab } from "./ChallansTab";
import { TransportTab } from "./TransportTab";
import { BillsTab } from "./BillsTab";
import { SiteAccountsTab } from "./SiteAccountsTab";
import { DiscountsAmendmentsTab } from "./DiscountsAmendmentsTab";
import { DocumentsTab } from "./DocumentsTab";
import { inr } from "../../lib/format";
import type { CompanySettings } from "../PrintDoc/DocHead";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

// Ported from renderProject() — same tab order as the prototype: Overview,
// Sales Order, Challans, Transport, Running Bills, Payments, Site Accounts,
// Discounts & Amendments, Documents.
const TAB_DEFS = [
  { key: "overview", label: "Overview" },
  { key: "so", label: "Sales Order" },
  { key: "challans", label: "Challans" },
  { key: "transport", label: "Transport" },
  { key: "bills", label: "Running Bills" },
  { key: "payments", label: "Payments" },
  { key: "accounts", label: "Site Accounts" },
  { key: "adjust", label: "Discounts & Amendments" },
  { key: "documents", label: "Documents" },
] as const;

type TabKey = (typeof TAB_DEFS)[number]["key"];

export function ProjectDetailClient({
  project,
  settings,
  gstRatePct,
  appPassword,
}: {
  project: ProjectViewModel;
  settings: CompanySettings;
  gstRatePct: number;
  appPassword: string;
}) {
  const [tab, setTab] = useState<TabKey>("overview");
  const f = project.financials;

  return (
    <>
      <ProjectHeader project={project} />
      <div style={{ marginTop: 16 }}>
        <StatsGrid>
          <StatCard label="Contract Value" value={inr(f.contractValue)} highlight />
          <StatCard label="Material Sent" value={inr(f.dispatchedValue)} />
          <StatCard label="Billed (RA)" value={inr(f.billedTotal)} />
          <StatCard label="Received" value={inr(f.paidTotal)} tone="pos" />
          <StatCard label="Balance vs Material" value={inr(f.pending)} tone={f.pending > 0 ? "neg" : "pos"} />
        </StatsGrid>
      </div>
      <Tabs tabs={TAB_DEFS as unknown as { key: TabKey; label: string }[]} active={tab} onChange={setTab} />
      {tab === "overview" && <OverviewTab project={project} />}
      {tab === "so" && <SalesOrderTab project={project} gstRatePct={gstRatePct} appPassword={appPassword} />}
      {tab === "challans" && <ChallansTab project={project} settings={settings} appPassword={appPassword} />}
      {tab === "transport" && <TransportTab project={project} />}
      {tab === "bills" && <BillsTab project={project} settings={settings} gstRatePct={gstRatePct} />}
      {tab === "payments" && <PaymentsTab project={project} />}
      {tab === "accounts" && <SiteAccountsTab project={project} settings={settings} gstRatePct={gstRatePct} />}
      {tab === "adjust" && <DiscountsAmendmentsTab project={project} />}
      {tab === "documents" && <DocumentsTab project={project} />}
    </>
  );
}
