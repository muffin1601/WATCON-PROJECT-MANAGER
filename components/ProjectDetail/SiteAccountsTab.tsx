"use client";

import { createPortal } from "react-dom";
import { Card, CardBody, CardHeader } from "../Card/Card";
import { Button } from "../Button/Button";
import { TableWrap, Table, Th, Td, EmptyState } from "../Table/Table";
import { SiteAccountDoc } from "../PrintDoc/SiteAccountDoc";
import { inr, dfmt, todayIso } from "../../lib/format";
import type { CompanySettings } from "../PrintDoc/DocHead";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

// Ported from tabAccounts(p, el) — a computed, READ-ONLY statement (no
// debit/credit ledger entries in the prototype; every figure is derived
// from challans, bills, discounts and payments already recorded elsewhere).
export function SiteAccountsTab({
  project,
  settings,
  gstRatePct,
}: {
  project: ProjectViewModel;
  settings: CompanySettings;
  gstRatePct: number;
}) {
  const f = project.siteAccount;
  const printArea = typeof document !== "undefined" ? document.getElementById("printArea") : null;

  const doc = (
    <SiteAccountDoc
      settings={settings}
      project={{ name: project.name, client: project.client, site: project.site, poNumber: project.poNumber, poDate: project.poDate }}
      bills={project.bills.map((b) => ({ no: b.no, date: b.date, grossToDate: b.grossToDate, priorBilled: b.priorBilled, netPayable: b.netPayable }))}
      figures={f}
      gstRatePct={gstRatePct}
      termsGstExtra={project.termsGst === "EXTRA"}
      termsTransportExtra={project.termsTransport === "EXTRA"}
      dfmt={dfmt}
      today={todayIso()}
    />
  );

  return (
    <div>
      {/* Button lives OUTSIDE the grid: as a grid-column:1/-1 item it would
          occupy every auto-fit track, preventing empty-track collapse and
          squeezing the two cards to 2/3 of the width. */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Button variant="primary" onClick={() => window.print()}>
          Print site account statement
        </Button>
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))" }}>
      <Card>
        <CardHeader>
          <h3>Running bills issued</h3>
        </CardHeader>
        <CardBody>
          {project.bills.length === 0 ? (
            <EmptyState>No running bills issued yet.</EmptyState>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Bill No.</Th>
                    <Th>Date</Th>
                    <Th align="r">Gross to date</Th>
                    <Th align="r">Less prior</Th>
                    <Th align="r">Net billed</Th>
                  </tr>
                </thead>
                <tbody>
                  {project.bills.map((b) => (
                    <tr key={b.id}>
                      <Td className="mono" style={{ whiteSpace: "nowrap" }}>
                        <b>{b.no}</b>
                      </Td>
                      <Td style={{ whiteSpace: "nowrap" }}>{dfmt(b.date)}</Td>
                      <Td align="r" className="money">{inr(b.grossToDate)}</Td>
                      <Td align="r" className="money">− {inr(b.priorBilled)}</Td>
                      <Td align="r" className="money">
                        <b>{inr(b.netPayable)}</b>
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <Td colSpan={4} align="r">
                      Total value of running bills issued
                    </Td>
                    <Td align="r" className="money">
                      {inr(f.billed)}
                    </Td>
                  </tr>
                </tfoot>
              </Table>
            </TableWrap>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3>Site account summary</h3>
        </CardHeader>
        <CardBody>
          <TableWrap>
            <Table>
              <tbody>
                <tr>
                  <Td>Material sent to site per challans (basic value)</Td>
                  <Td align="r" className="money">{inr(f.basicDispatched)}</Td>
                </tr>
                <tr>
                  <Td>Less: additional / special discount given</Td>
                  <Td align="r" className="money" style={{ color: "var(--danger)" }}>− {inr(f.disc)}</Td>
                </tr>
                <tr>
                  <Td>{project.termsGst === "EXTRA" ? `Add: GST @ ${gstRatePct}% (extra as per terms)` : "GST included in rates (as per terms)"}</Td>
                  <Td align="r" className="money">{f.gst ? inr(f.gst) : "—"}</Td>
                </tr>
                {project.termsTransport === "EXTRA" && (
                  <tr>
                    <Td>Add: transport bills at actuals (extra as per terms)</Td>
                    <Td align="r" className="money">{inr(f.transport)}</Td>
                  </tr>
                )}
                <tr>
                  <Td><b>Billable to date (challan basis)</b></Td>
                  <Td align="r" className="money"><b>{inr(f.payableToDate)}</b></Td>
                </tr>
                <tr>
                  <Td>Total value of running bills issued</Td>
                  <Td align="r" className="money">{inr(f.billed)}</Td>
                </tr>
                <tr>
                  <Td style={{ color: "var(--warn)" }}><b>Unbilled amount as per challans issued</b></Td>
                  <Td align="r" className="money" style={{ color: "var(--warn)" }}><b>{inr(f.unbilled)}</b></Td>
                </tr>
                <tr>
                  <Td style={{ color: "var(--ok)" }}><b>Total payment received till today</b></Td>
                  <Td align="r" className="money" style={{ color: "var(--ok)" }}><b>{inr(f.received)}</b></Td>
                </tr>
                <tr>
                  <Td style={{ color: f.balance > 0 ? "var(--danger)" : "var(--ok)" }}>
                    <b>Balance payment (billable to date − received)</b>
                  </Td>
                  <Td align="r" className="money" style={{ color: f.balance > 0 ? "var(--danger)" : "var(--ok)" }}>
                    <b>{inr(f.balance)}</b>
                  </Td>
                </tr>
              </tbody>
            </Table>
          </TableWrap>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
            Unbilled = value of material already sent (challans) that is not yet covered by a running bill. Balance =
            everything billable on challan basis to date, less payments received.
          </p>
        </CardBody>
      </Card>
      </div>

      {printArea && createPortal(doc, printArea)}
    </div>
  );
}
