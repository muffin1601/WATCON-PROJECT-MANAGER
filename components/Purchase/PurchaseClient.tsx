"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle } from "../Card/Card";
import { Table, TableWrap, Td, Th, EmptyState } from "../Table/Table";
import { Button } from "../Button/Button";
import { Chip, type ChipTone } from "../Chip/Chip";
import { VendorModal } from "./VendorModal";
import { NewRfqWizard } from "./NewRfqWizard";
import { inr, dfmt } from "../../lib/format";
import { PO_STATUS_LABEL } from "../../modules/purchase/schema";
import type { RfqListRow } from "../../services/rfqService";
import type { PoListRow } from "../../services/purchaseOrderService";
import type { VendorDto } from "../../services/vendorService";
import styles from "./Purchase.module.css";

const RFQ_STATUS_LABEL: Record<string, string> = {
  SENT: "Sent",
  COMPARING: "Comparing",
  PO_ISSUED: "PO issued",
};
const RFQ_TONE: Record<string, ChipTone> = { SENT: "grey", COMPARING: "teal", PO_ISSUED: "green" };
const PO_TONE: Record<string, ChipTone> = {
  DRAFT: "grey",
  ISSUED: "teal",
  PARTIALLY_RECEIVED: "gold",
  COMPLETED: "green",
  CANCELLED: "red",
};

// Ported from renderPurchase() — three cards, in the same order: Rate
// Inquiries, Purchase Orders, Suppliers.
export function PurchaseClient({
  rfqs,
  pos,
  vendors,
  projects,
}: {
  rfqs: RfqListRow[];
  pos: PoListRow[];
  vendors: VendorDto[];
  projects: { id: string; name: string; client: string; site: string | null }[];
}) {
  const router = useRouter();
  const [addingVendor, setAddingVendor] = useState(false);
  const [editingVendor, setEditingVendor] = useState<VendorDto | null>(null);
  const [wizard, setWizard] = useState(false);

  return (
    <>
      <Card style={{ marginBottom: 20 }}>
        <CardHeader>
          <CardTitle>Rate Inquiries</CardTitle>
          <div className={styles.toolbar}>
            <Button size="sm" onClick={() => setAddingVendor(true)}>
              + Supplier
            </Button>
            <Button size="sm" variant="primary" onClick={() => setWizard(true)}>
              + New rate inquiry
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          {rfqs.length === 0 ? (
            <EmptyState>
              No rate inquiries yet. Start one to collect supplier rates for pending project material.
            </EmptyState>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>RFQ no.</Th>
                    <Th>Date</Th>
                    <Th>Projects</Th>
                    <Th align="r">Items</Th>
                    <Th align="r">Suppliers</Th>
                    <Th align="r">Quotes received</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {rfqs.map((r) => (
                    <tr key={r.id}>
                      <Td>
                        <b>{r.no}</b>
                      </Td>
                      <Td>{dfmt(r.date)}</Td>
                      <Td>{r.projectNames.join(", ")}</Td>
                      <Td align="r">{r.lineCount}</Td>
                      <Td align="r">{r.vendorCount}</Td>
                      <Td align="r">{r.responseCount}</Td>
                      <Td>
                        <Chip tone={RFQ_TONE[r.status] ?? "grey"}>{RFQ_STATUS_LABEL[r.status] ?? r.status}</Chip>
                      </Td>
                      <Td>
                        <Button size="sm" onClick={() => router.push(`/purchase/rfq/${r.id}`)}>
                          Open
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardBody>
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <CardHeader>
          <CardTitle>Purchase Orders</CardTitle>
        </CardHeader>
        <CardBody>
          {pos.length === 0 ? (
            <EmptyState>
              No purchase orders yet — they are issued from a rate inquiry after comparing supplier rates.
            </EmptyState>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>PO no.</Th>
                    <Th>Date</Th>
                    <Th>Supplier</Th>
                    <Th>Against RFQ</Th>
                    <Th align="r">Value (incl. GST)</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {pos.map((o) => (
                    <tr key={o.id}>
                      <Td>
                        <b>{o.poNumber}</b>
                      </Td>
                      <Td>{dfmt(o.date)}</Td>
                      <Td>{o.vendorName}</Td>
                      <Td>{o.rfqNo ?? "—"}</Td>
                      <Td align="r">{inr(o.total)}</Td>
                      <Td>
                        <Chip tone={PO_TONE[o.status] ?? "grey"}>{PO_STATUS_LABEL[o.status] ?? o.status}</Chip>
                      </Td>
                      <Td>
                        <Button size="sm" onClick={() => router.push(`/purchase/po/${o.id}`)}>
                          Open
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Suppliers</CardTitle>
        </CardHeader>
        <CardBody>
          {vendors.length === 0 ? (
            <EmptyState>Add your suppliers here (or while creating a rate inquiry).</EmptyState>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Supplier</Th>
                    <Th>Contact</Th>
                    <Th>Phone</Th>
                    <Th>Email</Th>
                    <Th>GSTIN</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {vendors.map((v) => (
                    <tr key={v.id}>
                      <Td>
                        <b>{v.name}</b>
                      </Td>
                      <Td>{v.contact || "—"}</Td>
                      <Td>{v.phone || "—"}</Td>
                      <Td>{v.email || "—"}</Td>
                      <Td>{v.gstin || "—"}</Td>
                      <Td>
                        <Button size="sm" onClick={() => setEditingVendor(v)}>
                          Edit
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardBody>
      </Card>

      {(addingVendor || editingVendor) && (
        <VendorModal
          initial={editingVendor}
          onClose={() => {
            setAddingVendor(false);
            setEditingVendor(null);
          }}
          onSaved={() => {
            setAddingVendor(false);
            setEditingVendor(null);
            router.refresh();
          }}
        />
      )}

      {wizard && <NewRfqWizard projects={projects} vendors={vendors} onClose={() => setWizard(false)} />}
    </>
  );
}
