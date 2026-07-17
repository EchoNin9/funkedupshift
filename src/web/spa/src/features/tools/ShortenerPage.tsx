import React, { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { ClipboardDocumentIcon, LinkIcon } from "@heroicons/react/24/outline";
import { Alert, fadeUpStaggered, stagger } from "../../components";
import { useAuth } from "../../shell/AuthContext";
import { mintShortLink, type ShortLink } from "./api";

const input =
  "rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary flex-1 min-w-0";

interface MintedLink extends ShortLink {
  mintedAt: number;
}

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-hover bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors shrink-0"
    >
      <ClipboardDocumentIcon className="h-3.5 w-3.5" />
      {copied ? "Copied" : "Copy"}
    </button>
  );
};

const ShortenerPage: React.FC = () => {
  const { user } = useAuth();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<MintedLink[]>([]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!url.trim() || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const result = await mintShortLink(url.trim());
        setLinks((prev) => [{ ...result, mintedAt: Date.now() }, ...prev]);
        setUrl("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not shorten that URL.");
      } finally {
        setSubmitting(false);
      }
    },
    [url, submitting]
  );

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-text-primary">URL Shortener</h1>
        <p className="text-sm text-text-secondary">Sign in to create short links.</p>
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
        <LinkIcon className="h-6 w-6 text-accent" />
        URL Shortener
      </motion.h1>
      <p className="text-sm text-text-secondary">
        Paste a long URL to mint a short link on fus.fyi.
      </p>

      {error && <Alert variant="error">{error}</Alert>}

      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-center">
        <input
          type="url"
          aria-label="URL to shorten"
          placeholder="https://example.com/some/very/long/path"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className={input}
          required
        />
        <button
          type="submit"
          disabled={submitting || !url.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {submitting ? "Shortening…" : "Shorten"}
        </button>
      </form>

      {links.length > 0 && (
        <motion.div
          className="space-y-2"
          initial="hidden"
          animate="visible"
          variants={stagger(0.05)}
        >
          <h2 className="text-sm font-semibold text-text-primary">Minted this session</h2>
          {links.map((link, i) => (
            <motion.div
              key={link.code}
              variants={fadeUpStaggered}
              custom={i}
              className="rounded-xl border border-border-default bg-surface-2/80 p-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <a
                  href={link.shortUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-nav hover:underline break-all"
                >
                  {link.shortUrl}
                </a>
                <p className="text-xs text-text-tertiary truncate">{link.url}</p>
              </div>
              <CopyButton text={link.shortUrl} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
};

export default ShortenerPage;
