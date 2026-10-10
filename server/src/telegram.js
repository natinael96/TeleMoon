// MTProto layer via GramJS. We deliberately avoid the Bot HTTP API
// (20 MB download / 50 MB upload caps). Over MTProto a bot can move
// up to 2 GB per message; a premium *user* session raises that to 4 GB.
import telegram from "telegram";
import sessionsMod from "telegram/sessions/index.js";
import eventsMod from "telegram/events/index.js";
import bigInt from "big-integer";
import { cfg } from "./config.js";
import {
  q, now, ensureInboxFolder, createFileNode, getStorage, getStorageByChannel,
  activateStorage, getActiveStorage,
} from "./db.js";
import { hashPairingCode, normalizePairingCode } from "./pairing.js";

const { TelegramClient, Api } = telegram;
const { StringSession } = sessionsMod;
const { NewMessage } = eventsMod;

export const tg = {
  client: null,
  ready: false, // Telegram client authenticated; users pair channels separately
  mode: null, // "bot" | "user"
  botUsername: cfg.botUsername,
  error: null,
  channels: new Map(), // storage id -> resolved Telegram entity
};

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

export async function initTelegram() {
  if (!cfg.apiId || !cfg.apiHash || (!cfg.botToken && !cfg.session)) {
    tg.error = "Telegram not configured (TG_API_ID / TG_API_HASH / TG_BOT_TOKEN or TG_SESSION)";
    console.warn(`[tg] ${tg.error} — API is up, storage is disabled.`);
    return;
  }

  const client = new TelegramClient(
    new sessionsMod.StoreSession(cfg.dataDir),
    cfg.apiId,
    cfg.apiHash,
    { connectionRetries: 5 }
  );

  await client.session.load();

  // Load the env session string if we have a fresh StoreSession
  if (cfg.session && !client.session.authKey) {
    const temp = new StringSession(cfg.session);
    await temp.load();
    client.session.setDC(temp.dcId, temp.serverAddress, temp.port);
    client.session.authKey = temp.authKey;
  }


  if (cfg.botToken) {
    await client.start({ botAuthToken: cfg.botToken });
    tg.mode = "bot";
  } else {
    await client.connect(); // pre-generated user session (see scripts/login.js)
    tg.mode = "user";
  }
  tg.client = client;
  tg.ready = true;
  tg.error = null;
  const exportSession = new StringSession("");
  exportSession.setDC(client.session.dcId, client.session.serverAddress, client.session.port);
  exportSession.authKey = client.session.authKey;

  console.log(
    `[tg] connected (${tg.mode}). Tip: set TG_SESSION to reuse this session:\n` +
      `TG_SESSION=${exportSession.save()}`
  );

  // One handler completes channel pairing and indexes documents posted
  // directly into any channel paired with this deployment.
  client.addEventHandler(handleChannelPost, new NewMessage({}));
  console.log(`[tg] ready for per-user channel pairing`);
  drainDeletionQueue().catch((error) => console.warn("[tg] deletion queue:", error.message));
}

export const telegramChannelId = (entityOrId) => {
  const source = entityOrId && entityOrId.id !== undefined ? entityOrId.id : entityOrId;
  const raw = String(source?.toString?.() ?? source);
  return raw.startsWith("-100") ? raw : `-100${raw.replace(/^-/, "")}`;
};

async function channelForStorage(storageId) {
  if (!tg.ready || !tg.client) throw err(tg.error || "Telegram offline", 503);
  if (tg.channels.has(storageId)) return tg.channels.get(storageId);
  const storage = getStorage(storageId);
  if (!storage) throw err("Telegram storage connection not found", 502);
  const entity = await tg.client.getEntity(bigInt(storage.telegram_channel_id));
  if (entity.className !== "Channel") throw err("paired Telegram destination is not a channel", 502);
  if (entity.title && entity.title !== storage.channel_title) {
    q(`UPDATE storage_connections SET channel_title=? WHERE id=?`).run(entity.title, storage.id);
  }
  tg.channels.set(storageId, entity);
  return entity;
}

export async function connectByLink(raw) {
  if (!tg.client) throw err(tg.error || "Telegram offline", 503);
  if (/^https?:\/\/(t\.me|telegram\.me)\/\+/.test(raw)) {
    if (tg.mode === "bot")
      throw err(
        "bot mode cannot join via invite link — add the bot to the channel as admin manually, then provide the channel @name or -100... id"
      );
    const invite = raw.match(/\+([A-Za-z0-9_-]+)/);
    if (!invite) throw err("invalid invite link");
    const hash = invite[1];
    try {
      const upd = await tg.client.invoke(new Api.messages.ImportChatInvite({ hash }));
      return upd.chats?.[0]; // return channel entity
    } catch (e) {
      if (/ALREADY_PARTICIPANT/.test(e.errorMessage || e.message || "")) {
        const info = await tg.client.invoke(new Api.messages.CheckChatInvite({ hash }));
        if (info.chat) return info.chat;
      }
      if (/INVITE_HASH/.test(e.errorMessage || "")) throw err("that invite link is invalid or expired");
      throw e;
    }
  }

  const pvtMsg = raw.match(/(?:t\.me|telegram\.me)\/c\/(\d+)\//);
  if (pvtMsg) {
    return await tg.client.getEntity(bigInt("-100" + pvtMsg[1]));
  }

  const uname = raw.match(/(?:t\.me|telegram\.me)\/([A-Za-z]\w{3,})\/?$/)?.[1];
  try {
    const entity = await tg.client.getEntity(uname ? `@${uname}` : raw);
    return entity;
  } catch (e) {
    if (e.message && e.message.includes("Could not find the input entity")) {
      throw err("Telegram doesn't recognize this channel. If you just added the bot, please forward any message from the channel to the bot so it can register it, then try again.");
    }
    throw e;
  }
}

export async function listDialogs() {
  if (!tg.client) throw err(tg.error || "Telegram offline", 503);
  if (tg.mode === "bot")
    throw err("browsing your chats needs a user session (npm run login) — bots can't list dialogs");
  const dialogs = await tg.client.getDialogs({ limit: 200 });
  return dialogs
    .filter((d) => d.entity?.className === "Channel")
    .map((d) => ({
      id: `-100${d.entity.id.toString()}`,
      title: d.entity.title,
      username: d.entity.username || null,
      group: !!d.entity.megagroup,
    }));
}

export async function handleChannelPost(ev) {
  try {
    const m = ev.message;
    const cid = m?.peerId?.channelId;
    if (!cid) return;
    const channelId = telegramChannelId(cid);

    const storage = getStorageByChannel(channelId);
    if (!storage) return;
    const doc = m.media?.document;
    if (!doc) return; // photos/stickers ignored — send as "File" to index
    if ((m.message || "").startsWith("tm1;")) return; // our own upload part

    const fnAttr = doc.attributes?.find(
      (a) => a.className === "DocumentAttributeFilename"
    );
    const name = String(fnAttr?.fileName || `telegram_${m.id}`)
      .trim()
      .replace(/[/\\\0]/g, "-")
      .slice(0, 255) || `telegram_${m.id}`;
    const size = Number(doc.size?.toString?.() ?? doc.size);
    const inbox = ensureInboxFolder(storage.user_id, storage.id);
    const node = createFileNode({
      parentId: inbox.id,
      name,
      size,
      mime: doc.mimeType || null,
      ownerId: storage.user_id,
      storageId: storage.id,
      parts: [{ msg_id: m.id, size, storage_id: storage.id }],
    });
    console.log(`[indexer] +${node.name} (${size} B) from channel post ${m.id}`);
  } catch (e) {
    console.error("[indexer]", e);
  }
}

/** Upload a file from disk into the channel. Returns the message id. */
export async function sendDocument(storageId, filePath, fileName, caption) {
  const channel = await channelForStorage(storageId);
  const msg = await tg.client.sendFile(channel, {
    file: filePath,
    caption,
    forceDocument: true,
    attributes: [new Api.DocumentAttributeFilename({ fileName })],
  });
  return msg.id;
}

export async function getMessage(storageId, msgId) {
  const channel = await channelForStorage(storageId);
  const [m] = await tg.client.getMessages(channel, { ids: [msgId] });
  if (!m || !m.media) throw err(`message ${msgId} missing in channel (deleted?)`, 502);
  return m;
}

export async function deleteMessages(messages) {
  if (!messages.length) return;
  const insert = q(
    `INSERT OR IGNORE INTO deletion_queue(storage_id,msg_id,created_at) VALUES (?,?,?)`
  );
  for (const message of messages) {
    if (message?.storage_id && message?.msg_id)
      insert.run(message.storage_id, message.msg_id, now());
  }
  return drainDeletionQueue();
}

let isDraining = false;

/** Retry-safe removal: queued rows survive restarts and Telegram outages. */
export async function drainDeletionQueue() {
  if (!tg.ready || !tg.client || isDraining) return;
  isDraining = true;
  try {
    // Drop messages that permanently failed after 10 retries
    q(`DELETE FROM deletion_queue WHERE attempts >= 10`).run();

    const grouped = new Map();
    for (const message of q(`SELECT storage_id,msg_id FROM deletion_queue WHERE attempts < 10 ORDER BY created_at`).all()) {
      if (!grouped.has(message.storage_id)) grouped.set(message.storage_id, []);
      grouped.get(message.storage_id).push(message.msg_id);
    }
    for (const [storageId, ids] of grouped) {
      const channel = await channelForStorage(storageId).catch((error) => {
        console.warn("[tg] deleteMessages storage:", error.message);
        return null;
      });
      if (!channel) continue;
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const placeholders = batch.map(() => "?").join(",");
        try {
          await tg.client.deleteMessages(channel, batch, { revoke: true });
          q(`DELETE FROM deletion_queue WHERE storage_id=? AND msg_id IN (${placeholders})`)
            .run(storageId, ...batch);
        } catch (e) {
          console.warn("[tg] deleteMessages:", e.message);
          q(`UPDATE deletion_queue SET attempts=attempts+1,last_error=?
             WHERE storage_id=? AND msg_id IN (${placeholders})`)
            .run(String(e.message || e).slice(0, 500), storageId, ...batch);
        }
      }
    }
  } finally {
    isDraining = false;
  }
}

/**
 * Stream bytes [from..to] (inclusive, chunk-local) of one stored message.
 * MTProto wants offsets aligned to 4096 and requestSize | 1 MB, so we
 * over-fetch to the previous 4 KB boundary and trim.
 * `write(buf) -> Promise<boolean>` returns false to abort (client gone).
 */
export async function streamRange(storageId, msgId, from, to, write) {
  const m = await getMessage(storageId, msgId);
  const aligned = from - (from % 4096);
  let skip = from - aligned;
  let remaining = to - from + 1;

  for await (const piece of tg.client.iterDownload({
    file: m.media,
    offset: bigInt(aligned),
    requestSize: 512 * 1024,
  })) {
    let buf = Buffer.from(piece);
    if (skip > 0) {
      if (buf.length <= skip) { skip -= buf.length; continue; }
      buf = buf.subarray(skip);
      skip = 0;
    }
    if (buf.length > remaining) buf = buf.subarray(0, remaining);
    remaining -= buf.length;
    const keepGoing = await write(buf);
    if (!keepGoing || remaining <= 0) break; // breaking closes the iterator
  }
}

/**
 * Scans channel history for unindexed documents and verifies integrity of existing chunks.
 */
export async function scanAndRepairChannel(userId) {
  if (!tg.ready || !tg.client) throw err(tg.error || "Telegram offline", 503);
  const storage = getActiveStorage(userId);
  if (!storage) throw err("No active Telegram storage connected for this account", 400);

  const channel = await channelForStorage(storage.id);

  // 1. Audit user's mapped chunks
  const userChunks = q(
    `SELECT c.file_id, c.idx, c.msg_id, c.storage_id, n.name
     FROM chunks c JOIN nodes n ON c.file_id = n.id
     WHERE n.owner_id = ? AND c.storage_id = ? AND n.deleted_at IS NULL`
  ).all(userId, storage.id);

  const missingChunks = [];
  for (let i = 0; i < userChunks.length; i += 100) {
    const batch = userChunks.slice(i, i + 100);
    try {
      const msgs = await tg.client.getMessages(channel, { ids: batch.map((c) => c.msg_id) });
      batch.forEach((c, idx) => {
        const m = msgs[idx];
        if (!m || !m.media) {
          missingChunks.push({
            fileId: c.file_id,
            fileName: c.name,
            partIndex: c.idx,
            msgId: c.msg_id,
          });
        }
      });
    } catch (auditErr) {
      console.warn("[scan/repair audit]", auditErr.message);
    }
  }

  // 2. Discover unindexed documents posted directly in the channel
  const existingMsgIds = new Set(
    q(`SELECT msg_id FROM chunks WHERE storage_id = ?`).all(storage.id).map((r) => r.msg_id)
  );

  const newlyIndexedFiles = [];
  try {
    for await (const m of tg.client.iterMessages(channel, { limit: 500 })) {
      if (!m || !m.id) continue;
      if (existingMsgIds.has(m.id)) continue;
      if ((m.message || "").startsWith("tm1;")) continue; // TeleMoon upload part
      const doc = m.media?.document;
      if (!doc) continue;

      const fnAttr = doc.attributes?.find((a) => a.className === "DocumentAttributeFilename");
      const name = String(fnAttr?.fileName || `telegram_${m.id}`)
        .trim()
        .replace(/[/\\\0]/g, "-")
        .slice(0, 255) || `telegram_${m.id}`;
      const size = Number(doc.size?.toString?.() ?? doc.size);
      const inbox = ensureInboxFolder(userId, storage.id);
      const node = createFileNode({
        parentId: inbox.id,
        name,
        size,
        mime: doc.mimeType || null,
        ownerId: userId,
        storageId: storage.id,
        parts: [{ msg_id: m.id, size, storage_id: storage.id }],
      });
      existingMsgIds.add(m.id);
      newlyIndexedFiles.push({
        id: node.id,
        name: node.name,
        size: node.size,
        msgId: m.id,
      });
    }
  } catch (scanErr) {
    console.warn("[scan/repair history]", scanErr.message);
  }

  return {
    channelTitle: storage.channel_title || "Telegram Channel",
    totalChunksChecked: userChunks.length,
    missingChunks,
    newlyIndexedFiles,
  };
}
