import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../../shell/AuthContext";

type AuthMode = "signin" | "signup" | "forgot" | "forgot-confirm";

const AuthPage: React.FC = () => {
  const { user, refreshAuth } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setMessage(null);
    setCode("");
    setNewPassword("");
  };

  const handleSubmit: React.FormEventHandler = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const w = window as any;
    if (!w.auth) {
      setError("Auth is not configured. Check Cognito frontend setup.");
      return;
    }

    const trimmedEmail = email.trim();

    if (mode === "forgot") {
      if (!trimmedEmail) {
        setError("Email is required.");
        return;
      }
      setIsSubmitting(true);
      try {
        await new Promise<void>((resolve, reject) => {
          w.auth.forgotPassword(trimmedEmail, (err: any) => {
            if (err) reject(err);
            else resolve();
          });
        });
        setMessage("Verification code sent to your email.");
        setMode("forgot-confirm");
      } catch (err: any) {
        setError(err?.message || "Failed to send reset code. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (mode === "forgot-confirm") {
      const trimmedCode = code.trim();
      if (!trimmedEmail || !trimmedCode || !newPassword) {
        setError("All fields are required.");
        return;
      }
      if (newPassword.length < 8) {
        setError("New password must be at least 8 characters.");
        return;
      }
      setIsSubmitting(true);
      try {
        await new Promise<void>((resolve, reject) => {
          w.auth.confirmForgotPassword(trimmedEmail, trimmedCode, newPassword, (err: any) => {
            if (err) reject(err);
            else resolve();
          });
        });
        setMessage("Password reset successfully. You can now sign in.");
        setCode("");
        setNewPassword("");
        setMode("signin");
      } catch (err: any) {
        setError(err?.message || "Password reset failed. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const trimmedPassword = password.trim();
    if (!trimmedEmail || !trimmedPassword) {
      setError("Email and password are required.");
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

  const isForgotFlow = mode === "forgot" || mode === "forgot-confirm";
  const heading =
    mode === "signin" ? "Sign in"
      : mode === "signup" ? "Sign up"
      : mode === "forgot" ? "Reset password"
      : "New password";
  const subText =
    mode === "signin" ? "Welcome back to the funk."
      : mode === "signup" ? "Join the funk — it's free."
      : mode === "forgot" ? "We'll email you a verification code."
      : "Enter the code, then set a new password.";
  const submitLabel = isSubmitting
    ? mode === "signin" ? "Entering…"
      : mode === "signup" ? "Creating…"
      : mode === "forgot" ? "Sending…"
      : "Resetting…"
    : mode === "signin" ? "Enter the funk →"
      : mode === "signup" ? "Create account →"
      : mode === "forgot" ? "Send code →"
      : "Reset password →";

  const labelClass = "block font-display font-extrabold uppercase tracking-tight text-xs text-text-primary mb-1.5";

  return (
    <div className="flex justify-center py-8">
      <motion.div
        className="relative w-full max-w-[430px]"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Floating sticker badge */}
        <span aria-hidden className="pop-badge pop-pulse absolute -top-4 -right-3 z-10 rotate-6">
          Howdy!
        </span>

        <section className="card p-6 sm:p-8">
          <header className="mb-6 space-y-1">
            <h1 className="text-3xl font-display font-extrabold uppercase tracking-tight text-text-primary">
              {heading}
            </h1>
            <p className="text-sm text-text-secondary">{subText}</p>
          </header>

          {user && (
            <div className="mb-5 rounded-lg border-2 border-nav bg-surface-3 px-4 py-3 text-sm text-text-primary">
              Signed in as <span className="font-semibold">{user.email}</span> (
              {user.role === "superadmin" ? "SuperAdmin" : user.role}). Close this page or keep browsing.
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="authEmail" className={labelClass}>Email</label>
              <input
                id="authEmail"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={mode === "forgot-confirm"}
                className={`input-field ${mode === "forgot-confirm" ? "opacity-60 cursor-default" : ""}`}
                placeholder="you@example.com"
                required
              />
            </div>

            {mode === "forgot-confirm" && (
              <>
                <div>
                  <label htmlFor="authCode" className={labelClass}>Verification code</label>
                  <input
                    id="authCode"
                    type="text"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="input-field"
                    placeholder="123456"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="authNewPassword" className={labelClass}>New password</label>
                  <input
                    id="authNewPassword"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input-field"
                    placeholder="At least 8 characters"
                    minLength={8}
                    required
                  />
                </div>
              </>
            )}

            {(mode === "signin" || mode === "signup") && (
              <div>
                <label htmlFor="authPassword" className={labelClass}>Password</label>
                <input
                  id="authPassword"
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field"
                  placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                  minLength={8}
                  required
                />
              </div>
            )}

            {error && (
              <div className="rounded-lg border-2 border-red-500/70 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            {message && !error && (
              <div className="rounded-lg border-2 border-nav bg-surface-3 px-3 py-2 text-xs text-text-primary">
                {message}
              </div>
            )}

            <button type="submit" disabled={isSubmitting} className="btn-primary w-full disabled:opacity-60">
              {submitLabel}
            </button>

            {mode === "signin" && (
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="w-full text-center text-xs text-text-secondary hover:text-text-primary"
              >
                Forgot your password?
              </button>
            )}
          </form>

          {/* Toggle line at the bottom */}
          <div className="mt-6 border-t-2 border-border-subtle pt-4 text-center text-sm text-text-secondary">
            {mode === "signin" && (
              <>
                New here?{" "}
                <button type="button" onClick={() => switchMode("signup")} className="font-display font-extrabold uppercase tracking-tight text-accent hover:underline">
                  Sign up
                </button>
              </>
            )}
            {mode === "signup" && (
              <>
                Already funky?{" "}
                <button type="button" onClick={() => switchMode("signin")} className="font-display font-extrabold uppercase tracking-tight text-accent hover:underline">
                  Sign in
                </button>
              </>
            )}
            {isForgotFlow && (
              <button type="button" onClick={() => switchMode("signin")} className="font-display font-extrabold uppercase tracking-tight text-accent hover:underline">
                ← Back to sign in
              </button>
            )}
          </div>
        </section>
      </motion.div>
    </div>
  );
};

export default AuthPage;
