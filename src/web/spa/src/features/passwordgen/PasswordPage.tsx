import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ClipboardDocumentIcon, KeyIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { Alert } from "../../components";
import { useAuth } from "../../shell/AuthContext";

// ---- crypto-secure password generator ----
// Duplicated in the tools-site app's src/PasswordTool.tsx — the two
// frontends deliberately don't import from each other (see the note atop
// src/web/tools-site/src/api.ts), so the small generator function is
// carried in both places.

type CharClass = "upper" | "lower" | "digits" | "symbols";

const CHAR_SETS: Record<CharClass, string> = {
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lower: "abcdefghijklmnopqrstuvwxyz",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.<>?/|~",
};

const CLASS_TOGGLES: { cls: CharClass; label: string }[] = [
  { cls: "upper", label: "Uppercase (A–Z)" },
  { cls: "lower", label: "Lowercase (a–z)" },
  { cls: "digits", label: "Digits (0–9)" },
  { cls: "symbols", label: "Symbols (!@#…)" },
];

// Standard ambiguous/lookalike characters, stripped from each pool when
// "exclude ambiguous" is on: letter/digit lookalikes plus symbol lookalikes.
const AMBIGUOUS_CHARS = new Set(["I", "l", "1", "O", "0", "o", "|", "`", "'", '"']);

function classPool(cls: CharClass, excludeAmbiguous: boolean): string {
  const base = CHAR_SETS[cls];
  if (!excludeAmbiguous) return base;
  return Array.from(base)
    .filter((c) => !AMBIGUOUS_CHARS.has(c))
    .join("");
}

/** Uniform random integer in [0, maxExclusive) via rejection sampling.
 * crypto.getRandomValues only — never Math.random. */
function secureRandomInt(maxExclusive: number): number {
  const range = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= range);
  return x % maxExclusive;
}

/** Fisher-Yates shuffle using the same unbiased randomness. */
function secureShuffle<T>(items: T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface PasswordOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

interface ActivePool {
  cls: CharClass;
  pool: string;
}

/** Non-empty pools for the enabled classes — a class becomes effectively
 * disabled if excluding ambiguous characters would empty it. */
function activePools(opts: PasswordOptions): ActivePool[] {
  return (["upper", "lower", "digits", "symbols"] as CharClass[])
    .filter((c) => opts[c])
    .map((cls) => ({ cls, pool: classPool(cls, opts.excludeAmbiguous) }))
    .filter((p) => p.pool.length > 0);
}

/** Generates a password guaranteeing >=1 char from each enabled class, then
 * shuffles. Throws if no classes are usable or length is too short — the UI
 * must guard against calling this in that state (see canGenerate below). */
function generatePassword(opts: PasswordOptions): { password: string; poolSize: number } {
  const pools = activePools(opts);
  if (pools.length === 0) throw new Error("No character classes available");
  if (opts.length < pools.length) throw new Error("Length too short for the enabled classes");

  const fullPool = pools.map((p) => p.pool).join("");
  const chars = pools.map((p) => p.pool[secureRandomInt(p.pool.length)]);
  for (let i = chars.length; i < opts.length; i++) {
    chars.push(fullPool[secureRandomInt(fullPool.length)]);
  }
  return { password: secureShuffle(chars).join(""), poolSize: fullPool.length };
}

function entropyBits(length: number, poolSize: number): number {
  return poolSize > 0 ? length * Math.log2(poolSize) : 0;
}

function entropyLabel(bits: number): { label: string; className: string } {
  if (bits < 40) return { label: "Weak", className: "text-red-400" };
  if (bits < 70) return { label: "OK", className: "text-amber-400" };
  return { label: "Strong", className: "text-emerald-400" };
}
// ---- end shared generator ----

const DEFAULT_OPTIONS: PasswordOptions = {
  length: 16,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
};

const PasswordPage: React.FC = () => {
  const { user } = useAuth();
  const [options, setOptions] = useState<PasswordOptions>(DEFAULT_OPTIONS);
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pools = useMemo(() => activePools(options), [options]);
  const noClasses = pools.length === 0;
  const tooShort = !noClasses && options.length < pools.length;
  const canGenerate = !noClasses && !tooShort;
  const livePoolSize = useMemo(() => pools.reduce((sum, p) => sum + p.pool.length, 0), [pools]);
  const bits = entropyBits(options.length, livePoolSize);
  const strength = entropyLabel(bits);

  const handleGenerate = useCallback(() => {
    try {
      const result = generatePassword(options);
      setPassword(result.password);
      setCopied(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a password.");
    }
  }, [options]);

  // Generate one on first mount so there's always something to look at.
  useEffect(() => {
    if (user && canGenerate && !password) handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const toggleClass = (cls: CharClass) => setOptions((prev) => ({ ...prev, [cls]: !prev[cls] }));

  const handleCopy = useCallback(async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [password]);

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-text-primary">Password Generator</h1>
        <p className="text-sm text-text-secondary">Sign in to generate passwords.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <motion.h1
        className="text-2xl font-semibold tracking-tight text-text-primary flex items-center gap-2"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <KeyIcon className="h-6 w-6 text-accent" />
        Password Generator
      </motion.h1>
      <p className="text-sm text-text-secondary">Generated locally — nothing ever leaves your browser.</p>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="rounded-xl border border-border-default bg-surface-2/80 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex-1 min-w-0 break-all rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-nav">
            {password || "Click generate to create a password"}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!password}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-hover bg-surface-2 px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ClipboardDocumentIcon className="h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent-500 px-3 py-2 text-xs font-medium text-white hover:bg-accent-600 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowPathIcon className="h-3.5 w-3.5" />
            Generate
          </button>
        </div>

        {password && (
          <p className="text-xs text-text-tertiary">
            ~{Math.round(bits)} bits of entropy — <span className={strength.className}>{strength.label}</span>
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border-default bg-surface-2/80 p-4 space-y-3">
        <div>
          <label htmlFor="pwgen-length" className="flex justify-between text-sm text-text-secondary">
            <span>Length</span>
            <span className="font-medium text-text-primary">{options.length}</span>
          </label>
          <input
            id="pwgen-length"
            type="range"
            min={4}
            max={64}
            value={options.length}
            onChange={(e) => setOptions((prev) => ({ ...prev, length: Number(e.target.value) }))}
            className="w-full accent-accent-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          {CLASS_TOGGLES.map(({ cls, label }) => (
            <label key={cls} className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={options[cls]}
                onChange={() => toggleClass(cls)}
                className="accent-accent-500"
              />
              {label}
            </label>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={options.excludeAmbiguous}
            onChange={() => setOptions((prev) => ({ ...prev, excludeAmbiguous: !prev.excludeAmbiguous }))}
            className="accent-accent-500"
          />
          Exclude ambiguous characters (I l 1 O 0 o | ` &apos; &quot;)
        </label>

        {noClasses && <Alert variant="error">Enable at least one character type to generate a password.</Alert>}
        {tooShort && (
          <Alert variant="error">
            Increase length to at least {pools.length} to fit all selected character types.
          </Alert>
        )}
      </div>
    </div>
  );
};

export default PasswordPage;
