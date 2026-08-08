import type { AiChallanResult } from "../../modules/ai/schema";
import type { CellValue, WorkbookGrid } from "./spreadsheet";
import { extractRowsFromWorkbook } from "./tableExtract";

/**
 * Spreadsheet / CSV -> a delivery challan, read deterministically.
 *
 * The order path had a structured reader from the start; challans did not, so
 * a .xlsx or .csv challan was handed to a language model — or, with no AI key,
 * to a regular expression written for free-flowing OCR text, which finds
 * essentially nothing in comma-separated data. Both are the wrong tool for a
 * file that already contains the table.
 *
 * Challans differ from orders in one way that matters: they carry quantities
 * and usually no rates at all. The shared row reader already handles that (a
 * row needs a description and a quantity), so the same header detection,
 * column synonyms and totals-row rejection apply unchanged.
 */

const SCAN_ROWS = 40;

function cellText(cell: CellValue): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).replace(/\s+/g, " ").trim();
}

function toIsoDate(value: CellValue): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = cellText(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const m = text.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!m) return "";
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day > 31 || month > 12) return "";
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface ChallanHeader {
  challanNo: string;
  date: string;
  vehicle: string;
  driver: string;
  poNumber: string;
  clientName: string;
  projectName: string;
  siteAddress: string;
}

const LABELS: { key: keyof ChallanHeader; re: RegExp }[] = [
  { key: "challanNo", re: /^(challan\s*(no|number|#)?|dc\s*no|delivery\s*challan\s*(no|number)?|d\.?c\.?\s*no)\b/i },
  { key: "date", re: /^(challan\s*date|dispatch\s*date|date|dated)\b/i },
  { key: "vehicle", re: /^(vehicle\s*(no|number)?|truck\s*(no)?|lorry\s*(no)?|vehicle\s*reg)\b/i },
  { key: "driver", re: /^(driver|driver\s*name|driver\s*(no|mobile|contact))\b/i },
  { key: "poNumber", re: /^(against\s*po|p\.?o\.?\s*(no|number|ref)|work\s*order|order\s*(ref|no)|ref(erence)?\s*(no)?)\b/i },
  { key: "clientName", re: /^(client|customer|consignee|bill\s*to|deliver(ed)?\s*to|to)\b/i },
  { key: "projectName", re: /^(project|project\s*name|job|work)\b/i },
  { key: "siteAddress", re: /^(site|site\s*address|delivery\s*(address|at)|ship\s*to|location|destination)\b/i },
];

function readHeader(workbook: WorkbookGrid): ChallanHeader {
  const out: ChallanHeader = {
    challanNo: "",
    date: "",
    vehicle: "",
    driver: "",
    poNumber: "",
    clientName: "",
    projectName: "",
    siteAddress: "",
  };

  for (const sheet of workbook.sheets) {
    for (const row of sheet.rows.slice(0, SCAN_ROWS)) {
      const cells = row.map((c) => cellText(c));
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i]!;
        if (!cell) continue;

        const inline = cell.match(/^([^:]{2,40}):\s*(.+)$/);
        let label = cell.replace(/[:\-–]\s*$/, "").trim();
        let value = "";
        let valueCell: CellValue = null;
        if (inline) {
          label = inline[1]!.trim();
          value = inline[2]!.trim();
          valueCell = value;
        } else {
          for (let j = i + 1; j < cells.length; j++) {
            if (cells[j]) {
              value = cells[j]!;
              valueCell = row[j] ?? value;
              break;
            }
          }
        }
        if (!value || value.length > 200) continue;

        for (const { key, re } of LABELS) {
          if (out[key]) continue;
          if (!re.test(label)) continue;
          if (key === "date") {
            const iso = toIsoDate(valueCell);
            if (iso) out.date = iso;
          } else {
            out[key] = value;
          }
          break;
        }
      }
    }
  }
  return out;
}

export interface SpreadsheetChallanOutcome {
  result: AiChallanResult;
  /** False when no goods table was found, so the caller may fall back to AI. */
  usable: boolean;
}

export function buildChallanFromWorkbook(workbook: WorkbookGrid, fileName: string): SpreadsheetChallanOutcome {
  const extraction = extractRowsFromWorkbook(workbook);
  const header = readHeader(workbook);

  const validation: string[] = [];
  const warnings: string[] = [...extraction.warnings];

  const items = extraction.rows.map((row) => {
    for (const reason of row.reviewReasons) {
      // A challan legitimately prints no rate, so the order path's
      // rate-related notes are not problems here and would only add noise.
      if (/rate/i.test(reason)) continue;
      validation.push(`Row ${row.sourceRow} ("${row.description.slice(0, 60)}"): ${reason}`);
    }
    return {
      description: [row.description, row.make].filter(Boolean).join(" — "),
      unit: row.unit || "Nos",
      qty: row.qty ?? 0,
      code: row.code,
      remarks: row.remarks,
      // Quantity is the only figure that matters on a challan, so confidence
      // tracks whether it was read, not whether the arithmetic tallied.
      confidence: row.qty !== null && row.qty > 0 ? 1 : 0.4,
    };
  });

  const missingQty = items.filter((i) => i.qty <= 0).length;
  if (missingQty > 0) {
    warnings.push(
      `${missingQty} of ${items.length} line(s) have no readable quantity and are flagged for review. No quantity was guessed — check them against ${fileName}.`
    );
  }

  return {
    usable: items.length > 0,
    result: {
      documentType: "CHALLAN",
      confidence: items.length ? (missingQty ? 0.8 : 0.95) : 0.1,
      extractedData: {
        challanNo: header.challanNo,
        date: header.date,
        vehicle: header.vehicle,
        driver: header.driver,
        clientName: header.clientName,
        projectName: header.projectName,
        siteAddress: header.siteAddress,
        poNumber: header.poNumber,
        remarks: "",
        totalValue: 0,
        items,
      },
      validation,
      warnings,
    },
  };
}
