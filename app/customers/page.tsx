import { CustomersClient } from "../../components/Customers/CustomersClient";
import { listCustomers, listReferences } from "../../services/customerService";
import { customerListQuerySchema } from "../../modules/customers/schema";
import { getGstRatePct } from "../../lib/settings";
import { getCurrentUser } from "../../lib/auth";
import { can } from "../../modules/auth/permissions";
import { NoPermission } from "../../components/Auth/NoPermission";

export const dynamic = "force-dynamic";

// Customers & References. The first page is rendered on the server so the
// screen paints with real data immediately; subsequent search/sort/paging is
// fetched client-side from the same /api/customers endpoint.
export default async function CustomersPage() {
  const currentUser = await getCurrentUser();
  if (!can(currentUser, "customers", "view")) return <NoPermission module="customers" />;

  const gstRatePct = await getGstRatePct();
  const [initial, references] = await Promise.all([
    listCustomers(customerListQuerySchema.parse({}), gstRatePct),
    listReferences(gstRatePct),
  ]);
  return <CustomersClient initial={initial} references={references} />;
}
