import { useEffect, useState } from "react";
import { api, savedUser } from "./api.js";
import { Crescent, LinkIcon, MegaphoneIcon, UsersIcon, TelegramIcon, CopyIcon, CheckIcon } from "./icons.jsx";

// Link a storage channel: paste a private t.me/+ link (user session joins it),
// an @name, or a -100 id, or select from channels this account already has.
export default function Connect({ status, canSkip, onDone, onLogout }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dialogs, setDialogs] = useState(null);
  const [dlgErr, setDlgErr] = useState("");
  const [copiedHandle, setCopiedHandle] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const offline = !status.mode; // no Telegram client at all

  const botHandle = status?.botUsername ? `@${status.botUsername.replace(/^@/, "")}` : "@Telemoon2bot";
  const botUrl = `https://t.me/${botHandle.replace(/^@/, "")}`;

  function copyHandle() {
    navigator.clipboard?.writeText(botHandle);
    setCopiedHandle(true);
    setTimeout(() => setCopiedHandle(false), 2000);
  }

  function copyLink() {
    navigator.clipboard?.writeText(botUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  useEffect(() => {
    if (offline) return;
    api.dialogs()
      .then((d) => setDialogs(d.dialogs))
      .catch((e) => setDlgErr(e.message));
  }, [offline]);

  async function connect(ref) {
    setBusy(true); setErr("");
    try {
      await api.saveChannel(ref);
      
      // Update local storage so the UI knows they have a channel
      const u = savedUser.get();
      if (u) savedUser.set({ ...u, channel_id: ref });
      
      onDone();
    }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="connect-wrap">
      <div className="connect-head">
        <div className="brand"><Crescent /><span>TeleMoon</span></div>
        <div>
          {canSkip && <button className="ghost" onClick={onDone}>Back to drive</button>}
          <button className="ghost" onClick={onLogout}>Sign out</button>
        </div>
      </div>

      <div className="connect-main">
        <span className="section-label">STORAGE SETUP</span>
        <h1>Link Telegram Storage</h1>
        <p className="connect-subtitle">
          {canSkip
            ? <>Currently linked to <b>{status.channel}</b>. Switching channels does not move files already stored there.</>
            : "Point TeleMoon at a private Telegram channel. That is where your files will live."}
        </p>

        {/* Dedicated Bot Callout Card */}
        <div className="bot-callout">
          <div className="bot-callout-info">
            <div className="bot-callout-icon">
              <TelegramIcon size={24} />
            </div>
            <div className="bot-callout-text">
              <span className="bot-callout-label">REQUIRED TELEGRAM BOT</span>
              <div className="bot-callout-name">
                <a
                  href={botUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bot-name-link"
                >
                  {botHandle}
                </a>
              </div>
              <p className="bot-callout-desc">
                Add <b>{botHandle}</b> as an administrator with posting rights to your private channel.
              </p>
            </div>
          </div>
          <div className="bot-callout-actions">
            <button
              type="button"
              className="btn ghost bot-copy-btn"
              onClick={copyHandle}
              title={`Copy handle ${botHandle}`}
            >
              {copiedHandle ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              <span>{copiedHandle ? "Handle Copied" : "Copy @Handle"}</span>
            </button>
            <button
              type="button"
              className="btn ghost bot-copy-btn"
              onClick={copyLink}
              title={`Copy bot link: ${botUrl}`}
            >
              {copiedLink ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              <span>{copiedLink ? "Link Copied" : "Copy Link"}</span>
            </button>
            <a
              href={botUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-moon bot-action-btn"
            >
              Open in Telegram ↗
            </a>
          </div>
        </div>

        {offline ? (
          <div className="notice-box">
            <p><b>Telegram is offline on the server.</b></p>
            <p className="dim">{status.error}</p>
            <p className="dim">
              Add TG_API_ID, TG_API_HASH, and a bot token to <span className="mono">server/.env</span>, then restart the server.
            </p>
          </div>
        ) : (
          <form className="linkbox" onSubmit={(e) => { e.preventDefault(); connect(link); }}>
            <LinkIcon />
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste channel post link (e.g. https://t.me/c/1234567890/1), @channel, or chat ID"
              spellCheck={false} autoFocus
            />
            <button className="btn btn-moon" disabled={busy || !link.trim()}>
              {busy ? "Linking..." : "Connect"}
            </button>
          </form>
        )}
        {err && <p className="auth-err" role="alert">{err}</p>}

        <div className="connect-steps">
          <h2>How to connect your private channel</h2>
          <div className="steps-list">
            <div className="step-item">
              <span className="step-num">01</span>
              <div>
                <strong>Create Private Channel</strong>
                <p>Open Telegram and create a new private channel dedicated to your cloud storage.</p>
              </div>
            </div>
            <div className="step-item">
              <span className="step-num">02</span>
              <div>
                <strong>Add {botHandle} as Admin</strong>
                <p>
                  In your channel settings, add{" "}
                  <a
                    href={botUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="accent-link"
                  >
                    <b>{botHandle}</b>
                  </a>{" "}
                  as an administrator with "Post Messages" permission.
                </p>
              </div>
            </div>
            <div className="step-item">
              <span className="step-num">03</span>
              <div>
                <strong>Copy a Post Link</strong>
                <p>Send any test message into your channel, right-click (or tap) it, and choose "Copy Post Link".</p>
              </div>
            </div>
            <div className="step-item">
              <span className="step-num">04</span>
              <div>
                <strong>Paste &amp; Connect</strong>
                <p>Paste the copied post link into the box above and click Connect to link your storage.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!offline && status.mode !== "bot" && (
        <section className="dialogs">
          <h2>Your channels and groups</h2>
          {dialogs === null && !dlgErr && <p className="dim">Loading channels...</p>}
          {dlgErr && (
            <div className="notice-box">
              <p className="dim">{dlgErr}</p>
            </div>
          )}
          {dialogs && dialogs.length === 0 && <p className="dim">No channels found on this account.</p>}
          {dialogs && dialogs.length > 0 && (
            <div className="cards">
              {dialogs.map((d) => (
                <button key={d.id} disabled={busy}
                  className={`card pick ${d.current ? "current" : ""}`}
                  onClick={() => connect(d.id)} title={d.title}>
                  <div className="card-ico">{d.group ? <UsersIcon /> : <MegaphoneIcon />}</div>
                  <div className="card-name">{d.title}</div>
                  <div className="card-meta mono dim" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>{d.username ? `@${d.username}` : "private"} · {d.group ? "group" : "channel"}</span>
                    {d.current && <span className="pill-tag pill-tag-green">Linked</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

