import React, { useEffect } from "react";
import { ShieldCheckIcon } from "@heroicons/react/24/outline";

const EFFECTIVE_DATE = "3 August 2026";
const CONTACT_EMAIL = "adam@echo9.net";

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({
  id,
  title,
  children,
}) => (
  <section id={id} className="scroll-mt-24">
    <h2 className="text-xl sm:text-2xl font-display font-extrabold uppercase tracking-tight text-text-primary mb-3">
      {title}
    </h2>
    <div className="space-y-3 text-text-secondary leading-relaxed">{children}</div>
  </section>
);

const PrivacyPolicyPage: React.FC = () => {
  useEffect(() => {
    const previous = document.title;
    document.title = "Privacy Policy — Funkedupshift";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <main className="container-max section-padding">
      <div className="max-w-3xl">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheckIcon className="h-8 w-8 shrink-0 text-accent-500" />
          <h1 className="text-4xl sm:text-5xl font-display font-extrabold uppercase tracking-tight text-text-primary">
            Privacy Policy
          </h1>
        </div>

        <p className="text-sm text-text-tertiary mb-10">
          Effective {EFFECTIVE_DATE}. This policy applies to funkedupshift.com and
          funkedupshift.ca, and to the Funkedupshift web application served from
          those domains.
        </p>

        <div className="card p-5 mb-10">
          <h2 className="text-lg font-display font-extrabold uppercase tracking-tight text-text-primary mb-2">
            The short version
          </h2>
          <ul className="list-disc space-y-1.5 pl-5 text-text-secondary leading-relaxed">
            <li>We collect your email address so you can have an account.</li>
            <li>
              Everything else we hold is information you chose to enter or upload —
              expenses, vehicle records, receipts, images, and similar.
            </li>
            <li>
              We do not run advertising, analytics, or tracking pixels, and we do
              not sell or rent your information to anyone.
            </li>
            <li>
              Some features send your content to AI services to summarise or read
              it. Those are described below so you can decide whether to use them.
            </li>
            <li>You can ask us to delete your account and data at any time.</li>
          </ul>
        </div>

        <div className="space-y-10">
          <Section id="who-we-are" title="Who we are">
            <p>
              Funkedupshift is operated by Adam Jinks, an individual based in
              Canada, referred to below as &ldquo;we&rdquo; or &ldquo;us&rdquo;.
              We are the party responsible for the personal information described
              in this policy. You can reach us at{" "}
              <a
                className="text-accent-500 underline underline-offset-2"
                href={`mailto:${CONTACT_EMAIL}`}
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
            <p>
              We handle personal information in accordance with Canada&rsquo;s
              Personal Information Protection and Electronic Documents Act
              (PIPEDA).
            </p>
          </Section>

          <Section id="what-we-collect" title="What we collect">
            <p>
              <strong className="text-text-primary">Account information.</strong>{" "}
              When you create an account we collect your email address, which is
              also your sign-in identifier, and optionally a display name you
              choose. Accounts are open to the public — anyone may register.
              Authentication is handled by Amazon Cognito; we never see or store
              your password.
            </p>
            <p>
              <strong className="text-text-primary">
                Information you enter or upload.
              </strong>{" "}
              Depending on which features you use, this can include personal
              finance records (accounts you add manually, transactions, budgets and
              categorisation rules), vehicle records and fuel or maintenance
              entries, general expense entries, photographs of receipts, images you
              upload, investment tracking preferences, and squash player names and
              match scores. We only hold what you put in.
            </p>
            <p>
              <strong className="text-text-primary">
                Sign-in and technical records.
              </strong>{" "}
              We record the date and IP address of your most recent sign-in against
              your profile. Our content delivery network keeps standard web access
              logs — IP address, timestamp, requested page and browser user agent.
              Our server logs may briefly contain your IP address as part of normal
              operational logging.
            </p>
            <p>
              <strong className="text-text-primary">
                What we deliberately do not collect.
              </strong>{" "}
              We do not use advertising networks, analytics platforms, tracking
              pixels, or third-party marketing tags of any kind. We do not collect
              your precise location, contacts, or browsing activity on other sites.
            </p>
          </Section>

          <Section id="instagram" title="Instagram and Facebook data">
            <p>
              Funkedupshift includes an internal tool that publishes our own posts
              to our own Instagram and Bluesky accounts on a schedule. It is
              available only to site administrators.
            </p>
            <p>
              For this we store an access token for Instagram accounts we ourselves
              own, together with the numeric identifier of those accounts. Tokens
              are held encrypted in AWS Systems Manager Parameter Store and are
              never written into our source code or exposed in the application.
              When a post is published, the image or video is made available to
              Meta through a temporary, expiring link so that Meta can retrieve it.
            </p>
            <p>
              <strong className="text-text-primary">
                This tool does not connect to your Instagram or Facebook account,
                and it does not read, collect, or store information about Instagram
                or Facebook users.
              </strong>{" "}
              If you are a visitor or account holder here, no data about you is
              sent to Meta by this feature.
            </p>
          </Section>

          <Section id="ai" title="Automated processing and AI features">
            <p>
              Some optional features send your content to processing services so
              they can be read or summarised. We think you should know exactly which
              ones before you use them:
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong className="text-text-primary">Receipt scanning.</strong>{" "}
                Receipt photographs you upload are sent to Amazon Textract, which
                extracts details such as date, vendor, total, and odometer reading.
              </li>
              <li>
                <strong className="text-text-primary">Summaries and suggestions.</strong>{" "}
                Personal finance insights, meme titles, site descriptions and
                investment suggestions are generated using AI models hosted on
                Amazon Bedrock. The relevant text — which for finance insights can
                include transaction descriptions and amounts — is sent to Bedrock to
                produce the result.
              </li>
            </ul>
            <p>
              These services process the content on our behalf in order to return a
              result to you. If you would prefer your information not be processed
              this way, do not use these particular features.
            </p>
          </Section>

          <Section id="how-we-use" title="How we use your information">
            <p>We use personal information only to:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>create and secure your account and sign you in;</li>
              <li>
                store and display the records and files you have chosen to keep;
              </li>
              <li>
                provide the specific feature you asked for, including the automated
                processing described above;
              </li>
              <li>
                keep the service running, diagnose faults, and protect against abuse;
              </li>
              <li>meet legal obligations that apply to us.</li>
            </ul>
            <p>
              We do not use your information for advertising or profiling, and we do
              not sell, rent, or trade it.
            </p>
          </Section>

          <Section id="sharing" title="Who we share it with">
            <p>
              We do not sell your personal information. We share it only with
              service providers that operate parts of the platform for us:
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong className="text-text-primary">Amazon Web Services</strong> —
                hosting, database storage, file storage, authentication, content
                delivery, and the Textract and Bedrock processing described above.
              </li>
              <li>
                <strong className="text-text-primary">Meta and Bluesky</strong> —
                only for publishing our own posts from our own accounts, as
                described above.
              </li>
              <li>
                <strong className="text-text-primary">ipwho.is</strong> — if you use
                the &ldquo;My Info&rdquo; network tool, your IP address is sent to
                this service to look up its approximate location and provider, and
                the result is shown to you. We do not store it.
              </li>
              <li>
                <strong className="text-text-primary">
                  A financial data provider
                </strong>{" "}
                — where you have connected one, so that account and transaction
                information can be retrieved on your behalf.
              </li>
            </ul>
            <p>
              We may also disclose information where we are legally required to, or
              where necessary to protect our rights or someone&rsquo;s safety.
            </p>
          </Section>

          <Section id="location" title="Where your information is stored">
            <p>
              Data is stored on Amazon Web Services infrastructure, primarily in the
              United States (US East). Shared text pastes are stored in AWS&rsquo;s
              Canada Central region. Information stored in or transferred to the
              United States may be accessible to authorities there under that
              country&rsquo;s laws.
            </p>
          </Section>

          <Section id="retention" title="How long we keep it">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong className="text-text-primary">Account and content data</strong>{" "}
                is kept until you delete it or ask us to delete your account.
              </li>
              <li>
                <strong className="text-text-primary">
                  Shortened links and shared text pastes
                </strong>{" "}
                expire automatically at the time set when they were created, and are
                then removed.
              </li>
              <li>
                <strong className="text-text-primary">
                  Media uploaded to the social publishing tool
                </strong>{" "}
                is automatically deleted after 90 days.
              </li>
              <li>
                <strong className="text-text-primary">Access logs</strong> are kept
                for a limited period for security and troubleshooting.
              </li>
            </ul>
          </Section>

          <Section id="your-rights" title="Your rights">
            <p>Under PIPEDA you may:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>ask what personal information we hold about you and get a copy;</li>
              <li>ask us to correct anything inaccurate or incomplete;</li>
              <li>
                withdraw your consent to our handling of your information, subject
                to legal and contractual limits — in practice this usually means
                closing your account;
              </li>
              <li>ask us to delete your account and associated data;</li>
              <li>
                complain to the Office of the Privacy Commissioner of Canada if you
                are unhappy with how we have responded.
              </li>
            </ul>
            <p>
              Email{" "}
              <a
                className="text-accent-500 underline underline-offset-2"
                href={`mailto:${CONTACT_EMAIL}`}
              >
                {CONTACT_EMAIL}
              </a>{" "}
              and we will respond within 30 days.
            </p>
          </Section>

          <Section id="deletion" title="Deleting your data">
            <p>
              To have your account and its associated data deleted, email{" "}
              <a
                className="text-accent-500 underline underline-offset-2"
                href={`mailto:${CONTACT_EMAIL}`}
              >
                {CONTACT_EMAIL}
              </a>{" "}
              from the address registered to your account, with the subject line{" "}
              <span className="text-text-primary">&ldquo;Delete my account&rdquo;</span>.
            </p>
            <p>
              We will confirm the request, delete your sign-in credentials and the
              records stored against your account, and confirm once it is done. We
              aim to complete deletions within 30 days. Backups and access logs may
              retain some information for a short additional period before being
              overwritten in the ordinary course.
            </p>
          </Section>

          <Section id="cookies" title="Cookies and local storage">
            <p>
              We do not set advertising or tracking cookies, and our content
              delivery network is configured not to forward cookies.
            </p>
            <p>
              When you sign in, your browser&rsquo;s local storage holds the session
              tokens that keep you signed in. We also store small preferences there,
              such as your light or dark theme choice and whether the sidebar is
              collapsed. Clearing your browser storage signs you out and resets
              those preferences.
            </p>
          </Section>

          <Section id="security" title="Security">
            <p>
              Access requires authentication, traffic is encrypted in transit with
              HTTPS, stored files are encrypted at rest, and credentials for
              connected services are held in encrypted secret storage rather than in
              our code. Access to administrative functions is restricted by role.
            </p>
            <p>
              No system is perfectly secure, and we cannot guarantee absolute
              security. Please use a strong, unique password.
            </p>
          </Section>

          <Section id="children" title="Children">
            <p>
              Funkedupshift is not intended for children under 13, and we do not
              knowingly collect their personal information. If you believe a child
              has provided us information, contact us and we will delete it.
            </p>
          </Section>

          <Section id="changes" title="Changes to this policy">
            <p>
              If we change this policy we will update the effective date at the top
              of this page. Material changes will be communicated to account holders
              by email where practical.
            </p>
          </Section>

          <Section id="contact" title="Contact">
            <p>
              Questions, access requests, and deletion requests all go to{" "}
              <a
                className="text-accent-500 underline underline-offset-2"
                href={`mailto:${CONTACT_EMAIL}`}
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>
        </div>
      </div>
    </main>
  );
};

export default PrivacyPolicyPage;
