import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../../shell/AuthContext";

type AuthMode = "signin" | "signup";

const AuthPage: React.FC = () => {
  const { user, refreshAuth } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setMessage(null);
  };

  const handleSubmit: React.FormEventHandler = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      setError("Email and password are required.");
      return;
    }

    const w = window as any;
    if (!w.auth) {
      setError("Auth is not configured. Check Cognito frontend setup.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === "signin") {
        await new Promise<void>((resolve, reject) => {
          w.auth.signIn(trimmedEmail, trimmedPassword, (err: any) => {
            if (err) reject(err);
            else resolve();
          });
        });
        setMessage("Signed in successfully. Redirecting…");
        await refreshAuth();
      } else {
        await new Promise<void>((resolve, reject) => {
          w.auth.signUp(trimmedEmail, trimmedPassword, (err: any) => {
            if (err) reject(err);
            else resolve();
          });
        });
        setMessage("Account created successfully. You can now sign in.");
        setMode("signin");
      }

      if (mode === "signin") {
        setTimeout(() => navigate("/"), 800);
      }
    } catch (err: any) {
      const msg = err?.message || "Authentication failed. Please try again.";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <motion.header
        className="space-y-2"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Sign in / Sign up</h1>
        <p className="text-sm text-text-secondary">
          Use your Funkedupshift account to rate sites, add notes, and manage curated content (based on your role).
        </p>
      </motion.header>

      {user && (
        <div className="rounded-xl border border-emerald-600/60 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          You&apos;re currently signed in as{" "}
          <span className="font-semibold text-emerald-200">{user.email}</span> (
          {user.role === "superadmin" ? "SuperAdmin" : user.role}). You can safely close this page or continue
          browsing websites and media.
        </div>
      )}

      <motion.div
        className="grid gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      >
        <section className="rounded-2xl border border-border-default bg-surface-1 p-5 shadow-lg shadow-black/40">
          <div className="mb-4 flex gap-2 rounded-full bg-surface-2 p-1 text-xs font-medium text-text-secondary">
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className={[
                "flex-1 rounded-full px-3 py-1.5 transition-colors",
                mode === "signin" ? "bg-white text-surface-0" : "hover:bg-surface-3"
              ].join(" ")}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className={[
                "flex-1 rounded-full px-3 py-1.5 transition-colors",
                mode === "signup" ? "bg-white text-surface-0" : "hover:bg-surface-3"
              ].join(" ")}
            >
              Sign up
            </button>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <label htmlFor="authEmail" className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary">
                Email
              </label>
              <input
                id="authEmail"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-primary0 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="authPassword"
                className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary"
              >
                Password
              </label>
              <input
                id="authPassword"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-primary0 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                minLength={8}
                required
              />
            </div>

            {error && (
              <div className="rounded-md border border-red-500/70 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {error}
              </div>
            )}

            {message && !error && (
              <div className="rounded-md border border-emerald-500/70 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center rounded-full bg-accent-500 px-4 py-2.5 text-sm font-semibold text-surface-0 shadow-md shadow-orange-500/40 transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? (mode === "signin" ? "Signing in…" : "Creating account…") : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
        </section>

        <aside className="space-y-3 rounded-2xl border border-border-default bg-surface-1 p-4 text-xs text-text-secondary">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-text-primary0">
            How access works
          </p>
          <ul className="space-y-2">
            <li>
              <span className="font-semibold text-text-primary">Guests</span> can browse all websites and media without
              signing in.
            </li>
            <li>
              <span className="font-semibold text-text-primary">Signed-in users</span> can star sites and media, and later
              add their own metadata and comments.
            </li>
            <li>
              <span className="font-semibold text-text-primary">Managers & admins</span> can curate sites, media, and
              categories, with extra tooling in the admin area.
            </li>
          </ul>
          <p className="text-text-primary0">
            If you don&apos;t see expected admin controls after signing in, confirm your Cognito group membership in
            the AWS Console.
          </p>
        </aside>
      </motion.div>
    </div>
  );
};

export default AuthPage;

