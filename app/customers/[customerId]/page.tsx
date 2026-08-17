import { notFound } from "next/navigation";
import { CustomerDetailClient } from "../../../components/Customers/CustomerDetailClient";
import { getCustomerDetail } from "../../../services/customerService";
import { getGstRatePct } from "../../../lib/settings";
import { getCurrentUser } from "../../../lib/auth";
import { can } from "../../../modules/auth/permissions";
import { NoPermission } from "../../../components/Auth/NoPermission";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ customerId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!can(currentUser, "customers", "view")) return <NoPermission module="customers" />;

  const { customerId } = await params;
  const customer = await getCustomerDetail(customerId, await getGstRatePct());
  if (!customer) notFound();
  return <CustomerDetailClient customer={customer} />;
}
