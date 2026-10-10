import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, uploadFile } from "./api.js";
import { decryptBlob } from "./crypto.js";
import {
  Crescent, MoonProgress, iconFor, UploadIcon, PlusIcon, SearchIcon,
  DownloadIcon, TrashIcon, EditIcon, XIcon, LogoutIcon, ChevR, ShareIcon,
  RestoreIcon, FolderIcon, MoveIcon, LockIcon, ShieldIcon, TelegramIcon,
} from "./icons.jsx";
import { VoxideAssistant, VoxideTelemetryBadge } from "./VoxideAssistant.jsx";

const fmtBytes = (n) => {
  if (n === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log2(n) / 10), u.length - 1);
  return `${(n / 2 ** (10 * i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};
const fmtDate = (t) =>
  new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const focusableSelector = [
  "a[href]", "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
].join(",");

function ModalShell({ title, onClose, children, className = "", initialFocusRef, headerActions }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      const requested = initialFocusRef?.current;
      const fallback = dialogRef.current?.querySelector(focusableSelector);
      (requested || fallback)?.focus({ preventScroll: true });
    });
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll(focusableSelector)]
        .filter((element) => element.getClientRects().length > 0);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = priorOverflow;
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [initialFocusRef]);

  return (
    <div className="modal" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className={`modal-card ${className}`.trim()}
        role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <h2 id={titleId} className="upname">{title}</h2>
          <div className="modal-head-actions">
            {headerActions}
            <kbd style={{ fontSize: "0.72rem", color: "var(--muted)" }}>esc</kbd>
            <button type="button" className="ghost icon-btn" onClick={onClose} aria-label="Close dialog">
              <XIcon />
            </button>
          </div>
        </header>
        {children}
      </section>
    </div>
  );
}

function ActionModal({ modal, onClose, onConfirm }) {
  const [val, setVal] = useState(modal.node?.name || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (modal.type === "rename" && inputRef.current) inputRef.current.select();
  }, [modal.type]);

  const submit = async (e) => {
    e?.preventDefault();
    setErr("");
    if (!["remove", "purge", "emptyTrash"].includes(modal.type) && !val.trim()) return;
    if (modal.type === "encryptPassphrase" && val.trim().length < 6) {
      setErr("Passphrase must be at least 6 characters.");
      return;
    }
    setBusy(true);
    const res = await onConfirm(val.trim());
    if (res) {
      setErr(res);
      setBusy(false);
    }
  };

  const title = modal.type === "mkdir" ? "New folder"
    : modal.type === "rename" ? "Rename"
    : modal.type === "remove" ? "Move to Trash"
    : modal.type === "emptyTrash" ? "Empty Trash"
    : modal.type === "encryptPassphrase" ? "Encryption Passphrase"
    : "Delete permanently";

  return (
    <ModalShell title={title} onClose={onClose} className="action-modal"
      initialFocusRef={["remove", "purge", "emptyTrash"].includes(modal.type) ? cancelRef : inputRef}>
        <div className="modal-body modal-form-body">
          <form className="modal-form" onSubmit={submit}>
            {["remove", "purge", "emptyTrash"].includes(modal.type) ? (
              <p className="modal-message">
                {modal.type === "remove"
                  ? <>Move "{modal.node.name}" to Trash?<br/><span className="dim modal-detail">You can restore it later.</span></>
                  : modal.type === "emptyTrash"
                    ? <>Permanently delete everything in Trash?<br/><span className="dim modal-detail">Telegram copies will also be queued for deletion. This cannot be undone.</span></>
                    : <>Permanently delete "{modal.node.name}"?<br/><span className="dim modal-detail">Its Telegram copies will also be queued for deletion. This cannot be undone.</span></>}
              </p>
            ) : modal.type === "encryptPassphrase" ? (
              <label className="field-label">
                Passphrase for new uploads
                <input
                  ref={inputRef}
                  type="password"
                  value={val}
                  onChange={e => setVal(e.target.value)}
                  placeholder="At least 6 characters"
                  minLength={6}
                  required
                  autoComplete="new-password"
                />
                <span className="dim modal-detail" style={{ display: "block", marginTop: 6 }}>
                  Files will be encrypted with AES-GCM in your browser before uploading to Telegram.
                </span>
              </label>
            ) : (
              <label className="field-label">
                {modal.type === "mkdir" ? "Folder name" : "Name"}
                <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
                  maxLength={255} autoComplete="off" />
              </label>
            )}
            {err && <p className="auth-err" role="alert">{err}</p>}
            <div className="modal-actions">
              <button ref={cancelRef} type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="submit" className={["purge", "emptyTrash"].includes(modal.type) ? "btn" : "btn btn-moon"}
                disabled={busy}
                data-danger={["purge", "emptyTrash"].includes(modal.type) || undefined}>
                {busy ? "Working..." : modal.type === "remove" ? "Move to Trash" : modal.type === "purge" ? "Delete permanently" : modal.type === "emptyTrash" ? "Empty Trash" : modal.type === "encryptPassphrase" ? "Enable Encryption" : "Confirm"}
              </button>
            </div>
          </form>
        </div>
    </ModalShell>
  );
}

function ShareModal({ modal, onClose }) {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expiry, setExpiry] = useState("null");
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [err, setErr] = useState("");

  const loadShares = useCallback(() => {
    api.nodeShares(modal.node.id)
      .then(({ shares }) => setShares(shares))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [modal.node.id]);

  useEffect(() => { loadShares(); }, [loadShares]);

  const createNewShare = async () => {
    setCreating(true); setErr("");
    try {
      const expHours = expiry === "null" ? null : Number(expiry);
      await api.share(modal.node.id, expHours);
      loadShares();
    } catch (e) {
      setErr(e.message);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (shareId) => {
    try {
      await api.revokeShare(shareId);
      setShares((s) => s.filter((item) => item.id !== shareId));
    } catch (e) {
      setErr(e.message);
    }
  };

  const copyUrl = async (shareId) => {
    const url = `${window.location.origin}/api/share/${shareId}/content`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(shareId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setErr("Failed to copy link.");
    }
  };

  return (
    <ModalShell title="Share links" onClose={onClose} className="share-modal">
      <div className="modal-body modal-form-body">
        <p className="modal-message share-message">
          Manage access links for “{modal.node.name}”.
        </p>

        <div className="share-create-row">
          <label className="field-label flex-1">
            Link Expiration
            <select className="share-select" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              <option value="1">1 Hour</option>
              <option value="24">24 Hours (1 Day)</option>
              <option value="168">7 Days</option>
              <option value="720">30 Days</option>
              <option value="null">No Expiration</option>
            </select>
          </label>
          <button className="btn btn-moon share-create-btn" onClick={createNewShare} disabled={creating}>
            {creating ? "Creating..." : "Generate Link"}
          </button>
        </div>

        {err && <p className="auth-err share-error" role="alert">{err}</p>}

        <div className="share-list" aria-live="polite">
          {loading && <p className="dim center">Loading shares...</p>}
          {!loading && shares.length === 0 && (
            <p className="dim center">No active share links. Generate one above.</p>
          )}
          {shares.map((s) => {
            const isExpired = s.expires_at && s.expires_at <= Date.now();
            const url = `${window.location.origin}/api/share/${s.id}/content`;
            return (
              <div key={s.id} className={`share-item ${isExpired ? "expired" : ""}`}>
                <div className="share-item-info">
                  <input className="share-input" readOnly value={url} onFocus={(e) => e.target.select()} />
                  <span className="mono dim share-item-meta">
                    {isExpired
                      ? "Expired"
                      : s.expires_at
                        ? `Expires ${new Date(s.expires_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`
                        : "Never expires"}
                  </span>
                </div>
                <div className="share-item-actions">
                  <button className="btn" onClick={() => copyUrl(s.id)} disabled={isExpired}>
                    {copiedId === s.id ? "Copied!" : "Copy"}
                  </button>
                  <button className="ghost danger icon-btn" onClick={() => revoke(s.id)} aria-label="Revoke link">
                    <TrashIcon />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ModalShell>
  );
}

function ScanRepairModal({ onClose }) {
  const [running, setRunning] = useState(true);
  const [report, setReport] = useState(null);
  const [err, setErr] = useState("");

  const startScan = useCallback(() => {
    setRunning(true); setErr(""); setReport(null);
    api.scanChannel()
      .then(setReport)
      .catch((e) => setErr(e.message))
      .finally(() => setRunning(false));
  }, []);

  useEffect(() => { startScan(); }, [startScan]);

  return (
    <ModalShell title="Channel Repair & Scan" onClose={onClose} className="scan-modal">
      <div className="modal-body modal-form-body">
        {running && (
          <div className="center scan-running">
            <Crescent />
            <p className="dim">Scanning Telegram channel history and auditing chunk integrity...</p>
          </div>
        )}
        {err && (
          <div className="notice-box">
            <p className="auth-err">Scan failed: {err}</p>
            <button className="btn btn-moon" onClick={startScan}>Retry</button>
          </div>
        )}
        {report && (
          <div className="scan-results">
            <div className="notice-box">
              <p><b>Channel: {report.channelTitle}</b></p>
              <p className="dim">Audited {report.totalChunksChecked} stored chunks.</p>
            </div>

            <div className="scan-stats-grid">
              <div className="feature-box">
                <h2>Missing Chunks</h2>
                <p className={report.missingChunks.length ? "auth-err" : "dim"}>
                  {report.missingChunks.length === 0 ? "0 (All chunks verified ✓)" : `${report.missingChunks.length} missing in Telegram`}
                </p>
              </div>
              <div className="feature-box">
                <h2>Indexed Files</h2>
                <p className="dim">
                  {report.newlyIndexedFiles.length === 0 ? "0 new files" : `+${report.newlyIndexedFiles.length} imported into Inbox`}
                </p>
              </div>
            </div>

            {report.missingChunks.length > 0 && (
              <div className="scan-sublist">
                <h3>Missing / Inaccessible Chunks</h3>
                {report.missingChunks.map((c, i) => (
                  <div key={i} className="scan-row auth-err">
                    <span>{c.fileName} (part {c.partIndex + 1})</span>
                    <span className="mono dim">msg {c.msgId}</span>
                  </div>
                ))}
              </div>
            )}

            {report.newlyIndexedFiles.length > 0 && (
              <div className="scan-sublist">
                <h3>Newly Indexed Telegram Files</h3>
                {report.newlyIndexedFiles.map((f) => (
                  <div key={f.id} className="scan-row">
                    <span>{f.name}</span>
                    <span className="mono dim">{fmtBytes(f.size)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={startScan}>Re-scan</button>
              <button className="btn btn-moon" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function DecryptModal({ node, onClose, onDecrypted }) {
  const [passphrase, setPassphrase] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!passphrase) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch(api.fileUrl(node.id));
      if (!res.ok) throw new Error("Could not download encrypted file");
      const blob = await res.blob();
      const decrypted = await decryptBlob(blob, passphrase);
      onDecrypted(decrypted);
    } catch (ex) {
      setErr(ex.message.includes("operation failed") ? "Wrong passphrase or corrupted file" : ex.message);
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`Unlock “${node.name}”`} onClose={onClose} className="action-modal" initialFocusRef={inputRef}>
      <div className="modal-body modal-form-body">
        <form className="modal-form" onSubmit={submit}>
          <p className="modal-message">
            This file is protected with client-side AES-GCM encryption. Enter the passphrase to unlock it.
          </p>
          <label className="field-label">
            Passphrase
            <input ref={inputRef} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter passphrase" required />
          </label>
          {err && <p className="auth-err" role="alert">{err}</p>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-moon" disabled={busy || !passphrase}>
              {busy ? "Decrypting..." : "Unlock"}
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}

function MoveModal({ node, onClose, onMoved }) {
  const [folderId, setFolderId] = useState("root");
  const [view, setView] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setView(null);
    setErr("");
    api.children(folderId)
      .then((next) => active && setView(next))
      .catch((error) => active && setErr(error.message));
    return () => { active = false; };
  }, [folderId]);

  const moveHere = async () => {
    setBusy(true);
    setErr("");
    try {
      await api.move(node.id, folderId);
      onMoved();
    } catch (error) {
      setErr(error.message);
      setBusy(false);
    }
  };

  const folders = (view?.children || []).filter((item) => item.type === "folder" && item.id !== node.id);
  const currentName = view?.folder?.name || "Home";

  return (
    <ModalShell title={`Move “${node.name}”`} onClose={onClose} className="move-modal">
      <div className="modal-body move-body">
        <nav className="move-crumbs" aria-label="Destination folder">
          {(view?.breadcrumb || [{ id: "root", name: "Home" }]).map((crumb, index, all) => (
            <span key={crumb.id} className="crumb-wrap">
              {index > 0 && <ChevR />}
              <button className={`crumb ${index === all.length - 1 ? "on" : ""}`}
                onClick={() => setFolderId(crumb.id)}>{crumb.name}</button>
            </span>
          ))}
        </nav>
        <div className="move-list" aria-live="polite">
          {!view && !err && <p className="dim move-state">Reading folders...</p>}
          {view && folders.length === 0 && <p className="dim move-state">No folders inside {currentName}.</p>}
          {folders.map((folder) => (
            <button key={folder.id} className="move-folder" onClick={() => setFolderId(folder.id)}>
              <FolderIcon className="c-moon" />
              <span>{folder.name}</span>
              <ChevR />
            </button>
          ))}
        </div>
        {err && <p className="auth-err" role="alert">{err}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-moon" onClick={moveHere}
            disabled={busy || !view || folderId === node.parent_id}>
            {busy ? "Moving..." : folderId === node.parent_id ? "Already here" : `Move to ${currentName}`}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export default function Drive({ user, onLogout, onStorage }) {
  const [stack, setStack] = useState([{ id: "root", name: "Home" }]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [trashMode, setTrashMode] = useState(false);
  const [uploads, setUploads] = useState([]); // {key,name,pct,part,parts,status,handle}
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(null);
  const botHandle = status?.botUsername ? `@${status.botUsername.replace(/^@/, "")}` : "@Telemoon2bot";
  const botUrl = `https://t.me/${botHandle.replace(/^@/, "")}`;
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const resumeInput = useRef(null);
  const resumeTarget = useRef(null);
  const searchInput = useRef(null);
  const queue = useRef(Promise.resolve());
  const refreshRun = useRef(0);
  const cwd = stack[stack.length - 1];

  useEffect(() => {
    function onKeyDown(e) {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInput.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const refresh = useCallback(async () => {
    const run = ++refreshRun.current;
    setLoading(true); setError("");
    try {
      if (trashMode) {
        const { items } = await api.trash();
        if (run !== refreshRun.current) return;
        setItems(items); setSearching(false);
      } else if (debouncedQ) {
        const { results } = await api.search(debouncedQ);
        if (run !== refreshRun.current) return;
        setItems(results); setSearching(true);
      } else {
        const { children } = await api.children(cwd.id);
        if (run !== refreshRun.current) return;
        setItems(children); setSearching(false);
      }
    } catch (e) {
      if (run === refreshRun.current) setError(e.message);
    } finally {
      if (run === refreshRun.current) setLoading(false);
    }
  }, [cwd.id, debouncedQ, trashMode]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
    const t = setInterval(() => api.status().then(setStatus).catch(() => {}), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    api.uploads().then(({ uploads: pending }) => {
      setUploads((current) => {
        const known = new Set(current.map((item) => item.handle?.uploadId).filter(Boolean));
        const recovered = pending.filter((upload) => !known.has(upload.id)).map((upload) => ({
          key: `resume_${upload.id}`,
          name: upload.name,
          pct: upload.size ? (100 * upload.uploadedBytes) / upload.size : 100,
          part: upload.parts.length,
          parts: upload.size ? Math.ceil(upload.size / upload.chunkSize) : 0,
          status: "interrupted",
          handle: { uploadId: upload.id },
          session: upload,
        }));
        return [...current, ...recovered];
      });
    }).catch(() => {});
  }, []);

  const [encryptNext, setEncryptNext] = useState(false);
  const [encryptPassphrase, setEncryptPassphrase] = useState("");

  async function open(node) {
    if (trashMode) return;
    if (node.type === "folder") {
      setQ("");
      const { breadcrumb } = await api.children(node.id);
      setStack(breadcrumb);
    } else if (node.encrypted === 1) {
      setModal({ type: "decrypt", node });
    } else {
      setPreview(node);
    }
  }

  const folderCache = useRef({});

  function enqueue(items, emptyFolders = []) {
    const parentId = cwd.id;
    const currentPassphrase = encryptNext ? encryptPassphrase : "";
    
    // Process empty folders first
    if (emptyFolders.length > 0) {
      queue.current = queue.current.then(async () => {
        for (let relativePath of emptyFolders) {
          relativePath = relativePath.replace(/\\/g, '/');
          const parts = relativePath.split('/').filter(Boolean);
          let currentId = parentId;
          for (const part of parts) {
            const cacheKey = `${currentId}/${part}`;
            if (folderCache.current[cacheKey]) {
              currentId = folderCache.current[cacheKey];
            } else {
              const res = await api.children(currentId);
              let found = res.children.find(c => c.type === 'folder' && c.name === part);
              if (!found) found = await api.mkdir(currentId, part);
              folderCache.current[cacheKey] = found.id;
              currentId = found.id;
            }
          }
        }
        refresh();
      });
    }

    for (const item of items) {
      const file = item.file || item;
      const key = `${Date.now()}_${file.name}_${Math.random()}`;
      const handle = { passphrase: currentPassphrase };
      setUploads((u) => [...u, { key, name: file.name, pct: 0, part: 0, parts: 1, status: "queued", handle, file }]);
      queue.current = queue.current.then(async () => {
        if (handle.cancelled) return;
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, status: "up" } : x)));
        try {
          let targetFolderId = parentId;
          let relativePath = item.path || file.webkitRelativePath;
          if (relativePath) {
            relativePath = relativePath.replace(/\\/g, '/');
            const parts = relativePath.split('/').filter(Boolean);
            parts.pop(); // remove the filename itself
            let currentId = parentId;
            for (const part of parts) {
              const cacheKey = `${currentId}/${part}`;
              if (folderCache.current[cacheKey]) {
                currentId = folderCache.current[cacheKey];
              } else {
                const res = await api.children(currentId);
                let found = res.children.find(c => c.type === 'folder' && c.name === part);
                if (!found) found = await api.mkdir(currentId, part);
                folderCache.current[cacheKey] = found.id;
                currentId = found.id;
              }
            }
            targetFolderId = currentId;
          }
          await uploadFile(file, targetFolderId, ({ loaded, total, part, parts }) => {
            setUploads((u) => u.map((x) => x.key === key
              ? { ...x, pct: total ? (100 * loaded) / total : 100, part, parts } : x));
          }, handle, null, currentPassphrase);
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, pct: 100, status: "done" } : x)));
          refresh();
          setTimeout(() => setUploads((u) => u.filter((x) => x.key !== key)), 5000);
        } catch (e) {
          setUploads((u) => u.map((x) => x.key === key
            ? { ...x, status: e.cancelled ? "cancelled" : "error", err: e.message } : x));
        }
      });
    }
  }

  function continueUpload(item, file) {
    const expected = item.session;
    if (expected && (
      file.name !== expected.name ||
      (expected.lastModified && file.lastModified !== expected.lastModified)
    )) {
      setUploads((all) => all.map((entry) => entry.key === item.key
        ? { ...entry, status: "error", err: "Select the same file (name and modified date must match)." }
        : entry));
      return;
    }
    item.handle.cancelled = false;
    setUploads((all) => all.map((entry) => entry.key === item.key
      ? { ...entry, file, status: "queued", err: "" } : entry));
    queue.current = queue.current.then(async () => {
      setUploads((all) => all.map((entry) => entry.key === item.key ? { ...entry, status: "up" } : entry));
      try {
        const session = await api.upload(item.handle.uploadId);
        if (session.status === "completed") {
          await api.completeUpload(session.id);
        } else {
          await uploadFile(file, session.parentId, ({ loaded, total, part, parts }) => {
            setUploads((all) => all.map((entry) => entry.key === item.key
              ? { ...entry, pct: total ? (100 * loaded) / total : 100, part, parts, session }
              : entry));
          }, item.handle, session, item.handle.passphrase || "");
        }
        setUploads((all) => all.map((entry) => entry.key === item.key
          ? { ...entry, pct: 100, status: "done" } : entry));
        refresh();
        setTimeout(() => setUploads((all) => all.filter((entry) => entry.key !== item.key)), 5000);
      } catch (e) {
        setUploads((all) => all.map((entry) => entry.key === item.key
          ? { ...entry, status: e.cancelled ? "cancelled" : "error", err: e.message }
          : entry));
      }
    });
  }

  function chooseResume(item) {
    if (item.file) return continueUpload(item, item.file);
    resumeTarget.current = item;
    resumeInput.current?.click();
  }

  const cancelUpload = async (item) => {
    item.handle.cancelled = true;
    item.handle.xhr?.abort();
    setUploads((u) => u.filter((x) => x.key !== item.key));
    if (item.handle.uploadId) await api.abortUpload(item.handle.uploadId).catch(() => {});
  };

  const [modal, setModal] = useState(null);

  function mkdir() { setModal({ type: "mkdir" }); }
  function rename(node) { setModal({ type: "rename", node }); }
  function move(node) { setModal({ type: "move", node }); }
  function remove(node) { setModal({ type: "remove", node }); }
  function purge(node) { setModal({ type: "purge", node }); }
  async function restore(node) {
    try { await api.restore(node.id); refresh(); }
    catch (e) { setError(e.message); }
  }
  function share(node) {
    setModal({ type: "share", node });
  }

  /* OS file drop vs internal row drag */
  const isOsDrag = (e) => [...(e.dataTransfer?.types || [])].some(t => t.toLowerCase() === "files");
  async function onDrop(e) {
    e.preventDefault(); setDragOver(false);
    if (trashMode) return;
    if (!isOsDrag(e)) return;
    
    // Fallback if items not supported
    if (!e.dataTransfer.items) return enqueue([...e.dataTransfer.files]);
    
    const items = [...e.dataTransfer.items].filter(i => i.kind === "file");
    const filesToUpload = [];
    const emptyFolders = [];

    const readEntry = async (entry, path = "") => {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        filesToUpload.push({ file, path: path + file.name });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let entries = [];
        let hasMore = true;
        while (hasMore) {
          const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          if (batch.length === 0) hasMore = false;
          else entries.push(...batch);
        }
        if (entries.length === 0) {
          emptyFolders.push(path + entry.name);
        } else {
          for (const e of entries) await readEntry(e, path + entry.name + "/");
        }
      }
    };

    try {
      for (const item of items) {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry) await readEntry(entry);
        else filesToUpload.push({ file: item.getAsFile(), path: "" });
      }
      enqueue(filesToUpload, emptyFolders);
    } catch (err) {
      setError(`Could not read that dropped folder: ${err.message}`);
    }
  }
  async function dropOnFolder(e, folder) {
    e.preventDefault(); e.stopPropagation();
    const id = e.dataTransfer.getData("application/x-telemoon-node");
    if (!id || id === folder.id) return;
    try { await api.move(id, folder.id); refresh(); }
    catch (ex) { setError(`Could not move that item: ${ex.message}`); }
  }

  const previewable = (n) =>
    /^image\/|^video\/|^audio\/|^application\/pdf$/.test(n.mime || "");

  const driveContext = {
    stack,
    setStack,
    cwd,
    items,
    q,
    setQ,
    trashMode,
    setTrashMode,
    encryptUploads: encryptNext,
    setEncryptUploads: (val) => {
      if (val && !encryptPassphrase) {
        setModal({ type: "encryptPassphrase" });
      } else {
        setEncryptNext(val);
      }
    },
    encryptPassphrase,
    status,
    setModal,
    onOpenFolder: (folder) => {
      setQ("");
      setStack((s) => [...s, folder]);
    },
    createFolder: (name) => api.mkdir(cwd.id, name).then(() => refresh()),
    trashNode: async (node) => {
      await api.del(node.id);
      refresh();
    },
  };

  return (
    <div className="app"
      onDragOver={(e) => { if (isOsDrag(e)) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOver(false); }}
      onDrop={onDrop}>

      <header className="topbar">
        <div className="brand"><Crescent size={22} /><span>TeleMoon</span></div>
        <div className="searchbox" onClick={() => searchInput.current?.focus()}>
          <SearchIcon />
          <input
            ref={searchInput}
            placeholder={trashMode ? "Search is unavailable in Trash" : "Search files..."}
            value={q}
            disabled={trashMode}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
          {!q && <kbd className="search-kbd" title="Press / to search">/</kbd>}
          {q && <button className="ghost icon-btn" onClick={() => setQ("")} aria-label="Clear search"><XIcon /></button>}
        </div>
        <div className="top-actions">
          {trashMode ? (
            <>
              {items.length > 0 && <button className="btn danger-btn" onClick={() => setModal({ type: "emptyTrash" })}><TrashIcon /> Empty Trash</button>}
              <button className="btn btn-moon" onClick={() => setTrashMode(false)}>Back to drive</button>
            </>
          ) : (
            <>
              <label className="topbar-encrypt-toggle" title="Encrypt uploads with AES-GCM before sending to Telegram">
                <input type="checkbox" checked={encryptNext} onChange={(e) => {
                  if (e.target.checked) {
                    if (!encryptPassphrase) {
                      setModal({ type: "encryptPassphrase" });
                    } else {
                      setEncryptNext(true);
                    }
                  } else {
                    setEncryptNext(false);
                  }
                }} />
                <LockIcon /> <span>Encrypt</span>
              </label>
              <button className="btn" onClick={mkdir}><PlusIcon /> New folder</button>
              <button className="btn" onClick={() => folderInput.current.click()}><UploadIcon /> Folder</button>
              <input ref={folderInput} type="file" multiple webkitdirectory="true" hidden
                onChange={(e) => { enqueue([...e.target.files]); e.target.value = ""; }} />
              <button className="btn btn-moon" onClick={() => fileInput.current.click()}><UploadIcon /> File</button>
              <input ref={fileInput} type="file" multiple hidden
                onChange={(e) => { enqueue([...e.target.files]); e.target.value = ""; }} />
              <button className="btn" onClick={() => { setQ(""); setTrashMode(true); }}><TrashIcon /> Trash</button>
            </>
          )}
          <a
            href={botUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn ghost bot-top-link"
            title={`Telegram Bot: ${botHandle}`}
          >
            <TelegramIcon size={14} />
            <span className="bot-top-label">{botHandle}</span>
          </a>
          <input ref={resumeInput} type="file" hidden onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && resumeTarget.current) continueUpload(resumeTarget.current, file);
            resumeTarget.current = null;
            e.target.value = "";
          }} />
          <button className="ghost user" aria-label={`Sign out @${user.handle}`} onClick={onLogout}>
            <span className="avatar">{user.handle?.[0]?.toUpperCase() || "@"}</span>
            <LogoutIcon />
          </button>
        </div>
      </header>

      <nav className="crumbs" aria-label="Breadcrumb">
        <div className="crumbs-trail">
          {trashMode ? (
            <span className="crumb on">Trash</span>
          ) : searching ? (
            <span className="crumb on">Search: "{q}"</span>
          ) : stack.map((c, i) => (
            <span key={c.id} className="crumb-wrap">
              {i > 0 && <ChevR />}
              <button className={`crumb ${i === stack.length - 1 ? "on" : ""}`}
                onClick={() => setStack(stack.slice(0, i + 1))}>{c.name}</button>
            </span>
          ))}
        </div>
        {!loading && (
          <div className="crumbs-meta mono dim">
            {items.length} {items.length === 1 ? "item" : "items"}
          </div>
        )}
      </nav>

      <main className="content">
        {loading && <div className="empty" role="status">Loading files...</div>}
        {!loading && error && <div className="empty err" role="alert">{error}</div>}
        {!loading && !error && items.length === 0 && (
          <div className="empty-zone">
            <div className="empty-wireframe">
              <UploadIcon />
              <h3>{trashMode ? "Trash is empty" : searching ? "No matching files" : "Drop files to upload"}</h3>
              <p className="dim">
                {trashMode
                  ? "Deleted files and folders appear here before permanent removal."
                  : searching
                  ? `No files match "${q}". Check your spelling or clear search.`
                  : "Drag and drop files or folders anywhere on the screen."}
              </p>
              {!trashMode && !searching && (
                <button className="btn btn-moon" onClick={() => fileInput.current?.click()}>
                  <UploadIcon /> Select Files
                </button>
              )}
            </div>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="cards">
            {items.map((n) => {
              const Icon = iconFor(n);
              const ext = n.type === "folder" ? "DIR" : (n.name.split(".").pop() || "FILE").toUpperCase().slice(0, 4);
              const cardContent = (
                <>
                  <div className="card-header-meta">
                    <span className="card-type-tag mono">{ext}</span>
                    {n.encrypted === 1 && (
                      <span className="card-lock-badge" title="Encrypted with AES-GCM">
                        <LockIcon /> <span>AES</span>
                      </span>
                    )}
                  </div>
                  <div className="card-ico">
                    {!trashMode && n.type === "file" && !n.encrypted && n.mime?.startsWith("image/") && n.size < 1024 * 1024 ? (
                      <img className="card-thumb" src={api.fileUrl(n.id)} alt="" loading="lazy"
                        decoding="async" width="320" height="180" />
                    ) : (
                      <Icon className={n.type === "folder" ? "c-moon" : "c-mut"} />
                    )}
                  </div>
                  <span className="card-name" title={n.name}>{n.name}</span>
                  <span className="card-meta mono dim">
                    {n.type === "file" ? `${fmtBytes(n.size)} · ` : ""}{fmtDate(n.updated_at)}
                  </span>
                </>
              );
              return (
                <article key={n.id} className="card node"
                  draggable={!trashMode}
                  onDragStart={(e) => e.dataTransfer.setData("application/x-telemoon-node", n.id)}
                  onDragOver={(e) => { if (n.type === "folder" && !isOsDrag(e)) e.preventDefault(); }}
                  onDrop={(e) => n.type === "folder" && dropOnFolder(e, n)}>
                  {trashMode ? (
                    <div className="card-open card-static">{cardContent}</div>
                  ) : (
                    <button className="card-open" onClick={() => open(n)}
                      aria-label={`${n.type === "folder" ? "Open folder" : "Preview file"}: ${n.name}`}>
                      {cardContent}
                    </button>
                  )}
                  <div className="card-acts">
                    {trashMode ? (
                      <>
                        <button className="ghost icon-btn" onClick={() => restore(n)} aria-label={`Restore ${n.name}`}><RestoreIcon /></button>
                        <button className="ghost danger icon-btn" onClick={() => purge(n)} aria-label={`Delete ${n.name} permanently`}><TrashIcon /></button>
                      </>
                    ) : n.type === "file" && (
                      <button className="ghost icon-btn" onClick={() => share(n)} aria-label={`Share ${n.name}`}><ShareIcon /></button>
                    )}
                    {!trashMode && <>
                      <a className="ghost icon-btn" href={n.type === "folder" ? api.folderZipUrl(n.id) : api.fileUrl(n.id, true)}
                        aria-label={`Download ${n.name}`}><DownloadIcon /></a>
                      <button className="ghost icon-btn" onClick={() => rename(n)} aria-label={`Rename ${n.name}`}><EditIcon /></button>
                      <button className="ghost icon-btn" onClick={() => move(n)} aria-label={`Move ${n.name}`}><MoveIcon /></button>
                      <button className="ghost danger icon-btn" onClick={() => remove(n)} aria-label={`Move ${n.name} to Trash`}><TrashIcon /></button>
                    </>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <footer className="statusbar" role="status" aria-live="polite">
        <span className={`dot ${status?.telegram === "connected" ? "ok" : "off"}`} aria-hidden="true" />
        {status?.telegram === "connected"
          ? <><span>MTPROTO ONLINE</span> · Channel: <b>{status.channel}</b> · Chunk: {fmtBytes(status.chunkBytes)}</>
          : <><span>MTPROTO OFFLINE</span>{status?.error ? `: ${status.error}` : ""}</>}
        <a
          href={botUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="statusbar-bot-link"
          title={`Open Telegram bot ${botHandle}`}
        >
          <TelegramIcon size={13} />
          <span>{botHandle}</span>
        </a>
        <VoxideTelemetryBadge />
        <button className="ghost storage-link" onClick={() => setModal({ type: "scan" })}>
          <ShieldIcon /> Repair &amp; Scan
        </button>
        {onStorage && <button className="ghost storage-link" onClick={onStorage}>Storage</button>}
      </footer>

      <VoxideAssistant driveContext={driveContext} />

      {uploads.length > 0 && (
        <aside className="uppanel" aria-label="Uploads" aria-live="polite">
          <h3>Uploads</h3>
          {uploads.map((u) => (
            <div key={u.key} className={`uprow ${u.status}`}>
              <MoonProgress pct={u.pct} />
              <div className="upmeta">
                <span className="upname" title={u.name}>{u.name}</span>
                <span className="mono dim">
                  {u.status === "error" ? `Failed: ${u.err}`
                    : u.status === "interrupted" ? `Ready to resume (${Math.round(u.pct)}%)`
                    : u.status === "done" ? "Stored"
                    : u.parts > 1 ? `Part ${u.part}/${u.parts} (${Math.round(u.pct)}%)`
                    : `${Math.round(u.pct)}%`}
                </span>
              </div>
              {["error", "interrupted"].includes(u.status) && (
                <button className="ghost icon-btn" onClick={() => chooseResume(u)} aria-label={`Resume ${u.name}`}><UploadIcon /></button>
              )}
              {u.status !== "done" && <button className="ghost icon-btn" onClick={() => cancelUpload(u)} aria-label={`Cancel and discard ${u.name}`}><XIcon /></button>}
            </div>
          ))}
        </aside>
      )}

      {modal?.type === "share" ? (
        <ShareModal modal={modal} onClose={() => setModal(null)} />
      ) : modal?.type === "scan" ? (
        <ScanRepairModal onClose={() => { setModal(null); refresh(); }} />
      ) : modal?.type === "decrypt" ? (
        <DecryptModal node={modal.node} onClose={() => setModal(null)} onDecrypted={(blob) => {
          const url = URL.createObjectURL(blob);
          setModal(null);
          setPreview({ ...modal.node, decryptedUrl: url });
        }} />
      ) : modal?.type === "move" ? (
        <MoveModal node={modal.node} onClose={() => setModal(null)} onMoved={() => {
          setModal(null);
          refresh();
        }} />
      ) : modal ? (
        <ActionModal 
          modal={modal}
          onClose={() => {
            if (modal.type === "encryptPassphrase") setEncryptNext(false);
            setModal(null);
          }}
          onConfirm={async (val) => {
            try {
              if (modal.type === "encryptPassphrase") {
                setEncryptPassphrase(val);
                setEncryptNext(true);
                setModal(null);
                return;
              }
              if (modal.type === "mkdir") await api.mkdir(cwd.id, val);
              if (modal.type === "rename") await api.rename(modal.node.id, val);
              if (modal.type === "remove") await api.del(modal.node.id);
              if (modal.type === "purge") await api.purge(modal.node.id);
              if (modal.type === "emptyTrash") await api.emptyTrash();
              refresh();
              setModal(null);
            } catch (e) {
              return e.message;
            }
          }}
        />
      ) : null}

      {preview && (
        <ModalShell title={preview.name} onClose={() => {
          if (preview.decryptedUrl) URL.revokeObjectURL(preview.decryptedUrl);
          setPreview(null);
        }} className="preview-modal"
          headerActions={(
            <a className="btn" href={preview.decryptedUrl || api.fileUrl(preview.id, true)}
              download={preview.name}><DownloadIcon /> Download</a>
          )}>
            <div className="modal-body">
              {preview.mime?.startsWith("image/") && (
                <img src={preview.decryptedUrl || api.fileUrl(preview.id)} alt={preview.name} />
              )}
              {preview.mime?.startsWith("video/") && (
                <video src={preview.decryptedUrl || api.fileUrl(preview.id)} controls />
              )}
              {preview.mime?.startsWith("audio/") && (
                <audio src={preview.decryptedUrl || api.fileUrl(preview.id)} controls />
              )}
              {preview.mime === "application/pdf" && (
                <iframe src={preview.decryptedUrl || api.fileUrl(preview.id)} title={preview.name} />
              )}
              {!previewable(preview) && (
                <p className="dim center">
                  No inline preview for this type · {fmtBytes(preview.size)}
                </p>
              )}
            </div>
        </ModalShell>
      )}

      {dragOver && !trashMode && (
        <div className="dropveil"><Crescent /><p>Release to upload into “{cwd.name}”</p></div>
      )}
    </div>
  );
}
