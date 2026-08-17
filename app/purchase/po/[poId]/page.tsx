import { notFound } from "next/navigation";
import { PoDetailClient } from "../../../../components/Purchase/PoDetailClient";
import { getPurchaseOrder } from "../../../../services/purchaseOrderService";
import { getSettings } from "../../../../lib/settings";
import { getCurrentUser } from "../../../../lib/auth";
import { can } from "../../../../modules/auth/permissions";
import { NoPermission } from "../../../../components/Auth/NoPermission";

export const dynamic = "force-dynamic";

export default async function PoDetailPage({ params }: { params: Promise<{ poId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!can(currentUser, "purchase", "view")) return <NoPermission module="purchase" />;

  const { poId } = await params;
  const [po, settings] = await Promise.all([getPurchaseOrder(poId), getSettings()]);
  if (!po) notFound();

  return (
    <PoDetailClient
      po={po}
      settings={{
        companyName: settings.companyName,
        address: settings.address,
        phone: settings.phone,
        email: settings.email,
        gstin: settings.gstin,
      }}
    />
  );
}
