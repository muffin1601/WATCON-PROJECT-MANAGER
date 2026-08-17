import { DocHead, type CompanySettings } from "./DocHead";
import styles from "./PrintDoc.module.css";
import { dfmt, todayIso } from "../../lib/format";
import type { RfqDetail } from "../../services/rfqService";
import type { PoDetail } from "../../services/purchaseOrderService";

const n = (v: number) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- Rate Inquiry — ported from rfqDocHTML(r) ----------
// A blank rate column for the supplier to fill in by hand.
export function RfqDoc({ settings, rfq }: { settings: CompanySettings; rfq: RfqDetail }) {
  return (
    <div className={styles.doc}>
      <DocHead settings={settings} />
      <div className={styles.dtitle}>Rate Inquiry</div>

      <div className={styles.meta}>
        <div>
          <b>RFQ No:</b> {rfq.no}
          <br />
          <b>Date:</b> {dfmt(rfq.date)}
          {rfq.due && (
            <>
              <br />
              <b>Rates required by:</b> {dfmt(rfq.due)}
            </>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <b>Delivery to:</b>
          <br />
          {rfq.deliverTo || settings.address}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th>Make</th>
            <th>Unit</th>
            <th className={styles.r}>Qty</th>
            <th className={styles.r}>Rate (₹)</th>
            <th className={styles.r}>GST %</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {rfq.rows.map((l, i) => (
            <tr key={l.lineId}>
              <td>{i + 1}</td>
              <td>{l.name}</td>
              <td>{l.make || "—"}</td>
              <td>{l.unit}</td>
              <td className={styles.r}>{l.qty}</td>
              <td />
              <td />
              <td />
            </tr>
          ))}
        </tbody>
      </table>

      {rfq.note && <p style={{ marginTop: 8 }}>{rfq.note}</p>}
      <p style={{ marginTop: 8 }}>
        Transport: ______________ &nbsp; Delivery period: ______________ &nbsp; Payment terms: ______________
      </p>

      <div className={styles.sig}>
        <div>Supplier&apos;s signature &amp; stamp</div>
        <div>
          For {settings.companyName}
          <br />
          Authorised Signatory
        </div>
      </div>
    </div>
  );
}

// ---------- Rate Comparison Sheet — ported from rfqCompareDocHTML(r) ----------
export function RfqCompareDoc({ settings, rfq }: { settings: CompanySettings; rfq: RfqDetail }) {
  const vendorIds = Object.keys(rfq.totals);
  const nameOf = (id: string) => rfq.vendors.find((v) => v.id === id)?.name ?? "?";

  return (
    <div className={styles.doc}>
      <DocHead settings={settings} />
      <div className={styles.dtitle}>Rate Comparison Sheet (internal)</div>

      <div className={styles.meta}>
        <div>
          <b>RFQ:</b> {rfq.no} dt {dfmt(rfq.date)}
          <br />
          <b>Projects:</b> {rfq.projectNames.join(", ")}
        </div>
        <div style={{ textAlign: "right" }}>
          <b>Prepared:</b> {dfmt(todayIso())}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Make</th>
            <th className={styles.r}>Qty</th>
            {vendorIds.map((vid) => (
              <th key={vid} className={styles.r}>
                {nameOf(vid)}
                <br />
                <span style={{ fontWeight: 400 }}>rate / GST% / landed</span>
              </th>
            ))}
            <th>Selected</th>
          </tr>
        </thead>
        <tbody>
          {rfq.rows.map((row) => (
            <tr key={row.lineId}>
              <td>{row.name}</td>
              <td>{row.make || "—"}</td>
              <td className={styles.r}>
                {row.qty} {row.unit}
              </td>
              {vendorIds.map((vid) => {
                const o = row.offers.find((x) => x.vendorId === vid);
                if (!o || o.rate === null)
                  return (
                    <td key={vid} className={styles.r}>
                      —
                    </td>
                  );
                return (
                  <td key={vid} className={styles.r} style={o.vendorId === row.best ? { fontWeight: 700 } : undefined}>
                    {n(o.rate)} / {o.gst}% / {n(o.landed)}
                  </td>
                );
              })}
              <td>{row.chosen ? nameOf(row.chosen) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className={styles.r}>
              <b>Basic</b>
            </td>
            {vendorIds.map((vid) => (
              <td key={vid} className={styles.r}>
                {n(rfq.totals[vid]!.basic)}
              </td>
            ))}
            <td />
          </tr>
          <tr>
            <td colSpan={3} className={styles.r}>
              <b>GST</b>
            </td>
            {vendorIds.map((vid) => (
              <td key={vid} className={styles.r}>
                {n(rfq.totals[vid]!.gst)}
              </td>
            ))}
            <td />
          </tr>
          <tr>
            <td colSpan={3} className={styles.r}>
              <b>Transport (+GST)</b>
            </td>
            {vendorIds.map((vid) => (
              <td key={vid} className={styles.r}>
                {n(rfq.totals[vid]!.transport + rfq.totals[vid]!.transportGst)}
              </td>
            ))}
            <td />
          </tr>
          <tr>
            <td colSpan={3} className={styles.r}>
              <b>Grand total</b>
            </td>
            {vendorIds.map((vid) => (
              <td key={vid} className={styles.r}>
                <b>{n(rfq.totals[vid]!.total)}</b>
              </td>
            ))}
            <td />
          </tr>
        </tfoot>
      </table>

      <p style={{ marginTop: 8, fontSize: 10.5 }}>
        Bold = lowest landed rate for the item. Internal document.
      </p>
    </div>
  );
}

// ---------- Purchase Order — ported from poDocHTML(o) ----------
export function PoDoc({ settings, po }: { settings: CompanySettings; po: PoDetail }) {
  const t = po.totals;
  return (
    <div className={styles.doc}>
      <DocHead settings={settings} />
      <div className={styles.dtitle}>Purchase Order</div>

      <div className={styles.meta}>
        <div>
          <b>PO No:</b> {po.poNumber}
          <br />
          <b>Date:</b> {dfmt(po.date)}
          {po.rfq && (
            <>
              <br />
              <b>Ref:</b> RFQ {po.rfq.no}
            </>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <b>To:</b> {po.vendor.name}
          {po.vendor.contact && (
            <>
              <br />
              Attn: {po.vendor.contact}
            </>
          )}
          {po.vendor.address && (
            <>
              <br />
              <span style={{ whiteSpace: "pre-line" }}>{po.vendor.address}</span>
            </>
          )}
          {po.vendor.gstin && (
            <>
              <br />
              GSTIN: {po.vendor.gstin}
            </>
          )}
        </div>
      </div>

      <p style={{ marginTop: 8 }}>Please supply the following as per terms below:</p>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th>Make</th>
            <th>Unit</th>
            <th className={styles.r}>Qty</th>
            <th className={styles.r}>Rate (₹)</th>
            <th className={styles.r}>GST %</th>
            <th className={styles.r}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {po.lines.map((l, i) => (
            <tr key={l.id}>
              <td>{i + 1}</td>
              <td>
                {l.name}
                {l.remark && (
                  <>
                    <br />
                    <span style={{ fontSize: 10 }}>{l.remark}</span>
                  </>
                )}
              </td>
              <td>{l.make || "—"}</td>
              <td>{l.unit}</td>
              <td className={styles.r}>{l.qty}</td>
              <td className={styles.r}>{n(l.rate)}</td>
              <td className={styles.r}>{l.gst}</td>
              <td className={styles.r}>{n(l.qty * l.rate)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={7} className={styles.r}>
              <b>Basic total</b>
            </td>
            <td className={styles.r}>
              <b>{n(t.basic)}</b>
            </td>
          </tr>
          <tr>
            <td colSpan={7} className={styles.r}>
              GST
            </td>
            <td className={styles.r}>{n(t.gst)}</td>
          </tr>
          {t.transport > 0 && (
            <tr>
              <td colSpan={7} className={styles.r}>
                Transport{po.transportNote ? ` (${po.transportNote})` : ""}
                {t.transportGst ? " + GST" : ""}
              </td>
              <td className={styles.r}>{n(t.transport + t.transportGst)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={7} className={styles.r}>
              <b>PO VALUE</b>
            </td>
            <td className={styles.r}>
              <b>{n(t.total)}</b>
            </td>
          </tr>
        </tfoot>
      </table>

      <p style={{ marginTop: 8, fontSize: 11.5 }}>
        <b>Deliver to:</b> {po.deliverTo}
        {po.delivery && (
          <>
            <br />
            <b>Delivery period:</b> {po.delivery}
          </>
        )}
        {po.payment && (
          <>
            <br />
            <b>Payment terms:</b> {po.payment}
          </>
        )}
        {po.remarks && (
          <>
            <br />
            {po.remarks}
          </>
        )}
      </p>
      <p style={{ fontSize: 10.5 }}>
        Please mention our PO number on your invoice and delivery challan. Material to conform to specifications;
        rejected material to be replaced at your cost.
        {settings.gstin ? ` Our GSTIN: ${settings.gstin}.` : ""}
      </p>

      <div className={styles.sig}>
        <div>Supplier acceptance</div>
        <div>
          For {settings.companyName}
          <br />
          Authorised Signatory
        </div>
      </div>
    </div>
  );
}
