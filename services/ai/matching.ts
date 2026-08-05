import { prisma } from "../../lib/prisma";

/**
 * Matching layer — "if it already exists, reuse it; never duplicate".
 *
 * Every function here returns a *candidate with a score* and never writes.
 * Deciding to use a match is the caller's job, and for anything ambiguous the
 * decision is the user's: a challan silently attached to the wrong project
 * corrupts that project's dispatched-value and balance figures, and nothing
 * in the UI would reveal it. So a confident match is pre-selected and a weak
 * one is offered as a suggestion.
 */

/** Tokens worth matching on — drops noise words that appear in every description. */
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "of", "in", "to", "a", "an",
  "mm", "no", "nos", "set", "sets", "pcs", "make", "type", "size",
]);

function tokenise(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Dice coefficient over token sets: 2|A∩B| / (|A|+|B|).
 *
 * Chosen over the prototype's one-directional overlap (`matched / a.length`),
 * which scored a two-word challan line against a fifteen-word BOQ item as a
 * perfect match whenever both words happened to appear — a real source of
 * wrong auto-links. Dice penalises that length mismatch symmetrically.
 */
function similarity(a: string, b: string): number {
  const ta = new Set(tokenise(a));
  const tb = new Set(tokenise(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return (2 * shared) / (ta.size + tb.size);
}

export interface MatchCandidate<T> {
  value: T;
  score: number;
  /** True when the score is high enough to pre-select without asking. */
  confident: boolean;
}

const PROJECT_CONFIDENT = 0.6;
const ITEM_CONFIDENT = 0.55;

export interface ProjectMatchHints {
  poNumber?: string;
  projectName?: string;
  clientName?: string;
  siteAddress?: string;
}

export interface MatchedProject {
  id: string;
  name: string;
  client: string;
  site: string | null;
  poNumber: string | null;
}

/**
 * Find which existing project a challan belongs to.
 *
 * An exact PO-number hit is treated as decisive — that is an explicit,
 * human-assigned identifier, not a fuzzy signal. Everything else is scored
 * across name, client and site and only pre-selected above the threshold.
 */
export async function matchProject(hints: ProjectMatchHints): Promise<MatchCandidate<MatchedProject>[]> {
  const projects = await prisma.project.findMany({
    select: { id: true, name: true, client: true, site: true, poNumber: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const po = hints.poNumber?.trim().toLowerCase();

  const scored = projects.map((project) => {
    if (po && project.poNumber && project.poNumber.trim().toLowerCase() === po) {
      return { value: project, score: 1, confident: true };
    }

    // Weighted because the signals differ in reliability: a project name is
    // the most specific, a site address the least (several projects can share
    // one site).
    const nameScore = hints.projectName ? similarity(hints.projectName, project.name) : 0;
    const clientScore = hints.clientName ? similarity(hints.clientName, project.client) : 0;
    const siteScore = hints.siteAddress && project.site ? similarity(hints.siteAddress, project.site) : 0;
    const score = nameScore * 0.5 + clientScore * 0.35 + siteScore * 0.15;

    return { value: project, score, confident: score >= PROJECT_CONFIDENT };
  });

  return scored
    .filter((c) => c.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export interface MatchedItem {
  id: string;
  description: string;
  unit: string;
}

export interface ChallanLineMatch {
  /** Index into the incoming challan item array. */
  lineIndex: number;
  description: string;
  unit: string;
  qty: number;
  /** Best existing Sales Order item, or null when nothing plausible matched. */
  match: MatchCandidate<MatchedItem> | null;
  alternatives: MatchCandidate<MatchedItem>[];
}

/**
 * Link challan goods lines to this project's existing Sales Order items so
 * dispatched/pending quantities update against rows that already exist rather
 * than creating parallel duplicates.
 *
 * Matching is greedy and exclusive: once a Sales Order item is claimed by one
 * challan line it is not offered to another, which stops a single BOQ row
 * absorbing several distinct challan lines.
 */
export async function matchChallanLines(
  projectId: string,
  lines: { description: string; unit: string; qty: number }[]
): Promise<ChallanLineMatch[]> {
  const items = await prisma.poItem.findMany({
    where: { projectId },
    select: { id: true, description: true, unit: true },
    orderBy: { sortOrder: "asc" },
  });

  const claimed = new Set<string>();

  // Score every pair up front, then assign strongest-first, so the ordering
  // of lines in the challan cannot change which pairs win.
  const pairs: { lineIndex: number; item: MatchedItem; score: number }[] = [];
  lines.forEach((line, lineIndex) => {
    for (const item of items) {
      const base = similarity(line.description, item.description);
      // A matching unit is corroborating evidence, not proof on its own.
      const unitBonus =
        line.unit && item.unit && line.unit.toLowerCase() === item.unit.toLowerCase() ? 0.08 : 0;
      const score = Math.min(1, base + (base > 0 ? unitBonus : 0));
      if (score > 0.2) pairs.push({ lineIndex, item, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score);

  const best = new Map<number, { item: MatchedItem; score: number }>();
  const alts = new Map<number, MatchCandidate<MatchedItem>[]>();

  for (const pair of pairs) {
    if (!best.has(pair.lineIndex) && !claimed.has(pair.item.id)) {
      best.set(pair.lineIndex, { item: pair.item, score: pair.score });
      claimed.add(pair.item.id);
      continue;
    }
    const list = alts.get(pair.lineIndex) ?? [];
    if (list.length < 3) {
      list.push({ value: pair.item, score: pair.score, confident: false });
      alts.set(pair.lineIndex, list);
    }
  }

  return lines.map((line, lineIndex) => {
    const chosen = best.get(lineIndex);
    return {
      lineIndex,
      description: line.description,
      unit: line.unit,
      qty: line.qty,
      match: chosen
        ? { value: chosen.item, score: chosen.score, confident: chosen.score >= ITEM_CONFIDENT }
        : null,
      alternatives: alts.get(lineIndex) ?? [],
    };
  });
}
