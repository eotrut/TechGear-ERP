import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PRODUCTS, SWITCH_SWATCHES, type ProductSeed } from "../prisma/seed/data/catalogue";
import { slugify } from "../prisma/seed/lib/helpers";

/**
 * Draws a product illustration for every catalogue item into public/products,
 * matching the URLs the seed writes into ProductImage.
 *
 * Decision D-13 first used seeded picsum photos. They were stable, but they
 * were photographs of beaches and forests standing in for keyboards, which is
 * exactly the unrelated imagery the anti-slop checklist exists to stop. These
 * are flat studio-style drawings, one archetype per kind of product, in the
 * product's real first colourway, so a white Aureus K87 is drawn white and a
 * Tanay Brown switch pack has brown stems. Deterministic, a few kilobytes each,
 * and no network.
 *
 * Two views per product: the whole item, and a close crop of the same drawing.
 *
 * Run: npm run db:images
 */

const OUT_DIR = join("public", "products");
const SIZE = 800;

// ----------------------------------------------------------------- colours

const COLOURS: Record<string, string> = {
  amber: "#c98a2b",
  black: "#1f2226",
  blue: "#3f6fb5",
  bone: "#e4dac6",
  bronze: "#8c6239",
  brown: "#6f4a33",
  charcoal: "#2e3237",
  chrome: "#c9ced4",
  clear: "#dfe9ee",
  cream: "#efe6d2",
  "dark ebony": "#2b2320",
  fog: "#c9ced3",
  frosted: "#dde4ea",
  graphite: "#3b4047",
  green: "#2f8f5b",
  grey: "#8e959d",
  ivory: "#efe8d8",
  midnight: "#1d2640",
  mint: "#a8dcc6",
  natural: "#cdb38b",
  navy: "#26344f",
  "off-white": "#ece9e1",
  olive: "#6e7446",
  orange: "#e0662e",
  pink: "#e7a6c0",
  purple: "#6d4fa3",
  "raw aluminium": "#c4c8cd",
  red: "#c23b33",
  rose: "#d9a0a7",
  sage: "#9bb29a",
  sand: "#d8c7a6",
  silver: "#b9bec5",
  sky: "#8fc1e3",
  slate: "#5b6875",
  smoke: "#55595f",
  "space grey": "#6b7078",
  walnut: "#6b4a32",
  white: "#eceef0",
  "hand oiled": "#7a5536",
};

function colour(name: string | undefined, fallback: string): string {
  if (!name) return fallback;
  return COLOURS[name.toLowerCase()] ?? fallback;
}

/** "Red and ivory" is a body and an accent. */
function colourway(product: ProductSeed): { body: string; accent: string; stem: string } {
  const attributes = product.variants[0]?.attributes ?? [];
  const named = attributes.find(([key]) => key === "Color" || key === "Finish")?.[1];
  const switchName = attributes.find(([key]) => key === "Switch")?.[1];
  const [first, second] = (named ?? "").split(" and ");
  const body = colour(first, "#2e3237");
  const accent = colour(second, luminance(body) > 0.5 ? "#8e959d" : "#5b6875");
  const stem =
    (switchName && SWITCH_SWATCHES[switchName]) ??
    Object.entries(SWITCH_SWATCHES).find(([name]) => product.name.includes(name))?.[1] ??
    "#d64545";
  return { body, accent, stem };
}

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Lighten (positive) or darken (negative) by a fraction. */
function shade(hex: string, amount: number): string {
  const [r, g, b] = channels(hex).map((c) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)),
  ) as [number, number, number];
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Pale items would vanish into the backdrop, so they get a hairline edge. */
function edge(body: string): string {
  return luminance(body) > 0.7 ? `stroke="${shade(body, -0.3)}" stroke-width="3"` : "";
}

/** Caps that read against the case: dark on light bodies, lighter on dark. */
function capColour(body: string): string {
  return luminance(body) > 0.55 ? shade(body, -0.06) : shade(body, 0.12);
}

// ----------------------------------------------------------------- shapes

const rect = (x: number, y: number, w: number, h: number, r: number, fill: string, extra = "") =>
  `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${r}" fill="${fill}" ${extra}/>`;
const circle = (cx: number, cy: number, r: number, fill: string, extra = "") =>
  `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" ${extra}/>`;

/** A keycap seen from above: a darker skirt and a lighter dished top. */
function keycap(x: number, y: number, w: number, h: number, fill: string): string {
  return (
    rect(x, y, w, h, 6, shade(fill, -0.18)) +
    rect(x + w * 0.1, y + h * 0.07, w * 0.8, h * 0.72, 5, shade(fill, 0.06))
  );
}

function keyGrid(
  x: number,
  y: number,
  cols: number,
  rows: number,
  unit: number,
  cap: string,
  accent: string,
): string {
  let out = "";
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const isEsc = row === 0 && col === 0;
      const isEnter = row === Math.min(2, rows - 1) && col === cols - 1;
      out += keycap(
        x + col * unit,
        y + row * unit,
        unit - 4,
        unit - 4,
        isEsc || isEnter ? accent : cap,
      );
    }
  }
  return out;
}

function keyboard(product: ProductSeed, body: string, accent: string): string {
  const name = product.name;
  const cap = capColour(body);
  const keyAccent = accent === body ? shade(body, -0.3) : accent;
  const layout = /40/.test(name)
    ? { cols: 12, rows: 4 }
    : /61|Compact|65|68/.test(name)
      ? { cols: 15, rows: 5 }
      : /75/.test(name)
        ? { cols: 15, rows: 6 }
        : /Full-Size|1800/.test(name)
          ? { cols: 21, rows: 6 }
          : { cols: 18, rows: 6 };

  if (/Macropad/.test(name)) {
    const unit = 70;
    return (
      rect(270, 280, 260, 260, 22, shade(body, -0.2)) +
      rect(270, 270, 260, 256, 22, body) +
      keyGrid(297, 300, 3, 3, unit, cap, keyAccent) +
      circle(478, 322, 14, shade(body, 0.25))
    );
  }

  if (/Split/.test(name)) {
    const unit = 34;
    const half = (x: number, tilt: number) =>
      `<g transform="rotate(${tilt} ${x + 120} 400)">` +
      rect(x, 305, 250, 200, 18, shade(body, -0.2)) +
      rect(x, 296, 250, 200, 18, body) +
      keyGrid(x + 18, 316, 7, 5, unit, cap, keyAccent) +
      "</g>";
    return half(135, -8) + half(415, 8);
  }

  const unit = Math.min(36, 640 / layout.cols);
  const width = layout.cols * unit + 36;
  const height = layout.rows * unit + 40;
  const x = (SIZE - width) / 2;
  const y = 420 - height / 2;
  const lowProfile = /Low Profile/.test(name);
  return (
    rect(x, y + (lowProfile ? 6 : 12), width, height, 16, shade(body, -0.22)) +
    rect(x, y, width, height, 16, body) +
    rect(x + 4, y + 3, width - 8, 2, 1, shade(body, 0.2)) +
    keyGrid(x + 20, y + 20, layout.cols, layout.rows, unit, cap, keyAccent) +
    // The spacebar replaces the middle of the bottom row.
    keycap(
      x + 20 + unit * Math.floor(layout.cols * 0.3),
      y + 20 + unit * (layout.rows - 1),
      unit * Math.floor(layout.cols * 0.4) - 4,
      unit - 4,
      cap,
    )
  );
}

function keycapSet(product: ProductSeed, body: string, accent: string): string {
  if (/Artisan/.test(product.name)) {
    return (
      keycap(270, 290, 260, 240, body) +
      `<path d="M300 330 Q250 260 330 250 Q320 290 360 320 Z" fill="${shade(accent, -0.1)}"/>` +
      `<path d="M500 330 Q550 260 470 250 Q480 290 440 320 Z" fill="${shade(accent, -0.1)}"/>` +
      circle(370, 400, 12, shade(body, -0.5)) +
      circle(430, 400, 12, shade(body, -0.5))
    );
  }
  const cap = body;
  const accentCap = accent === body ? shade(body, -0.35) : accent;
  let out = "";
  const unit = 74;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      const fill = (row + col) % 5 === 0 ? accentCap : cap;
      out += keycap(142 + col * unit, 250 + row * unit, unit - 10, unit - 10, fill);
    }
  }
  out += keycap(216, 480, unit * 5 - 10, unit - 10, cap);
  if (/Wood/.test(product.name)) {
    for (let line = 0; line < 9; line += 1) {
      out += `<path d="M140 ${262 + line * 34} q 260 ${line % 2 ? 10 : -10} 520 0" stroke="${shade(cap, -0.25)}" stroke-width="2" fill="none" opacity="0.5"/>`;
    }
  }
  return out;
}

function switchUnit(x: number, y: number, housing: string, stem: string, scale = 1): string {
  const s = (value: number) => value * scale;
  return (
    `<g transform="translate(${x} ${y})">` +
    rect(s(-70), s(20), s(140), s(90), s(10), shade(housing, -0.25)) +
    `<path d="M${s(-80)} ${s(20)} L${s(80)} ${s(20)} L${s(64)} ${s(-60)} L${s(-64)} ${s(-60)} Z" fill="${housing}" opacity="0.92"/>` +
    rect(s(-18), s(-110), s(36), s(56), s(4), stem) +
    rect(s(-6), s(-122), s(12), s(20), s(2), stem) +
    rect(s(-40), s(110), s(8), s(26), 2, "#b98d3c") +
    rect(s(30), s(110), s(8), s(26), 2, "#b98d3c") +
    "</g>"
  );
}

function switches(product: ProductSeed, stem: string): string {
  if (/Opener|Lube/.test(product.name)) {
    return (
      rect(220, 330, 170, 170, 26, "#2e3237") +
      rect(262, 372, 86, 86, 12, "#eceef0") +
      circle(530, 380, 70, "#d9dde2") +
      circle(530, 380, 52, "#b8a26a") +
      rect(470, 470, 140, 18, 9, "#6b4a32") +
      rect(600, 466, 50, 26, 6, "#1f2226")
    );
  }
  const housing = /Silent|Ink/.test(product.name) ? "#2b3350" : "#e3e8ec";
  return (
    switchUnit(245, 470, housing, stem, 1.25) +
    switchUnit(555, 470, housing, stem, 1.25) +
    switchUnit(400, 400, housing, stem, 1.5)
  );
}

function mouse(product: ProductSeed, body: string, accent: string): string {
  const name = product.name;
  if (/Grip Tape/.test(name)) {
    return (
      `<path d="M250 280 q-60 120 0 250 l60 0 q-30 -120 0 -250 Z" fill="#2e3237"/>` +
      `<path d="M550 280 q60 120 0 250 l-60 0 q30 -120 0 -250 Z" fill="#2e3237"/>`
    );
  }
  if (/Skates/.test(name)) {
    return [300, 400, 500]
      .map((x, index) =>
        rect(
          x - 40,
          330 + (index % 2) * 60,
          80,
          120,
          40,
          "#f3f4f5",
          'stroke="#9aa1aa" stroke-width="4"',
        ),
      )
      .join("");
  }
  if (/Dock/.test(name)) {
    return (
      `<ellipse cx="400" cy="470" rx="190" ry="60" fill="${shade(body, -0.25)}"/>` +
      `<ellipse cx="400" cy="455" rx="190" ry="60" fill="${body}"/>` +
      `<ellipse cx="400" cy="450" rx="120" ry="30" fill="${shade(body, 0.12)}"/>` +
      circle(400, 470, 6, "#2bb8ce")
    );
  }
  if (/Vertical/.test(name)) {
    return (
      `<path d="M300 540 Q280 330 380 250 Q480 200 520 300 Q560 420 520 540 Z" fill="${body}"/>` +
      `<path d="M380 250 Q440 230 470 280 L420 380 Z" fill="${shade(body, 0.12)}"/>` +
      rect(470, 300, 18, 50, 9, shade(body, -0.3))
    );
  }
  if (/Trackball/.test(name)) {
    return (
      `<path d="M250 520 Q230 330 400 290 Q570 330 550 520 Z" fill="${body}"/>` +
      circle(400, 420, 88, accent === body ? "#c23b33" : accent) +
      circle(375, 395, 22, "rgb(255 255 255 / 0.35)")
    );
  }
  const shell = `M400 230 C500 230 530 330 530 420 C530 530 470 590 400 590 C330 590 270 530 270 420 C270 330 300 230 400 230 Z`;
  const side = /MMO/.test(name)
    ? Array.from({ length: 6 }, (_, index) =>
        rect(282 + (index % 2) * 22, 380 + Math.floor(index / 2) * 26, 18, 20, 4, shade(body, 0.2)),
      ).join("")
    : "";
  return (
    `<path d="${shell}" fill="${shade(body, -0.2)}" transform="translate(0 8)"/>` +
    `<path d="${shell}" fill="${body}" ${edge(body)}/>` +
    `<path d="M400 232 L400 370" stroke="${shade(body, -0.28)}" stroke-width="4"/>` +
    rect(390, 280, 20, 50, 10, shade(body, -0.4)) +
    (/Ultralight/.test(name)
      ? [0, 1, 2, 3, 4]
          .map((index) =>
            circle(400 + ((index % 2) * 2 - 1) * 45, 420 + index * 26, 11, shade(body, -0.35)),
          )
          .join("")
      : "") +
    side
  );
}

function mousepad(product: ProductSeed, body: string, accent: string): string {
  const name = product.name;
  const desk = /Desk Mat|Banig|Tropical/.test(name);
  const [w, h] = desk ? [640, 300] : [460, 380];
  const x = (SIZE - w) / 2;
  const y = 420 - h / 2;
  let pattern = "";
  if (/Banig/.test(name)) {
    const colours = [shade(accent, 0.1), "#c23b33", "#e0b43a", "#2f8f5b"];
    for (let index = 0; index < 14; index += 1) {
      pattern += `<path d="M${x + index * 50} ${y} l${h} ${h}" stroke="${colours[index % 4]}" stroke-width="12" opacity="0.55"/>`;
    }
    pattern = `<g clip-path="url(#pad)">${pattern}</g>`;
  } else if (/Tropical/.test(name)) {
    const leaves: [number, number, number][] = [
      [260, 330, -30],
      [520, 480, 20],
      [610, 320, 60],
      [330, 500, 140],
    ];
    pattern = leaves
      .map(
        ([cx, cy, angle]) =>
          `<ellipse cx="${cx}" cy="${cy}" rx="70" ry="26" fill="${luminance(body) > 0.5 ? "#2f8f5b" : shade(body, 0.35)}" opacity="0.8" transform="rotate(${angle} ${cx} ${cy})"/>` +
          `<ellipse cx="${cx + 40}" cy="${cy - 30}" rx="18" ry="18" fill="#e0b43a" opacity="0.8"/>`,
      )
      .join("");
  } else if (/Glass/.test(name)) {
    pattern = `<path d="M${x + 40} ${y + h} L${x + 200} ${y} L${x + 260} ${y} L${x + 100} ${y + h} Z" fill="#ffffff" opacity="0.18"/>`;
  }
  return (
    `<defs><clipPath id="pad">${rect(x, y, w, h, 18, "#000")}</clipPath></defs>` +
    rect(x, y + 8, w, h, 18, shade(body, -0.25)) +
    rect(x, y, w, h, 18, body, edge(body)) +
    pattern +
    rect(
      x + 10,
      y + 10,
      w - 20,
      h - 20,
      12,
      "none",
      `stroke="${shade(body, 0.22)}" stroke-width="2" stroke-dasharray="6 6"`,
    ) +
    rect(x + w - 70, y + h - 34, 44, 14, 3, shade(body, 0.3))
  );
}

function audio(product: ProductSeed, body: string, accent: string): string {
  const name = product.name;
  if (/Monitor Pair/.test(name)) {
    const cabinet = (x: number) =>
      rect(x, 250, 190, 320, 16, shade(body, -0.2)) +
      rect(x, 244, 190, 320, 16, body) +
      circle(x + 95, 460, 68, shade(body, -0.45)) +
      circle(x + 95, 460, 30, shade(body, -0.2)) +
      circle(x + 95, 320, 30, shade(body, -0.45)) +
      circle(x + 95, 320, 12, shade(body, 0.15));
    return cabinet(180) + cabinet(430);
  }
  if (/IEM/.test(name)) {
    return (
      `<path d="M320 380 C300 520 400 560 400 620 C400 560 500 520 480 380" stroke="#2e3237" stroke-width="6" fill="none"/>` +
      `<ellipse cx="300" cy="340" rx="70" ry="54" fill="${body}" ${edge(body)} transform="rotate(-20 300 340)"/>` +
      `<ellipse cx="500" cy="340" rx="70" ry="54" fill="${body}" ${edge(body)} transform="rotate(20 500 340)"/>` +
      circle(300, 340, 22, shade(body, 0.2)) +
      circle(500, 340, 22, shade(body, 0.2))
    );
  }
  if (/Amp|DAC/.test(name)) {
    return (
      rect(210, 330, 380, 180, 14, shade(body, -0.25)) +
      rect(210, 320, 380, 180, 14, body) +
      circle(470, 410, 52, shade(body, 0.2)) +
      circle(470, 410, 40, shade(body, -0.1)) +
      rect(468, 372, 4, 20, 2, "#eceef0") +
      circle(270, 380, 6, "#2bb8ce") +
      circle(290, 450, 14, shade(body, -0.5)) +
      circle(340, 450, 14, shade(body, -0.5))
    );
  }
  if (/Boom Arm/.test(name)) {
    return (
      rect(200, 540, 80, 40, 6, "#2e3237") +
      `<path d="M240 540 L340 330 L560 280" stroke="${body}" stroke-width="22" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M252 520 L346 350 L556 300" stroke="${shade(body, 0.2)}" stroke-width="4" fill="none"/>` +
      circle(340, 330, 20, shade(body, -0.3)) +
      rect(545, 250, 60, 90, 12, shade(body, -0.2))
    );
  }
  if (/Earpad/.test(name)) {
    const pad = (cx: number) =>
      `<ellipse cx="${cx}" cy="420" rx="120" ry="140" fill="${body}"/>` +
      `<ellipse cx="${cx}" cy="420" rx="62" ry="80" fill="${shade(body, -0.35)}"/>`;
    return pad(270) + pad(530);
  }
  const cup = (x: number) =>
    rect(x, 360, 110, 170, 48, shade(body, -0.2)) + rect(x + 8, 372, 94, 146, 42, body);
  return (
    `<path d="M275 420 C275 200 525 200 525 420" stroke="${shade(body, -0.1)}" stroke-width="34" fill="none" stroke-linecap="round"/>` +
    `<path d="M285 400 C290 230 510 230 515 400" stroke="${shade(accent, 0.1)}" stroke-width="8" fill="none"/>` +
    cup(220) +
    cup(470) +
    (/Comm|Meridian|Cloudline/.test(name)
      ? `<path d="M250 500 Q260 600 370 610" stroke="${shade(body, -0.2)}" stroke-width="12" fill="none" stroke-linecap="round"/>` +
        circle(378, 610, 16, shade(body, -0.35))
      : "")
  );
}

function streaming(product: ProductSeed, body: string): string {
  const name = product.name;
  if (/Webcam/.test(name)) {
    return (
      rect(370, 470, 60, 80, 10, shade(body, -0.25)) +
      rect(220, 320, 360, 150, 60, body) +
      circle(400, 395, 58, shade(body, -0.5)) +
      circle(400, 395, 40, "#1c2a3a") +
      circle(386, 380, 12, "rgb(255 255 255 / 0.4)") +
      circle(520, 360, 6, "#3dd68c")
    );
  }
  if (/Microphone/.test(name)) {
    let grille = "";
    for (let line = 0; line < 8; line += 1) {
      grille += `<path d="M345 ${260 + line * 22} h110" stroke="${shade(body, -0.35)}" stroke-width="3"/>`;
    }
    return (
      rect(330, 230, 140, 240, 70, body) +
      grille +
      rect(386, 470, 28, 90, 6, shade(body, -0.25)) +
      `<ellipse cx="400" cy="575" rx="120" ry="24" fill="${shade(body, -0.3)}"/>`
    );
  }
  if (/Light Panel/.test(name)) {
    return (
      rect(392, 470, 16, 140, 4, "#2e3237") +
      rect(230, 250, 340, 230, 16, shade(body, -0.25)) +
      rect(246, 266, 308, 198, 10, "#fbf5e6") +
      rect(246, 266, 308, 198, 10, "#ffffff", 'opacity="0.4"')
    );
  }
  if (/Stream Deck/.test(name)) {
    const screens = [
      "#2bb8ce",
      "#e0662e",
      "#3dd68c",
      "#e8b339",
      "#7aa7f5",
      "#f87171",
      "#9bb29a",
      "#eceef0",
    ];
    return (
      `<path d="M220 520 L260 300 L540 300 L580 520 Z" fill="${shade(body, -0.2)}"/>` +
      `<path d="M230 510 L266 310 L534 310 L570 510 Z" fill="${body}"/>` +
      screens
        .map((fill, index) =>
          rect(
            290 + (index % 4) * 60,
            340 + Math.floor(index / 4) * 70,
            48,
            48,
            8,
            fill,
            'opacity="0.85"',
          ),
        )
        .join("")
    );
  }
  return capture(body);
}

function capture(body: string): string {
  return (
    rect(230, 350, 340, 150, 18, shade(body, -0.25)) +
    rect(230, 340, 340, 150, 18, body) +
    rect(270, 395, 60, 22, 4, shade(body, -0.5)) +
    rect(350, 395, 44, 22, 4, shade(body, -0.5)) +
    circle(520, 380, 7, "#2bb8ce")
  );
}

function connectivity(product: ProductSeed, body: string, accent: string): string {
  const name = product.name;
  if (/Coiled/.test(name)) {
    let coil = "";
    for (let loop = 0; loop < 9; loop += 1) {
      if (luminance(body) > 0.7) {
        coil += `<ellipse cx="${270 + loop * 30}" cy="420" rx="26" ry="60" fill="none" stroke="${shade(body, -0.3)}" stroke-width="18"/>`;
      }
      coil += `<ellipse cx="${270 + loop * 30}" cy="420" rx="26" ry="60" fill="none" stroke="${body}" stroke-width="14"/>`;
    }
    return (
      `<path d="M150 420 L240 420 M530 420 L650 420" stroke="${shade(body, luminance(body) > 0.7 ? -0.3 : 0)}" stroke-width="14" stroke-linecap="round"/>` +
      coil +
      rect(100, 404, 70, 32, 8, shade(accent, -0.1)) +
      rect(640, 400, 90, 40, 10, "#c9ced4")
    );
  }
  if (/Monitor Arm/.test(name)) {
    const dual = /Dual/.test(name);
    const plate = (x: number) =>
      rect(x, 250, 110, 80, 8, shade(body, 0.15)) +
      rect(x + 20, 270, 70, 40, 4, "none", `stroke="${shade(body, -0.3)}" stroke-width="4"`);
    return (
      rect(386, 250, 28, 330, 10, body) +
      rect(330, 570, 140, 30, 8, shade(body, -0.25)) +
      `<path d="M400 300 L520 300" stroke="${body}" stroke-width="22" stroke-linecap="round"/>` +
      plate(515) +
      (dual
        ? `<path d="M400 300 L280 300" stroke="${body}" stroke-width="22" stroke-linecap="round"/>` +
          plate(175)
        : "")
    );
  }
  if (/Hub|Dock/.test(name)) {
    const ports = /Dock/.test(name) ? 9 : 7;
    const width = /Dock/.test(name) ? 460 : 380;
    const x = (SIZE - width) / 2;
    let slots = "";
    for (let index = 0; index < ports; index += 1) {
      slots += rect(
        x + 30 + index * ((width - 60) / ports),
        412,
        (width - 60) / ports - 12,
        18,
        4,
        shade(body, -0.55),
      );
    }
    return (
      rect(x, 370, width, 110, 20, shade(body, -0.25)) +
      rect(x, 360, width, 110, 20, body) +
      slots +
      circle(x + width - 30, 385, 5, "#2bb8ce")
    );
  }
  if (/Tray/.test(name)) {
    return (
      `<path d="M150 360 L650 360 L620 480 L180 480 Z" fill="${shade(body, -0.2)}"/>` +
      `<path d="M150 350 L650 350 L620 460 L180 460 Z" fill="${body}"/>` +
      `<path d="M190 370 L610 370" stroke="${shade(body, -0.35)}" stroke-width="6"/>`
    );
  }
  // A plain cable, looped once.
  return (
    `<path d="M200 520 C200 280 600 280 600 420 C600 560 330 560 330 420" stroke="${body}" stroke-width="16" fill="none" stroke-linecap="round"/>` +
    rect(176, 520, 48, 60, 10, "#c9ced4") +
    rect(306, 396, 48, 60, 10, "#c9ced4")
  );
}

function drawing(product: ProductSeed): string {
  const { body, accent, stem } = colourway(product);
  switch (product.category) {
    case "keyboards":
      return keyboard(product, body, accent);
    case "keycaps":
      return keycapSet(product, body, accent);
    case "switches":
      return switches(product, stem);
    case "mice":
      return mouse(product, body, accent);
    case "mousepads":
      return mousepad(product, body, accent);
    case "audio":
      return audio(product, body, accent);
    case "streaming":
      return streaming(product, body);
    case "connectivity":
      return connectivity(product, body, accent);
    default:
      return capture(body);
  }
}

/**
 * A neutral studio backdrop, the same in both themes: product photography is
 * content, not chrome. The floor shadow is what stops the item floating.
 */
function svg(product: ProductSeed, view: 1 | 2): string {
  const viewBox = view === 1 ? `0 0 ${SIZE} ${SIZE}` : "170 190 460 460";
  const backdrop = view === 1 ? "#e9ecef" : "#e2e6ea";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${SIZE}" height="${SIZE}" role="img" aria-label="${product.name}">`,
    `<defs><filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter></defs>`,
    `<rect x="-400" y="-400" width="1600" height="1600" fill="${backdrop}"/>`,
    `<rect x="-400" y="560" width="1600" height="1000" fill="${shade(backdrop, -0.03)}"/>`,
    `<ellipse cx="400" cy="600" rx="260" ry="26" fill="#0d1114" opacity="0.14" filter="url(#soft)"/>`,
    drawing(product),
    `</svg>`,
  ].join("");
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const product of PRODUCTS) {
    const slug = slugify(product.name);
    for (const view of [1, 2] as const) {
      writeFileSync(join(OUT_DIR, `${slug}-${view}.svg`), svg(product, view));
    }
  }
  console.log(`Drew ${PRODUCTS.length * 2} product images into ${OUT_DIR}.`);
}

main();
