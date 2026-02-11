import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
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

      // Give AuthContext a moment to see the new session, then return to previous context.
      setTimeout(() => {
        navigate(-1);
      }, 800);
    } catch (err: any) {
      const msg = err?.message || "Authentication failed. Please try again.";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Sign in / Sign up</h1>
        <p className="text-sm text-slate-400">
          Use your Funkedupshift account to rate sites, add notes, and manage curated content (based on your role).
        </p>
      </header>

      {user && (
        <div className="rounded-xl border border-emerald-600/60 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          You&apos;re currently signed in as{" "}
          <span className="font-semibold text-emerald-200">{user.email}</span> (
          {user.role === "superadmin" ? "SuperAdmin" : user.role}). You can safely close this page or continue
          browsing websites and media.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start">
        <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow-lg shadow-slate-950/40">
          <div className="mb-4 flex gap-2 rounded-full bg-slate-900/70 p-1 text-xs font-medium text-slate-300">
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className={[
                "flex-1 rounded-full px-3 py-1.5 transition-colors",
                mode === "signin" ? "bg-slate-50 text-slate-950" : "hover:bg-slate-800/80"
              ].join(" ")}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className={[
                "flex-1 rounded-full px-3 py-1.5 transition-colors",
                mode === "signup" ? "bg-slate-50 text-slate-950" : "hover:bg-slate-800/80"
              ].join(" ")}
            >
              Sign up
            </button>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <label htmlFor="authEmail" className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                Email
              </label>
              <input
                id="authEmail"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="authPassword"
                className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400"
              >
                Password
              </label>
              <input
                id="authPassword"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
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
              className="inline-flex w-full items-center justify-center rounded-full bg-brand-orange px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-md shadow-orange-500/40 transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? (mode === "signin" ? "Signing in…" : "Creating account…") : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
        </section>

        <aside className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-300">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
            How access works
          </p>
          <ul className="space-y-2">
            <li>
              <span className="font-semibold text-slate-100">Guests</span> can browse all websites and media without
              signing in.
            </li>
            <li>
              <span className="font-semibold text-slate-100">Signed-in users</span> can star sites and media, and later
              add their own metadata and comments.
            </li>
            <li>
              <span className="font-semibold text-slate-100">Managers & admins</span> can curate sites, media, and
              categories, with extra tooling in the admin area.
            </li>
          </ul>
          <p className="text-slate-500">
            If you don&apos;t see expected admin controls after signing in, confirm your Cognito group membership in
            the AWS Console.
          </p>
        </aside>
      </div>
    </div>
  );
};

export default AuthPage;

