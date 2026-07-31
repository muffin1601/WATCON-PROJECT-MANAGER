import { DocHead, type CompanySettings } from "./DocHead";
import styles from "./PrintDoc.module.css";

export interface SiteAccountDocProject {
  name: string;
  client: string;
  site: string | null;
  poNumber: string | null;
  poDate: string | null;
}

export interface SiteAccountFigures {
  basicDispatched: number;
  disc: number;
  gst: number;
  payableToDate: number;
  billed: number;
  unbilled: number;
  received: number;
  balance: number;
}

const n = (x: number) => x.toLocaleString("en-IN", { minimumFractionDigits: 2 });

// Ported from siteAccountDocHTML(p) — running bills table (A) + account
// summary table (B), ending in the BALANCE PAYMENT line.
export function SiteAccountDoc({
  settings,
  project,
  bills,
  figures,
  gstRatePct,
  termsGstExtra,
  dfmt,
  today,
}: {
  settings: CompanySettings;
  project: SiteAccountDocProject;
  bills: { no: string; date: string; grossToDate: number; priorBilled: number; netPayable: number }[];
  figures: SiteAccountFigures;
  gstRatePct: number;
  termsGstExtra: boolean;
  dfmt: (d: string) => string;
  today: string;
}) {
  return (
    <div className={styles.doc}>
      <DocHead settings={settings} />
      <div className={styles.dtitle}>Site Account Statement</div>
      <div className={styles.meta}>
        <div>
          <b>Statement date:</b> {dfmt(today)}
          <br />
          <b>Project:</b> {project.name}
          {project.poNumber ? (
            <>
              <br />
              <b>PO ref:</b> {project.poNumber} dt {dfmt(project.poDate ?? "")}
            </>
          ) : null}
        </div>
        <div style={{ textAlign: "right" }}>
          <b>Client:</b> {project.client}
          <br />
          {project.site || ""}
        </div>
      </div>

      <p style={{ marginTop: 10 }}>
        <b>A. Running bills issued</b>
      </p>
      {bills.length > 0 ? (
        <table className={styles.docTable}>
          <thead>
            <tr>
              <th>Bill No.</th>
              <th>Date</th>
              <th className={styles.r}>Gross to date (₹)</th>
              <th className={styles.r}>Less prior billed (₹)</th>
              <th className={styles.r}>Net billed (₹)</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.no}>
                <td>{b.no}</td>
                <td>{dfmt(b.date)}</td>
                <td className={styles.r}>{n(b.grossToDate)}</td>
                <td className={styles.r}>− {n(b.priorBilled)}</td>
                <td className={styles.r}>{n(b.netPayable)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className={styles.r}>
                <b>Total value of running bills issued</b>
              </td>
              <td className={styles.r}>
                <b>{n(figures.billed)}</b>
              </td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <p style={{ fontSize: 11.5 }}>No running bills issued to date.</p>
      )}

      <p style={{ marginTop: 12 }}>
        <b>B. Account summary</b>
      </p>
      <table className={styles.docTable}>
        <tbody>
          <tr>
            <td>Material sent to site per challans (basic value)</td>
            <td className={styles.r} style={{ width: "22%" }}>
              {n(figures.basicDispatched)}
            </td>
          </tr>
          <tr>
            <td>Less: additional / special discount given</td>
            <td className={styles.r}>− {n(figures.disc)}</td>
          </tr>
          <tr>
            <td>{termsGstExtra ? `Add: GST @ ${gstRatePct}% (extra as per terms)` : "GST included in rates (as per terms)"}</td>
            <td className={styles.r}>{figures.gst ? n(figures.gst) : "—"}</td>
          </tr>
          <tr>
            <td>
              <b>Billable to date (challan basis)</b>
            </td>
            <td className={styles.r}>
              <b>{n(figures.payableToDate)}</b>
            </td>
          </tr>
          <tr>
            <td>Total value of running bills issued</td>
            <td className={styles.r}>{n(figures.billed)}</td>
          </tr>
          <tr>
            <td>
              <b>Unbilled amount as per challans issued</b>
            </td>
            <td className={styles.r}>
              <b>{n(figures.unbilled)}</b>
            </td>
          </tr>
          <tr>
            <td>
              <b>Total payment received till date</b>
            </td>
            <td className={styles.r}>
              <b>{n(figures.received)}</b>
            </td>
          </tr>
          <tr>
            <td>
              <b>BALANCE PAYMENT</b>
            </td>
            <td className={styles.r}>
              <b>{n(figures.balance)}</b>
            </td>
          </tr>
        </tbody>
      </table>
      <p className={styles.note}>
        Unbilled = value of material already dispatched vide challans, not yet covered by a running bill. Balance =
        total billable on challan basis to date, less payments received. E. &amp; O. E.
      </p>
      <div className={styles.sig}>
        <div>Client</div>
        <div>
          For {settings.companyName}
          <br />
          Authorised Signatory
        </div>
      </div>
    </div>
  );
}
