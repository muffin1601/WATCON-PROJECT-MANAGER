import { DocHead, type CompanySettings } from "./DocHead";
import styles from "./PrintDoc.module.css";

// Printable Items & Stocks documents — ported from itemDocHTML(m) and
// stockReportDocHTML() in the prototype.

export interface StockItemView {
  id: string;
  name: string;
  make: string;
  unit: string;
  entries: { id: string; date: string; qty: number; note: string | null }[];
  stats: {
    rows: { projectId: string; project: string; client: string; site: string; required: number; delivered: number; pending: number }[];
    req: number;
    del: number;
    pending: number;
    stockIn: number;
    current: number;
  };
}

// Ported from itemDocHTML(m) — per-item report: A. sites where the item has
// been sent, B. sites where delivery is pending, C. stock position + entries.
export function ItemDoc({
  settings,
  item,
  dfmt,
  today,
}: {
  settings: CompanySettings;
  item: StockItemView;
  dfmt: (d: string) => string;
  today: string;
}) {
  const st = item.stats;
  const sent = st.rows.filter((r) => r.delivered > 0);
  const pend = st.rows.filter((r) => r.pending > 0);
  return (
    <div className={styles.doc}>
      <DocHead settings={settings} />
      <div className={styles.dtitle}>Item Stock &amp; Delivery Status</div>
      <div className={styles.meta}>
        <div>
          <b>Item:</b> {item.name}
          <br />
          <b>Make:</b> {item.make || "—"} · <b>Unit:</b> {item.unit}
        </div>
        <div style={{ textAlign: "right" }}>
          <b>Report date:</b> {dfmt(today)}
          <br />
          <b>Current stock:</b> {st.current} {item.unit}
        </div>
      </div>

      <p style={{ marginTop: 10 }}>
        <b>A. Sites where the item has been sent</b>
      </p>
      {sent.length > 0 ? (
        <table className={styles.docTable}>
          <thead>
            <tr>
              <th>Project</th>
              <th>Client</th>
              <th>Site</th>
              <th className={styles.r}>Qty delivered</th>
            </tr>
          </thead>
          <tbody>
            {sent.map((r) => (
              <tr key={r.projectId}>
                <td>{r.project}</td>
                <td>{r.client}</td>
                <td>{r.site}</td>
                <td className={styles.r}>{r.delivered}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className={styles.r}>
                <b>Total delivered</b>
              </td>
              <td className={styles.r}>
                <b>{st.del}</b>
              </td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <p style={{ fontSize: 11.5 }}>Not yet delivered to any site.</p>
      )}

      <p style={{ marginTop: 12 }}>
        <b>B. Sites where delivery is pending</b>
      </p>
      {pend.length > 0 ? (
        <table className={styles.docTable}>
          <thead>
            <tr>
              <th>Project</th>
              <th>Client</th>
              <th>Site</th>
              <th className={styles.r}>Required</th>
              <th className={styles.r}>Delivered</th>
              <th className={styles.r}>Pending qty</th>
            </tr>
          </thead>
          <tbody>
            {pend.map((r) => (
              <tr key={r.projectId}>
                <td>{r.project}</td>
                <td>{r.client}</td>
                <td>{r.site}</td>
                <td className={styles.r}>{r.required}</td>
                <td className={styles.r}>{r.delivered}</td>
                <td className={styles.r}>{r.pending}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className={styles.r}>
                <b>Total pending</b>
              </td>
              <td className={styles.r}>
                <b>{st.pending}</b>
              </td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <p style={{ fontSize: 11.5 }}>No pending deliveries.</p>
      )}

      <p style={{ marginTop: 12 }}>
        <b>C. Stock position</b>
      </p>
      <table className={styles.docTable}>
        <tbody>
          <tr>
            <td>Stock received / adjustments (total in)</td>
            <td className={styles.r} style={{ width: "22%" }}>
              {st.stockIn}
            </td>
          </tr>
          <tr>
            <td>Dispatched to sites (total out)</td>
            <td className={styles.r}>− {st.del}</td>
          </tr>
          <tr>
            <td>
              <b>CURRENT STOCK</b>
            </td>
            <td className={styles.r}>
              <b>{st.current}</b>
            </td>
          </tr>
        </tbody>
      </table>

      {item.entries.length > 0 && (
        <>
          <p style={{ marginTop: 12 }}>
            <b>Stock entries</b>
          </p>
          <table className={styles.docTable}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Note</th>
                <th className={styles.r}>Qty</th>
              </tr>
            </thead>
            <tbody>
              {item.entries.map((e) => (
                <tr key={e.id}>
                  <td>{dfmt(e.date)}</td>
                  <td>{e.note || "—"}</td>
                  <td className={styles.r}>
                    {e.qty > 0 ? "+" : ""}
                    {e.qty}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className={styles.sig}>
        <div>Store In-charge</div>
        <div>
          For {settings.companyName}
          <br />
          Authorised Signatory
        </div>
      </div>
    </div>
  );
}

// Ported from stockReportDocHTML() — all-items stock report.
export function StockReportDoc({
  settings,
  items,
  dfmt,
  today,
}: {
  settings: CompanySettings;
  items: StockItemView[];
  dfmt: (d: string) => string;
  today: string;
}) {
  return (
    <div className={styles.doc}>
      <DocHead settings={settings} />
      <div className={styles.dtitle}>Stock Report — All Items</div>
      <div className={styles.meta}>
        <div>
          <b>Report date:</b> {dfmt(today)}
        </div>
        <div style={{ textAlign: "right" }}>
          <b>Items (make-wise):</b> {items.length}
        </div>
      </div>
      <table className={styles.docTable}>
        <thead>
          <tr>
            <th>Item</th>
            <th>Make</th>
            <th>Unit</th>
            <th className={styles.r}>Required</th>
            <th className={styles.r}>Delivered</th>
            <th className={styles.r}>Pending</th>
            <th className={styles.r}>Stock in</th>
            <th className={styles.r}>Current stock</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>{m.make || "—"}</td>
              <td>{m.unit}</td>
              <td className={styles.r}>{m.stats.req}</td>
              <td className={styles.r}>{m.stats.del}</td>
              <td className={styles.r}>{m.stats.pending}</td>
              <td className={styles.r}>{m.stats.stockIn}</td>
              <td className={styles.r}>
                <b>{m.stats.current}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.sig}>
        <div>Store In-charge</div>
        <div>
          For {settings.companyName}
          <br />
          Authorised Signatory
        </div>
      </div>
    </div>
  );
}
