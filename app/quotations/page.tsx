import { QuotationsClient } from "../../components/Quotations/QuotationsClient";
import { listQuotations } from "../../services/quotationService";
import { quotationListQuerySchema } from "../../modules/quotations/schema";
import { getCurrentUser } from "../../lib/auth";
import { can } from "../../modules/auth/permissions";
import { NoPermission } from "../../components/Auth/NoPermission";

export const dynamic = "force-dynamic";

export default async function QuotationsPage() {
  const currentUser = await getCurrentUser();
  if (!can(currentUser, "quotes", "view")) return <NoPermission module="quotes" />;

  const initial = await listQuotations(quotationListQuerySchema.parse({}));
  return <QuotationsClient initial={initial} />;
}
