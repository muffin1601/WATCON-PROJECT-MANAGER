"use client";

import { createPortal } from "react-dom";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { ChallanDoc } from "../PrintDoc/ChallanDoc";
import previewStyles from "../PrintDoc/PrintDoc.module.css";
import { inr, dfmt } from "../../lib/format";
import type { CompanySettings } from "../PrintDoc/DocHead";
import type { ProjectViewModel } from "../../modules/projects/viewModel";

// Ported from viewChallanModal(p,c) — doc preview + an internal (not
// printed) summary line showing challan value and additional-qty count.
export function ChallanViewModal({
  project,
  challan,
  settings,
  onClose,
}: {
  project: ProjectViewModel;
  challan: ProjectViewModel["challans"][number];
  settings: CompanySettings;
  onClose: () => void;
}) {
  const printArea = typeof document !== "undefined" ? document.getElementById("printArea") : null;
  const extraQtyCount =
    challan.items.reduce((s, ci) => s + (ci.extraQty || 0), 0) + challan.extraItems.reduce((s, x) => s + (x.qty || 0), 0);

  const doc = (
    <ChallanDoc
      settings={settings}
      project={{ name: project.name, client: project.client, site: project.site, poNumber: project.poNumber }}
      challan={challan}
      soItems={project.items}
      dfmt={dfmt}
    />
  );

  return (
    <>
      <Modal
        title={`Challan ${challan.no}`}
        onClose={onClose}
        footer={
          <>
            {challan.attachments[0] && (
              <Button onClick={() => window.open(challan.attachments[0]!.url, "_blank")}>View attachment</Button>
            )}
            <Button variant="primary" onClick={() => window.print()}>
              Print
            </Button>
            <Button onClick={onClose}>Close</Button>
          </>
        }
      >
        <div className={previewStyles.preview}>{doc}</div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
          Internal summary (not printed): <b>Challan value:</b> {inr(challan.value)}
          {extraQtyCount > 0 ? (
            <>
              {" "}
              · <b>Additional qty (beyond SO):</b> {extraQtyCount}
            </>
          ) : null}
        </p>
      </Modal>
      {printArea ? createPortal(doc, printArea) : null}
    </>
  );
}
