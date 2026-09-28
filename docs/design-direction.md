# Design direction

Required by SPEC section 3.1. This is the standing brief for every UI task in
TechGear ERP. Where it disagrees with a component you are about to write, this
document wins; where it disagrees with `DESIGN.md`, `DESIGN.md` wins on values.

## 1. The design read

> A dense internal tool for a Philippine peripherals retailer. Calm, sharp,
> fast to scan. Linear's chrome, Shopify's commerce vocabulary, Stripe's
> numeric discipline, with quiet mechanical-keyboard character.

## 2. Authority order

SPEC section 3.2 sets this and it settles most arguments:

1. **`DESIGN.md` (Linear)** decides values: colour relationships, spacing, radii, type scale.
2. **taste-skill** decides personality and anti-slop judgement.
3. **Shopify and Stripe** contribute patterns only, and only where they fit.
4. If a secondary reference conflicts with Linear, **Linear wins**.

## 3. Dials

taste-skill asks for three dials before any UI work. These are ours, with the
overrides an application UI requires.

| Dial               | Value | Reasoning                                                                                                                                                                                                                                                                         |
| ------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DESIGN_VARIANCE`  | **4** | taste-skill's "Linear-style" row suggests 5 to 6, but its high-variance moves (asymmetric grids, anti-center bias, large empty zones) are landing-page tools. An ERP earns trust by being predictable. Variance is spent on page composition, never on making a table surprising. |
| `MOTION_INTENSITY` | **3** | Hover, focus and press states, the dnd-kit drag transform, and the command palette transition. No scroll-triggered reveals anywhere. At dial 3 `prefers-reduced-motion` is close to the baseline already, and it is honoured globally in `globals.css`.                           |
| `VISUAL_DENSITY`   | **8** | The override that makes this read as a product rather than a template. taste-skill's 8 to 10 band prescribes exactly what a dense ERP needs: tight padding, no card boxes around data, 1px lines instead of container chrome, and mono for every number.                          |

## 4. Resolved conflicts

Three places where the references genuinely disagree, and what we do.

### 4.1 Mono for data, not just code

`DESIGN.md` says "Mono only in code contexts. Linear Mono lives inside product
screenshots, not on marketing chrome." SPEC section 3.1 asks for "monospace for
SKUs, prices, and IDs."

This is a personality question about an application, not a value question about
Linear's marketing site, so taste-skill has authority. Its `VISUAL_DENSITY` 8 to
10 band independently makes mono numerals mandatory.

**Decision.** SKUs, barcodes, order numbers, quantities, money and IDs are set in
Geist Mono with `tabular-nums`. Everything else is Geist Sans. Money is
right-aligned.

### 4.2 Light mode has to be invented

`DESIGN.md` states in its own Known Gaps that light mode is undocumented,
because linear.app does not ship one. SPEC requires light and dark.

**Decision.** The light ladder is derived here, preserving Linear's
relationships rather than its literal values: the same four-step lift, the same
hairline-carries-hierarchy rule, the same accent scarcity. Every pair is
verified numerically by `npm run check:contrast`, which fails the build loop if
a token drifts below its threshold.

### 4.3 Shopify and Stripe contribute patterns, not tokens

The files in `docs/reference/` analyse those brands' **marketing sites**, not
the Shopify admin (Polaris) or the Stripe Dashboard. Shopify's prescribes
pill-only buttons, mint and pistachio accents and Neue Haas at weight 330.
Stripe's prescribes a gradient mesh across the upper third of the page. Both
collide head-on with Linear.

**Decision.** Per SPEC's "Linear wins", they contribute almost no visual tokens.
What we take from them is in section 7.

## 5. Tokens

Defined once in `src/app/globals.css` as CSS variables, exposed to Tailwind v4
through `@theme inline`, and consumed by the shadcn/ui semantic layer. There is
no second source.

### 5.1 Surface ladder

Straight from `DESIGN.md`. Depth is carried by the ladder plus 1px hairlines.
**There are no drop shadows in this app** except `--shadow-overlay`, which is
reserved for true overlays (command palette, dropdowns, dialogs).

| Token             | Light     | Dark      | Use                                       |
| ----------------- | --------- | --------- | ----------------------------------------- |
| `canvas`          | `#FCFCFD` | `#08090B` | Page background                           |
| `surface-1`       | `#F6F7F9` | `#101214` | Sidebar, panels, empty states             |
| `surface-2`       | `#F1F3F5` | `#16181B` | Hovered rows, secondary buttons, popovers |
| `surface-3`       | `#EAEDF0` | `#1C1F23` | Active nav item, nested surfaces          |
| `hairline`        | `#E3E6EA` | `#23252A` | Borders, table rules, dividers            |
| `hairline-strong` | `#D3D8DE` | `#34343A` | Input borders                             |

### 5.2 Ink

| Token        | Light     | Dark      | Use                            |
| ------------ | --------- | --------- | ------------------------------ |
| `ink`        | `#0D1114` | `#F5F7F8` | Headings, primary values       |
| `ink-muted`  | `#39424C` | `#C9D1D9` | Body, nav labels               |
| `ink-subtle` | `#5C646E` | `#8B929C` | Meta, captions, column headers |

### 5.3 Accent: Aqua

Linear's lavender is replaced, as SPEC section 3.2 requires. The constraints
were tight and worth recording, because they rule out most of the spectrum:

- taste-skill allows **one** accent, under 80% saturation.
- taste-skill's LILA RULE bans AI-purple as a default reach, so lavender is out
  even before the identity requirement.
- The ERP semantics already spend green (paid, in stock), amber (low stock,
  pending) and red (cancelled, out of stock). A brand hue that collides with any
  of them is unreadable at badge size.

That leaves the cyan-teal gap around hue 190, which is also where the gear-shop
character lives. The accent is named **Aqua** after the switch family.

| Token                          | Light                   | Dark                        |
| ------------------------------ | ----------------------- | --------------------------- |
| `accent-fill`                  | `#0B6E82` on white text | `#2BB8CE` on `#04161A` text |
| `accent-fill-hover`            | `#095F70`               | `#4ECADD`                   |
| `accent-strong` (links, focus) | `#075B6D`               | `#5FD2E3`                   |
| `accent-wash`                  | `#E6F3F6`               | `#0D2C33`                   |

**The accent is scarce.** It appears on the brand mark, the primary action, the
focus ring, the active nav item and the selected-row indicator. It is never a
card fill and never a section background. Phase 11 added exactly two uses, both
the same idiom as the ones above: the unread count on the notification bell,
and the 2px inset bar that marks an unread notification or the row `j` and `k`
have focused (the active-nav bar, reused).

Note the polarity flip: on dark, the accent is bright and carries **dark** text.
White on mid-cyan reaches only 3.11:1 and would fail body contrast.

### 5.4 Status

| Token         | Light     | Dark      | Meaning                                 |
| ------------- | --------- | --------- | --------------------------------------- |
| `success`     | `#0F7A3D` | `#3DD68C` | Paid, received, in stock                |
| `warning`     | `#8A5A00` | `#E8B339` | Low stock, pending, SLA at risk         |
| `danger`      | `#B3261E` | `#F87171` | Cancelled, out of stock, overdue        |
| `info`        | `#175CD3` | `#7AA7F5` | Shipped, informational                  |
| `danger-fill` | `#B3261E` | `#C0392F` | Destructive **button** fill, white text |

`danger-fill` is deliberately separate from `danger`. On dark, `#F87171` as a
button fill is brighter than the accent and would outrank the primary action,
inverting the hierarchy. The fill is deepened; the text colour stays bright.

### 5.5 Radii, spacing, type

- **Radii**, `DESIGN.md` scale verbatim: 4px chips and badges, 6px inline tags,
  8px buttons and inputs, 12px panels, 16px largest container. **Never pill on
  buttons.** This documented rule satisfies taste-skill's SHAPE CONSISTENCY LOCK.
- **Spacing**, 4px base: 4, 8, 12, 16, 24, 32, 48. Table cells 8px by 12px.
  Panel padding 16px, not Linear's 24px, which is a marketing-card value.
- **Type**, Linear's ratios and negative tracking compressed for app density:

| Token          | Size | Weight | Tracking |
| -------------- | ---- | ------ | -------- |
| `text-display` | 32px | 600    | -0.019em |
| `text-title`   | 24px | 600    | -0.017em |
| `text-section` | 18px | 600    | -0.011em |
| `text-lead`    | 16px | 400    | -0.003em |
| `text-body`    | 14px | 400    | 0        |
| `text-body-sm` | 13px | 400    | 0        |
| `text-caption` | 12px | 400    | 0        |

Linear's "pair display 600 with body 400, resist 700+" is kept.

### 5.6 Fonts

**Geist Sans and Geist Mono**, self-hosted via `next/font`. `DESIGN.md` names
Inter and Geist as the two viable free substitutes for Linear's proprietary cut;
taste-skill discourages Inter as a default while explicitly permitting it for a
Linear-style brief. Geist satisfies both, and Geist Mono has proper tabular
figures, which the money columns depend on.

## 6. Character

Applied sparingly. Three things, and only these:

1. **The brand mark**, once, in the sidebar: a keycap squircle with the faint
   top-edge highlight `DESIGN.md` describes on lifted panels (`.edge-highlight`).
   It is not repeated as decoration anywhere.
2. **Keyboard-first interaction is the personality.** All of it is built as of
   Phase 11. Command palette, `/` to
   focus search, `j` and `k` for row navigation, `Enter` to open, barcode input
   permanently focused at POS. For a keyboard shop this reads as intent rather
   than novelty.
3. **Switch-colour language** in the variant UI: the swatch beside a switch
   variant uses that switch's real colour. Semantic, not decorative.

## 7. Borrowed patterns

### From Shopify, e-commerce patterns

- **Two-axis order status.** Payment state and fulfilment state render as
  separate badges rather than one overloaded word, so `PAID` and `PACKED` never
  look like competing ideas. `OrderStatus` remains the single enum SPEC 5.3 asks
  for; only the presentation splits.
- **Tonal status badges, not coloured dots.** Five tones: subdued, info, success,
  warning, critical. Flat tinted background, 4px radius, 12px mono label, no
  leading dot. taste-skill bans decorative status dots, and a tonal chip carries
  the same meaning with less noise.
- **Resource-list conventions.** Saved-view tabs above the table (All,
  Unfulfilled, Unpaid, Open), a selection column that swaps the toolbar for a
  bulk-action bar, a persistent result count. Identical across products, orders,
  customers and POs so the behaviour is learned once.
- **Product and variant editor.** One product page with the variant matrix
  underneath; per-variant SKU, barcode, price, cost and reorder level inline.
- **Inventory adjust drawer.** Quantity, reason and note captured together,
  because an adjustment without a reason is unauditable.
- **Empty states name the next action** rather than shrugging.

### From Stripe, charts and finance

- **Tabular figures wherever numbers align.** Applied globally to mono and to
  every numeric column. This single detail does more for the "real product"
  impression than anything else on this list.
- **KPI tile anatomy.** Small-caps label, large mono value, signed delta against
  the comparison period, bare sparkline beneath. No filled background track, no
  card chrome at density 8.
- **Every date range carries a comparison.** "vs. previous period" as a muted
  ghost line on trend charts and a signed delta on tiles. This is what makes a
  seeded dashboard read as analysis rather than decoration.
- **Restrained chart palette.** One accent hue with a lightness ramp for
  sequential data; a small categorical set only where categories genuinely
  differ, such as channel mix. **Load the `dataviz` skill before writing the
  first line of chart code** and adapt its palette to Aqua rather than inventing
  one. Done in Phase 10, with the skill's validator run against our own
  canvas in both modes: `--chart-1` is Aqua stepped up in chroma (#00859C
  light, #1AA2B8 dark; the accent fill reads grey at mark size in light and
  sits outside the lightness band in dark), `--chart-2` is its warm opposite
  (#E0622E / #D95926) for a second measure, and `--chart-compare` is a neutral
  ghost (#9AA1AA / #5A616B) for the prior period. Every check passes:
  lightness band, chroma floor, CVD separation (15.0 light, 20.4 dark) and 3:1
  contrast for marks. Nominal breakdowns (channel, category) are one colour as
  bar lists, since colouring categories would only re-encode length.
- **Money and time detail pages** structured as summary header, then timeline,
  then line items. Order and PO detail pages follow that shape.
- **No gradient mesh.** It is the thing Stripe is most known for visually and it
  is exactly wrong here.

### From Vercel

Nothing beyond empty-state terseness, per SPEC's "only if needed". A fourth
voice does not get pulled in unless a specific screen demands it.

## 8. Anti-slop checklist

From taste-skill sections 4, 6 and 9. Check before accepting any screenshot.

- No gradients on chrome, no outer glows, no pure `#000000` or `#FFFFFF`, no
  custom cursors.
- No emoji as icons. `lucide-react`, per SPEC's fixed stack.
- **Zero em-dash and en-dash characters in any user-visible string**, including
  every seeded product name, customer name, ticket body and note. This is
  taste-skill's single hardest rule.
- No "Jane Doe" data. Seeded people get realistic Filipino names, real province,
  city and barangay combinations, and `+63 9XX` numbers that are plausible and
  uneven rather than round.
- No fake-perfect numbers. Seeded revenue, on-time rates and defect rates are
  messy.
- Every table gets a real empty state, a skeleton matching its own column
  layout, and an error state. No generic spinners.
- Every button label fits on one line and passes contrast against its own
  background. Every input, placeholder, helper and error passes AA against its
  section background.
- One radius system, one accent, one neutral family, locked across the app.
- Theme is set once in `app/layout.tsx`. No section inverts.

## 9. Verification

A UI task is not done until it is verified with Playwright CLI screenshots
(1440, 1024 and 390, light and dark) and a clean console.

```bash
npm run dev          # in one terminal
npm run shoot        # captures every page in the manifest, fails on console errors
npm run check:contrast
npm run check:a11y   # axe, WCAG 2.1 A and AA, every page in both themes
```

`scripts/pages.mjs` holds the page manifest, shared by both sweeps. Add each
new page to it as it lands. It fails the run if any console error or warning appears that is not
known dev-server noise, so "clean console" is enforced rather than eyeballed.

Screenshots land in `docs/screenshots/<page>-<light|dark>-<size>.png`.
Look at them and compare against `DESIGN.md`. Do at least one fix-and-recheck
loop whenever something looks off.
