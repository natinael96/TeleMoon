import { useEffect, useRef, useState } from "react";
import { api, token, savedUser } from "./api.js";
import { Crescent, TelegramIcon } from "./icons.jsx";
import AuthCanvas from "./AuthCanvas.jsx";

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [st, setSt] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const handleRef = useRef(null);

  const botHandle = st?.botUsername ? `@${st.botUsername.replace(/^@/, "")}` : "@Telemoon2bot";
  const botUrl = `https://t.me/${botHandle.replace(/^@/, "")}`;

  useEffect(() => {
    api.publicStatus().then(setSt).catch(() => {});
  }, []);

  useEffect(() => {
    if (window.matchMedia("(min-width: 721px) and (pointer: fine)").matches) {
      handleRef.current?.focus({ preventScroll: true });
    }
  }, [mode]);

  const needInvite = mode === "signup" && !!st && st.users > 0 && st.inviteRequired;

  async function submit(e) {
    e.preventDefault();
    setErr("");

    if (mode === "signup" && password !== confirmPassword) {
      setErr("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const res = await api.enter({
        handle,
        password,
        invite: mode === "signup" ? invite : undefined,
      });
      token.clear();
      savedUser.set(res.user);
      onAuth(res.user);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split-landing">
      {/* Background Liquid & Flying Telegram Canvas */}
      <AuthCanvas />

      {/* Left side: Editorial / Written content */}
      <section className="landing-left">
        <div className="landing-top-bar">
          <div className="landing-brand">
            <Crescent size={28} />
            <span>TeleMoon</span>
          </div>
          <a
            href={botUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="bot-badge"
            title={`Open ${botHandle} on Telegram`}
          >
            <TelegramIcon size={14} />
            <span>{botHandle}</span>
          </a>
        </div>

        <div className="left-content">
          <span className="section-label">TELEGRAM STORAGE VFS</span>
          <h1>Your Telegram channel as a <em>private drive.</em></h1>
          <p className="left-desc">
            Upload files from your browser. TeleMoon splits large files and stores the chunks in your private Telegram channel. Browse, stream, and download your files whenever you need them.
          </p>

          <div className="left-features">
            <div className="feature-row">
              <span className="feature-num">01</span>
              <div className="feature-info">
                <h3>Private Channel Storage</h3>
                <p>
                  Telegram stores your files. Create a private channel and add{" "}
                  <a
                    href={botUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="accent-link"
                  >
                    <b>{botHandle}</b>
                  </a>{" "}
                  as admin to start storing. You keep full ownership.
                </p>
              </div>
            </div>

            <div className="feature-row">
              <span className="feature-num">02</span>
              <div className="feature-info">
                <h3>Password Encryption</h3>
                <p>Encrypt files in your browser before uploading them to Telegram.</p>
              </div>
            </div>

            <div className="feature-row">
              <span className="feature-num">03</span>
              <div className="feature-info">
                <h3>Drive System</h3>
                <p>Folders, video streaming with range requests, search, and download links.</p>
              </div>
            </div>
          </div>
        </div>

        <footer className="left-foot">
          <span>TeleMoon</span>
          <a
            href={botUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="bot-foot-link"
            title={`Open ${botHandle} on Telegram`}
          >
            <TelegramIcon size={13} />
            <span>Telegram Bot: {botHandle}</span>
          </a>
          <span>Telegram Virtual File System</span>
        </footer>
      </section>

      {/* Right side: Auth Box with Sign In / Sign Up tabs */}
      <section className="landing-right">
        <div className="auth-box">
          <div className="auth-tabs" role="tablist" aria-label="Account options">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signin"}
              className={`auth-tab ${mode === "signin" ? "active" : ""}`}
              onClick={() => { setMode("signin"); setErr(""); }}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              className={`auth-tab ${mode === "signup" ? "active" : ""}`}
              onClick={() => { setMode("signup"); setErr(""); }}
            >
              Sign Up
            </button>
          </div>

          <form className="auth-body" onSubmit={submit}>
            <div>
              <h2>{mode === "signin" ? "Sign In" : "Create Account"}</h2>
              <p className="auth-sub">
                {mode === "signin"
                  ? "Enter your handle and password to access your drive."
                  : "Choose a handle and password for your storage."}
              </p>
            </div>

            <div className="form-fields">
              <label className="field-group">
                <span className="field-label">Handle</span>
                <div className="at-field">
                  <span aria-hidden="true">@</span>
                  <input
                    ref={handleRef}
                    value={handle}
                    placeholder="username"
                    onChange={(e) => setHandle(e.target.value.replace(/^@/, ""))}
                    required
                    autoComplete="username"
                    spellCheck={false}
                    autoCapitalize="none"
                  />
                </div>
              </label>

              <label className="field-group">
                <span className="field-label">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                />
              </label>

              {mode === "signup" && (
                <label className="field-group">
                  <span className="field-label">Confirm Password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                </label>
              )}

              {needInvite && (
                <label className="field-group">
                  <span className="field-label">Invite Code</span>
                  <input
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                    placeholder="Required for registration"
                    required
                  />
                </label>
              )}

              {err && <div className="auth-err" role="alert">{err}</div>}

              <button className="btn btn-moon auth-submit" disabled={busy}>
                {busy
                  ? "Working..."
                  : mode === "signin"
                    ? "Sign In"
                    : "Create Account"}
              </button>
            </div>

            <p className="auth-switch-note">
              {mode === "signin" ? (
                <>
                  Need an account?
                  <button
                    type="button"
                    className="switch-btn"
                    onClick={() => { setMode("signup"); setErr(""); }}
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already registered?
                  <button
                    type="button"
                    className="switch-btn"
                    onClick={() => { setMode("signin"); setErr(""); }}
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}
