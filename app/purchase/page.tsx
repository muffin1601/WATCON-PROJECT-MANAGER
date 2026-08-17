import { PurchaseClient } from "../../components/Purchase/PurchaseClient";
import { listRfqs } from "../../services/rfqService";
import { listPurchaseOrders } from "../../services/purchaseOrderService";
import { listVendors } from "../../services/vendorService";
import { prisma } from "../../lib/prisma";
import { getCurrentUser } from "../../lib/auth";
import { can } from "../../modules/auth/permissions";
import { NoPermission } from "../../components/Auth/NoPermission";

export const dynamic = "force-dynamic";

// Ported from renderPurchase(): Rate Inquiries, Purchase Orders, Suppliers.
export default async function PurchasePage() {
  const currentUser = await getCurrentUser();
  if (!can(currentUser, "purchase", "view")) return <NoPermission module="purchase" />;

  const [rfqs, pos, vendors, projects] = await Promise.all([
    listRfqs(),
    listPurchaseOrders(),
    listVendors(),
    // The wizard offers only projects that are still running, as in the prototype.
    prisma.project.findMany({
      where: { status: { not: "COMPLETED" } },
      select: { id: true, name: true, client: true, site: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return <PurchaseClient rfqs={rfqs} pos={pos} vendors={vendors} projects={projects} />;
}
