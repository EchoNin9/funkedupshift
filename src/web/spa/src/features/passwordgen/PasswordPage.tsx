import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowsClockwise, LockSimple } from "@phosphor-icons/react";
import { Alert } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { CopyButton } from "../../components/CopyButton";
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
  if (bits < 40) return { label: "Weak", className: "text-danger" };
  if (bits < 70) return { label: "OK", className: "text-warning" };
  return { label: "Strong", className: "text-success" };
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

const checkboxClass = `h-4 w-4 shrink-0 rounded-sm accent-[rgb(var(--color-accent))] ${focusRing}`;

const PasswordPage: React.FC = () => {
  const { user } = useAuth();
  const [options, setOptions] = useState<PasswordOptions>(DEFAULT_OPTIONS);
  const [password, setPassword] = useState("");
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

  const srTitle = <h1 className="sr-only">Password Generator</h1>;

  if (!user) {
    return (
      <div className="space-y-4">
        {srTitle}
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to generate passwords</div>
            <div className="text-sm text-text-secondary">Generated locally — nothing ever leaves your browser.</div>
          </div>
          <Link to="/auth" className={buttonClasses("primary", "md")}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {srTitle}
      <p className="text-sm text-text-secondary">Generated locally — nothing ever leaves your browser.</p>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="space-y-3 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <code
            aria-label="Generated password"
            className="min-h-12 min-w-0 flex-1 basis-[240px] break-all rounded-ds-md border border-border-default bg-surface-0 px-3.5 py-3 font-mono text-[15px] text-text-primary"
          >
            {password || <span className="text-text-tertiary">Click generate to create a password</span>}
          </code>
          <div className="flex w-full gap-2 sm:w-auto">
            {password ? (
              <CopyButton text={password} size="lg" className="flex-1 sm:flex-none" />
            ) : (
              <button type="button" disabled className={`${buttonClasses("secondary", "lg")} flex-1 sm:flex-none`}>
                Copy
              </button>
            )}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className={`${buttonClasses("primary", "lg")} flex-1 sm:flex-none`}
            >
              <ArrowsClockwise size={18} weight="regular" aria-hidden="true" />
              Generate
            </button>
          </div>
        </div>

        {password && (
          <p className="text-[13px] text-text-secondary">
            ~{Math.round(bits)} bits of entropy — <span className={`font-semibold ${strength.className}`}>{strength.label}</span>
          </p>
        )}
      </div>

      <div className="space-y-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-3.5">
        <div>
          <label htmlFor="pwgen-length" className="mb-2 flex justify-between text-sm font-semibold text-text-primary">
            <span>Length</span>
            <span className="font-mono text-accent-text">{options.length}</span>
          </label>
          <input
            id="pwgen-length"
            type="range"
            min={4}
            max={64}
            value={options.length}
            onChange={(e) => setOptions((prev) => ({ ...prev, length: Number(e.target.value) }))}
            className={`h-6 w-full accent-[rgb(var(--color-accent))] ${focusRing}`}
          />
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-1 min-[420px]:grid-cols-2">
          {CLASS_TOGGLES.map(({ cls, label }) => (
            <label key={cls} className="flex min-h-10 items-center gap-2.5 text-sm text-text-primary">
              <input type="checkbox" checked={options[cls]} onChange={() => toggleClass(cls)} className={checkboxClass} />
              {label}
            </label>
          ))}
        </div>

        <label className="flex min-h-10 items-center gap-2.5 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={options.excludeAmbiguous}
            onChange={() => setOptions((prev) => ({ ...prev, excludeAmbiguous: !prev.excludeAmbiguous }))}
            className={checkboxClass}
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
