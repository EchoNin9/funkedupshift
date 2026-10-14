import React, { useEffect, useRef, useState } from "react";
import { Player } from "./squashShared";

interface Props {
  players: Player[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  mode: "and" | "or";
  onModeChange: (m: "and" | "or") => void;
  className?: string;
}

const PlayerPicker: React.FC<Props> = ({ players, selectedIds, onChange, mode, onModeChange, className = "max-w-[14rem] min-w-[12rem]" }) => {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const nameOf = (id: string) => {
    const p = players.find((x) => x.id === id || x.PK === id);
    return p ? p.name || p.id || id : id;
  };

  const options = players.filter(
    (p) => !selectedIds.includes(p.id) && (!search.trim() || (p.name || "").toLowerCase().includes(search.toLowerCase()))
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const modeBtn = (m: "and" | "or", label: string) => (
    <button
      type="button"
      onClick={() => onModeChange(m)}
      className={`rounded px-2 py-0.5 text-xs font-medium ${
        mode === m ? "bg-accent-500 text-surface-0" : "text-text-secondary hover:text-text-primary transition-colors"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className={`relative ${className}`} ref={ref}>
      <label className="block text-xs font-semibold text-text-secondary mb-1">Filter by players</label>
      <input
        aria-label="Filter by players"
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Search players..."
        autoComplete="off"
        className="block w-full rounded-md border border-border-hover bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface-2 border border-border-hover rounded-md max-h-48 overflow-y-auto scrollbar-thin z-10">
          {options.length ? (
            options.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange([...selectedIds, p.id]);
                  setSearch("");
                }}
                className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-surface-3 transition-colors"
              >
                {p.name || p.id}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-text-tertiary">No matches</div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1 mt-1">
        {selectedIds.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-3 text-text-primary text-xs">
            {nameOf(id)}
            <button
              type="button"
              onClick={() => onChange(selectedIds.filter((x) => x !== id))}
              className="text-text-secondary hover:text-text-primary transition-colors"
              aria-label="Remove"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {selectedIds.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-text-tertiary">Match:</span>
          <div className="inline-flex rounded-md border border-border-hover bg-surface-1 p-0.5">
            {modeBtn("and", "AND")}
            {modeBtn("or", "OR")}
          </div>
        </div>
      )}
    </div>
  );
};

export default PlayerPicker;
