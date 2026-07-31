import { DocHead, type CompanySettings } from "./DocHead";
import styles from "./PrintDoc.module.css";

export interface ChallanDocProject {
  name: string;
  client: string;
  site: string | null;
  poNumber: string | null;
}

export interface ChallanDocChallan {
  no: string;
  date: string;
  vehicle: string | null;
  driver: string | null;
  remarks: string | null;
  items: { itemId: string; qty: number; extraQty: number }[];
  extraItems: { description: string; unit: string; qty: number }[];
}

// Ported from challanDocHTML(p,c) — quantities only, no rates/values, no
// SO-vs-additional bifurcation shown on the printed challan itself.
export function ChallanDoc({
  settings,
  project,
  challan,
  soItems,
  dfmt,
}: {
  settings: CompanySettings;
  project: ChallanDocProject;
  challan: ChallanDocChallan;
  soItems: { id: string; description: string; unit: string }[];
  dfmt: (d: string) => string;
}) {
  let sNo = 1;
  let totalQty = 0;
  const rows: { sNo: number; description: string; unit: string; qty: number }[] = [];

  challan.items.forEach((ci) => {
    const it = soItems.find((x) => x.id === ci.itemId);
    if (!it) return;
    const q = (ci.qty || 0) + (ci.extraQty || 0);
    totalQty += q;
    rows.push({ sNo: sNo++, description: it.description, unit: it.unit, qty: q });
  });
  challan.extraItems.forEach((x) => {
    totalQty += x.qty;
    rows.push({ sNo: sNo++, description: x.description, unit: x.unit, qty: x.qty });
  });

  return (
    <div className={styles.doc}>
      <DocHead settings={settings} />
      <div className={styles.dtitle}>Delivery Challan</div>
      <div className={styles.meta}>
        <div>
          <b>Challan No:</b> {challan.no}
          <br />
          <b>Date:</b> {dfmt(challan.date)}
          <br />
          <b>Vehicle:</b> {challan.vehicle || "—"}
          <br />
          <b>Driver:</b> {challan.driver || "—"}
        </div>
        <div style={{ textAlign: "right" }}>
          <b>Delivered to:</b>
          <br />
          {project.client}
          <br />
          {project.site || ""}
          <br />
          <b>Project:</b> {project.name}
          {project.poNumber ? (
            <>
              <br />
              <b>Against PO:</b> {project.poNumber}
            </>
          ) : null}
        </div>
      </div>
      {rows.length > 0 && (
        <table className={styles.docTable}>
          <thead>
            <tr>
              <th style={{ width: "8%" }}>S.No</th>
              <th>Description of goods</th>
              <th style={{ width: "12%" }}>Unit</th>
              <th className={styles.r} style={{ width: "14%" }}>
                Qty
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sNo}>
                <td>{r.sNo}</td>
                <td>{r.description}</td>
                <td>{r.unit}</td>
                <td className={styles.r}>{r.qty}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className={styles.r}>
                <b>Total quantity — this challan</b>
              </td>
              <td className={styles.r}>
                <b>{totalQty}</b>
              </td>
            </tr>
          </tfoot>
        </table>
      )}
      {challan.remarks && (
        <p style={{ marginTop: 8 }}>
          <b>Remarks:</b> {challan.remarks}
        </p>
      )}
      <p className={styles.note}>
        Goods dispatched for the above project. This is a delivery challan, not an invoice. Please check material on
        receipt; any discrepancy to be reported within 48 hours.
      </p>
      <div className={styles.sig}>
        <div>Received by (name, sign &amp; date)</div>
        <div>
          For {settings.companyName}
          <br />
          Authorised Signatory
        </div>
      </div>
    </div>
  );
}
