import { test } from "node:test";
import assert from "node:assert/strict";
import { api, db, httpCalls, httpBehavior, closeServer } from "./helpers.js";

const reverse = (q, uid = "alice") => api(`/api/location/reverse?${q}`, { uid });

test("reverse: kimlik zorunlu", async () => {
  assert.equal((await reverse("lat=39.9&lon=32.8", null)).status, 401);
});

test("reverse: yasaklı kullanıcı 403", async () => {
  await db.doc("Users/banned1").set({ isBanned: true });
  assert.equal((await reverse("lat=39.9&lon=32.8", "banned1")).status, 403);
});

test("reverse: koordinat doğrulaması", async () => {
  for (const q of ["", "lat=abc&lon=32", "lat=91&lon=32", "lat=39&lon=181", "lat=39", "lat=Infinity&lon=1"]) {
    assert.equal((await reverse(q)).status, 400, q);
  }
});

test("reverse: adres döner, yakın koordinatlar önbellekten gelir (dış servise tek istek)", async () => {
  httpCalls.length = 0;
  const a = await reverse("lat=39.92001&lon=32.85401");
  assert.equal(a.status, 200);
  const body = await a.json();
  assert.equal(body.address.province, "Ankara");
  assert.equal(body.displayName, "Test Mah., Çankaya, Ankara");
  const b = await reverse("lat=39.92004&lon=32.85404"); // aynı ~110 m ızgarası
  assert.equal(b.status, 200);
  assert.equal(httpCalls.filter((c) => c.url.includes("/reverse")).length, 1);
});

test("reverse: dış servis çökerse 502 ve ayrıntı sızmaz", async () => {
  httpBehavior.fail = true;
  try {
    const res = await reverse("lat=41.0&lon=29.0");
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { success: false, error: "Konum servisine ulaşılamadı" });
  } finally {
    httpBehavior.fail = false;
  }
});

test("coordinates: mahalle isteğe bağlı (il + ilçe yeter)", async () => {
  httpCalls.length = 0;
  const res = await api("/api/location/coordinates?city=Ankara&district=Çankaya", { uid: "alice" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { latitude: "39.9", longitude: "32.8" });
  assert.equal(httpCalls[0].params.q, "Çankaya, Ankara, Turkey");
});

test("coordinates: il/ilçe eksikse 400", async () => {
  assert.equal((await api("/api/location/coordinates?city=Ankara", { uid: "alice" })).status, 400);
});

test.after(closeServer);
