import React from "react";
import { Link } from "react-router-dom";
import { ShieldCheckIcon } from "@heroicons/react/24/outline";

const PrivacyPolicyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <ShieldCheckIcon className="w-8 h-8 text-indigo-400 shrink-0" />
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        </div>

        <p className="text-gray-400 text-sm mb-10">
          Last updated: April 2026
        </p>

        <div className="space-y-8 text-gray-300 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Overview</h2>
            <p>
              Funkedupshift is a private personal app. We do not collect, store,
              or share your personal information. Your data stays with you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              Information We Do Not Collect
            </h2>
            <p>
              We do not collect or transmit personal information such as your
              name, email address, location, contacts, or device identifiers to
              any third party. No analytics, advertising SDKs, or tracking
              libraries are included in this app.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              Camera Access
            </h2>
            <p>
              The app requests access to your device camera solely to allow you
              to photograph fuel and expense receipts. Receipt images are
              processed to extract expense data (such as date, amount, and
              vendor) and then associated with your expense records. Images are
              not shared with third parties, sold, or used for any purpose
              beyond this in-app feature.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              Data Storage
            </h2>
            <p>
              Any data you enter — expenses, vehicle records, or other items —
              is stored in your own account and is not accessible to other users
              or shared externally. You can delete your data at any time through
              the app.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              Changes to This Policy
            </h2>
            <p>
              If this policy changes, the updated version will be posted at this
              URL with a revised date.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Contact</h2>
            <p>
              Questions about this policy can be directed to the app developer
              via the Google Play Store listing.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-800">
          <Link
            to="/"
            className="text-indigo-400 hover:text-indigo-300 text-sm transition-colors"
          >
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicyPage;
