import { test } from "node:test";
import assert from "node:assert/strict";
import { api, db, makeListing, cloudinaryCalls, closeServer } from "./helpers.js";

test("ilan silme: sahibi silince ilan, viewers alt koleksiyonu ve raporlar gider", async () => {
  await makeListing("L1", "alice");
  await db.doc("Listings/L1/viewers/bob").set({ at: new Date() });
  await db.doc("Listings/L1/viewers/carol").set({ at: new Date() });
  await db.doc("ListingReports/L1").set({ createdAt: new Date() });
  await db.doc("ListingReports/L1/reports/bob_L1").set({ userId: "bob" });

  const res = await api("/api/listings/L1", { uid: "alice", method: "DELETE" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, message: "İlan silindi" });

  assert.equal((await db.doc("Listings/L1").get()).exists, false);
  assert.equal((await db.collection("Listings/L1/viewers").get()).size, 0, "viewers kalmamalı");
  assert.equal((await db.doc("ListingReports/L1").get()).exists, false);
  assert.equal((await db.collection("ListingReports/L1/reports").get()).size, 0, "raporlar kalmamalı");
  assert.ok(cloudinaryCalls.deletedPrefixes.includes("Listings/alice/L1"));
});

test("ilan silme: başkasının ilanı silinemez (403) ve olduğu gibi kalır", async () => {
  await makeListing("L2", "alice");
  await db.doc("Listings/L2/viewers/bob").set({ at: new Date() });
  const res = await api("/api/listings/L2", { uid: "mallory", method: "DELETE" });
  assert.equal(res.status, 403);
  assert.equal((await db.doc("Listings/L2").get()).exists, true);
  assert.equal((await db.collection("Listings/L2/viewers").get()).size, 1);
});

test("ilan silme: olmayan ilan 404, geçersiz kimlik 400, token yoksa 401", async () => {
  assert.equal((await api("/api/listings/yok", { uid: "alice", method: "DELETE" })).status, 404);
  assert.equal((await api("/api/listings/a%20b", { uid: "alice", method: "DELETE" })).status, 400);
  assert.equal((await api("/api/listings/L1", { method: "DELETE" })).status, 401);
});

test("ilan silme: kullanıcı başına hız sınırı (30 istek/10 dk) 429 döner", async () => {
  let last = 0;
  for (let i = 0; i < 32; i++) {
    last = (await api("/api/listings/yok", { uid: "spammer", method: "DELETE" })).status;
  }
  assert.equal(last, 429);
  // başka kullanıcı etkilenmez
  assert.equal((await api("/api/listings/yok", { uid: "other", method: "DELETE" })).status, 404);
});

test.after(closeServer);
