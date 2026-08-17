import { QuotationEditor } from "../../../components/Quotations/QuotationEditor";
import { getSettings } from "../../../lib/settings";
import { prisma } from "../../../lib/prisma";
import { toNum } from "../../../lib/decimal";
import { getCurrentUser } from "../../../lib/auth";
import { can } from "../../../modules/auth/permissions";
import { NoPermission } from "../../../components/Auth/NoPermission";

export const dynamic = "force-dynamic";

// New quotation. Accepts ?customerId= so "New quotation" from a customer's
// page arrives with that customer already filled in.
export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!can(currentUser, "quotes", "view")) return <NoPermission module="quotes" />;

  const { customerId } = await searchParams;
  const [settings, presetCustomer] = await Promise.all([
    getSettings(),
    customerId
      ? prisma.customer.findUnique({
          where: { id: customerId },
          select: { id: true, name: true, phone: true, billing: true, delivery: true, refBy: true, salesPerson: true, gstin: true },
        })
      : Promise.resolve(null),
  ]);

  return (
    <QuotationEditor
      quotation={null}
      presetCustomer={presetCustomer}
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
