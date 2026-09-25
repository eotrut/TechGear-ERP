import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

import type { SalesDocument } from "./documents";

/**
 * Sales documents as PDF, drawn from the same model as the printable pages.
 *
 * Uses the PDF standard fonts (Helvetica and Courier), so nothing has to be
 * embedded and the file is a few kilobytes. Those fonts speak WinAnsi only,
 * which is why the document model writes amounts without the peso sign and
 * why any character outside that set is transliterated before drawing: a
 * product name with an unusual glyph must not stop an invoice from printing.
 */

const MM = 72 / 25.4;

// The paper palette, as in the .paper scope of globals.css.
const INK = rgb(13 / 255, 17 / 255, 20 / 255);
const MUTED = rgb(57 / 255, 66 / 255, 76 / 255);
const SUBTLE = rgb(92 / 255, 100 / 255, 110 / 255);
const RULE = rgb(211 / 255, 216 / 255, 222 / 255);
const ACCENT = rgb(11 / 255, 110 / 255, 130 / 255);

const WIN_ANSI_EXTRA = new Set([..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•™š›œžŸ"]);

/** Text the standard fonts can encode. Latin-1 survives intact, so "Peñaflor" stays. */
export function pdfSafe(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      WIN_ANSI_EXTRA.has(char)
    ) {
      out += char;
      continue;
    }
    const stripped = char.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    out += /^[\x20-\x7e]+$/.test(stripped) ? stripped : "?";
  }
  return out;
}

type Fonts = { sans: PDFFont; bold: PDFFont; mono: PDFFont };

type TextOptions = {
  font?: PDFFont;
  size?: number;
  color?: ReturnType<typeof rgb>;
  align?: "left" | "right" | "center";
};

function drawText(
  page: PDFPage,
  fonts: Fonts,
  text: string,
  x: number,
  y: number,
  options: TextOptions = {},
) {
  const font = options.font ?? fonts.sans;
  const size = options.size ?? 9;
  const safe = pdfSafe(text);
  const width = font.widthOfTextAtSize(safe, size);
  const left =
    options.align === "right" ? x - width : options.align === "center" ? x - width / 2 : x;
  page.drawText(safe, { x: left, y, size, font, color: options.color ?? INK });
}

/** Greedy word wrap to a width, measured in the font that will draw it. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || line === "") {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

function rule(page: PDFPage, x1: number, x2: number, y: number, dashed = false) {
  page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness: 0.6,
    color: RULE,
    ...(dashed ? { dashArray: [2, 2] } : {}),
  });
}

async function fontsFor(pdf: PDFDocument): Promise<Fonts> {
  return {
    sans: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.Courier),
  };
}

// ------------------------------------------------------------------ invoice

const A4 = { width: 210 * MM, height: 297 * MM };

async function invoicePdf(doc: SalesDocument): Promise<PDFDocument> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.title} ${doc.number}`);
  pdf.setAuthor(doc.seller.name);
  pdf.setCreator("TechGear ERP");
  const fonts = await fontsFor(pdf);

  const left = 14 * MM;
  const right = A4.width - 14 * MM;
  const bottom = 18 * MM;

  // Column right edges for the line table.
  const col = {
    qty: left + 22,
    desc: left + 34,
    unit: right - 150,
    discount: right - 78,
    amount: right,
  };

  let page = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - 14 * MM;

  // Seller and title.
  page.drawRectangle({ x: left, y: y - 20, width: 22, height: 22, color: ACCENT });
  drawText(page, fonts, "TG", left + 11, y - 13, {
    font: fonts.bold,
    size: 9,
    color: rgb(1, 1, 1),
    align: "center",
  });
  drawText(page, fonts, doc.seller.name, left + 30, y - 8, { font: fonts.bold, size: 13 });
  let sellerY = y - 20;
  for (const line of wrap(doc.seller.address, fonts.sans, 8.5, 330)) {
    drawText(page, fonts, line, left + 30, sellerY, { size: 8.5, color: MUTED });
    sellerY -= 11;
  }
  if (doc.seller.tin) {
    drawText(page, fonts, `VAT Reg. TIN ${doc.seller.tin}`, left + 30, sellerY, {
      size: 8.5,
      color: MUTED,
    });
    sellerY -= 11;
  }
  drawText(page, fonts, doc.title.toUpperCase(), right, y - 8, {
    font: fonts.bold,
    size: 14,
    align: "right",
  });
  drawText(page, fonts, doc.number, right, y - 22, { font: fonts.mono, size: 10, align: "right" });
  drawText(page, fonts, doc.issuedOn, right, y - 34, { size: 9, color: MUTED, align: "right" });

  y = Math.min(sellerY, y - 40) - 8;
  rule(page, left, right, y);
  y -= 16;

  // Buyer and meta.
  drawText(page, fonts, "SOLD TO", left, y, { size: 7, color: SUBTLE });
  let buyerY = y - 12;
  if (doc.buyer) {
    drawText(page, fonts, doc.buyer.name, left, buyerY, { font: fonts.bold, size: 9.5 });
    buyerY -= 12;
    for (const line of doc.buyer.lines) {
      drawText(page, fonts, line, left, buyerY, { size: 8.5, color: MUTED });
      buyerY -= 11;
    }
    if (doc.buyer.tin) {
      drawText(page, fonts, `TIN ${doc.buyer.tin}`, left, buyerY, { size: 8.5, color: MUTED });
      buyerY -= 11;
    }
  } else {
    drawText(page, fonts, "Walk-in customer", left, buyerY, { size: 9, color: MUTED });
    buyerY -= 12;
  }
  let metaY = y;
  for (const item of doc.meta) {
    drawText(page, fonts, item.label, right - 170, metaY, { size: 8.5, color: SUBTLE });
    drawText(page, fonts, item.value, right, metaY, {
      font: item.mono ? fonts.mono : fonts.sans,
      size: 8.5,
      align: "right",
    });
    metaY -= 12;
  }
  y = Math.min(buyerY, metaY) - 6;
  rule(page, left, right, y);
  y -= 18;

  function tableHeader() {
    const size = 7;
    drawText(page, fonts, "QTY", col.qty, y, { size, color: SUBTLE, align: "right" });
    drawText(page, fonts, "DESCRIPTION", col.desc, y, { size, color: SUBTLE });
    drawText(page, fonts, "UNIT PRICE", col.unit, y, { size, color: SUBTLE, align: "right" });
    drawText(page, fonts, "DISCOUNT", col.discount, y, { size, color: SUBTLE, align: "right" });
    drawText(page, fonts, "AMOUNT, PHP", col.amount, y, { size, color: SUBTLE, align: "right" });
    y -= 6;
    rule(page, left, right, y);
    y -= 13;
  }

  function ensureRoom(height: number) {
    if (y - height > bottom) return;
    page = pdf.addPage([A4.width, A4.height]);
    y = A4.height - 16 * MM;
    drawText(page, fonts, `${doc.number}, continued`, left, y, { size: 8.5, color: SUBTLE });
    y -= 20;
    tableHeader();
  }

  tableHeader();
  const descWidth = col.unit - col.desc - 60;
  for (const line of doc.lines) {
    const described = wrap(line.description, fonts.sans, 9, descWidth);
    ensureRoom(described.length * 11 + 16);
    drawText(page, fonts, line.qty, col.qty, y, { font: fonts.mono, size: 9, align: "right" });
    drawText(page, fonts, line.unitPrice, col.unit, y, {
      font: fonts.mono,
      size: 9,
      align: "right",
    });
    if (line.discount) {
      drawText(page, fonts, line.discount, col.discount, y, {
        font: fonts.mono,
        size: 9,
        color: MUTED,
        align: "right",
      });
    }
    drawText(page, fonts, line.amount, col.amount, y, {
      font: fonts.mono,
      size: 9,
      align: "right",
    });
    for (const text of described) {
      drawText(page, fonts, text, col.desc, y, { size: 9 });
      y -= 11;
    }
    drawText(page, fonts, line.sku, col.desc, y, { font: fonts.mono, size: 7, color: SUBTLE });
    y -= 8;
    rule(page, left, right, y);
    y -= 13;
  }

  // Totals, right aligned.
  const labelX = right - 210;
  ensureRoom(doc.totals.length * 13 + doc.payments.length * 12 + 40);
  y -= 4;
  for (const total of doc.totals) {
    if (total.strong) {
      rule(page, labelX, right, y + 10);
      drawText(page, fonts, total.label, labelX, y - 2, { font: fonts.bold, size: 10.5 });
      drawText(page, fonts, total.value, right, y - 2, {
        font: fonts.mono,
        size: 10.5,
        align: "right",
      });
      y -= 8;
      rule(page, labelX, right, y - 2);
      y -= 14;
    } else {
      drawText(page, fonts, total.label, labelX, y, { size: 9, color: MUTED });
      drawText(page, fonts, total.value, right, y, { font: fonts.mono, size: 9, align: "right" });
      y -= 13;
    }
  }
  if (doc.payments.length > 0) {
    y -= 4;
    drawText(page, fonts, "PAID BY", labelX, y, { size: 7, color: SUBTLE });
    y -= 12;
    for (const payment of doc.payments) {
      drawText(page, fonts, payment.label, labelX, y, { size: 9, color: MUTED });
      drawText(page, fonts, payment.value, right, y, { font: fonts.mono, size: 9, align: "right" });
      y -= 12;
    }
  }

  // Footer on the last page.
  let footerY = bottom + doc.footer.length * 10;
  rule(page, left, right, footerY + 8);
  for (const line of doc.footer) {
    drawText(page, fonts, line, left, footerY, { size: 8, color: SUBTLE });
    footerY -= 10;
  }

  const pages = pdf.getPages();
  pages.forEach((each, index) => {
    drawText(each, fonts, `Page ${index + 1} of ${pages.length}`, right, 10 * MM, {
      size: 7,
      color: SUBTLE,
      align: "right",
    });
  });
  return pdf;
}

// ------------------------------------------------------------------ receipt

const RECEIPT_WIDTH = 80 * MM;

/**
 * A thermal strip is as long as its content, so the receipt is laid out twice:
 * once to measure, once to draw on a page of exactly that height.
 */
async function receiptPdf(doc: SalesDocument): Promise<PDFDocument> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.title} ${doc.number}`);
  pdf.setAuthor(doc.seller.name);
  pdf.setCreator("TechGear ERP");
  const fonts = await fontsFor(pdf);

  const left = 5 * MM;
  const right = RECEIPT_WIDTH - 5 * MM;
  const width = right - left;
  const center = RECEIPT_WIDTH / 2;

  function layout(page: PDFPage | null, top: number): number {
    let y = top;
    const text = (value: string, x: number, options: TextOptions = {}) => {
      if (page) drawText(page, fonts, value, x, y, options);
    };
    const line = (dashed = true) => {
      if (page) rule(page, left, right, y, dashed);
    };
    const pair = (label: string, value: string, strong = false) => {
      text(label, left, {
        size: strong ? 9.5 : 7.5,
        font: strong ? fonts.bold : fonts.sans,
        color: strong ? INK : MUTED,
      });
      text(value, right, { size: strong ? 9.5 : 7.5, font: fonts.mono, align: "right" });
      y -= strong ? 13 : 10;
    };

    text(doc.seller.name, center, { font: fonts.bold, size: 11, align: "center" });
    y -= 12;
    for (const row of wrap(doc.seller.address, fonts.sans, 7, width)) {
      text(row, center, { size: 7, color: MUTED, align: "center" });
      y -= 9;
    }
    if (doc.seller.tin) {
      text(`VAT Reg. TIN ${doc.seller.tin}`, center, { size: 7, color: MUTED, align: "center" });
      y -= 9;
    }
    y -= 3;
    line();
    y -= 12;
    text(doc.title.toUpperCase(), center, { font: fonts.bold, size: 8.5, align: "center" });
    y -= 12;
    pair(doc.number, doc.issuedOn);
    for (const item of doc.meta) pair(item.label, item.value);
    if (doc.buyer) pair("Customer", doc.buyer.name);
    y -= 2;
    line();
    y -= 12;

    for (const item of doc.lines) {
      for (const row of wrap(item.description, fonts.sans, 8, width)) {
        text(row, left, { size: 8 });
        y -= 10;
      }
      text(`${item.qty} x ${item.unitPrice}${item.discount ? ` ${item.discount}` : ""}`, left, {
        font: fonts.mono,
        size: 7.5,
        color: MUTED,
      });
      text(item.amount, right, { font: fonts.mono, size: 8, align: "right" });
      y -= 12;
    }
    line();
    y -= 12;
    for (const total of doc.totals) pair(total.label, total.value, total.strong);
    if (doc.payments.length > 0) {
      y -= 2;
      line();
      y -= 12;
      for (const payment of doc.payments) pair(payment.label, payment.value);
    }
    y -= 2;
    line();
    y -= 12;
    for (const footer of doc.footer) {
      for (const row of wrap(footer, fonts.sans, 6.5, width)) {
        text(row, center, { size: 6.5, color: SUBTLE, align: "center" });
        y -= 8.5;
      }
    }
    return top - y;
  }

  const margin = 6 * MM;
  const height = layout(null, 0) + margin * 2;
  const page = pdf.addPage([RECEIPT_WIDTH, height]);
  layout(page, height - margin - 6);
  return pdf;
}

export async function renderSalesDocumentPdf(doc: SalesDocument): Promise<Uint8Array> {
  const pdf = doc.kind === "invoice" ? await invoicePdf(doc) : await receiptPdf(doc);
  return pdf.save();
}
