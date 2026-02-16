import React, { useEffect, useMemo, useRef, useState } from "react";

interface AddTagInputProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  allTags: string[];
  /** Optional: fetch tags from API as user types for immediate server-side suggestions */
  fetchTags?: (query: string) => Promise<string[]>;
  placeholder?: string;
  className?: string;
}

/**
 * Tag input with autocomplete: typing suggests tags immediately, Tab to autocomplete,
 * Enter/Tab adds first suggestion or creates new tag from current input.
 */
const AddTagInput: React.FC<AddTagInputProps> = ({
  tags,
  onTagsChange,
  allTags,
  fetchTags,
  placeholder = "Type to suggest or create tag, Tab to autocomplete",
  className = ""
}) => {
  const [input, setInput] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [liveSuggestions, setLiveSuggestions] = useState<string[] | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!fetchTags) {
      setLiveSuggestions(null);
      return;
    }
    const q = input.trim();
    if (q.length === 0) {
      setLiveSuggestions(null);
      return;
    }
    if (fetchAbortRef.current) fetchAbortRef.current.abort();
    const ctrl = new AbortController();
    fetchAbortRef.current = ctrl;
    const id = setTimeout(() => {
      fetchTags(q)
        .then((list) => {
          if (!ctrl.signal.aborted) setLiveSuggestions(list);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setLiveSuggestions(null);
        });
    }, 80);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [input, fetchTags]);

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (fetchTags && liveSuggestions !== null) {
      return liveSuggestions.filter((t) => !tags.includes(t));
    }
    if (!q) return allTags.filter((t) => !tags.includes(t));
    return allTags.filter(
      (t) => !tags.includes(t) && t.toLowerCase().includes(q)
    );
  }, [allTags, tags, input, fetchTags, liveSuggestions]);

  const addTag = (tag: string) => {
    const t = tag.trim();
    if (t && !tags.includes(t)) {
      onTagsChange([...tags, t]);
    }
    setInput("");
    setHighlightIndex(0);
  };

  const removeTag = (t: string) => {
    onTagsChange(tags.filter((x) => x !== t));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      if (suggestions.length > 0) {
        addTag(suggestions[highlightIndex] ?? suggestions[0]);
      } else {
        const t = input.trim();
        if (t) addTag(t);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % Math.max(1, suggestions.length));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) =>
        i <= 0 ? Math.max(0, suggestions.length - 1) : i - 1
      );
      return;
    }
    if (e.key === "Escape") {
      setDropdownOpen(false);
      setHighlightIndex(0);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setDropdownOpen(true);
          setHighlightIndex(0);
        }}
        onFocus={() => setDropdownOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
        autoComplete="off"
      />
      {dropdownOpen && (suggestions.length > 0 || input.trim()) && (
        <div
          className="absolute left-0 top-full z-10 mt-1 w-full max-h-48 overflow-auto scrollbar-thin rounded-md border border-slate-700 bg-slate-900 shadow-lg"
          role="listbox"
        >
          {suggestions.length > 0 ? (
            suggestions.map((tag, i) => (
              <button
                key={tag}
                type="button"
                role="option"
                aria-selected={i === highlightIndex}
                onClick={() => addTag(tag)}
                onMouseEnter={() => setHighlightIndex(i)}
                className={`block w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 ${
                  i === highlightIndex ? "bg-slate-800" : ""
                }`}
              >
                {tag}
              </button>
            ))
          ) : (
            <button
              type="button"
              onClick={() => input.trim() && addTag(input.trim())}
              className="block w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Create &quot;{input.trim()}&quot;
            </button>
          )}
        </div>
      )}
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
            >
              {t}
              <button
                type="button"
                onClick={() => removeTag(t)}
                className="hover:text-slate-100"
                aria-label={`Remove ${t}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default AddTagInput;
