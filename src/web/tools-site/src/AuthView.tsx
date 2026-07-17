import React, { useState } from "react";

type Mode = "signin" | "signup" | "forgot" | "forgot-confirm";

interface Props {
  notice: string | null;
  onSuccess: () => void;
  onBack: () => void;
}

const AuthView: React.FC<Props> = ({ notice, onSuccess, onBack }) => {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
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
      setError("Auth is not configured.");
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
          w.auth.forgotPassword(trimmedEmail, (err: any) => (err ? reject(err) : resolve()));
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
          w.auth.confirmForgotPassword(trimmedEmail, trimmedCode, newPassword, (err: any) =>
            err ? reject(err) : resolve()
          );
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
          w.auth.signIn(trimmedEmail, trimmedPassword, (err: any) => (err ? reject(err) : resolve()));
        });
        setMessage("Signed in successfully.");
        onSuccess();
      } else {
        await new Promise<void>((resolve, reject) => {
          w.auth.signUp(trimmedEmail, trimmedPassword, (err: any) => (err ? reject(err) : resolve()));
        });
        setMessage("Account created successfully. You can now sign in.");
        setMode("signin");
      }
    } catch (err: any) {
      setError(err?.message || "Authentication failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isForgotFlow = mode === "forgot" || mode === "forgot-confirm";
  const heading =
    mode === "signin" ? "Sign in" : mode === "signup" ? "Sign up" : mode === "forgot" ? "Reset password" : "New password";
  const submitLabel = isSubmitting
    ? "Working…"
    : mode === "signin"
      ? "Sign in"
      : mode === "signup"
        ? "Create account"
        : mode === "forgot"
          ? "Send code"
          : "Reset password";

  return (
    <section className="auth-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="auth-heading">{heading}</h1>

      {notice && <div className="banner banner-warn">{notice}</div>}

      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={mode === "forgot-confirm"}
            required
          />
        </label>

        {mode === "forgot-confirm" && (
          <>
            <label className="field">
              <span>Verification code</span>
              <input
                type="text"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>New password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
          </>
        )}

        {(mode === "signin" || mode === "signup") && (
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
        )}

        {error && <div className="banner banner-error">{error}</div>}
        {message && !error && <div className="banner banner-info">{message}</div>}

        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {submitLabel}
        </button>

        {mode === "signin" && (
          <button type="button" className="btn-link" onClick={() => switchMode("forgot")}>
            Forgot your password?
          </button>
        )}
      </form>

      <div className="auth-switch">
        {mode === "signin" && (
          <button type="button" className="btn-link" onClick={() => switchMode("signup")}>
            New here? Sign up
          </button>
        )}
        {mode === "signup" && (
          <button type="button" className="btn-link" onClick={() => switchMode("signin")}>
            Already have an account? Sign in
          </button>
        )}
        {isForgotFlow && (
          <button type="button" className="btn-link" onClick={() => switchMode("signin")}>
            &larr; Back to sign in
          </button>
        )}
      </div>
    </section>
  );
};

export default AuthView;
