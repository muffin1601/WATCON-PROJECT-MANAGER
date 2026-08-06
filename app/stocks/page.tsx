import { StocksClient } from "../../components/Stocks/StocksClient";
import { listItemsWithStats } from "../../services/stockService";
import { getSettings } from "../../lib/settings";

export const dynamic = "force-dynamic";

// Ported from renderStocks() — Items & Stocks: one row per item per make,
// auto-created from every project's Sales Order, with stock-in entries and
// cross-project required/delivered/pending and current-stock figures.
export default async function StocksPage() {
  const [items, settings] = await Promise.all([listItemsWithStats(), getSettings()]);
  const companySettings = {
    companyName: settings.companyName,
    address: settings.address,
    phone: settings.phone,
    email: settings.email,
    gstin: settings.gstin,
  };
  return <StocksClient items={items} settings={companySettings} />;
}
