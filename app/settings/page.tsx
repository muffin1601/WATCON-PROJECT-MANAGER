import { BackLink } from "../../components/BackLink/BackLink";
import { SettingsForm } from "../../components/Settings/SettingsForm";
import { getSettings } from "../../lib/settings";
import { toNum } from "../../lib/decimal";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
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
          appPassword: s.appPassword,
          // Always blank: the deletion password exists only as a hash and is
          // never sent to the browser.
          deletePassword: "",
        }}
      />
    </>
  );
}
