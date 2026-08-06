import { DocHead, type CompanySettings } from "./DocHead";
import styles from "./PrintDoc.module.css";

export interface BillDocProject {
  name: string;
  client: string;
  site: string | null;
  poNumber: string | null;
  poDate: string | null;
  paymentTerms: string | null;
  termsTransport: string;
}

export interface BillDocLine {
  description: string;
  unit: string | null;
  orderQty: number | null;
  cumQty: number | null;
  rate: number | null;
  amount: number;
  isExtra: boolean;
}

export interface BillDocBill {
  no: string;
  date: string;
  lines: BillDocLine[];
  grossBasic: number;
  discountCum: number;
  discountApplied: number;
  gst: number;
  transportCum: number;
  grossToDate: number;
  priorBilled: number;
  netPayable: number;
}

const n = (x: number) => x.toLocaleString("en-IN", { minimumFractionDigits: 2 });

// Ported from printBill(p,b) — section A (Sales Order supply) + section B
// (extras beyond SO) with their own sub-totals, then the gross/discount/GST/
// prior-billed/net-payable cascade.
export function BillDoc({
  settings,
  project,
  bill,
  gstRatePct,
  dfmt,
}: {
  settings: CompanySettings;
  project: BillDocProject;
  bill: BillDocBill;
  gstRatePct: number;
  dfmt: (d: string) => string;
}) {
  const a = bill.lines.filter((l) => !l.isExtra);
  const b = bill.lines.filter((l) => l.isExtra);
  const subA = a.reduce((s, l) => s + l.amount, 0);
  const subB = b.reduce((s, l) => s + l.amount, 0);
  let sNo = 1;

  const renderLine = (l: BillDocLine, tag: string) => (
    <tr key={sNo}>
      <td>{sNo++}</td>
      <td>
        {l.description}
        {tag ? <i> {tag}</i> : null}
      </td>
      <td>{l.unit ?? ""}</td>
      <td className={styles.r}>{l.orderQty ?? "—"}</td>
      <td className={styles.r}>{l.cumQty ?? "—"}</td>
      <td className={styles.r}>{l.rate !== null ? l.rate.toLocaleString("en-IN") : ""}</td>
      <td className={styles.r}>{tag ? "—" : "—"}</td>
      <td className={styles.r}>{n(l.amount)}</td>
    </tr>
  );

  return (
    <div className={styles.doc}>
      <DocHead settings={settings} />
      <div className={styles.dtitle}>Running Account Bill</div>
      <div className={styles.meta}>
        <div>
          <b>Bill No:</b> {bill.no}
          <br />
          <b>Bill date:</b> {dfmt(bill.date)}
          <br />
          <b>Bill basis:</b> Cumulative material dispatched vide challans up to {dfmt(bill.date)}
        </div>
        <div style={{ textAlign: "right" }}>
          <b>Client:</b> {project.client}
          <br />
          {project.site || ""}
          <br />
          <b>Project:</b> {project.name}
          {project.poNumber ? (
            <>
              <br />
              <b>PO ref:</b> {project.poNumber} dt {dfmt(project.poDate ?? "")}
            </>
          ) : null}
        </div>
      </div>
      <table className={styles.docTable}>
        <thead>
          <tr>
            <th>S.No</th>
            <th>Description</th>
            <th>Unit</th>
            <th className={styles.r}>Order Qty</th>
            <th className={styles.r}>Qty to date</th>
            <th className={styles.r}>Rate (₹)</th>
            <th className={styles.r}>Beyond SO</th>
            <th className={styles.r}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={8} style={{ background: "#f0f0f0" }}>
              <b>A. Supply as per Sales Order / BOQ</b>
            </td>
          </tr>
          {a.map((l) => renderLine(l, ""))}
          <tr>
            <td colSpan={7} className={styles.r}>
              <b>Sub-total A</b>
            </td>
            <td className={styles.r}>
              <b>{n(subA)}</b>
            </td>
          </tr>
          {b.length > 0 && (
            <>
              <tr>
                <td colSpan={8} style={{ background: "#f0f0f0" }}>
                  <b>B. Extra items / quantities sent to site — not in Sales Order</b>
                </td>
              </tr>
              {b.map((l) => renderLine(l, "(beyond SO)"))}
              <tr>
                <td colSpan={7} className={styles.r}>
                  <b>Sub-total B (extras)</b>
                </td>
                <td className={styles.r}>
                  <b>{n(subB)}</b>
                </td>
              </tr>
            </>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={7} className={styles.r}>
              <b>Gross value of work / supply to date (A{b.length ? " + B" : ""})</b>
            </td>
            <td className={styles.r}>
              <b>{n(bill.grossBasic)}</b>
            </td>
          </tr>
          {(bill.discountCum || bill.discountApplied) > 0 && (
            <tr>
              <td colSpan={7} className={styles.r}>
                Less: special discount (to date)
              </td>
              <td className={styles.r}>− {n(bill.discountCum || bill.discountApplied)}</td>
            </tr>
          )}
          {bill.gst ? (
            <tr>
              <td colSpan={7} className={styles.r}>
                Add: GST @ {gstRatePct}% (as per terms — extra)
              </td>
              <td className={styles.r}>{n(bill.gst)}</td>
            </tr>
          ) : (
            <tr>
              <td colSpan={7} className={styles.r}>
                GST included in rates (as per terms)
              </td>
              <td className={styles.r}>—</td>
            </tr>
          )}
          {bill.transportCum > 0 && (
            <tr>
              <td colSpan={7} className={styles.r}>
                Add: Transport at actuals (bills up to {dfmt(bill.date)}, as per terms — extra)
              </td>
              <td className={styles.r}>{n(bill.transportCum)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={7} className={styles.r}>
              <b>Gross payable to date</b>
            </td>
            <td className={styles.r}>
              <b>{n(bill.grossToDate)}</b>
            </td>
          </tr>
          <tr>
            <td colSpan={7} className={styles.r}>
              Less: billed in previous running bills
            </td>
            <td className={styles.r}>− {n(bill.priorBilled)}</td>
          </tr>
          <tr>
            <td colSpan={7} className={styles.r}>
              <b>NET PAYABLE — THIS BILL</b>
            </td>
            <td className={styles.r}>
              <b>{n(bill.netPayable)}</b>
            </td>
          </tr>
        </tfoot>
      </table>
      <p className={styles.note}>
        <b>Payment terms:</b> {project.paymentTerms || "As agreed"} ·{" "}
        <b>Transport:</b> {project.termsTransport === "EXTRA" ? "Extra at actuals" : "Included"}
      </p>
      <div className={styles.sig}>
        <div>Client / Site Engineer</div>
        <div>
          For {settings.companyName}
          <br />
          Authorised Signatory
        </div>
      </div>
    </div>
  );
}
