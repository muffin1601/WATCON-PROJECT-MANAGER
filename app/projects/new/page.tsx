import { BackLink } from "../../../components/BackLink/BackLink";
import { ProjectForm } from "../../../components/ProjectForm/ProjectForm";
import { getGstRatePct } from "../../../lib/settings";
import { getCurrentUser } from "../../../lib/auth";
import { can } from "../../../modules/auth/permissions";
import { NoPermission } from "../../../components/Auth/NoPermission";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const currentUser = await getCurrentUser();
  if (!can(currentUser, "projects", "view")) return <NoPermission module="projects" />;

  const gstRatePct = await getGstRatePct();
  return (
    <>
      <BackLink href="/">Back to projects</BackLink>
      <ProjectForm gstRatePct={gstRatePct} />
    </>
  );
}
