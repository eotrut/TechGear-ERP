const hex = (h) => {
  h = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const L = (h) => {
  const [r, g, b] = hex(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const l1 = L(a),
    l2 = L(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};
const LC = "#FCFCFD",
  LS1 = "#F6F7F9",
  LS2 = "#F1F3F5";
const DC = "#08090B",
  DS1 = "#101214",
  DS2 = "#16181B";
const pairs = [
  ["L ink #0D1114 / canvas", "#0D1114", LC, 4.5],
  ["L ink-muted #39424C / canvas", "#39424C", LC, 4.5],
  ["L ink-muted #39424C / surface-2", "#39424C", LS2, 4.5],
  ["L ink-subtle #5C646E / canvas", "#5C646E", LC, 4.5],
  ["L ink-subtle #5C646E / surface-2", "#5C646E", LS2, 4.5],
  ["L accent-strong #075B6D / canvas", "#075B6D", LC, 4.5],
  ["L accent-strong #075B6D / surface-1", "#075B6D", LS1, 4.5],
  ["L accent fill #0B6E82 vs white txt", "#0B6E82", "#FFFFFF", 4.5],
  ["L accent fill #0B6E82 / canvas (ring 3:1)", "#0B6E82", LC, 3],
  ["L success #0F7A3D / canvas", "#0F7A3D", LC, 4.5],
  ["L warning #8A5A00 / canvas", "#8A5A00", LC, 4.5],
  ["L danger #B3261E / canvas", "#B3261E", LC, 4.5],
  ["L hairline #E3E6EA / canvas (visible ~1.2)", "#E3E6EA", LC, 1.15],
  ["D ink #F5F7F8 / canvas", "#F5F7F8", DC, 4.5],
  ["D ink-muted #C9D1D9 / canvas", "#C9D1D9", DC, 4.5],
  ["D ink-muted #C9D1D9 / surface-2", "#C9D1D9", DS2, 4.5],
  ["D ink-subtle #8B929C / canvas", "#8B929C", DC, 4.5],
  ["D ink-subtle #8B929C / surface-2", "#8B929C", DS2, 4.5],
  ["D accent-strong #5FD2E3 / canvas", "#5FD2E3", DC, 4.5],
  ["D accent-strong #5FD2E3 / surface-2", "#5FD2E3", DS2, 4.5],
  ["D accent fill #2BB8CE vs ink #04161A", "#2BB8CE", "#04161A", 4.5],
  ["D accent fill #2BB8CE / canvas (ring 3:1)", "#2BB8CE", DC, 3],
  ["D success #3DD68C / canvas", "#3DD68C", DC, 4.5],
  ["D warning #E8B339 / canvas", "#E8B339", DC, 4.5],
  ["D danger #F87171 / canvas", "#F87171", DC, 4.5],
  ["L danger button #B3261E vs white txt", "#B3261E", "#FFFFFF", 4.5],
  ["D danger button #C0392F vs white txt", "#C0392F", "#FFFFFF", 4.5],
  ["D danger button #C0392F / canvas (shape)", "#C0392F", DC, 3],
  ["D hairline #23252A / canvas (visible)", "#23252A", DC, 1.15],
  ["D hairline #23252A / surface-1", "#23252A", DS1, 1.08],
  // Chart marks are graphics, so WCAG 1.4.11 asks 3:1. The comparison ghost is
  // deliberately recessive; it only has to be seen, and its values are always
  // in the tooltip and the table beneath the chart.
  ["L chart-1 #00859C / canvas (mark 3:1)", "#00859C", LC, 3],
  ["L chart-2 #E0622E / canvas (mark 3:1)", "#E0622E", LC, 3],
  ["L chart-compare #9AA1AA / canvas (ghost)", "#9AA1AA", LC, 2.4],
  ["D chart-1 #1AA2B8 / canvas (mark 3:1)", "#1AA2B8", DC, 3],
  ["D chart-2 #D95926 / canvas (mark 3:1)", "#D95926", DC, 3],
  ["D chart-compare #5A616B / canvas (ghost)", "#5A616B", DC, 2.4],
];
let fail = 0;
for (const [label, a, b, min] of pairs) {
  const r = ratio(a, b);
  const ok = r >= min;
  if (!ok) fail++;
  console.log(
    (ok ? "PASS" : "FAIL").padEnd(5),
    label.padEnd(46),
    r.toFixed(2).padStart(6),
    " need>=",
    min,
  );
}
console.log(fail === 0 ? "\nAll token pairs pass." : `\n${fail} FAILED`);
