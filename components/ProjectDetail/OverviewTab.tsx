import { Card, CardBody, CardHeader } from "../Card/Card";
import { TableWrap, Table, Td } from "../Table/Table";
import { inr, dfmt } from "../../lib/format";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

const APPROVAL_LABEL: Record<string, string> = {
  PURCHASE_ORDER: "Purchase Order",
  QUOTE_EMAIL: "Quote — Email approval",
  QUOTE_WHATSAPP: "Quote — WhatsApp approval",
  QUOTE_VERBAL: "Quote — Verbal approval",
};

// Ported from tabOverview(p, el) — financial summary + terms/approval card.
export function OverviewTab({ project }: { project: ProjectViewModel }) {
  const f = project.financials;
  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
      <Card>
        <CardHeader>
          <h3>Financial summary</h3>
        </CardHeader>
        <CardBody>
          <TableWrap>
            <Table>
              <tbody>
                <tr>
                  <Td>Sales order basic value</Td>
                  <Td align="r" className="money">{inr(f.orderBase)}</Td>
                </tr>
                <tr>
                  <Td>Amendments</Td>
                  <Td align="r" className="money">{inr(f.amendTotal)}</Td>
                </tr>
                <tr>
                  <Td>Special discounts</Td>
                  <Td align="r" className="money" style={{ color: "var(--danger)" }}>
                    − {inr(f.discountTotal)}
                  </Td>
                </tr>
                <tr>
                  <Td>GST {project.termsGst === "EXTRA" ? "(extra)" : "(included in rates)"}</Td>
                  <Td align="r" className="money">{inr(f.gst)}</Td>
                </tr>
                <tr>
                  <Td><b>Total contract value</b></Td>
                  <Td align="r" className="money"><b>{inr(f.contractValue)}</b></Td>
                </tr>
                <tr>
                  <Td>Value of material sent to site</Td>
                  <Td align="r" className="money">{inr(f.dispatchedValue)}</Td>
                </tr>
                <tr>
                  <Td>Billed through running bills</Td>
                  <Td align="r" className="money">{inr(f.billedTotal)}</Td>
                </tr>
                <tr>
                  <Td style={{ color: "var(--ok)" }}><b>Payments received</b></Td>
                  <Td align="r" className="money" style={{ color: "var(--ok)" }}><b>{inr(f.paidTotal)}</b></Td>
                </tr>
                <tr>
                  <Td style={{ color: "var(--danger)" }}><b>Balance (material sent − received)</b></Td>
                  <Td align="r" className="money" style={{ color: "var(--danger)" }}><b>{inr(f.pending)}</b></Td>
                </tr>
              </tbody>
            </Table>
          </TableWrap>
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <h3>Terms & approval</h3>
        </CardHeader>
        <CardBody>
          <p style={{ fontSize: 13.5, lineHeight: 2 }}>
            <b>GST:</b> {project.termsGst === "EXTRA" ? "Extra" : "Included"}
            <br />
            <b>Transport:</b> {project.termsTransport === "EXTRA" ? "Extra at actuals" : "Included"}
            <br />
            <b>Payment terms:</b> {project.paymentTerms || "—"}
            <br />
            <b>Approval basis:</b> {APPROVAL_LABEL[project.approvalMode] ?? project.approvalMode}
            {project.approvalBasisNote ? ` — ${project.approvalBasisNote}` : ""}
            <br />
            <b>PO / Ref:</b> {project.poNumber || "—"} · {dfmt(project.poDate)}
          </p>
          <div style={{ marginTop: 10 }}>
            {project.challans.length} challan(s) issued · {project.bills.length} running bill(s) · {project.payments.length}{" "}
            payment(s)
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
