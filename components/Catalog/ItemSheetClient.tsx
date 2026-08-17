"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle } from "../Card/Card";
import { Table, TableWrap, Td, Th, EmptyState } from "../Table/Table";
import { Button } from "../Button/Button";
import { Chip } from "../Chip/Chip";
import { TextInput, Select } from "../Form/Inputs";
import { ConfirmModal } from "../Modal/ConfirmModal";
import { CatalogItemModal } from "./CatalogItemModal";
import { ItemSheetViewModal } from "./ItemSheetViewModal";
import { DuplicatesModal } from "./DuplicatesModal";
import { useToast } from "../Toast/ToastProvider";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { inr } from "../../lib/format";
import styles from "./Catalog.module.css";
import type { CatalogItemDto, CatalogListResult } from "../../services/catalogService";

// The Item Sheet: the master product list every quotation, sales order and
// stock row prices against.
export function ItemSheetClient({ initial }: { initial: CatalogListResult }) {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<CatalogListResult>(initial);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<CatalogItemDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CatalogItemDto | null>(null);
  const [viewing, setViewing] = useState<CatalogItemDto | null>(null);
  const [dupes, setDupes] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          q,
          category,
          page: String(page),
          includeArchived: includeArchived ? "1" : "0",
        });
        const res = await fetch(`/api/catalog?${params}`, { signal });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load the item sheet");
        setData(await res.json());
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message || "Failed to load the item sheet");
      } finally {
        setLoading(false);
      }
    },
    [q, category, page, includeArchived]
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

  const archiveToggle = async (item: CatalogItemDto) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch(`/api/catalog/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: item.archivedAt ? "restore" : "archive" }),
      });
      toast(item.archivedAt ? "Item restored" : "Item archived");
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: CatalogItemDto) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch(`/api/catalog/${item.id}`, { method: "DELETE" });
      toast("Item deleted");
      await load();
    } catch (err) {
      // 409 here means the item is quoted somewhere — the message tells the
      // user to archive instead, which is the correct action.
      toast(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  };

  const seed = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ created: number }>("/api/catalog", {
        method: "POST",
        body: JSON.stringify({ action: "seedFromUsage" }),
      });
      toast(
        res.created
          ? `${res.created} item(s) added to the sheet from existing sales orders and quotations`
          : "The sheet already covers every item in use"
      );
      await load();
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card style={{ marginBottom: 20 }}>
        <CardHeader>
          <CardTitle>Item Sheet — master list of all items</CardTitle>
          <div className={styles.toolbar}>
            <TextInput
              className={styles.search}
              placeholder="Search item sheet…"
              value={q}
              onChange={(e) => changeFilter(() => setQ(e.target.value))}
              aria-label="Search the item sheet"
            />
            <Select
              value={category}
              onChange={(e) => changeFilter(() => setCategory(e.target.value))}
              aria-label="Filter by category"
              style={{ width: "auto" }}
            >
              <option value="">All categories</option>
              {data.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => changeFilter(() => setIncludeArchived(e.target.checked))}
              />
              Show archived
            </label>
            <Button size="sm" onClick={seed} disabled={busy} title="Add every item already used on a sales order or quotation">
              Seed from usage
            </Button>
            <Button size="sm" onClick={() => setDupes(true)}>
              Review duplicates
            </Button>
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              + New item
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          {error && (
            <p role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>
              {error}{" "}
              <button
                onClick={() => void load()}
                style={{ border: "none", background: "none", color: "var(--primary-dark)", fontWeight: 700, cursor: "pointer" }}
              >
                Retry
              </button>
            </p>
          )}
          {data.rows.length === 0 && !loading ? (
            <EmptyState>
              The item sheet is empty. Add your products, or use <b>Seed from usage</b> to pull in every item already
              used on a sales order or quotation.
            </EmptyState>
          ) : (
            <TableWrap>
              <Table style={loading ? { opacity: 0.55 } : undefined}>
                <thead>
                  <tr>
                    <Th />
                    <Th>Item</Th>
                    <Th>Unit</Th>
                    <Th>Category</Th>
                    <Th>Brands</Th>
                    <Th align="r">Selling price</Th>
                    <Th align="r">Disc %</Th>
                    <Th align="r">Net rate</Th>
                    <Th align="r">Cost to us</Th>
                    <Th>Parts</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((c) => (
                    <tr key={c.id}>
                      <Td>
                        {c.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- Supabase-hosted product photo
                          <img src={c.imageUrl} alt={c.name} className={styles.thumb} />
                        ) : (
                          <div className={styles.thumbEmpty} />
                        )}
                      </Td>
                      <Td>
                        <b>{c.name}</b>
                        {c.archivedAt && (
                          <>
                            {" "}
                            <Chip tone="grey">archived</Chip>
                          </>
                        )}
                        {c.details && (
                          <div
                            style={{
                              color: "var(--muted)",
                              fontSize: 11.5,
                              maxWidth: 320,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.details}
                          </div>
                        )}
                      </Td>
                      <Td>{c.unit}</Td>
                      <Td>{c.category || "—"}</Td>
                      <Td>
                        {c.makes.length ? c.makes.map((m) => <Chip key={m} tone="teal">{m}</Chip>) : "—"}
                      </Td>
                      <Td align="r">{c.sellPrice != null ? inr(c.sellPrice) : "—"}</Td>
                      <Td align="r">{c.discountPct ? `${c.discountPct}%` : "—"}</Td>
                      <Td align="r">{c.netRate != null ? inr(c.netRate) : "—"}</Td>
                      <Td align="r" title={c.costBasis ?? undefined}>
                        {c.costRate != null ? inr(c.costRate) : "—"}
                      </Td>
                      <Td>{c.components.length ? `${c.components.length} part${c.components.length > 1 ? "s" : ""}` : "—"}</Td>
                      <Td style={{ whiteSpace: "nowrap" }}>
                        <Button size="sm" onClick={() => setViewing(c)}>
                          View
                        </Button>{" "}
                        <Button size="sm" onClick={() => setEditing(c)}>
                          Edit
                        </Button>{" "}
                        <Button size="sm" onClick={() => void archiveToggle(c)} disabled={busy}>
                          {c.archivedAt ? "Restore" : "Archive"}
                        </Button>{" "}
                        <Button size="sm" variant="danger" onClick={() => setConfirmDelete(c)} disabled={busy}>
                          Delete
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
              {data.total} item{data.total === 1 ? "" : "s"} · page {data.page} of {data.pageCount}
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

      {(creating || editing) && (
        <CatalogItemModal
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void load();
            router.refresh();
          }}
        />
      )}

      {viewing && (
        <ItemSheetViewModal
          item={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            const item = viewing;
            setViewing(null);
            setEditing(item);
          }}
        />
      )}

      {dupes && (
        <DuplicatesModal
          onClose={() => setDupes(false)}
          onMerged={() => {
            void load();
            router.refresh();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          message={`Delete "${confirmDelete.name}" from the item sheet? If it has been quoted anywhere this will be refused — archive it instead.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void remove(confirmDelete)}
        />
      )}
    </>
  );
}
