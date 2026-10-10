import { Router } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import { ZipArchive } from "archiver";
import bcrypt from "bcryptjs";
import { cfg } from "./config.js";
import {
  db, q, now, uid, getNode, getOwnedNode, breadcrumb, children, subtreeIds,
  isAncestor, uniqueName, createFileNode, createShare, getShare, getNodeShares,
  deleteShare, claimLegacyNodes, getActiveStorage, claimLegacyStorage, activateStorage,
} from "./db.js";
import { sign, auth } from "./auth.js";
import {
  tg, sendDocument, deleteMessages, streamRange, scanAndRepairChannel,
} from "./telegram.js";
import { hashPairingCode, newPairingCode } from "./pairing.js";
import { uploadCaption } from "./caption.js";

export const api = Router();
const bad = (res, code, error) => res.status(code).json({ error });
const publicUser = (user) => ({ id: user.id, handle: user.handle, role: user.role });

// Session state and one-time pairing codes must never be stored by browsers,
// reverse proxies, or shared caches.
api.use((req, res, next) => {
  if (
    req.path === "/status" || req.path.startsWith("/auth/")  ||
    req.path.startsWith("/uploads") || req.path.startsWith("/trash")
  )
    res.set("Cache-Control", "no-store");
  next();
});

const sessionCookie = (res, sessionToken) => res.cookie("tm_session", sessionToken, {
  httpOnly: true,
  secure: cfg.secureCookies,
  sameSite: "strict",
  path: "/",
  maxAge: 30 * 24 * 60 * 60 * 1000,
});
const cleanName = (value) => String(value || "").trim().replace(/[/\\\0]/g, "-").slice(0, 255);
const ownedNode = (req, id, options) => getOwnedNode(id, req.user.id, options);
const ownedUpload = (req) =>
  q(`SELECT * FROM uploads WHERE id=? AND user_id=?`).get(req.params.id, req.user.id);
const uploadSummary = (upload) => {
  const parts = q(`SELECT idx,size FROM upload_parts WHERE upload_id=? ORDER BY idx`).all(upload.id);
  return {
    id: upload.id,
    status: upload.status,
    nodeId: upload.node_id,
    name: upload.name,
    size: upload.size,
    mime: upload.mime,
    parentId: upload.parent_id,
    chunkSize: upload.chunk_size,
    lastModified: upload.last_modified,
    createdAt: upload.created_at,
    updatedAt: upload.updated_at, encrypted: upload.encrypted,
    parts,
    uploadedBytes: parts.reduce((sum, part) => sum + part.size, 0),
  };
};

// A small in-process guard is enough for a single TeleMoon instance and avoids
// allowing password guessing at network speed. A reverse proxy can add a
// distributed limiter when the app is scaled horizontally.
const authAttempts = new Map();
function authRateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const time = now();
  const prior = authAttempts.get(key);
  const entry = !prior || prior.resetAt <= time
    ? { count: 0, resetAt: time + 15 * 60 * 1000 }
    : prior;
  entry.count += 1;
  authAttempts.set(key, entry);
  if (entry.count > 20) {
    res.set("Retry-After", String(Math.ceil((entry.resetAt - time) / 1000)));
    return bad(res, 429, "too many sign-in attempts; try again later");
  }
  next();
}

/* ---------------------------------------------------------------- status */

api.get("/health", (_req, res) => res.json({ ok: true }));

api.get("/public-status", (_req, res) => {
  res.json({
    users: q(`SELECT COUNT(*) c FROM users`).get().c,
    botUsername: tg.botUsername || cfg.botUsername || "Telemoon2bot",
  });
});

api.get("/status", auth, (req, res) => {
  const storage = getActiveStorage(req.user.id);
  res.json({
    telegram: !tg.ready ? "offline" : storage ? "connected" : "unlinked",
    mode: tg.mode,
    botUsername: tg.botUsername || cfg.botUsername || "Telemoon2bot",
    channel: storage?.channel_title || null,
    storageId: storage?.id || null,
    storageUpdatedAt: storage?.updated_at || null,
    error: tg.ready ? null : tg.error,
    chunkBytes: cfg.chunkBytes,
    users: q(`SELECT COUNT(*) c FROM users`).get().c,
    canManageStorage: true,
  });
});

/* ------------------------------------------------------------------ auth */
// One door, no signup: a known @handle signs in, an unknown one is claimed
// on the spot (invite-gated for everyone after the first user, if set).

api.post("/auth/enter", authRateLimit, async (req, res) => {
  const { password, invite } = req.body || {};
  const handle = String(req.body?.handle || "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(handle))
    return bad(res, 400, "handle: 3–32 letters, digits or _");
  if (!password || password.length < 6)
    return bad(res, 400, "password: at least 6 characters");

  const user = q(`SELECT * FROM users WHERE handle=?`).get(handle);
  if (user) {
    if (!(await bcrypt.compare(password, user.pass_hash)))
      return bad(res, 401, `wrong password for @${handle}`);
    const token = sign(user);
    sessionCookie(res, token);
    return res.json({ token, user: publicUser(user) });
  }

  const count = q(`SELECT COUNT(*) c FROM users`).get().c;
  const u = {
    id: uid(), handle, pass_hash: await bcrypt.hash(password, 12),
    role: count === 0 ? "owner" : "member", created_at: now(),
  };
  q(`INSERT INTO users(id,handle,pass_hash,role,created_at) VALUES (?,?,?,?,?)`)
    .run(u.id, u.handle, u.pass_hash, u.role, u.created_at);
  if (u.role === "owner") {
    claimLegacyNodes(u.id);
    claimLegacyStorage(u.id);
  }
  const token = sign(u);
  sessionCookie(res, token);
  res.json({ token, user: publicUser(u), created: true });
});

api.get("/auth/me", auth, (req, res) => {
  sessionCookie(res, sign(req.user));
  res.json({ user: publicUser(req.user) });
});
api.post("/auth/logout", (_req, res) => {
  res.clearCookie("tm_session", {
    httpOnly: true, secure: cfg.secureCookies, sameSite: "strict", path: "/",
  });
  res.json({ ok: true });
});

/* ------------------------------------------------------- storage pairing */

api.get("/tg/dialogs", auth, async (req, res) => {
  try {
    const { listDialogs } = await import("./telegram.js");
    const dialogs = await listDialogs();
    res.json({ dialogs });
  } catch (e) {
    console.error("[tg/dialogs error]", e);
    bad(res, e.status || 400, e.message);
  }
});

api.post("/tg/connect", auth, async (req, res) => {
  const { link } = req.body || {};
  if (!link) return bad(res, 400, "link required");
  try {
    const tglib = await import("./telegram.js");
    const channel = await tglib.connectByLink(link);
    const storage = getActiveStorage(req.user.id);
    const newStorage = activateStorage(req.user.id, tglib.telegramChannelId(channel), channel.title || "Telegram channel");
    tg.channels.set(newStorage.id, channel);
    res.json({ ok: true, channel: channel.title || "channel" });
  } catch (e) {
    console.error("[tg/connect error]", e);
    bad(res, e.status || 400, e.message);
  }
});

/* ------------------------------------------------------ virtual filesystem */

api.get("/nodes/:id/children", auth, (req, res) => {
  const folder = ownedNode(req, req.params.id);
  if (!folder || folder.type !== "folder") return bad(res, 404, "folder not found");
  res.json({ folder, breadcrumb: breadcrumb(folder.id, req.user.id), children: children(folder.id, req.user.id) });
});

api.post("/folders", auth, (req, res) => {
  const { parentId, name } = req.body || {};
  const parent = ownedNode(req, parentId);
  if (!parent || parent.type !== "folder") return bad(res, 404, "parent not found");
  const clean = cleanName(name);
  if (!clean) return bad(res, 400, "name required");
  const id = uid();
  q(`INSERT INTO nodes(id,parent_id,name,type,size,owner_id,created_at,updated_at)
     VALUES (?,?,?,?,0,?,?,?)`)
    .run(id, parentId, uniqueName(parentId, clean, req.user.id), "folder", req.user.id, now(), now());
  res.json(getNode(id));
});

api.patch("/nodes/:id", auth, (req, res) => {
  const node = ownedNode(req, req.params.id, { allowRoot: false });
  if (!node || node.id === "root") return bad(res, 404, "not found");
  const { name, parentId } = req.body || {};

  if (parentId !== undefined && parentId !== node.parent_id) {
    const target = ownedNode(req, parentId);
    if (!target || target.type !== "folder") return bad(res, 404, "target folder not found");
    if (node.type === "folder" && isAncestor(node.id, target.id, req.user.id))
      return bad(res, 400, "cannot move a folder into itself");
    q(`UPDATE nodes SET parent_id=?, name=?, updated_at=? WHERE id=?`)
      .run(target.id, uniqueName(target.id, node.name, req.user.id, node.id), now(), node.id);
  }
  if (name !== undefined) {
    const clean = cleanName(name);
    if (!clean) return bad(res, 400, "name required");
    const fresh = getNode(node.id);
    if (clean !== fresh.name) {
      q(`UPDATE nodes SET name=?, updated_at=? WHERE id=?`)
        .run(uniqueName(fresh.parent_id, clean, req.user.id, node.id), now(), node.id);
    }
  }
  res.json(getNode(node.id));
});

// Normal deletion is recoverable: keep Telegram bytes and the original tree
// until the user explicitly deletes from Trash.
api.delete("/nodes/:id", auth, (req, res) => {
  const node = ownedNode(req, req.params.id, { allowRoot: false });
  if (!node || node.id === "root") return bad(res, 404, "not found");
  const ids = subtreeIds(node.id, req.user.id);
  if (!ids.length) return bad(res, 404, "not found");
  const ph = ids.map(() => "?").join(",");
  const activeUploads = q(
    `SELECT COUNT(*) count FROM uploads WHERE parent_id IN (${ph}) AND user_id=? AND status='active'`
  ).get(...ids, req.user.id).count;
  if (activeUploads) return bad(res, 409, "cancel or finish uploads in this folder before moving it to Trash");
  const deletedAt = now();
  db.transaction(() => {
    q(`DELETE FROM shares WHERE file_id IN (${ph})`).run(...ids);
    q(`UPDATE nodes SET deleted_at=?,trash_root_id=?,updated_at=? WHERE id IN (${ph})`)
      .run(deletedAt, node.id, deletedAt, ...ids);
  })();
  res.json({ ok: true, trashed: ids.length });
});

api.get("/trash", auth, (req, res) => {
  const items = q(
    `SELECT id,parent_id,name,type,size,mime,storage_id,encrypted,deleted_at,updated_at FROM nodes
     WHERE owner_id=? AND deleted_at IS NOT NULL AND trash_root_id=id
     ORDER BY deleted_at DESC`
  ).all(req.user.id);
  res.json({ items });
});

api.post("/trash/:id/restore", auth, (req, res) => {
  const node = getOwnedNode(req.params.id, req.user.id, { allowRoot: false, includeDeleted: true });
  if (!node || node.trash_root_id !== node.id) return bad(res, 404, "trash item not found");
  const parent = getOwnedNode(node.parent_id, req.user.id);
  const parentId = parent?.type === "folder" ? parent.id : "root";
  const restoredName = uniqueName(parentId, node.name, req.user.id);
  const restoredAt = now();
  db.transaction(() => {
    q(`UPDATE nodes SET parent_id=?,name=? WHERE id=?`).run(parentId, restoredName, node.id);
    q(`UPDATE nodes SET deleted_at=NULL,trash_root_id=NULL,updated_at=? WHERE trash_root_id=? AND owner_id=?`)
      .run(restoredAt, node.id, req.user.id);
  })();
  res.json(getOwnedNode(node.id, req.user.id));
});

function purgeTrashRoot(userId, node) {
  const ids = q(`SELECT id FROM nodes WHERE owner_id=? AND trash_root_id=?`).all(userId, node.id).map((r) => r.id);
  if (!ids.length) return { removed: 0, messages: [] };
  const ph = ids.map(() => "?").join(",");
  const messages = q(`SELECT msg_id,storage_id FROM chunks WHERE file_id IN (${ph})`).all(...ids);
  db.transaction(() => {
    const enqueueDeletion = q(
      `INSERT OR IGNORE INTO deletion_queue(storage_id,msg_id,created_at) VALUES (?,?,?)`
    );
    for (const message of messages) {
      if (message.storage_id && message.msg_id)
        enqueueDeletion.run(message.storage_id, message.msg_id, now());
    }
    q(`DELETE FROM shares WHERE file_id IN (${ph})`).run(...ids);
    q(`DELETE FROM chunks WHERE file_id IN (${ph})`).run(...ids);
    q(`DELETE FROM nodes WHERE id IN (${ph})`).run(...ids);
  })();
  return { removed: ids.length, messages };
}

api.delete("/trash/:id", auth, (req, res) => {
  const node = getOwnedNode(req.params.id, req.user.id, { allowRoot: false, includeDeleted: true });
  if (!node || node.trash_root_id !== node.id) return bad(res, 404, "trash item not found");
  const result = purgeTrashRoot(req.user.id, node);
  deleteMessages(result.messages).catch((error) => console.error("[trash purge]", error.message));
  res.json({ ok: true, removed: result.removed, telegramMessages: result.messages.length });
});

api.delete("/trash", auth, (req, res) => {
  const roots = q(`SELECT * FROM nodes WHERE owner_id=? AND deleted_at IS NOT NULL AND trash_root_id=id`)
    .all(req.user.id);
  let removed = 0;
  const messages = [];
  db.transaction(() => {
    for (const root of roots) {
      const result = purgeTrashRoot(req.user.id, root);
      removed += result.removed;
      messages.push(...result.messages);
    }
  })();
  deleteMessages(messages).catch((error) => console.error("[empty trash]", error.message));
  res.json({ ok: true, removed, telegramMessages: messages.length });
});

api.get("/search", auth, (req, res) => {
  const term = String(req.query.q || "").trim();
  if (!term) return res.json({ results: [] });
  const results = q(
    `SELECT id,parent_id,name,type,size,mime,storage_id,encrypted,created_at,updated_at FROM nodes
     WHERE name LIKE ? AND id != 'root' AND owner_id=?
     AND deleted_at IS NULL
     ORDER BY type='folder' DESC, name COLLATE NOCASE LIMIT 100`
  ).all(`%${term}%`, req.user.id);
  res.json({ results });
});

api.post("/nodes/:id/share", auth, (req, res) => {
  const node = ownedNode(req, req.params.id, { allowRoot: false });
  if (!node || node.type !== "file") return bad(res, 404, "file not found");
  const { expiresInHours } = req.body || {};
  let expiresAt = null;
  if (Number.isFinite(expiresInHours) && expiresInHours > 0) {
    expiresAt = now() + Math.round(expiresInHours * 3600 * 1000);
  }
  const shareId = createShare(node.id, expiresAt);
  res.json({ shareId, expiresAt });
});

api.get("/nodes/:id/shares", auth, (req, res) => {
  const node = ownedNode(req, req.params.id, { allowRoot: false });
  if (!node || node.type !== "file") return bad(res, 404, "file not found");
  const shares = getNodeShares(node.id);
  res.json({ shares });
});

api.delete("/shares/:id", auth, (req, res) => {
  const ok = deleteShare(req.params.id, req.user.id);
  if (!ok) return bad(res, 404, "share link not found");
  res.json({ ok: true });
});

api.post("/tg/scan", auth, async (req, res) => {
  try {
    const report = await scanAndRepairChannel(req.user.id);
    res.json(report);
  } catch (e) {
    bad(res, e.status || 500, e.message);
  }
});

/* -------------------------------------------------------- chunked uploads */
// Browser slices the File into <= chunkBytes parts. Each part is PUT as a
// raw body -> temp file on disk -> one Telegram message. `complete` stitches
// the message ids into a file node. Memory use stays flat regardless of size.

api.get("/uploads", auth, (req, res) => {
  const uploads = q(
    `SELECT * FROM uploads WHERE user_id=? AND status='active' ORDER BY updated_at DESC,created_at DESC`
  ).all(req.user.id).map(uploadSummary);
  res.json({ uploads });
});

api.get("/uploads/:id", auth, (req, res) => {
  const upload = ownedUpload(req);
  if (!upload) return bad(res, 404, "upload not found");
  res.json(uploadSummary(upload));
});

api.post("/uploads", auth, (req, res) => {
  const { name, size, mime, parentId, lastModified, encrypted } = req.body || {};
  const parent = ownedNode(req, parentId);
  if (!parent || parent.type !== "folder") return bad(res, 404, "parent not found");
  const fileName = cleanName(name);
  if (!fileName || !(Number.isSafeInteger(size) && size >= 0))
    return bad(res, 400, "name and size required");
  const storage = getActiveStorage(req.user.id);
  if (!storage) return bad(res, 409, "pair a Telegram channel before uploading");
  const id = uid();
  const timestamp = now();
  q(`DELETE FROM uploads WHERE user_id=? AND status='completed' AND updated_at<?`)
    .run(req.user.id, timestamp - 7 * 24 * 60 * 60 * 1000);
  q(`INSERT INTO uploads(
       id,name,parent_id,size,mime,chunk_size,user_id,storage_id,encrypted,status,last_modified,created_at,updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?, 'active',?,?,?)`)
    .run(
      id, fileName, parentId, size, String(mime || "").slice(0, 255) || null,
      cfg.chunkBytes, req.user.id, storage.id, encrypted ? 1 : 0,
      Number.isSafeInteger(lastModified) && lastModified >= 0 ? lastModified : null,
      timestamp, timestamp
    );
  res.json(uploadSummary(q(`SELECT * FROM uploads WHERE id=?`).get(id)));
});

api.put("/uploads/:id/parts/:idx", auth, async (req, res) => {
  const up = ownedUpload(req);
  if (!up || up.status !== "active") return bad(res, 404, "upload not found");
  if (!tg.ready) return bad(res, 503, tg.error || "Telegram storage offline");
  const idx = Number(req.params.idx);
  const totalParts = Math.max(1, Math.ceil(up.size / up.chunk_size));
  if (!(Number.isInteger(idx) && idx >= 0 && idx < totalParts))
    return bad(res, 400, "part index out of range");
  const expectedSize = Math.min(up.chunk_size, up.size - idx * up.chunk_size);
  const stored = q(`SELECT msg_id,size FROM upload_parts WHERE upload_id=? AND idx=?`).get(up.id, idx);
  if (stored?.size === expectedSize) {
    req.resume();
    return res.json({ msgId: stored.msg_id, size: stored.size, alreadyStored: true });
  }
  const announcedSize = Number(req.headers["content-length"]);
  if (Number.isFinite(announcedSize) && announcedSize !== expectedSize)
    return bad(res, 400, `part size must be exactly ${expectedSize} bytes`);

  const tmp = path.join(cfg.dataDir, "tmp", `${up.id}.${idx}`);
  try {
    let received = 0;
    const sizeGuard = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > expectedSize) {
          const error = Object.assign(new Error("upload part exceeds expected size"), { status: 413 });
          return callback(error);
        }
        callback(null, chunk);
      },
    });
    await pipeline(req, sizeGuard, fs.createWriteStream(tmp));
    if (received !== expectedSize)
      return bad(res, 400, `part size must be exactly ${expectedSize} bytes`);

    const partName =
      totalParts > 1
        ? `${up.name}.part${String(idx + 1).padStart(3, "0")}`
        : up.name;
    const caption = uploadCaption({
      name: up.name,
      part: idx + 1,
      totalParts,
      partSize: received,
    });
    const msgId = await sendDocument(up.storage_id, tmp, partName, caption);

    // Retried part? Drop the superseded Telegram message.
    const prev = q(`SELECT msg_id FROM upload_parts WHERE upload_id=? AND idx=?`)
      .get(up.id, idx);
    if (prev) deleteMessages([{ msg_id: prev.msg_id, storage_id: up.storage_id }]);
    q(`INSERT OR REPLACE INTO upload_parts(upload_id,idx,msg_id,size) VALUES (?,?,?,?)`)
      .run(up.id, idx, msgId, received);
    q(`UPDATE uploads SET updated_at=? WHERE id=?`).run(now(), up.id);
    res.json({ msgId, size: received });
  } catch (e) {
    console.error("[upload part]", e);
    bad(res, e.status || 500, e.message);
  } finally {
    fsp.rm(tmp, { force: true }).catch(() => {});
  }
});

api.post("/uploads/:id/complete", auth, (req, res) => {
  const up = ownedUpload(req);
  if (!up) return bad(res, 404, "upload not found");
  if (up.status === "completed" && up.node_id) {
    const existing = getOwnedNode(up.node_id, req.user.id, { allowRoot: false, includeDeleted: true });
    return existing ? res.json(existing) : bad(res, 410, "completed file no longer exists");
  }
  const parent = ownedNode(req, up.parent_id);
  if (!parent || parent.type !== "folder")
    return bad(res, 409, "upload destination no longer exists");
  const parts = q(`SELECT * FROM upload_parts WHERE upload_id=? ORDER BY idx`).all(up.id);
  const expected = up.size === 0 ? 0 : Math.ceil(up.size / up.chunk_size);
  const total = parts.reduce((s, p) => s + p.size, 0);
  if (parts.length !== expected || total !== up.size)
    return bad(res, 400, `incomplete upload: ${parts.length}/${expected} parts, ${total}/${up.size} bytes`);

  let node;
  db.transaction(() => {
    node = createFileNode({
      parentId: up.parent_id, name: up.name, size: up.size,
      mime: up.mime, ownerId: up.user_id, storageId: up.storage_id,
      encrypted: up.encrypted, parts,
    });
    q(`DELETE FROM upload_parts WHERE upload_id=?`).run(up.id);
    q(`UPDATE uploads SET status='completed',node_id=?,updated_at=? WHERE id=?`)
      .run(node.id, now(), up.id);
  })();
  res.json(node);
});

api.delete("/uploads/:id", auth, (req, res) => {
  const up = ownedUpload(req);
  if (!up) return bad(res, 404, "upload not found");
  if (up.status === "completed") return bad(res, 409, "upload is already complete");
  const msgIds = q(`SELECT msg_id FROM upload_parts WHERE upload_id=?`)
    .all(up.id).map((r) => r.msg_id);
  db.transaction(() => {
    const enqueueDeletion = q(
      `INSERT OR IGNORE INTO deletion_queue(storage_id,msg_id,created_at) VALUES (?,?,?)`
    );
    for (const msgId of msgIds) enqueueDeletion.run(up.storage_id, msgId, now());
    q(`DELETE FROM upload_parts WHERE upload_id=?`).run(up.id);
    q(`DELETE FROM uploads WHERE id=?`).run(up.id);
  })();
  deleteMessages(msgIds.map((msgId) => ({ msg_id: msgId, storage_id: up.storage_id })));
  res.json({ ok: true });
});

/* ------------------------------------------------------- ranged downloads */
// Full HTTP Range support across chunk boundaries -> video seeking works.

async function serveNodeContent(req, res, node) {
  if (!node || node.type !== "file") return bad(res, 404, "file not found");
  const chunks = q(`SELECT * FROM chunks WHERE file_id=? ORDER BY idx`).all(node.id);
  const total = node.size;

  let start = 0, end = Math.max(total - 1, 0), status = 200;
  const range = req.headers.range;
  if (range && total > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = Number(m[1]); end = m[2] ? Number(m[2]) : total - 1; }
      else { start = Math.max(total - Number(m[2]), 0); end = total - 1; }
      end = Math.min(end, total - 1);
      if (start > end || start >= total)
        return res.status(416).set("Content-Range", `bytes */${total}`).end();
      status = 206;
    }
  }

  const isDangerousInline = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml)/i.test(node.mime || "");
  const dispositionType = req.query.dl === "1" || isDangerousInline ? "attachment" : "inline";

  res.status(status).set({
    "Accept-Ranges": "bytes",
    "Content-Type": node.mime || "application/octet-stream",
    "Content-Length": String(total === 0 ? 0 : end - start + 1),
    "Content-Disposition":
      `${dispositionType}; ` +
      `filename*=UTF-8''${encodeURIComponent(node.name)}`,
  });
  if (status === 206) res.set("Content-Range", `bytes ${start}-${end}/${total}`);
  if (req.method === "HEAD" || total === 0) return res.end();

  let closed = false;
  res.on("close", () => (closed = true));
  try {
    let pos = 0;
    for (const c of chunks) {
      const cStart = pos, cEnd = pos + c.size - 1;
      pos += c.size;
      if (cEnd < start) continue;
      if (cStart > end) break;
      await streamRange(
        c.storage_id || node.storage_id,
        c.msg_id,
        Math.max(start - cStart, 0),
        Math.min(end - cStart, c.size - 1),
        async (buf) => {
          if (closed) return false;
          if (!res.write(buf)) await once(res, "drain");
          return !closed;
        }
      );
      if (closed) break;
    }
  } catch (e) {
    console.error("[download]", e.message);
  }
  res.end();
}

api.get("/files/:id/content", auth, async (req, res) => {
  serveNodeContent(req, res, ownedNode(req, req.params.id, { allowRoot: false }));
});

api.get("/share/:id/content", async (req, res) => {
  const share = getShare(req.params.id);
  if (!share) return bad(res, 404, "share link not found");
  if (share.expires_at && share.expires_at <= now()) {
    return bad(res, 410, "this share link has expired");
  }
  serveNodeContent(req, res, getNode(share.file_id));
});

api.get("/folders/:id/download", auth, async (req, res) => {
  const rootFolder = ownedNode(req, req.params.id);
  if (!rootFolder || rootFolder.type !== "folder") return bad(res, 404, "folder not found");
  
  res.status(200).set({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(rootFolder.name)}.zip`,
  });

  const archive = new ZipArchive({ zlib: { level: 1 } });
  archive.on("error", (err) => console.error("[zip error]", err));
  archive.pipe(res);

  let closed = false;
  res.on("close", () => {
    closed = true;
    try { archive.abort(); } catch {}
  });

  async function addFolder(folderId, basePath) {
    if (closed) return;
    const folderChildren = children(folderId, req.user.id);
    for (const child of folderChildren) {
      if (closed) return;
      const childPath = basePath ? `${basePath}/${child.name}` : child.name;
      
      if (child.type === "folder") {
        archive.append("", { name: childPath + "/" });
        await addFolder(child.id, childPath);
      } else {
        const fileChunks = q(`SELECT * FROM chunks WHERE file_id=? ORDER BY idx`).all(child.id);
        const pt = new PassThrough();
        archive.append(pt, { name: childPath });
        
        try {
          for (const c of fileChunks) {
            if (closed) break;
            if (c.size > 0) {
              await streamRange(c.storage_id || child.storage_id, c.msg_id, 0, c.size - 1, async (buf) => {
                if (!pt.write(buf)) await once(pt, "drain");
                return !closed;
              });
            }
          }
        } catch (e) {
          console.error("[zip stream]", e.message);
        } finally {
          pt.end();
        }
      }
    }
  }

  try {
    await addFolder(rootFolder.id, "");
    if (!closed) archive.finalize();
  } catch (err) {
    if (!closed) {
      try { archive.abort(); } catch {}
    }
  }
});
