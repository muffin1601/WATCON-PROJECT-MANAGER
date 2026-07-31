import styles from "./PrintDoc.module.css";

export interface CompanySettings {
  companyName: string;
  address: string;
  phone: string;
  email: string;
  gstin: string | null;
}

// Ported from docHead() — company letterhead block shared by every printed document.
export function DocHead({ settings }: { settings: CompanySettings }) {
  return (
    <div className={styles.dhead}>
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element -- print document, not a Next/Image-optimized page */}
        <img src="/watcon-logo.png" alt={settings.companyName} className={styles.logo} />
        <div className={styles.co}>
          {settings.address}
          {settings.phone ? <><br />Ph: {settings.phone}</> : null}
          {settings.email ? ` · Email: ${settings.email}` : ""}
          {settings.gstin ? <><br />GSTIN: {settings.gstin}</> : null}
        </div>
      </div>
      <div className={styles.coRight}>
        <b>{settings.companyName}</b>
        <br />
        Pools · Water Bodies · Tiles
        <br />
        Fireplaces · Sauna · Steam · Spa
      </div>
    </div>
  );
}
