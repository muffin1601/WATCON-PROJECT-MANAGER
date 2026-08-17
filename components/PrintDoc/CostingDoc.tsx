import { DocHead, type CompanySettings } from "./DocHead";
import styles from "./PrintDoc.module.css";
import { dfmt, todayIso } from "../../lib/format";
import { describeBasis, type ProjectCostingResult } from "../../services/costingService";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

const n = (v: number) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Ported from costingDocHTML(p) — A. Material, B. Other costs, C. Summary.
// Marked internal, because it exposes what the company pays.
export function CostingDoc({
  settings,
  project,
  result,
}: {
  settings: CompanySettings;
  project: ProjectViewModel;
  result: ProjectCostingResult;
}) {
  return (
    <div className={styles.doc}>
      <DocHead settings={settings} />
      <div className={styles.dtitle}>Project Costing Sheet (internal)</div>

      <div className={styles.meta}>
        <div>
          <b>Project:</b> {project.name}
          <br />
          <b>Client:</b> {project.client}
          {project.poNumber && (
            <>
              <br />
              <b>PO ref:</b> {project.poNumber}
            </>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <b>Date:</b> {dfmt(todayIso())}
        </div>
      </div>

      <p style={{ marginTop: 8 }}>
        <b>A. Material</b>
      </p>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Unit</th>
            <th className={styles.r}>Qty</th>
            <th className={styles.r}>Sale rate</th>
            <th className={styles.r}>Cost rate</th>
            <th>Basis</th>
            <th className={styles.r}>Cost</th>
            <th className={styles.r}>Sale</th>
            <th className={styles.r}>Margin</th>
          </tr>
        </thead>
        <tbody>
          {result.lines.map((l) => (
            <tr key={l.itemId}>
              <td>{l.description}</td>
              <td>{l.unit}</td>
              <td className={styles.r}>{l.qty}</td>
              <td className={styles.r}>{n(l.saleRate)}</td>
              <td className={styles.r}>{n(l.costRate)}</td>
              <td style={{ fontSize: 10 }}>{describeBasis(l)}</td>
              <td className={styles.r}>{n(l.cost)}</td>
              <td className={styles.r}>{n(l.sale)}</td>
              <td className={styles.r}>{n(l.sale - l.cost)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className={styles.r}>
              <b>Material total</b>
            </td>
            <td className={styles.r}>
              <b>{n(result.matCost)}</b>
            </td>
            <td className={styles.r}>
              <b>{n(result.sale)}</b>
            </td>
            <td className={styles.r}>
              <b>{n(result.sale - result.matCost)}</b>
            </td>
          </tr>
        </tfoot>
      </table>

      <p style={{ marginTop: 10 }}>
        <b>B. Other costs</b>
      </p>
      <table>
        <tbody>
          {result.extras.map((x, i) => (
            <tr key={i}>
              <td>{x.name || "—"}</td>
              <td className={styles.r} style={{ width: "22%" }}>
                {n(x.amount || 0)}
              </td>
            </tr>
          ))}
          {result.transportCost > 0 && (
            <tr>
              <td>Transport (included in rates)</td>
              <td className={styles.r}>{n(result.transportCost)}</td>
            </tr>
          )}
          <tr>
            <td>
              <b>Other costs total</b>
            </td>
            <td className={styles.r}>
              <b>{n(result.otherCost + result.transportCost)}</b>
            </td>
          </tr>
        </tbody>
      </table>

      <p style={{ marginTop: 10 }}>
        <b>C. Summary</b>
      </p>
      <table>
        <tbody>
          <tr>
            <td>Sales order value (basic)</td>
            <td className={styles.r} style={{ width: "22%" }}>
              {n(result.sale)}
            </td>
          </tr>
          {result.discounts > 0 && (
            <>
              <tr>
                <td>Less special discounts</td>
                <td className={styles.r}>− {n(result.discounts)}</td>
              </tr>
              <tr>
                <td>
                  <b>Net revenue</b>
                </td>
                <td className={styles.r}>
                  <b>{n(result.revenue)}</b>
                </td>
              </tr>
            </>
          )}
          <tr>
            <td>Total cost (A + B)</td>
            <td className={styles.r}>{n(result.totalCost)}</td>
          </tr>
          <tr>
            <td>
              <b>GROSS MARGIN</b>
            </td>
            <td className={styles.r}>
              <b>
                {n(result.margin)} ({result.marginPct.toFixed(1)}%)
              </b>
            </td>
          </tr>
        </tbody>
      </table>

      <p style={{ marginTop: 8, fontSize: 10.5 }}>Internal document — not for circulation to the client.</p>
    </div>
  );
}
