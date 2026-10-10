import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "telemoon-ownership-"));
process.env.DATA_DIR = testDataDir;
process.env.JWT_SECRET = "ownership-test-secret-that-is-not-used-in-production";
process.env.NODE_ENV = "test";

const { app } = await import("../src/app.js");
const { db, q, activateStorage, getActiveStorage } = await import("../src/db.js");
const { tg, handleChannelPost } = await import("../src/telegram.js");

after(() => { db.close(); fs.rmSync(testDataDir, { recursive: true, force: true }); });

async function enter(handle) {
  const response = await request(app)
    .post("/api/auth/enter")
    .send({ handle, password: "correct horse battery staple" })
    .expect(200);
  return response.body;
}

const owner = await enter("owner_user");
const member = await enter("member_user");
tg.ready = true; tg.mode = 'bot'; tg.error = null; tg.client = { getEntity: async () => ({ className: 'Channel', id: { toString: () => '100009' } }), sendMessage: async () => 1, getMessages: async () => [{ media: true }], deleteMessages: async () => 1 }; const ownerStorage = activateStorage(owner.user.id, "-100100001", "Owner channel");
activateStorage(member.user.id, "-100100002", "Member channel");

const timestamp = Date.now();
const insertNode = q(`
  INSERT INTO nodes(id,parent_id,name,type,size,mime,owner_id,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?)
`);
insertNode.run("owner-folder", "root", "Owner folder", "folder", 0, null, owner.user.id, timestamp, timestamp);
insertNode.run("owner-file", "owner-folder", "owner.txt", "file", 0, "text/plain", owner.user.id, timestamp, timestamp);
insertNode.run("member-folder", "root", "Member folder", "folder", 0, null, member.user.id, timestamp, timestamp);
insertNode.run("member-file", "member-folder", "member.txt", "file", 0, "text/plain", member.user.id, timestamp, timestamp);

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

test("the first account is owner and later accounts are members", () => {
  assert.equal(owner.user.role, "owner");
  assert.equal(member.user.role, "member");
});

test("storage status is private and scoped to each account's channel", async () => {
  await request(app).get("/api/status").expect(401);

  const ownerStatus = await request(app).get("/api/status").set(bearer(owner.token)).expect(200);
  const memberStatus = await request(app).get("/api/status").set(bearer(member.token)).expect(200);
  assert.equal(ownerStatus.body.canManageStorage, true);
  assert.equal(memberStatus.body.canManageStorage, true);
  assert.equal(ownerStatus.body.channel, "Owner channel");
  assert.equal(memberStatus.body.channel, "Member channel");
});

test("browser sessions use an HttpOnly cookie and can be cleared", async () => {
  const browser = request.agent(app);
  const signedIn = await browser
    .post("/api/auth/enter")
    .send({ handle: "cookie_user", password: "correct horse battery staple" })
    .expect(200);
  const cookie = signedIn.headers["set-cookie"]?.[0] || "";
  assert.match(cookie, /tm_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);

  await browser.get("/api/auth/me").expect(200);
  await browser.post("/api/auth/logout").expect(200);
  await browser.get("/api/auth/me").expect(401);
});

test("root listings contain only the signed-in user's nodes", async () => {
  const response = await request(app)
    .get("/api/nodes/root/children")
    .set(bearer(member.token))
    .expect(200);
  assert.deepEqual(response.body.children.map((node) => node.id), ["member-folder"]);
});

test("node IDs cannot cross account boundaries", async () => {
  const headers = bearer(member.token);
  await request(app).get("/api/nodes/owner-folder/children").set(headers).expect(404);
  await request(app).patch("/api/nodes/owner-file").set(headers).send({ name: "stolen.txt" }).expect(404);
  await request(app).patch("/api/nodes/member-file").set(headers).send({ parentId: "owner-folder" }).expect(404);
  await request(app).post("/api/nodes/owner-file/share").set(headers).expect(404);
  await request(app).get("/api/files/owner-file/content").set(headers).expect(404);
  await request(app).get("/api/folders/owner-folder/download").set(headers).expect(404);
  await request(app).delete("/api/nodes/owner-file").set(headers).expect(404);
  assert.ok(q(`SELECT 1 FROM nodes WHERE id='owner-file'`).get());
});

test("upload sessions and upload destinations are owner-scoped", async () => {
  await request(app)
    .post("/api/uploads")
    .set(bearer(member.token))
    .send({ name: "bad.txt", size: 4, mime: "text/plain", parentId: "owner-folder" })
    .expect(404);

  const upload = await request(app)
    .post("/api/uploads")
    .set(bearer(owner.token))
    .send({ name: "safe.txt", size: 4, mime: "text/plain", parentId: "owner-folder" })
    .expect(200);

  await request(app).post(`/api/uploads/${upload.body.id}/complete`).set(bearer(member.token)).expect(404);
  await request(app).delete(`/api/uploads/${upload.body.id}`).set(bearer(member.token)).expect(404);
  await request(app).put(`/api/uploads/${upload.body.id}/parts/0`).set(bearer(member.token)).send("test").expect(404);
  assert.ok(q(`SELECT 1 FROM uploads WHERE id=?`).get(upload.body.id));

  const emptyUpload = await request(app)
    .post("/api/uploads")
    .set(bearer(owner.token))
    .send({ name: "empty.txt", size: 0, mime: "text/plain", parentId: "owner-folder" })
    .expect(200);
  const completed = await request(app)
    .post(`/api/uploads/${emptyUpload.body.id}/complete`)
    .set(bearer(owner.token))
    .expect(200);
  assert.equal(completed.body.storage_id, ownerStorage.id);
});

test("stored upload parts survive interruption and completion is idempotent", async () => {
  const upload = await request(app)
    .post("/api/uploads")
    .set(bearer(owner.token))
    .send({
      name: "resume.txt", size: 4, mime: "text/plain", parentId: "owner-folder", lastModified: 12345,
    })
    .expect(200);
  q(`INSERT INTO upload_parts(upload_id,idx,msg_id,size) VALUES (?,?,?,?)`)
    .run(upload.body.id, 0, 7001, 4);

  const pending = await request(app).get("/api/uploads").set(bearer(owner.token)).expect(200);
  const manifest = pending.body.uploads.find((item) => item.id === upload.body.id);
  assert.equal(manifest.uploadedBytes, 4);
  assert.deepEqual(manifest.parts, [{ idx: 0, size: 4 }]);
  assert.equal(manifest.lastModified, 12345);

  const reused = await request(app)
    .put(`/api/uploads/${upload.body.id}/parts/0`)
    .set(bearer(owner.token))
    .set("Content-Type", "application/octet-stream")
    .send(Buffer.from("test"))
    .expect(200);
  assert.equal(reused.body.alreadyStored, true);
  assert.equal(reused.body.msgId, 7001);

  const first = await request(app)
    .post(`/api/uploads/${upload.body.id}/complete`).set(bearer(owner.token)).expect(200);
  const repeated = await request(app)
    .post(`/api/uploads/${upload.body.id}/complete`).set(bearer(owner.token)).expect(200);
  assert.equal(repeated.body.id, first.body.id);
  assert.equal(q(`SELECT status FROM uploads WHERE id=?`).get(upload.body.id).status, "completed");
  assert.equal(q(`SELECT 1 FROM upload_parts WHERE upload_id=?`).get(upload.body.id), undefined);
});

test("switching channels keeps old storage immutable and routes new uploads to the new channel", async () => {
  const next = activateStorage(owner.user.id, "-100100003", "Next owner channel");
  assert.equal(q(`SELECT status FROM storage_connections WHERE id=?`).get(ownerStorage.id).status, "archived");
  assert.equal(getActiveStorage(owner.user.id).id, next.id);

  const upload = await request(app)
    .post("/api/uploads")
    .set(bearer(owner.token))
    .send({ name: "new-channel.txt", size: 4, mime: "text/plain", parentId: "owner-folder" })
    .expect(200);
  assert.equal(q(`SELECT storage_id FROM uploads WHERE id=?`).get(upload.body.id).storage_id, next.id);
});

test("a Telegram channel cannot be paired to two TeleMoon accounts", () => {
  assert.throws(
    () => activateStorage(member.user.id, "-100100003", "Stolen channel"),
    /already paired with another account/
  );
});

test("moving a file to Trash revokes shares and restoring keeps its Telegram data", async () => {
  const shared = await request(app)
    .post("/api/nodes/member-file/share")
    .set(bearer(member.token))
    .expect(200);
  await request(app).delete("/api/nodes/member-file").set(bearer(member.token)).expect(200);
  await request(app).get(`/api/share/${shared.body.shareId}/content`).expect(404);
  assert.ok(q(`SELECT deleted_at FROM nodes WHERE id='member-file'`).get().deleted_at);
  assert.equal(q(`SELECT COUNT(*) count FROM deletion_queue`).get().count, 0);

  const trash = await request(app).get("/api/trash").set(bearer(member.token)).expect(200);
  assert.ok(trash.body.items.some((item) => item.id === "member-file"));
  const collisionAt = Date.now();
  insertNode.run(
    "member-collision", "member-folder", "member.txt", "file", 0, "text/plain",
    member.user.id, collisionAt, collisionAt
  );
  const restored = await request(app)
    .post("/api/trash/member-file/restore").set(bearer(member.token)).expect(200);
  assert.equal(restored.body.name, "member (2).txt");
  assert.equal(q(`SELECT deleted_at FROM nodes WHERE id='member-file'`).get().deleted_at, null);
});

test("a folder with an active resumable upload cannot be trashed", async () => {
  const response = await request(app)
    .delete("/api/nodes/owner-folder").set(bearer(owner.token)).expect(409);
  assert.match(response.body.error, /cancel or finish uploads/);
  assert.equal(q(`SELECT deleted_at FROM nodes WHERE id='owner-folder'`).get().deleted_at, null);
});

test("permanent Trash deletion removes metadata and durably queues Telegram cleanup", async () => { tg.client.deleteMessages = async () => { throw new Error("mock offline") };
  const storage = getActiveStorage(member.user.id);
  const createdAt = Date.now();
  q(`INSERT INTO nodes(id,parent_id,name,type,size,mime,owner_id,storage_id,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run("purge-file", "member-folder", "purge.txt", "file", 4, "text/plain", member.user.id, storage.id, createdAt, createdAt);
  q(`INSERT INTO chunks(file_id,idx,msg_id,size,storage_id) VALUES (?,?,?,?,?)`)
    .run("purge-file", 0, 8123, 4, storage.id);

  await request(app).delete("/api/nodes/purge-file").set(bearer(member.token)).expect(200);
  await request(app).delete("/api/trash/purge-file").set(bearer(owner.token)).expect(404);
  await request(app).delete("/api/trash/purge-file").set(bearer(member.token)).expect(200);
  assert.equal(q(`SELECT 1 FROM nodes WHERE id='purge-file'`).get(), undefined);
  assert.ok(q(`SELECT 1 FROM deletion_queue WHERE storage_id=? AND msg_id=8123`).get(storage.id));
});

test("security response headers are enabled", async () => {
  const response = await request(app).get("/api/health").expect(200);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.match(response.headers["content-security-policy"], /default-src 'self'/);
  assert.equal(response.headers["x-powered-by"], undefined);
});

test("expiring share links and revocation work as expected", async () => {
  // Create expiring share
  const shareRes = await request(app)
    .post("/api/nodes/member-file/share")
    .set(bearer(member.token))
    .send({ expiresInHours: 24 })
    .expect(200);

  assert.ok(shareRes.body.shareId);
  assert.ok(shareRes.body.expiresAt > Date.now());

  // List shares
  const listRes = await request(app)
    .get("/api/nodes/member-file/shares")
    .set(bearer(member.token))
    .expect(200);
  assert.equal(listRes.body.shares.length, 1);
  assert.equal(listRes.body.shares[0].id, shareRes.body.shareId);

  // Revoke share
  await request(app)
    .delete(`/api/shares/${shareRes.body.shareId}`)
    .set(bearer(member.token))
    .expect(200);

  // Verify revoked
  await request(app).get(`/api/share/${shareRes.body.shareId}/content`).expect(404);

  // Manually insert an expired share to test 410 Gone
  q(`INSERT INTO shares(id,file_id,created_at,expires_at) VALUES ('expired-share','member-file',?,?)`)
    .run(Date.now() - 10000, Date.now() - 5000);
  await request(app).get("/api/share/expired-share/content").expect(410);
});

test("encrypted uploads persist encrypted flag on the resulting file node", async () => {
  const upload = await request(app)
    .post("/api/uploads")
    .set(bearer(member.token))
    .send({ name: "secret.txt", size: 0, mime: "application/octet-stream", parentId: "member-folder", encrypted: 1 })
    .expect(200);
  assert.equal(upload.body.encrypted, 1);

  const completed = await request(app)
    .post(`/api/uploads/${upload.body.id}/complete`)
    .set(bearer(member.token))
    .expect(200);
  assert.equal(completed.body.encrypted, 1);

  const childrenRes = await request(app)
    .get("/api/nodes/member-folder/children")
    .set(bearer(member.token))
    .expect(200);
  const fileNode = childrenRes.body.children.find((n) => n.id === completed.body.id);
  assert.equal(fileNode.encrypted, 1);
});

test("channel scan endpoint audits storage and returns report", async () => {
  tg.client = {
    getMessages: async () => [],
    iterMessages: async function* () {},
  };
  const response = await request(app)
    .post("/api/tg/scan")
    .set(bearer(member.token))
    .expect(200);
  assert.ok(response.body.channelTitle);
  assert.ok(Array.isArray(response.body.missingChunks));
  assert.ok(Array.isArray(response.body.newlyIndexedFiles));
});

test("renaming a node to its current name does not change the name", async () => {
  const patchRes = await request(app)
    .patch("/api/nodes/member-folder")
    .set(bearer(member.token))
    .send({ name: "Member folder" })
    .expect(200);
  assert.equal(patchRes.body.name, "Member folder");
});

test("search results include encrypted flag", async () => {
  const searchRes = await request(app)
    .get("/api/search?q=secret")
    .set(bearer(member.token))
    .expect(200);
  assert.equal(searchRes.body.results.length, 1);
  assert.equal(searchRes.body.results[0].encrypted, 1);
});

test("CSP header includes voxide connect endpoints", async () => {
  const res = await request(app).get("/api/health").expect(200);
  assert.match(res.headers["content-security-policy"], /https:\/\/voxide\.onrender\.com/);
  assert.match(res.headers["content-security-policy"], /wss:\/\/voxide\.onrender\.com/);
});

test("botUsername is reported in public-status and status", async () => {
  const pub = await request(app).get("/api/public-status").expect(200);
  assert.equal(pub.body.botUsername, "Telemoon2bot");

  const st = await request(app).get("/api/status").set(bearer(owner.token)).expect(200);
  assert.equal(st.body.botUsername, "Telemoon2bot");
});

