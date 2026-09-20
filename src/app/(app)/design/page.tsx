import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Design tokens",
};

const surfaces = [
  { name: "canvas", className: "bg-canvas" },
  { name: "surface-1", className: "bg-surface-1" },
  { name: "surface-2", className: "bg-surface-2" },
  { name: "surface-3", className: "bg-surface-3" },
];

const inks = [
  { name: "ink", className: "text-ink" },
  { name: "ink-muted", className: "text-ink-muted" },
  { name: "ink-subtle", className: "text-ink-subtle" },
];

const statuses = [
  { name: "success", fill: "bg-success-wash", text: "text-success", label: "Paid" },
  { name: "warning", fill: "bg-warning-wash", text: "text-warning", label: "Low stock" },
  { name: "danger", fill: "bg-danger-wash", text: "text-danger", label: "Cancelled" },
  { name: "info", fill: "bg-info-wash", text: "text-info", label: "Shipped" },
  { name: "accent", fill: "bg-accent-wash", text: "text-accent-strong", label: "Draft" },
];

const radii = [
  { name: "xs / 4px", className: "rounded-xs" },
  { name: "sm / 6px", className: "rounded-sm" },
  { name: "md / 8px", className: "rounded-md" },
  { name: "lg / 12px", className: "rounded-lg" },
  { name: "xl / 16px", className: "rounded-xl" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-hairline pt-4 pb-7">
      <h2 className="text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
        {title}
      </h2>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

/**
 * Internal reference page. It exists so the token system can be checked in
 * both themes at every breakpoint before real pages are built on top of it.
 * See docs/PLAN.md risk RK-4.
 */
export default function DesignTokensPage() {
  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageHeader
        title="Design tokens"
        description="Internal reference for the theme derived from DESIGN.md. Every colour pair here is checked by npm run check:contrast."
      />

      <Section title="Surface ladder">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {surfaces.map((surface) => (
            <div
              key={surface.name}
              className={`${surface.className} rounded-lg border border-hairline p-3`}
            >
              <div className="text-body-sm font-medium text-ink">{surface.name}</div>
              <div className="mt-0.5 font-mono text-[11px] text-ink-subtle">1px hairline</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Ink">
        <div className="flex flex-col gap-1.5">
          {inks.map((ink) => (
            <p key={ink.name} className={`${ink.className} text-body`}>
              <span className="font-mono text-[12px]">{ink.name}</span>
              {"  "}
              Mechanical keyboard, hot-swap PCB, south-facing RGB.
            </p>
          ))}
        </div>
      </Section>

      <Section title="Status tones">
        <div className="flex flex-wrap gap-2">
          {statuses.map((status) => (
            <span
              key={status.name}
              className={`${status.fill} ${status.text} inline-flex items-center rounded-xs px-2 py-0.5 font-mono text-[12px] font-medium`}
            >
              {status.label}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Create order</Button>
          <Button variant="secondary">Export CSV</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="link">View ledger</Button>
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="secondary" size="lg">
            Large
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
        </div>
      </Section>

      <Section title="Radii">
        <div className="flex flex-wrap gap-3">
          {radii.map((radius) => (
            <div key={radius.name} className="flex flex-col items-center gap-1.5">
              <div className={`${radius.className} size-12 border border-hairline bg-surface-3`} />
              <span className="font-mono text-[11px] text-ink-subtle">{radius.name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type scale">
        <div className="flex flex-col gap-2">
          <p className="text-display text-ink">Display 32</p>
          <p className="text-title text-ink">Title 24</p>
          <p className="text-section text-ink">Section 18</p>
          <p className="text-lead text-ink">Lead 16</p>
          <p className="text-body text-ink">Body 14, the default for tables and forms.</p>
          <p className="text-body-sm text-ink-muted">Body small 13, dense table rows.</p>
          <p className="text-caption text-ink-subtle">Caption 12, meta and helper text.</p>
        </div>
      </Section>

      <Section title="Tabular figures">
        <table className="w-full max-w-md">
          <thead>
            <tr className="border-b border-hairline">
              <th className="pb-1.5 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                SKU
              </th>
              <th className="pb-1.5 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                On hand
              </th>
              <th className="pb-1.5 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                Price
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              ["KB-TKL-BRN-01", 142, "4,190.00"],
              ["MS-WLS-8K-02", 8, "3,450.00"],
              ["KC-PBT-DYE-11", 1067, "1,290.00"],
            ].map(([sku, qty, price]) => (
              <tr key={String(sku)} className="border-b border-hairline last:border-b-0">
                <td className="py-1.5 font-mono text-[12px] text-ink">{sku}</td>
                <td className="py-1.5 text-right font-mono text-[12px] text-ink">{qty}</td>
                <td className="py-1.5 text-right font-mono text-[12px] text-ink">&#8369;{price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
