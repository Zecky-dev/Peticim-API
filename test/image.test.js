import { test } from "node:test";
import assert from "node:assert/strict";
import { api, db, makeListing, imageForm, jpegBytes, cloudinaryCalls, closeServer } from "./helpers.js";

const upload = (uid, fields, files = [jpegBytes()]) =>
  api("/api/image/upload", { uid, method: "POST", form: imageForm(fields, files) });

test("yükleme: başkasının ilanına görsel eklenemez (403)", async () => {
  await makeListing("I1", "alice");
  const res = await upload("mallory", { folder: "Listings/alice/I1", listingId: "I1" });
  assert.equal(res.status, 403);
  assert.deepEqual((await db.doc("Listings/I1").get()).data().images, []);
});

test("yükleme: sahibi ekleyebilir; klasör sunucuda uid'den üretilir", async () => {
  cloudinaryCalls.uploads.length = 0;
  const res = await upload("alice", { folder: "Listings/mallory/I1", listingId: "I1" });
  assert.equal(res.status, 200);
  assert.equal(cloudinaryCalls.uploads[0], "Listings/alice/I1", "istemcinin gönderdiği klasör yok sayılmalı");
  assert.equal((await db.doc("Listings/I1").get()).data().images.length, 1);
});

test("yükleme: ilan başına en fazla 5 görsel (mevcutlar dahil)", async () => {
  await makeListing("I2", "alice");
  assert.equal((await upload("alice", { folder: "Listings/alice/I2", listingId: "I2" }, Array(4).fill(jpegBytes()))).status, 200);
  assert.equal((await upload("alice", { folder: "Listings/alice/I2", listingId: "I2" }, Array(2).fill(jpegBytes()))).status, 400);
  assert.equal((await db.doc("Listings/I2").get()).data().images.length, 4);
});

test("yükleme: görsel olmayan içerik reddedilir (mimetype yalan söylese de)", async () => {
  await makeListing("I3", "alice");
  const res = await upload("alice", { folder: "Listings/alice/I3", listingId: "I3" }, [Buffer.from("<script>alert(1)</script>".padEnd(64))]);
  assert.equal(res.status, 400);
});

test("yükleme: bilinmeyen klasör ve eksik dosya reddedilir", async () => {
  assert.equal((await upload("alice", { folder: "../etc" })).status, 400);
  assert.equal((await api("/api/image/upload", { uid: "alice", method: "POST", form: imageForm({ folder: "profile_images" }, []) })).status, 400);
});

test("rapor görseli ilana eklenmez", async () => {
  await makeListing("I4", "alice");
  const res = await upload("bob", { folder: "report_images", listingId: "I4" });
  assert.equal(res.status, 200);
  assert.deepEqual((await db.doc("Listings/I4").get()).data().images, []);
});

test("profil görseli yalnızca token sahibinin hesabına yazılır", async () => {
  await db.doc("Users/alice").set({ name: "A" });
  await db.doc("Users/victim").set({ name: "V" });
  const res = await upload("alice", { folder: "profile_images", userId: "victim" });
  assert.equal(res.status, 200);
  assert.ok((await db.doc("Users/alice").get()).data().profilePicture?.url);
  assert.equal((await db.doc("Users/victim").get()).data().profilePicture, undefined);
});

test("silme: başkasının ilanının görselleri silinemez", async () => {
  await makeListing("I5", "alice", { images: [{ url: "u", publicId: "p" }] });
  const res = await api("/api/image/delete", { uid: "mallory", method: "POST", json: { listingId: "I5" } });
  assert.equal(res.status, 403);
  assert.equal((await db.doc("Listings/I5").get()).data().images.length, 1);
});

test("token yok/bozuk: 401", async () => {
  assert.equal((await api("/api/image/upload", { method: "POST", form: imageForm({ folder: "profile_images" }, [jpegBytes()]) })).status, 401);
  const bad = await fetch(`${(await import("./helpers.js")).BASE}/api/image/delete`, { method: "POST", headers: { Authorization: "Bearer sahte", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(bad.status, 401);
});

test.after(closeServer);
