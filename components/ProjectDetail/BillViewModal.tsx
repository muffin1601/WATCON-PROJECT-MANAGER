"use client";

import { createPortal } from "react-dom";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { BillDoc } from "../PrintDoc/BillDoc";
import previewStyles from "../PrintDoc/PrintDoc.module.css";
import { inr, dfmt } from "../../lib/format";
import type { CompanySettings } from "../PrintDoc/DocHead";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

// View modal for a running bill — same pattern as ChallanViewModal: the
// printable document rendered as an in-modal preview, with Print (via the
// #printArea portal) and an internal summary line.
export function BillViewModal({
  project,
  bill,
  settings,
  gstRatePct,
  onClose,
}: {
  project: ProjectViewModel;
  bill: ProjectViewModel["bills"][number];
  settings: CompanySettings;
  gstRatePct: number;
  onClose: () => void;
}) {
  const printArea = typeof document !== "undefined" ? document.getElementById("printArea") : null;

  const doc = (
    <BillDoc
      settings={settings}
      project={{
        name: project.name,
        client: project.client,
        site: project.site,
        poNumber: project.poNumber,
        poDate: project.poDate,
        paymentTerms: project.paymentTerms,
        termsTransport: project.termsTransport,
      }}
      bill={bill}
      gstRatePct={gstRatePct}
      dfmt={dfmt}
    />
  );

  return (
    <>
      <Modal
        title={`Bill ${bill.no}`}
        onClose={onClose}
        footer={
          <>
            <Button variant="primary" onClick={() => window.print()}>
              Print
            </Button>
            <Button onClick={onClose}>Close</Button>
          </>
        }
      >
        <div className={previewStyles.preview}>{doc}</div>
        <p className="note" style={{ marginTop: 10 }}>
          Internal summary (not printed): <b>Net payable this bill:</b> {inr(bill.netPayable)} ·{" "}
          <b>Gross to date:</b> {inr(bill.grossToDate)} · <b>Prior billed:</b> {inr(bill.priorBilled)}
          {bill.extraTotal > 0 ? (
            <>
              {" "}
              · <b>Extras (beyond SO):</b> {inr(bill.extraTotal)}
            </>
          ) : null}
        </p>
      </Modal>
      {printArea ? createPortal(doc, printArea) : null}
    </>
  );
}
