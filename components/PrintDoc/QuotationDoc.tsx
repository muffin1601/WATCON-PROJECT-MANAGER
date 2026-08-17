import { Fragment } from "react";
import { DocHead, type CompanySettings } from "./DocHead";
import styles from "./PrintDoc.module.css";
import { dfmt } from "../../lib/format";
import {
  lineDisc,
  lineNet,
  lineNetRate,
  quoteSectionNet,
  quoteSections,
  quoteSectionShown,
  quoteTotals,
} from "../../services/quotationTotals";
import type { QuotationDto } from "../../services/quotationService";

const n = (v: number) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Printed client-facing quotation: area summary, the priced item table grouped
// by area, the commercial roll-up, and terms. Uses the same
// services/quotationTotals.ts functions as the editor and the server, so the
// printed figures can never differ from the stored ones.
export function QuotationDoc({ settings, quotation }: { settings: CompanySettings; quotation: QuotationDto }) {
  const terms = {
    discountPct: quotation.discountPct,
    installMode: quotation.installMode,
    installBasis: quotation.installBasis,
    installValue: quotation.installValue,
    transportMode: quotation.transportMode,
    transportAmount: quotation.transportAmount,
    gstMode: quotation.gstMode,
    gstPct: quotation.gstPct,
    roundTo: quotation.roundTo,
    areaTotalsWithGst: quotation.areaTotalsWithGst,
  };
  const lines = quotation.items.map((i) => ({
    section: i.section,
    qty: i.qty,
    rate: i.rate,
    discPct: i.discPct,
  }));
  const t = quoteTotals(terms, lines);
  const sections = quoteSections(quotation.sections, lines);
  const grouped = sections.length > 0;
  const order = grouped ? [...sections, ""] : [""];
  const hasUngrouped = quotation.items.some((i) => (i.section || "").trim() === "");
  const multiMake = quotation.items.some((i) => i.makes.length > 1);

  let sNo = 0;

  return (
    <div className={styles.doc}>
      <DocHead settings={settings} />
      <div className={styles.dtitle}>Quotation</div>

      <div className={styles.meta}>
        <div>
          <b>Ref:</b> {quotation.ref}
          <br />
          <b>Date:</b> {dfmt(quotation.date)}
          <br />
          <b>Validity:</b> {quotation.validityDays} days
          {quotation.refBy && (
            <>
              <br />
              <b>Reference:</b> {quotation.refBy}
            </>
          )}
          {quotation.salesPerson && (
            <>
              <br />
              <b>Sales contact:</b> {quotation.salesPerson}
            </>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <b>To:</b> {quotation.client}
          {quotation.billing && (
            <>
              <br />
              <span style={{ whiteSpace: "pre-line" }}>{quotation.billing}</span>
            </>
          )}
          <br />
          <b>Project:</b> {quotation.title}
          {quotation.delivery && quotation.delivery !== quotation.billing && (
            <>
              <br />
              <b>Site / delivery:</b> <span style={{ whiteSpace: "pre-line" }}>{quotation.delivery}</span>
            </>
          )}
        </div>
      </div>

      <p style={{ marginTop: 8 }}>
        Dear Sir/Madam,
        <br />
        We thank you for your enquiry. Please find below our best prices.
      </p>

      {grouped && (
        <table style={{ marginBottom: 8 }}>
          <thead>
            <tr>
              <th>Area / sub-heading</th>
              <th className={styles.r}>
                Amount (₹) — after discount
                {t.installAmount ? " & installation" : ""}
                {quotation.areaTotalsWithGst && quotation.gstMode === "EXTRA" ? ", incl. GST" : ", before GST"}
              </th>
            </tr>
          </thead>
          <tbody>
            {sections.map((sec) => (
              <tr key={sec}>
                <td>{sec}</td>
                <td className={styles.r}>{n(quoteSectionShown(terms, lines, sec))}</td>
              </tr>
            ))}
            {hasUngrouped && (
              <tr>
                <td>Other items</td>
                <td className={styles.r}>{n(quoteSectionShown(terms, lines, ""))}</td>
              </tr>
            )}
            <tr>
              <td>
                <b>Total</b>
              </td>
              <td className={styles.r}>
                <b>{n([...sections, ""].reduce((a, sec) => a + quoteSectionShown(terms, lines, sec), 0))}</b>
              </td>
            </tr>
          </tbody>
        </table>
      )}

      <table>
        <thead>
          <tr>
            <th>S.N</th>
            <th>Particulars</th>
            <th>Make / brand options</th>
            <th>Unit</th>
            <th className={styles.r}>Qty</th>
            <th className={styles.r}>List rate (₹)</th>
            <th className={styles.r}>Disc %</th>
            <th className={styles.r}>Net rate (₹)</th>
            <th className={styles.r}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {order.map((sec) => {
            const its = quotation.items.filter((i) => (i.section || "").trim() === sec);
            if (!its.length) return null;
            return (
              <Fragment key={`sec-${sec}`}>
                {grouped && (
                  <tr>
                    <td colSpan={9} style={{ background: "#e9e9e9" }}>
                      <b>{sec || "Other items"}</b>
                    </td>
                  </tr>
                )}
                {its.map((i) => {
                  const line = { qty: i.qty, rate: i.rate, discPct: i.discPct };
                  const dp = lineDisc(terms, line);
                  sNo += 1;
                  return (
                    <tr key={i.id}>
                      <td>{sNo}</td>
                      <td>{i.description}</td>
                      <td>{i.makes.length ? i.makes.join(" / ") : "—"}</td>
                      <td>{i.unit}</td>
                      <td className={styles.r}>{i.qty}</td>
                      <td className={styles.r}>{Number(i.rate).toLocaleString("en-IN")}</td>
                      <td className={styles.r}>{dp ? `${dp}%` : "—"}</td>
                      <td className={styles.r}>{Number(lineNetRate(terms, line)).toLocaleString("en-IN")}</td>
                      <td className={styles.r}>{n(lineNet(terms, line))}</td>
                    </tr>
                  );
                })}
                {grouped && (
                  <tr>
                    <td colSpan={8} className={styles.r}>
                      <b>Sub-total — {sec || "Other items"} (after discount)</b>
                    </td>
                    <td className={styles.r}>
                      <b>{n(quoteSectionNet(terms, lines, sec))}</b>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={8} className={styles.r}>
              Total at list rates
            </td>
            <td className={styles.r}>{n(t.subtotal)}</td>
          </tr>
          {t.discountAmount > 0 && (
            <tr>
              <td colSpan={8} className={styles.r}>
                Less Discount
              </td>
              <td className={styles.r}>− {n(t.discountAmount)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={8} className={styles.r}>
              <b>Net Total (after discount)</b>
            </td>
            <td className={styles.r}>
              <b>{n(t.netAmount)}</b>
            </td>
          </tr>
          {t.installAmount > 0 && (
            <>
              <tr>
                <td colSpan={8} className={styles.r}>
                  Installation of Equipment
                  {quotation.installBasis === "LUMPSUM"
                    ? " (lump sum)"
                    : quotation.installBasis === "PER_UNIT"
                      ? ` @ ${n(quotation.installValue)} per unit`
                      : ` @ ${quotation.installValue}%`}
                </td>
                <td className={styles.r}>{n(t.installAmount)}</td>
              </tr>
              <tr>
                <td colSpan={8} className={styles.r}>
                  <b>Grand Total</b>
                </td>
                <td className={styles.r}>
                  <b>{n(t.grandBeforeRounding)}</b>
                </td>
              </tr>
            </>
          )}
          {!!quotation.roundTo && (
            <tr>
              <td colSpan={8} className={styles.r}>
                <b>Rounded to Rs.</b>
              </td>
              <td className={styles.r}>
                <b>{n(t.roundedAmount)}</b>
              </td>
            </tr>
          )}
          {t.transportAmount > 0 && (
            <tr>
              <td colSpan={8} className={styles.r}>
                Transportation (extra)
              </td>
              <td className={styles.r}>{n(t.transportAmount)}</td>
            </tr>
          )}
          {t.gstAmount > 0 && (
            <tr>
              <td colSpan={8} className={styles.r}>
                GST @ {quotation.gstPct}% (extra)
              </td>
              <td className={styles.r}>{n(t.gstAmount)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={8} className={styles.r}>
              <b>Total Payable</b>
            </td>
            <td className={styles.r}>
              <b>{n(t.grandTotal)}</b>
            </td>
          </tr>
        </tfoot>
      </table>

      <p style={{ marginTop: 8, fontSize: 11 }}>
        <b>Commercial:</b> GST {quotation.gstMode === "EXTRA" ? `extra @ ${quotation.gstPct}%` : "included"} · Transport{" "}
        {quotation.transportMode === "EXTRA" ? "extra" : "included"} · Installation{" "}
        {quotation.installMode === "EXTRA" ? "extra" : "included"}.
      </p>

      {multiMake && (
        <p style={{ marginTop: 6, fontSize: 10.5 }}>
          <b>Makes:</b> Where more than one make is listed, any of the listed makes may be supplied at the quoted rate;
          the client may indicate a preferred make at the time of order.
        </p>
      )}

      {quotation.note && (
        <p style={{ marginTop: 8 }}>
          <b>Note:</b> {quotation.note}
        </p>
      )}

      {quotation.terms && (
        <>
          <p style={{ marginTop: 10 }}>
            <b>Terms and Conditions</b>
          </p>
          <p style={{ fontSize: 10.5, whiteSpace: "pre-line" }}>{quotation.terms}</p>
        </>
      )}

      <p style={{ marginTop: 14 }}>
        Thank you.
        <br />
        For {settings.companyName}
      </p>
      <div className={styles.sig}>
        <div>&nbsp;</div>
        <div>Authorised Signatory</div>
      </div>
    </div>
  );
}
