import { notFound } from "next/navigation";
import { BackLink } from "../../../components/BackLink/BackLink";
import { ProjectDetailClient } from "../../../components/ProjectDetail/ProjectDetailClient";
import { getProjectDetail } from "../../../modules/projects/data";
import { buildProjectViewModel } from "../../../modules/projects/viewModel";
import { getSettings } from "../../../lib/settings";
import { resolveCostRates } from "../../../services/costingService";
import { toNum } from "../../../lib/decimal";
import { getCurrentUser } from "../../../lib/auth";
import { can } from "../../../modules/auth/permissions";
import { NoPermission } from "../../../components/Auth/NoPermission";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: Props) {
  const currentUser = await getCurrentUser();
  if (!can(currentUser, "projects", "view")) return <NoPermission module="projects" />;

  const { id } = await params;
  const [project, settings] = await Promise.all([getProjectDetail(id), getSettings()]);
  if (!project) notFound();

  const gstRatePct = toNum(settings.gstRatePct);
  const viewModel = buildProjectViewModel(project, gstRatePct);
  // Automatic cost rates for the Costing tab, resolved once here rather than
  // per line in the browser.
  const costRates = Object.fromEntries(await resolveCostRates(project.items.map((i) => i.description)));
  const companySettings = {
    companyName: settings.companyName,
    address: settings.address,
    phone: settings.phone,
    email: settings.email,
    gstin: settings.gstin,
  };

  return (
    <>
      <BackLink href="/">All projects</BackLink>
      <ProjectDetailClient
        project={viewModel}
        settings={companySettings}
        gstRatePct={gstRatePct}
        appPassword={settings.appPassword}
        costRates={costRates}
      />
    </>
  );
}
