import React, { useState } from "react";
import { LinkIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline";

interface ShareMemeBoxProps {
  memeId: string;
  title?: string;
  className?: string;
}

function getShareUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const base = window.location.origin;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

const ShareMemeBox: React.FC<ShareMemeBoxProps> = ({ memeId, title = "", className = "" }) => {
  const [copied, setCopied] = useState(false);
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

  const shareLinks = [
    { label: "Copy link", icon: copied ? "✓" : null, onClick: handleCopyLink, href: null },
    {
      label: "Instagram",
      href: "https://www.instagram.com/",
      title: "Open Instagram (copy link first to share)"
    },
    {
      label: "Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`
    },
    {
      label: "Bluesky",
      href: `https://bsky.app/intent/compose?text=${encodedUrl}`
    },
    {
      label: "Reddit",
      href: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`
    }
  ];

  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-950/60 p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-2">
        <LinkIcon className="h-4 w-4 text-slate-400" />
        <span className="text-xs font-medium text-slate-400 uppercase">Share</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {shareLinks.map((item) =>
          item.onClick ? (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 hover:border-slate-600"
            >
              {item.icon ? (
                <span className="text-emerald-400">{item.icon}</span>
              ) : (
                <ClipboardDocumentIcon className="h-4 w-4 text-slate-400" />
              )}
              {item.label}
            </button>
          ) : (
            <a
              key={item.label}
              href={item.href!}
              target="_blank"
              rel="noopener noreferrer"
              title={item.title}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 hover:border-slate-600"
            >
              {item.label}
            </a>
          )
        )}
      </div>
    </div>
  );
};

export default ShareMemeBox;
