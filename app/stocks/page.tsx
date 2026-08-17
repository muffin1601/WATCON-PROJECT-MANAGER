import { StocksClient } from "../../components/Stocks/StocksClient";
import { ItemSheetClient } from "../../components/Catalog/ItemSheetClient";
import { listItemsWithStats } from "../../services/stockService";
import { listCatalogItems } from "../../services/catalogService";
import { catalogListQuerySchema } from "../../modules/catalog/schema";
import { getSettings } from "../../lib/settings";
import { getCurrentUser } from "../../lib/auth";
import { can } from "../../modules/auth/permissions";
import { NoPermission } from "../../components/Auth/NoPermission";

export const dynamic = "force-dynamic";

// Items & Stocks. Two layers, deliberately kept on one screen because they
// describe the same physical thing from two angles:
//   1. Item Sheet  — the product definition (brands, pricing, bill of materials)
//   2. Stocks      — one row per item+make, with required/delivered/pending
//                    across every project plus physical stock movements.
export default async function StocksPage() {
  const currentUser = await getCurrentUser();
  if (!can(currentUser, "items", "view")) return <NoPermission module="items" />;

  const [items, settings, catalog] = await Promise.all([
    listItemsWithStats(),
    getSettings(),
    listCatalogItems(catalogListQuerySchema.parse({})),
  ]);
  const companySettings = {
    companyName: settings.companyName,
    address: settings.address,
    phone: settings.phone,
    email: settings.email,
    gstin: settings.gstin,
  };
  return (
    <>
      <ItemSheetClient initial={catalog} />
      <StocksClient items={items} settings={companySettings} />
    </>
  );
}
