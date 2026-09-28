"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

import { importProductsAction } from "../actions";
import type { ImportAction, ImportPlan } from "../services/csv";
import { IMPORT_TEMPLATE } from "../services/csv";

/**
 * CSV import in two deliberate steps: read the file and show exactly what it
 * would do, then write it. The plan is recomputed on the server at commit
 * time, so a stale preview can never be what gets applied.
 */

const ACTION_TONE: Record<ImportAction, StatusTone> = {
  "create-product": "accent",
  "create-variant": "info",
  update: "warning",
  unchanged: "neutral",
  error: "critical",
};

const ACTION_LABEL: Record<ImportAction, string> = {
  "create-product": "new product",
  "create-variant": "new variant",
  update: "update",
  unchanged: "no change",
  error: "error",
};

export function ImportWizard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setPlan(null);
    setMessage(null);
    setError(null);
    setDone(false);
  }

  async function onFile(file: File) {
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    reset();
  }

  function run(commit: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await importProductsAction({ csv, commit });
      if (!result.ok) {
        setError(result.error);
        if (!commit) setPlan(null);
        return;
      }
      setPlan(result.plan);
      setMessage(result.message);
      setDone(result.committed);
      if (result.committed) router.refresh();
    });
  }

  const applicable = plan
    ? plan.counts["create-product"] + plan.counts["create-variant"] + plan.counts.update
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-hairline bg-surface-1 p-4">
        <h2 className="text-section text-ink">1. Choose the file</h2>
        <p className="mt-0.5 mb-3 text-body-sm text-ink-subtle">
          One row per variant, matched on SKU. A SKU that already exists is updated in place; a new
          one is created, attached to the product named in its row. Column names are matched
          loosely, so an export from this app can be edited and uploaded straight back.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            // The Choose CSV button is the visible control; the input keeps a
            // name for assistive tech but stays out of the Tab order.
            aria-label="CSV file to import"
            tabIndex={-1}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
            <FileUp aria-hidden />
            Choose CSV
          </Button>
          <span className="text-body-sm text-ink-subtle">
            {fileName ?? "No file chosen. You can also paste below."}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setCsv(IMPORT_TEMPLATE);
              setFileName("template");
              reset();
            }}
          >
            Use the template
          </Button>
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          <Label htmlFor="csv-text">CSV contents</Label>
          <textarea
            id="csv-text"
            rows={8}
            spellCheck={false}
            value={csv}
            onChange={(event) => {
              setCsv(event.target.value);
              reset();
            }}
            placeholder={IMPORT_TEMPLATE}
            className="rounded-md border border-input bg-canvas px-2 py-1.5 font-mono text-[12px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill"
          />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button
            type="button"
            variant="primary"
            disabled={csv.trim() === "" || isPending}
            onClick={() => run(false)}
          >
            {isPending && !plan ? "Reading" : "Check the file"}
          </Button>
          <Button asChild variant="ghost">
            <Link href="/products">Back to products</Link>
          </Button>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-body-sm text-danger">
            {error}
          </p>
        ) : null}
      </section>

      {plan ? (
        <section className="rounded-lg border border-hairline bg-surface-1 p-4">
          <h2 className="text-section text-ink">2. Review what would change</h2>
          <p className="mt-0.5 text-body-sm text-ink-subtle">{message}</p>

          {plan.unknownHeaders.length > 0 ? (
            <p className="mt-2 rounded-md border border-hairline bg-warning-wash px-3 py-2 text-body-sm text-warning">
              Ignored columns: {plan.unknownHeaders.join(", ")}
            </p>
          ) : null}

          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(Object.keys(ACTION_LABEL) as ImportAction[]).map((action) => (
              <div key={action} className="border-t border-hairline pt-2">
                <dt className="text-[11px] tracking-[0.06em] text-ink-subtle uppercase">
                  {ACTION_LABEL[action]}
                </dt>
                <dd className="font-mono text-lead text-ink" data-numeric>
                  {plan.counts[action]}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 max-h-96 overflow-auto rounded-md border border-hairline">
            <table className="w-full text-body-sm">
              <thead className="sticky top-0 bg-surface-1">
                <tr className="border-b border-hairline">
                  <th className="px-3 py-1.5 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                    Line
                  </th>
                  <th className="px-3 py-1.5 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                    SKU
                  </th>
                  <th className="px-3 py-1.5 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                    Action
                  </th>
                  <th className="px-3 py-1.5 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                    What changes
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row) => (
                  <tr key={row.line} className="border-b border-hairline last:border-b-0">
                    <td className="px-3 py-1.5 font-mono text-[12px] text-ink-subtle">
                      {row.line}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[12px] text-ink">{row.sku || "?"}</td>
                    <td className="px-3 py-1.5">
                      <StatusBadge tone={ACTION_TONE[row.action]}>
                        {ACTION_LABEL[row.action]}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="text-ink-muted">{row.label}</span>
                      {row.errors.length > 0 ? (
                        <ul className="mt-0.5">
                          {row.errors.map((problem) => (
                            <li key={problem} className="text-caption text-danger">
                              {problem}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {row.changes.length > 0 ? (
                        <ul className="mt-0.5 flex flex-wrap gap-x-3">
                          {row.changes.map((change) => (
                            <li
                              key={change.field}
                              className="font-mono text-[11px] text-ink-subtle"
                            >
                              {change.field}{" "}
                              {change.from === "" ? null : (
                                <span className="line-through opacity-70">{change.from}</span>
                              )}{" "}
                              <span aria-hidden>{"->"}</span>{" "}
                              <span className="text-ink">{change.to}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {done ? (
              <>
                <p className="text-body-sm text-success">{message}</p>
                <Button asChild variant="primary" className="ml-auto">
                  <Link href="/products">See the catalogue</Link>
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="primary"
                  disabled={isPending || applicable === 0 || plan.counts.error > 0}
                  onClick={() => run(true)}
                >
                  {isPending
                    ? "Importing"
                    : `Import ${applicable} row${applicable === 1 ? "" : "s"}`}
                </Button>
                {plan.counts.error > 0 ? (
                  <p className="text-body-sm text-danger">
                    Fix the {plan.counts.error} row{plan.counts.error === 1 ? "" : "s"} with errors
                    first. Nothing is written while any row is wrong.
                  </p>
                ) : null}
                {applicable === 0 && plan.counts.error === 0 ? (
                  <p className="text-body-sm text-ink-subtle">
                    Every row already matches the catalogue, so there is nothing to write.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
