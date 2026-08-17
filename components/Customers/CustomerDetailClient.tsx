"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BackLink } from "../BackLink/BackLink";
import { Card, CardBody, CardHeader, CardTitle } from "../Card/Card";
import { StatsGrid } from "../StatsGrid/StatsGrid";
import { StatCard } from "../StatCard/StatCard";
import { Table, TableWrap, Td, Th, EmptyState } from "../Table/Table";
import { Button } from "../Button/Button";
import { Chip } from "../Chip/Chip";
import { ConfirmModal } from "../Modal/ConfirmModal";
import { CustomerFormModal } from "./CustomerFormModal";
import { useToast } from "../Toast/ToastProvider";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { inr, dfmt } from "../../lib/format";
import { PROJECT_STATUS_LABEL } from "../../modules/projects/data";
import styles from "./Customers.module.css";
import type { CustomerDetail } from "../../services/customerService";

const QUOTE_TONE: Record<string, "green" | "teal" | "grey" | "red" | "gold"> = {
  ACCEPTED: "green",
  CONVERTED: "green",
  SENT: "teal",
  DRAFT: "grey",
  REJECTED: "red",
  EXPIRED: "gold",
};

export function CustomerDetailClient({ customer }: { customer: CustomerDetail }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | "archive" | "restore" | "delete">(null);
  const [busy, setBusy] = useState(false);
  const f = customer.figures;

  const run = async (action: "archive" | "restore" | "delete") => {
    if (busy) return;
    setBusy(true);
    try {
      if (action === "delete") {
        await apiFetch(`/api/customers/${customer.id}`, { method: "DELETE" });
        toast("Customer deleted");
        router.push("/customers");
        router.refresh();
        return;
      }
      await apiFetch(`/api/customers/${customer.id}`, { method: "PATCH", body: JSON.stringify({ action }) });
      toast(action === "archive" ? "Customer archived" : "Customer restored");
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <>
      <BackLink href="/customers">All customers</BackLink>
      <div className={styles.detailHead}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2>
            {customer.name} {customer.archivedAt && <Chip tone="grey">archived</Chip>}
          </h2>
          <div className={styles.detailMeta}>
            {[customer.phone && `Ph: ${customer.phone}`, customer.email, customer.gstin && `GSTIN: ${customer.gstin}`]
              .filter(Boolean)
              .join(" · ")}
            {(customer.refBy || customer.salesPerson) && (
              <>
                <br />
                {customer.refBy && (
                  <>
                    <b>Referred by:</b>{" "}
                    <Link href={`/customers/references/${encodeURIComponent(customer.refBy)}`}>{customer.refBy}</Link>
                  </>
                )}
                {customer.refBy && customer.salesPerson && " · "}
                {customer.salesPerson && (
                  <>
                    <b>Sales person:</b> {customer.salesPerson}
                  </>
                )}
              </>
            )}
            {customer.billing && (
              <>
                <br />
                <b>Billing:</b> {customer.billing}
              </>
            )}
            {customer.delivery && (
              <>
                <br />
                <b>Delivery:</b> {customer.delivery}
              </>
            )}
            {customer.notes && (
              <>
                <br />
                <b>Notes:</b> {customer.notes}
              </>
            )}
          </div>
        </div>
        <div className={styles.detailActions}>
          <Button size="sm" onClick={() => setEditing(true)}>
            Edit customer
          </Button>
          <Link href={`/quotations/new?customerId=${customer.id}`}>
            <Button size="sm" variant="primary">
              + New quotation
            </Button>
          </Link>
          {customer.archivedAt ? (
            <Button size="sm" onClick={() => setConfirm("restore")} disabled={busy}>
              Restore
            </Button>
          ) : (
            <Button size="sm" onClick={() => setConfirm("archive")} disabled={busy}>
              Archive
            </Button>
          )}
          {f.projectCount === 0 && f.quotationCount === 0 && (
            <Button size="sm" variant="danger" onClick={() => setConfirm("delete")} disabled={busy}>
              Delete
            </Button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <StatsGrid>
          <StatCard label="Projects" value={String(f.projectCount)} highlight />
          <StatCard label="Quotations" value={`${f.quotationCount} (${f.openQuotationCount} open)`} />
          <StatCard label="Total contract value" value={inr(f.contract)} />
          <StatCard label="Value of goods sent" value={inr(f.sent)} />
          <StatCard label="Total payment received" value={inr(f.received)} tone="pos" />
          <StatCard label="Total payment due" value={inr(f.due)} tone={f.due > 0 ? "neg" : "pos"} />
        </StatsGrid>
      </div>

      <Card style={{ marginTop: 18 }}>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <CardBody>
          {customer.projects.length === 0 ? (
            <EmptyState>No projects yet for this customer.</EmptyState>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Project</Th>
                    <Th>Site</Th>
                    <Th>Status</Th>
                    <Th align="r">Contract</Th>
                    <Th align="r">Goods sent</Th>
                    <Th align="r">Received</Th>
                    <Th align="r">Due</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {customer.projects.map((p) => (
                    <tr key={p.id}>
                      <Td>
                        <b>{p.name}</b>
                      </Td>
                      <Td>{p.site || "—"}</Td>
                      <Td>
                        <Chip tone={p.status === "COMPLETED" ? "green" : p.status === "ON_HOLD" ? "gold" : "grey"}>
                          {PROJECT_STATUS_LABEL[p.status] ?? p.status}
                        </Chip>
                      </Td>
                      <Td align="r">{inr(p.contract)}</Td>
                      <Td align="r">{inr(p.sent)}</Td>
                      <Td align="r" style={{ color: "var(--ok)" }}>
                        {inr(p.received)}
                      </Td>
                      <Td align="r" style={{ color: p.balance > 0 ? "var(--danger)" : undefined }}>
                        {inr(p.balance)}
                      </Td>
                      <Td>
                        <Link href={`/projects/${p.id}`}>
                          <Button size="sm">Open</Button>
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardBody>
      </Card>

      <Card style={{ marginTop: 18 }}>
        <CardHeader>
          <CardTitle>Quotations</CardTitle>
        </CardHeader>
        <CardBody>
          {customer.quotations.length === 0 ? (
            <EmptyState>No quotations yet.</EmptyState>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Ref</Th>
                    <Th>Date</Th>
                    <Th>Project</Th>
                    <Th align="r">Value</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {customer.quotations.map((q) => (
                    <tr key={q.id}>
                      <Td>
                        <b>{q.ref}</b>
                      </Td>
                      <Td>{dfmt(q.date)}</Td>
                      <Td>{q.title}</Td>
                      <Td align="r">{inr(q.grandTotal)}</Td>
                      <Td>
                        <Chip tone={QUOTE_TONE[q.status] ?? "grey"}>{q.status}</Chip>
                      </Td>
                      <Td>
                        <Link href={`/quotations/${q.id}`}>
                          <Button size="sm">Open</Button>
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardBody>
      </Card>

      {editing && (
        <CustomerFormModal
          initial={{
            id: customer.id,
            name: customer.name,
            billing: customer.billing ?? "",
            delivery: customer.delivery ?? "",
            phone: customer.phone ?? "",
            email: customer.email ?? "",
            gstin: customer.gstin ?? "",
            refBy: customer.refBy ?? "",
            salesPerson: customer.salesPerson ?? "",
            notes: customer.notes ?? "",
          }}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      )}

      {confirm && (
        <ConfirmModal
          message={
            confirm === "archive"
              ? "Archive this customer? Their projects and quotations stay exactly as they are — the customer just drops out of pickers and the default list."
              : confirm === "restore"
                ? "Restore this customer so they appear in lists and pickers again?"
                : "Delete this customer permanently? This is only possible because they have no projects or quotations."
          }
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run(confirm)}
        />
      )}
    </>
  );
}
