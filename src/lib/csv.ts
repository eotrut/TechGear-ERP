/**
 * CSV encode and decode, RFC 4180 shaped.
 *
 * Written rather than pulled in: the app only ever reads its own export format
 * back, and the two rules that actually matter (quote anything containing a
 * delimiter, quote or newline; escape a quote by doubling it) are four lines
 * each. A dependency here would be larger than the thing it replaces.
 *
 * Excel refuses to parse UTF-8 without a byte-order mark, and half the point of
 * an export is that somebody opens it in Excel, so `toCsv` emits one.
 */

export const CSV_BOM = "﻿";

/** One row of parsed CSV, keyed by the header names in the first line. */
export type CsvRow = Record<string, string>;

/** A cell Excel or Sheets would evaluate as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** A plain signed decimal, which no spreadsheet evaluates as anything but a number. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

function encodeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // A leading =, +, -, @, tab or carriage return makes a spreadsheet treat the
  // cell as a formula. Prefixing an apostrophe is the standard defence and
  // survives a round trip. A negative amount such as "-1250.00" is exempt:
  // guarding it would turn every loss or outbound quantity into text.
  const guarded = FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
  return /["\n\r,]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function toCsvLine(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(encodeCell).join(",");
}

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
};

/** Whole document in memory. For large exports, stream `toCsvLine` instead. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [toCsvLine(columns.map((column) => column.header))];
  for (const row of rows) lines.push(toCsvLine(columns.map((column) => column.value(row))));
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

/**
 * Split a CSV document into rows of cells.
 *
 * Handles quoted fields containing commas and newlines, doubled quotes, and
 * CRLF or LF line endings. A trailing newline does not produce an empty row.
 */
export function parseCsvRows(input: string): string[][] {
  const text = input.startsWith(CSV_BOM) ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      // Swallow the LF of a CRLF pair so it does not open an empty row.
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((value) => value.trim() !== ""));
}

/** Header comparison ignores case, spaces, underscores and punctuation. */
export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export type ParsedCsv = {
  headers: string[];
  rows: CsvRow[];
};

/**
 * Parse into objects keyed by normalised header, so "Reorder level",
 * "reorder_level" and "ReorderLevel" all land on the same key. Short rows are
 * padded rather than rejected: a missing trailing column is a blank value, and
 * the import's own validation decides whether that is an error.
 */
export function parseCsv(input: string): ParsedCsv {
  const rows = parseCsvRows(input);
  const [headerRow, ...bodyRows] = rows;
  if (!headerRow) return { headers: [], rows: [] };

  const headers = headerRow.map((header) => header.trim());
  const keys = headers.map(normaliseHeader);

  return {
    headers,
    rows: bodyRows.map((cells) => {
      const record: CsvRow = {};
      keys.forEach((key, index) => {
        if (key !== "") record[key] = (cells[index] ?? "").trim();
      });
      return record;
    }),
  };
}
