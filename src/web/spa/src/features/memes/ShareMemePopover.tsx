import React, { useRef, useEffect, useState } from "react";
import { LinkIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline";

interface ShareMemePopoverProps {
  memeId: string;
  title?: string;
  trigger: React.ReactNode;
  className?: string;
}

function getShareUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const base = window.location.origin;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

const ShareMemePopover: React.FC<ShareMemePopoverProps> = ({
  memeId,
  title = "",
  trigger,
  className = ""
}) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const shareUrl = getShareUrl(`/memes/${encodeURIComponent(memeId)}`);
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(title || "Meme");

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback */
    }
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div className={`relative inline-block ${className}`} ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
      >
        {trigger}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 min-w-[180px] rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
          <div className="flex items-center gap-1.5 px-2 py-1 mb-2 text-xs font-medium text-slate-500 uppercase">
            <LinkIcon className="h-3.5 w-3.5" />
            Share
          </div>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
            >
              <ClipboardDocumentIcon className="h-4 w-4 text-slate-500" />
              Copy link
              {copied && <span className="text-emerald-400 text-xs">✓</span>}
            </button>
            <a
              href="https://www.instagram.com/"
              target="_blank"
              rel="noopener noreferrer"
              title="Open Instagram"
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
              onClick={() => setOpen(false)}
            >
              Instagram
            </a>
            <a
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
              onClick={() => setOpen(false)}
            >
              Facebook
            </a>
            <a
              href={`https://bsky.app/intent/compose?text=${encodedUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
              onClick={() => setOpen(false)}
            >
              Bluesky
            </a>
            <a
              href={`https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
              onClick={() => setOpen(false)}
            >
              Reddit
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShareMemePopover;
