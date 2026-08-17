"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardBody, CardHeader, CardTitle } from "../Card/Card";
import { StatsGrid } from "../StatsGrid/StatsGrid";
import { StatCard } from "../StatCard/StatCard";
import { Table, TableWrap, Td, Th, EmptyState } from "../Table/Table";
import { Button } from "../Button/Button";
import { Chip, type ChipTone } from "../Chip/Chip";
import { TextInput, Select } from "../Form/Inputs";
import { inr, dfmt } from "../../lib/format";
import { QUOTATION_STATUS_LABEL, QUOTATION_STATUSES } from "../../modules/quotations/schema";
import styles from "./Quotations.module.css";
import type { QuotationListResult } from "../../services/quotationService";

export const STATUS_TONE: Record<string, ChipTone> = {
  DRAFT: "grey",
  SENT: "teal",
  ACCEPTED: "green",
  CONVERTED: "green",
  REJECTED: "red",
  EXPIRED: "gold",
};

// Quotations list: server-side search, status/date filtering, sorting and
// paging. The KPI row summarises the whole filtered set, not just the page.
export function QuotationsClient({ initial }: { initial: QuotationListResult }) {
  const router = useRouter();
  const [data, setData] = useState<QuotationListResult>(initial);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<"date" | "value" | "ref">("date");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ q, sort, page: String(page) });
        if (status) params.set("status", status);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const res = await fetch(`/api/quotations?${params}`, { signal });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load quotations");
        setData(await res.json());
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message || "Failed to load quotations");
      } finally {
        setLoading(false);
      }
    },
    [q, status, from, to, sort, page]
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [load]);

  const changeFilter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const s = data.summary;

  return (
    <>
      <StatsGrid>
        <StatCard label="Quotations" value={String(s.count)} highlight />
        <StatCard label="Total quoted value" value={inr(s.value)} />
        <StatCard label="Accepted / converted" value={String(s.accepted)} tone="pos" />
        <StatCard label="Open (draft or sent)" value={String(s.open)} />
      </StatsGrid>

      <Card style={{ marginTop: 20 }}>
        <CardHeader>
          <CardTitle>Quotations</CardTitle>
          <div className={styles.toolbar}>
            <TextInput
              className={styles.search}
              placeholder="Search ref / customer / project…"
              value={q}
              onChange={(e) => changeFilter(() => setQ(e.target.value))}
              aria-label="Search quotations"
            />
            <Select
              value={status}
              onChange={(e) => changeFilter(() => setStatus(e.target.value))}
              aria-label="Filter by status"
              style={{ width: "auto" }}
            >
              <option value="">All statuses</option>
              {QUOTATION_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {QUOTATION_STATUS_LABEL[st]}
                </option>
              ))}
            </Select>
            <TextInput
              type="date"
              value={from}
              onChange={(e) => changeFilter(() => setFrom(e.target.value))}
              aria-label="From date"
              style={{ width: "auto" }}
            />
            <TextInput
              type="date"
              value={to}
              onChange={(e) => changeFilter(() => setTo(e.target.value))}
              aria-label="To date"
              style={{ width: "auto" }}
            />
            <Select
              value={sort}
              onChange={(e) => changeFilter(() => setSort(e.target.value as typeof sort))}
              aria-label="Sort quotations"
              style={{ width: "auto" }}
            >
              <option value="date">Sort: Date</option>
              <option value="value">Sort: Value</option>
              <option value="ref">Sort: Reference</option>
            </Select>
            <Link href="/quotations/new">
              <Button variant="primary" size="sm">
                + New quotation
              </Button>
            </Link>
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
              {q || status || from || to
                ? "No quotation matches these filters."
                : "No quotations yet. Create one, print it on the letterhead, and convert it to a project once the client accepts."}
            </EmptyState>
          ) : (
            <TableWrap>
              <Table style={loading ? { opacity: 0.55 } : undefined}>
                <thead>
                  <tr>
                    <Th>Ref</Th>
                    <Th>Date</Th>
                    <Th>Customer</Th>
                    <Th>Project</Th>
                    <Th align="r">Value</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id}>
                      <Td>
                        <b>{row.ref}</b>
                      </Td>
                      <Td>{dfmt(row.date)}</Td>
                      <Td>
                        {row.customerId ? (
                          <Link href={`/customers/${row.customerId}`}>{row.client}</Link>
                        ) : (
                          row.client
                        )}
                      </Td>
                      <Td>
                        {row.title}
                        {row.refBy && (
                          <div style={{ color: "var(--muted)", fontSize: 11 }}>ref: {row.refBy}</div>
                        )}
                      </Td>
                      <Td align="r">{inr(row.grandTotal)}</Td>
                      <Td>
                        <Chip tone={STATUS_TONE[row.status] ?? "grey"}>
                          {QUOTATION_STATUS_LABEL[row.status] ?? row.status}
                        </Chip>
                      </Td>
                      <Td style={{ whiteSpace: "nowrap" }}>
                        <Button size="sm" onClick={() => router.push(`/quotations/${row.id}`)}>
                          Open
                        </Button>
                        {row.convertedProjectId && (
                          <>
                            {" "}
                            <Link href={`/projects/${row.convertedProjectId}`}>
                              <Button size="sm">Project</Button>
                            </Link>
                          </>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
          <div className={styles.pagination}>
            <span>
              {data.total} quotation{data.total === 1 ? "" : "s"} · page {data.page} of {data.pageCount}
            </span>
            <Button size="sm" disabled={data.page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </Button>
            <Button size="sm" disabled={data.page >= data.pageCount || loading} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
