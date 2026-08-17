import { notFound } from "next/navigation";
import { RfqDetailClient } from "../../../../components/Purchase/RfqDetailClient";
import { getRfqDetail } from "../../../../services/rfqService";
import { listVendors } from "../../../../services/vendorService";
import { getSettings } from "../../../../lib/settings";
import { getCurrentUser } from "../../../../lib/auth";
import { can } from "../../../../modules/auth/permissions";
import { NoPermission } from "../../../../components/Auth/NoPermission";

export const dynamic = "force-dynamic";

export default async function RfqDetailPage({ params }: { params: Promise<{ rfqId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!can(currentUser, "purchase", "view")) return <NoPermission module="purchase" />;

  const { rfqId } = await params;
  const [rfq, settings, vendors] = await Promise.all([getRfqDetail(rfqId), getSettings(), listVendors()]);
  if (!rfq) notFound();

  return (
    <RfqDetailClient
      rfq={rfq}
      allVendors={vendors}
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
