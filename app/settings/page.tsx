import { BackLink } from "../../components/BackLink/BackLink";
import { SettingsForm } from "../../components/Settings/SettingsForm";
import { getSettings } from "../../lib/settings";
import { toNum } from "../../lib/decimal";
import { getCurrentUser } from "../../lib/auth";
import { can } from "../../modules/auth/permissions";
import { NoPermission } from "../../components/Auth/NoPermission";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const currentUser = await getCurrentUser();
  if (!can(currentUser, "settings", "view")) return <NoPermission module="settings" />;

  const s = await getSettings();
  return (
    <>
      <BackLink href="/">Back</BackLink>
      <SettingsForm
        initial={{
          companyName: s.companyName,
          address: s.address,
          phone: s.phone,
          email: s.email,
          gstin: s.gstin ?? "",
          gstRatePct: toNum(s.gstRatePct),
          challanPrefix: s.challanPrefix,
          challanNext: s.challanNext,
          billPrefix: s.billPrefix,
          quotePrefix: s.quotePrefix,
          quoteNext: s.quoteNext,
          appPassword: s.appPassword,
          // Write-only fields: always blank, and only a boolean says whether a
          // key is stored — the key itself never leaves the server.
          anthropicApiKey: "",
          hasApiKey: !!s.anthropicApiKey,
          // Always blank: the deletion password exists only as a hash and is
          // never sent to the browser.
          deletePassword: "",
        }}
      />
    </>
  );
}
