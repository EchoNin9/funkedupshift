import React from "react";

interface TagFilterBarProps {
  availableTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  mode: "and" | "or";
  onModeChange: (mode: "and" | "or") => void;
  onClear: () => void;
}

/** Toggleable tag-chip filter row with an AND/OR mode toggle. Client-side only. */
const TagFilterBar: React.FC<TagFilterBarProps> = ({
  availableTags,
  selectedTags,
  onToggleTag,
  mode,
  onModeChange,
  onClear
}) => {
  if (availableTags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <span className="text-xs font-semibold text-text-secondary">Filter by tags:</span>
      {availableTags.map((tag) => {
        const active = selectedTags.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onToggleTag(tag)}
            className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
              active
                ? "border-accent-500 bg-accent-500 text-surface-0"
                : "border-border-hover text-text-secondary hover:bg-surface-3"
            }`}
          >
            {tag}
          </button>
        );
      })}
      {selectedTags.length >= 2 && (
        <div className="inline-flex rounded-md border border-border-hover bg-surface-1 p-0.5">
          <button
            type="button"
            onClick={() => onModeChange("or")}
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              mode === "or" ? "bg-accent-500 text-surface-0" : "text-text-secondary hover:text-text-primary transition-colors"
            }`}
          >
            OR
          </button>
          <button
            type="button"
            onClick={() => onModeChange("and")}
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              mode === "and" ? "bg-accent-500 text-surface-0" : "text-text-secondary hover:text-text-primary transition-colors"
            }`}
          >
            AND
          </button>
        </div>
      )}
      {selectedTags.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-text-tertiary underline hover:text-text-primary"
        >
          Clear tags
        </button>
      )}
    </div>
  );
};

export default TagFilterBar;
