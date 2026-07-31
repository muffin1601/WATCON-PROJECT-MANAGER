import { BackLink } from "../../../components/BackLink/BackLink";
import { ProjectForm } from "../../../components/ProjectForm/ProjectForm";
import { getGstRatePct } from "../../../lib/settings";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const gstRatePct = await getGstRatePct();
  return (
    <>
      <BackLink href="/">Back to projects</BackLink>
      <ProjectForm gstRatePct={gstRatePct} />
    </>
  );
}
