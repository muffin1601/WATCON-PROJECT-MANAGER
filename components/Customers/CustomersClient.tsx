"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardBody, CardHeader, CardTitle } from "../Card/Card";
import { Table, TableWrap, Td, Th, EmptyState } from "../Table/Table";
import { Button } from "../Button/Button";
import { TextInput, Select } from "../Form/Inputs";
import { Chip } from "../Chip/Chip";
import { CustomerFormModal } from "./CustomerFormModal";
import { inr } from "../../lib/format";
import styles from "./Customers.module.css";
import type { CustomerListResult } from "../../services/customerService";
import type { ReferenceRow } from "../../services/customerService";

// Customers screen. The table is served page-by-page from /api/customers so
// the browser never holds the whole customer base in memory; search, sort and
// paging all round-trip to the database.
export function CustomersClient({
  initial,
  references,
}: {
  initial: CustomerListResult;
  references: ReferenceRow[];
}) {
  const router = useRouter();
  const [data, setData] = useState<CustomerListResult>(initial);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "due" | "contract" | "recent">("name");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          q,
          sort,
          page: String(page),
          includeArchived: includeArchived ? "1" : "0",
        });
        const res = await fetch(`/api/customers?${params}`, { signal });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load customers");
        setData(await res.json());
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message || "Failed to load customers");
      } finally {
        setLoading(false);
      }
    },
    [q, sort, page, includeArchived]
  );

  // Debounced so typing in the search box doesn't fire a request per keystroke.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [load]);

  // Any filter change restarts at page 1 — otherwise a narrowed search can land
  // on a page that no longer exists and look empty.
  const changeFilter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <>
      <Card style={{ marginBottom: 20 }}>
        <CardHeader>
          <CardTitle>Customers</CardTitle>
          <div className={styles.toolbar}>
            <TextInput
              className={styles.search}
              placeholder="Search customer / reference / sales person…"
              value={q}
              onChange={(e) => changeFilter(() => setQ(e.target.value))}
              aria-label="Search customers"
            />
            <Select
              value={sort}
              onChange={(e) => changeFilter(() => setSort(e.target.value as typeof sort))}
              aria-label="Sort customers"
              style={{ width: "auto" }}
            >
              <option value="name">Sort: Name</option>
              <option value="due">Sort: Payment due</option>
              <option value="contract">Sort: Contract value</option>
              <option value="recent">Sort: Recently added</option>
            </Select>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => changeFilter(() => setIncludeArchived(e.target.checked))}
              />
              Show archived
            </label>
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              + New customer
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          {error && (
            <p role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>
              {error}{" "}
              <button className={styles.linkBtn} onClick={() => void load()}>
                Retry
              </button>
            </p>
          )}
          {data.rows.length === 0 && !loading ? (
            <EmptyState>
              {q ? "No customer matches that search." : "No customers yet. Add one, or create a quotation/project — customers are linked automatically."}
            </EmptyState>
          ) : (
            <TableWrap>
              <Table style={loading ? { opacity: 0.55 } : undefined}>
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Referred by</Th>
                    <Th>Sales person</Th>
                    <Th align="r">Projects</Th>
                    <Th align="r">Contract value</Th>
                    <Th align="r">Goods sent</Th>
                    <Th align="r">Received</Th>
                    <Th align="r">Payment due</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((c) => (
                    <tr key={c.id}>
                      <Td>
                        <b>{c.name}</b>
                        {c.archivedAt && (
                          <>
                            {" "}
                            <Chip tone="grey">archived</Chip>
                          </>
                        )}
                        {c.phone && <div style={{ color: "var(--muted)", fontSize: 11.5 }}>{c.phone}</div>}
                      </Td>
                      <Td>{c.refBy || "—"}</Td>
                      <Td>{c.salesPerson || "—"}</Td>
                      <Td align="r">
                        {c.figures.projectCount}
                        {c.figures.quotationCount > 0 && (
                          <span style={{ color: "var(--muted)", fontSize: 11.5 }}>
                            {" "}
                            (+{c.figures.quotationCount} quote{c.figures.quotationCount > 1 ? "s" : ""})
                          </span>
                        )}
                      </Td>
                      <Td align="r">{inr(c.figures.contract)}</Td>
                      <Td align="r">{inr(c.figures.sent)}</Td>
                      <Td align="r" style={{ color: "var(--ok)" }}>
                        {inr(c.figures.received)}
                      </Td>
                      <Td align="r" style={{ color: c.figures.due > 0 ? "var(--danger)" : undefined }}>
                        <b>{inr(c.figures.due)}</b>
                      </Td>
                      <Td>
                        <Button size="sm" onClick={() => router.push(`/customers/${c.id}`)}>
                          Open
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
          <div className={styles.pagination}>
            <span>
              {data.total} customer{data.total === 1 ? "" : "s"} · page {data.page} of {data.pageCount}
            </span>
            <Button size="sm" disabled={data.page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </Button>
            <Button
              size="sm"
              disabled={data.page >= data.pageCount || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>References (who brings the business)</CardTitle>
        </CardHeader>
        <CardBody>
          {references.length === 0 ? (
            <EmptyState>
              Set &quot;Referred by&quot; on a customer, quotation or project to see who brings the business.
            </EmptyState>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Referred by</Th>
                    <Th align="r">Customers</Th>
                    <Th align="r">Quotes</Th>
                    <Th align="r">Quoted value</Th>
                    <Th align="r">Projects</Th>
                    <Th align="r">Contract value</Th>
                    <Th align="r">Received</Th>
                    <Th align="r">Due</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {references.map((r) => (
                    <tr key={r.name}>
                      <Td>
                        <b>{r.name}</b>
                      </Td>
                      <Td align="r">{r.customerCount}</Td>
                      <Td align="r">
                        {r.quotationCount}
                        {r.openQuotationCount > 0 && (
                          <span style={{ color: "var(--muted)", fontSize: 11.5 }}> ({r.openQuotationCount} open)</span>
                        )}
                      </Td>
                      <Td align="r">{inr(r.quotedValue)}</Td>
                      <Td align="r">{r.projectCount}</Td>
                      <Td align="r">{inr(r.contract)}</Td>
                      <Td align="r" style={{ color: "var(--ok)" }}>
                        {inr(r.received)}
                      </Td>
                      <Td align="r" style={{ color: r.due > 0 ? "var(--danger)" : undefined }}>
                        {inr(r.due)}
                      </Td>
                      <Td>
                        <Link href={`/customers/references/${encodeURIComponent(r.name)}`}>
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

      {creating && (
        <CustomerFormModal
          onClose={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false);
            router.push(`/customers/${c.id}`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
