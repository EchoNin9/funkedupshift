import React from "react";
import { Link } from "react-router-dom";
import { ChatBubbleLeftRightIcon, ArrowUturnLeftIcon } from "@heroicons/react/24/outline";

const MerchSupportPage: React.FC = () => {
  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-text-primary tracking-tight">
          Merch help, feedback &amp; returns
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Questions about an order, product quality, or returns? Use the options below.
        </p>
      </div>

      <section className="rounded-xl border border-border-default bg-surface-1 p-6 space-y-3">
        <div className="flex items-center gap-2 text-text-primary font-semibold">
          <ChatBubbleLeftRightIcon className="h-5 w-5 text-accent-500" aria-hidden />
          Feedback &amp; support
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">
          For general feedback, shipping issues, or help using the store, contact the site administrators using
          the same channel you use for the rest of this site (e.g. your team email or Discord). If you have a
          Stripe receipt, include the order reference from that email so we can match your purchase quickly.
        </p>
      </section>

      <section className="rounded-xl border border-border-default bg-surface-1 p-6 space-y-3">
        <div className="flex items-center gap-2 text-text-primary font-semibold">
          <ArrowUturnLeftIcon className="h-5 w-5 text-accent-500" aria-hidden />
          Returns &amp; exchanges
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">
          Print-on-demand items are produced when you order. If an item arrives damaged or misprinted, contact
          support with photos within 14 days of delivery. We will work with our fulfillment partner (e.g.
          Gelato) on a replacement or refund where eligible. Change-of-mind returns may not be available for
          custom printed goods; we will confirm based on partner policy.
        </p>
      </section>

      <p className="text-xs text-text-tertiary">
        Policies may be updated; the version on this page applies at the time you place an order.
      </p>

      <Link to="/merch" className="inline-flex text-sm text-accent-400 hover:text-accent-300">
        ← Back to merch store
      </Link>
    </div>
  );
};

export default MerchSupportPage;
