import { notFound } from "next/navigation";
import { QuotationEditor } from "../../../components/Quotations/QuotationEditor";
import { getQuotation } from "../../../services/quotationService";
import { getSettings } from "../../../lib/settings";
import { resolveCostRates } from "../../../services/costingService";
import { toNum } from "../../../lib/decimal";
import { getCurrentUser } from "../../../lib/auth";
import { can } from "../../../modules/auth/permissions";
import { NoPermission } from "../../../components/Auth/NoPermission";

export const dynamic = "force-dynamic";

export default async function QuotationDetailPage({ params }: { params: Promise<{ quotationId: string }> }) {
  const currentUser = await getCurrentUser();
  if (!can(currentUser, "quotes", "view")) return <NoPermission module="quotes" />;

  const { quotationId } = await params;
  const [quotation, settings] = await Promise.all([getQuotation(quotationId), getSettings()]);
  if (!quotation) notFound();

  // Costing is internal margin data, gated on its own module.
  const canViewCosting = can(currentUser, "costing", "view");
  const costRates = canViewCosting
    ? Object.fromEntries(await resolveCostRates(quotation.items.map((i) => i.description)))
    : {};

  return (
    <QuotationEditor
      quotation={quotation}
      costRates={costRates}
      canViewCosting={canViewCosting}
      defaultGstPct={toNum(settings.gstRatePct)}
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
