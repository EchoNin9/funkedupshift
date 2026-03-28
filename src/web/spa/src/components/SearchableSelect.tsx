import React, { useCallback, useMemo, useRef, useState } from "react";
import { useClickOutside } from "./useClickOutside";
import { Badge } from "./Badge";

export interface SelectOption {
  id: string;
  label: string;
}

interface SearchableSelectProps {
  options: SelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
}

export function SearchableSelect({
  options,
  selected,
  onChange,
  placeholder = "Search and select\u2026",
  emptyMessage = "No matches",
  className = "",
}: SearchableSelectProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

  const filtered = useMemo(
    () =>
      options.filter(
        (o) =>
          !selected.includes(o.id) &&
          (!search.trim() || o.label.toLowerCase().includes(search.toLowerCase())),
      ),
    [options, selected, search],
  );

  const add = (id: string) => {
    onChange([...selected, id]);
    setSearch("");
  };

  const remove = (id: string) => {
    onChange(selected.filter((s) => s !== id));
  };

  const labelFor = (id: string) => options.find((o) => o.id === id)?.label ?? id;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="input-field w-full"
        autoComplete="off"
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-auto scrollbar-thin rounded-md border border-slate-700 bg-slate-900 shadow-lg">
          {filtered.length ? (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => add(o.id)}
                className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
              >
                {o.label}
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-xs text-slate-500">{emptyMessage}</p>
          )}
        </div>
      )}
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {selected.map((id) => (
            <Badge key={id} label={labelFor(id)} onRemove={() => remove(id)} />
          ))}
        </div>
      )}
    </div>
  );
}
