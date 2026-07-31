import { prisma } from "../lib/prisma";

export interface SearchResult {
  type: "project" | "challan" | "bill" | "payment" | "document" | "documentPage" | "discount" | "amendment" | "vendor";
  id: string;
  title: string;
  subtitle: string;
  projectId: string | null;
  documentId?: string; // for documentPage results — the parent document to open
  page?: number; // for documentPage results — which page the match is on
}

const LIMIT_PER_TYPE = 5;
const SNIPPET_RADIUS = 60;

function snippet(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, SNIPPET_RADIUS * 2).trim();
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

// Database-driven search across every entity the app tracks. Query is
// matched case-insensitively against the field(s) that identify each
// record (project name/client/site/PO no., challan/bill no., payment
// reference, document filename, discount reason, amendment description,
// vendor name), plus full-document-text search across every page indexed
// by services/ocr#extractDocumentText (Part 6 — the extracted text is
// never interpreted, only searched).
export async function globalSearch(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const [projects, challans, bills, payments, documents, discounts, amendments, vendors, documentTexts] = await Promise.all([
    prisma.project.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { client: { contains: q, mode: "insensitive" } },
          { site: { contains: q, mode: "insensitive" } },
          { poNumber: { contains: q, mode: "insensitive" } },
        ],
      },
      take: LIMIT_PER_TYPE,
      select: { id: true, name: true, client: true },
    }),
    prisma.challan.findMany({
      where: { no: { contains: q, mode: "insensitive" } },
      take: LIMIT_PER_TYPE,
      select: { id: true, no: true, projectId: true, project: { select: { name: true } } },
    }),
    prisma.bill.findMany({
      where: { no: { contains: q, mode: "insensitive" } },
      take: LIMIT_PER_TYPE,
      select: { id: true, no: true, projectId: true, project: { select: { name: true } } },
    }),
    prisma.payment.findMany({
      where: { reference: { contains: q, mode: "insensitive" } },
      take: LIMIT_PER_TYPE,
      select: { id: true, reference: true, projectId: true, project: { select: { name: true } } },
    }),
    prisma.document.findMany({
      where: { fileName: { contains: q, mode: "insensitive" } },
      take: LIMIT_PER_TYPE,
      select: { id: true, fileName: true, projectId: true, project: { select: { name: true } } },
    }),
    prisma.discount.findMany({
      where: { reason: { contains: q, mode: "insensitive" } },
      take: LIMIT_PER_TYPE,
      select: { id: true, reason: true, projectId: true, project: { select: { name: true } } },
    }),
    prisma.amendment.findMany({
      where: { description: { contains: q, mode: "insensitive" } },
      take: LIMIT_PER_TYPE,
      select: { id: true, description: true, projectId: true, project: { select: { name: true } } },
    }),
    prisma.vendor.findMany({
      where: { name: { contains: q, mode: "insensitive" } },
      take: LIMIT_PER_TYPE,
      select: { id: true, name: true },
    }),
    prisma.documentText.findMany({
      where: { rawText: { contains: q, mode: "insensitive" } },
      take: LIMIT_PER_TYPE,
      select: {
        id: true,
        documentId: true,
        pageNumber: true,
        rawText: true,
        document: { select: { fileName: true, projectId: true } },
      },
    }),
  ]);

  return [
    ...projects.map((p): SearchResult => ({ type: "project", id: p.id, title: p.name, subtitle: p.client, projectId: p.id })),
    ...challans.map((c): SearchResult => ({ type: "challan", id: c.id, title: c.no, subtitle: c.project.name, projectId: c.projectId })),
    ...bills.map((b): SearchResult => ({ type: "bill", id: b.id, title: b.no, subtitle: b.project.name, projectId: b.projectId })),
    ...payments.map((x): SearchResult => ({ type: "payment", id: x.id, title: x.reference ?? "Payment", subtitle: x.project.name, projectId: x.projectId })),
    ...documents.map((d): SearchResult => ({ type: "document", id: d.id, title: d.fileName, subtitle: d.project?.name ?? "—", projectId: d.projectId })),
    ...discounts.map((d): SearchResult => ({ type: "discount", id: d.id, title: d.reason ?? "Discount", subtitle: d.project.name, projectId: d.projectId })),
    ...amendments.map((a): SearchResult => ({ type: "amendment", id: a.id, title: a.description, subtitle: a.project.name, projectId: a.projectId })),
    ...vendors.map((v): SearchResult => ({ type: "vendor", id: v.id, title: v.name, subtitle: "Vendor", projectId: null })),
    ...documentTexts.map(
      (t): SearchResult => ({
        type: "documentPage",
        id: t.id,
        title: `${t.document.fileName} · page ${t.pageNumber}`,
        subtitle: snippet(t.rawText, q),
        projectId: t.document.projectId,
        documentId: t.documentId,
        page: t.pageNumber,
      })
    ),
  ];
}
