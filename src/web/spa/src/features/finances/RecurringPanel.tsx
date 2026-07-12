import React from "react";
import { fmtMoney } from "./api";

export interface RecurringCharge {
  payee: string;
  cadence: string;
  typicalAmount: number;
  occurrences: number;
  lastDate: string;
  nextExpected: string;
}

/** Presentational card listing detected recurring charges (FUNK-31). */
const RecurringPanel: React.FC<{ items: RecurringCharge[] }> = ({ items }) => (
  <div className="rounded-xl border border-border-default bg-surface-1 p-4 space-y-3">
    <h2 className="text-sm font-semibold text-text-primary uppercase">Recurring charges</h2>
    {items.length === 0 && (
      <p className="text-sm text-text-tertiary">No recurring charges detected yet.</p>
    )}
    {items.map((r) => (
      <div
        key={`${r.payee}-${r.cadence}`}
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-text-primary">{r.payee}</span>
          <span className="shrink-0 rounded-full border border-border-hover px-2 text-xs text-text-secondary">
            {r.cadence}
          </span>
        </div>
        <div className="shrink-0">
          <span className="font-medium text-text-primary">{fmtMoney(r.typicalAmount)}</span>{" "}
          <span className="text-text-tertiary">next ~{r.nextExpected}</span>
        </div>
      </div>
    ))}
  </div>
);

export default RecurringPanel;
