import { notFound } from "next/navigation";
import { BackLink } from "../../../components/BackLink/BackLink";
import { ProjectDetailClient } from "../../../components/ProjectDetail/ProjectDetailClient";
import { getProjectDetail } from "../../../modules/projects/data";
import { buildProjectViewModel } from "../../../modules/projects/viewModel";
import { getSettings } from "../../../lib/settings";
import { toNum } from "../../../lib/decimal";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params;
  const [project, settings] = await Promise.all([getProjectDetail(id), getSettings()]);
  if (!project) notFound();

  const gstRatePct = toNum(settings.gstRatePct);
  const viewModel = buildProjectViewModel(project, gstRatePct);
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
      />
    </>
  );
}
