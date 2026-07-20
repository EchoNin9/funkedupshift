import React, { useEffect, useMemo, useState } from "react";

// ---- crypto-secure password generator ----
// Duplicated in the SPA's src/features/passwordgen/PasswordPage.tsx — this
// app deliberately does not import from src/web/spa (see the note atop
// api.ts), so the small generator function is carried in both places.

type CharClass = "upper" | "lower" | "digits" | "symbols";

const CHAR_SETS: Record<CharClass, string> = {
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lower: "abcdefghijklmnopqrstuvwxyz",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.<>?/|~"
};

const CLASS_LABELS: Record<CharClass, string> = {
  upper: "Uppercase (A–Z)",
  lower: "Lowercase (a–z)",
  digits: "Digits (0–9)",
  symbols: "Symbols (!@#…)"
};

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

export interface PasswordOptions {
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
  if (bits < 40) return { label: "Weak", className: "entropy-weak" };
  if (bits < 70) return { label: "OK", className: "entropy-ok" };
  return { label: "Strong", className: "entropy-strong" };
}
// ---- end shared generator ----

interface Props {
  onBack: () => void;
}

const DEFAULT_OPTIONS: PasswordOptions = {
  length: 16,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false
};

const CLASS_ORDER: CharClass[] = ["upper", "lower", "digits", "symbols"];

const PasswordTool: React.FC<Props> = ({ onBack }) => {
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

  const handleGenerate = () => {
    try {
      const result = generatePassword(options);
      setPassword(result.password);
      setCopied(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a password.");
    }
  };

  // Generate one on first mount so there's always something to look at.
  useEffect(() => {
    if (canGenerate) handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleClass = (cls: CharClass) => {
    setOptions((prev) => ({ ...prev, [cls]: !prev[cls] }));
  };

  const handleCopy = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard permission denied — the password text is still visible, so
      // the user can copy it by hand
    }
  };

  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">Password Generator</h1>
      <p className="muted local-notice">Generated locally — nothing ever leaves your browser.</p>

      <div className="pwgen-output">
        <code className="pwgen-password">{password || "—"}</code>
        <button type="button" className="btn btn-ghost" onClick={handleCopy} disabled={!password}>
          {copied ? "Copied!" : "Copy"}
        </button>
        <button type="button" className="btn btn-primary" onClick={handleGenerate} disabled={!canGenerate}>
          Generate
        </button>
      </div>

      {password && (
        <p className={`entropy-readout ${strength.className}`}>
          ~{Math.round(bits)} bits of entropy — {strength.label}
        </p>
      )}

      {error && <div className="banner banner-error">{error}</div>}

      <div className="pwgen-field">
        <label htmlFor="pwgen-length">Length: {options.length}</label>
        <input
          id="pwgen-length"
          type="range"
          min={4}
          max={64}
          value={options.length}
          onChange={(e) => setOptions((prev) => ({ ...prev, length: Number(e.target.value) }))}
        />
      </div>

      <div className="pwgen-checks">
        {CLASS_ORDER.map((cls) => (
          <label key={cls} className="pwgen-check">
            <input type="checkbox" checked={options[cls]} onChange={() => toggleClass(cls)} />
            {CLASS_LABELS[cls]}
          </label>
        ))}
        <label className="pwgen-check">
          <input
            type="checkbox"
            checked={options.excludeAmbiguous}
            onChange={() => setOptions((prev) => ({ ...prev, excludeAmbiguous: !prev.excludeAmbiguous }))}
          />
          Exclude ambiguous characters (I l 1 O 0 o | ` &apos; &quot;)
        </label>
      </div>

      {noClasses && (
        <div className="banner banner-warn">Enable at least one character type to generate a password.</div>
      )}
      {tooShort && (
        <div className="banner banner-warn">
          Increase length to at least {pools.length} to fit all selected character types.
        </div>
      )}
    </section>
  );
};

export default PasswordTool;
