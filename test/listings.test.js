import { test } from "node:test";
import assert from "node:assert/strict";
import { api, db, makeListing, imageForm, jpegBytes, cloudinaryCalls, closeServer } from "./helpers.js";

const valid = {
  title: "Sevimli kedi yuva arıyor",
  description: "Aşıları tam, uysal ve sağlıklı bir kedi.",
  phone: "505 988 01 37",
  animalType: "Kedi",
  animalBreed: "Tekir",
  gender: "female",
  age: 2,
  vaccinated: true,
  sterilized: false,
  address: { city: "Ankara", district: "Çankaya", formattedAddress: "Çankaya, Ankara, Türkiye", latitude: 39.9, longitude: 32.8 },
};
// İlan oluşturma kullanıcı başına saatlik hız sınırına tabidir (geçersiz istekler de sayılır): her çağrıya taze kullanıcı.
let seq = 0;
const fresh = () => `lu${++seq}`;
const create = (uid, data, files = [jpegBytes()]) =>
  api("/api/listings", { uid, method: "POST", form: imageForm({ data: typeof data === "string" ? data : JSON.stringify(data) }, files) });

test("ilan oluşturma: sunucu alanları belirler (userId, status, views, geohash, görseller)", async () => {
  cloudinaryCalls.uploads.length = 0;
  const res = await create("alice", { ...valid });
  assert.equal(res.status, 201);
  const { id, images } = await res.json();
  const d = (await db.doc(`Listings/${id}`).get()).data();
  assert.equal(d.userId, "alice");
  assert.equal(d.status, "pending");
  assert.equal(d.views, 0);
  assert.equal(typeof d.geohash, "string");
  assert.equal(d.geohash.length, 10);
  assert.equal(d.images.length, 1);
  assert.equal(images.length, 1);
  assert.equal(cloudinaryCalls.uploads[0], `Listings/alice/${id}`);
  assert.ok(d.createdAt);
});

test("ilan oluşturma: istemci status/views/userId/geohash/images gönderemez", async () => {
  for (const extra of [{ status: "approved" }, { views: 9999 }, { userId: "victim" }, { geohash: "x" }, { images: [] }, { isDummy: true }]) {
    assert.equal((await create(fresh(), { ...valid, ...extra })).status, 400, JSON.stringify(extra));
  }
});

test("ilan oluşturma: doğrulama kuralları", async () => {
  const bad = [
    { ...valid, title: "kısa" },
    { ...valid, description: "çok kısa" },
    { ...valid, phone: "123" },
    { ...valid, gender: "" }, // sahiplendirmede cinsiyet zorunlu
    { ...valid, age: 25 },
    { ...valid, age: 2.3 },
    { ...valid, address: { ...valid.address, latitude: 120 } },
    { ...valid, address: { ...valid.address, formattedAddress: "" } },
  ];
  for (const b of bad) assert.equal((await create(fresh(), b)).status, 400, JSON.stringify(b).slice(0, 80));
  assert.equal((await create(fresh(), "{bozuk json")).status, 400);
});

test("ilan oluşturma: kayıp ilanında yaş ve sağlık bilgisi sıfırlanır, cinsiyet isteğe bağlı", async () => {
  const res = await create(fresh(), { ...valid, listingType: "lost", gender: "", age: 3, vaccinated: true, sterilized: true });
  assert.equal(res.status, 201);
  const d = (await db.doc(`Listings/${(await res.json()).id}`).get()).data();
  assert.equal(d.age, null);
  assert.equal(d.vaccinated, null);
  assert.equal(d.sterilized, null);
  assert.equal(d.listingType, "lost");
});

test("ilan oluşturma: görsel zorunlu, en çok 5, görsel olmayan içerik reddedilir", async () => {
  assert.equal((await create(fresh(), valid, [])).status, 400);
  assert.equal((await create(fresh(), valid, Array(6).fill(jpegBytes()))).status, 400);
  assert.equal((await create(fresh(), valid, [Buffer.from("not an image at all, just text".padEnd(64))])).status, 400);
});

test("ilan oluşturma: görsel hatasında ilan oluşmaz", async () => {
  const before = (await db.collection("Listings").where("userId", "==", "carol").get()).size;
  const original = cloudinaryCalls.failNext;
  cloudinaryCalls.failNext = true;
  try {
    const res = await create("carol", valid);
    assert.equal(res.status, 502);
  } finally {
    cloudinaryCalls.failNext = original;
  }
  assert.equal((await db.collection("Listings").where("userId", "==", "carol").get()).size, before);
});

test("ilan oluşturma: onay bekleyen ilan sınırı (10)", async () => {
  for (let i = 0; i < 10; i++) await makeListing(`P${i}`, "dave", { status: "pending" });
  const res = await create("dave", valid);
  assert.equal(res.status, 429);
});

test("tamamlandı: yalnızca sahibi, yalnızca approved <-> resolved", async () => {
  await makeListing("R1", "alice", { status: "approved" });
  await makeListing("R2", "alice", { status: "pending" });
  const patch = (uid, id, resolved) => api(`/api/listings/${id}/resolved`, { uid, method: "PATCH", json: { resolved } });

  assert.equal((await patch("mallory", "R1", true)).status, 403);
  assert.equal((await patch("alice", "R2", true)).status, 409, "pending -> resolved olamaz");
  assert.equal((await patch("alice", "R1", false)).status, 409, "approved -> approved geri alma olamaz");
  assert.equal((await patch("alice", "R1", true)).status, 200);
  let d = (await db.doc("Listings/R1").get()).data();
  assert.equal(d.status, "resolved");
  assert.ok(d.resolvedAt);
  assert.equal((await patch("alice", "R1", true)).status, 409);
  assert.equal((await patch("alice", "R1", false)).status, 200);
  d = (await db.doc("Listings/R1").get()).data();
  assert.equal(d.status, "approved");
  assert.equal(d.resolvedAt, undefined);
  assert.equal((await api("/api/listings/R1/resolved", { uid: "alice", method: "PATCH", json: { resolved: "yes" } })).status, 400);
});

test("görüntülenme: 24 saatte bir kez; kendi ilanı ve onaysız ilan sayılmaz", async () => {
  await makeListing("V1", "owner", { status: "approved", views: 0 });
  await makeListing("V2", "owner", { status: "pending", views: 0 });
  const view = (uid, id) => api(`/api/listings/${id}/view`, { uid, method: "POST" });

  assert.deepEqual(await (await view("bob", "V1")).json(), { success: true, counted: true });
  assert.deepEqual(await (await view("bob", "V1")).json(), { success: true, counted: false });
  assert.equal((await db.doc("Listings/V1").get()).data().views, 1);
  assert.equal((await (await view("carol", "V1")).json()).counted, true);
  assert.equal((await db.doc("Listings/V1").get()).data().views, 2);

  assert.equal((await (await view("owner", "V1")).json()).counted, false);
  assert.equal((await (await view("bob", "V2")).json()).counted, false);
  assert.equal((await view("bob", "yok")).status, 404);

  // 24 saat geçince yeniden sayılır
  await db.doc("Listings/V1/viewers/bob").set({ at: new Date(Date.now() - 25 * 3600 * 1000) });
  assert.equal((await (await view("bob", "V1")).json()).counted, true);
  assert.equal((await db.doc("Listings/V1").get()).data().views, 3);
});

test("görüntülenme: eşzamanlı çağrılar tek sayım üretir", async () => {
  await makeListing("V3", "owner", { status: "approved", views: 0 });
  const rs = await Promise.all(Array.from({ length: 5 }, () => api("/api/listings/V3/view", { uid: "zed", method: "POST" }).then((r) => r.json())));
  assert.equal(rs.filter((r) => r.counted).length, 1);
  assert.equal((await db.doc("Listings/V3").get()).data().views, 1);
});

test("rapor: tek kez; ikinci 409; kendi ilanı ve olmayan ilan reddedilir", async () => {
  await makeListing("RP1", "owner");
  const report = (uid, id, body) => api(`/api/listings/${id}/reports`, { uid, method: "POST", json: body });
  const body = { selectedReason: "Uygunsuz İçerik", reasonText: "açıklama" };

  assert.equal((await report("bob", "RP1", body)).status, 201);
  const d = (await db.doc("ListingReports/RP1/reports/bob_RP1").get()).data();
  assert.equal(d.userId, "bob");
  assert.equal(d.selectedReason, "Uygunsuz İçerik");
  assert.ok((await db.doc("ListingReports/RP1").get()).exists);

  const dup = await report("bob", "RP1", body);
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).code, "already_reported");
  assert.equal((await report("owner", "RP1", body)).status, 400);
  assert.equal((await report("bob", "yok", body)).status, 404);
  assert.equal((await report("bob", "RP1", { selectedReason: "" })).status, 400);
  assert.equal((await report("bob", "RP1", { ...body, userId: "x" })).status, 400);
});

test("rapor: görsel adresi yalnızca kullanıcının kendi rapor görseli olabilir", async () => {
  await makeListing("RP2", "owner");
  const report = (uid, imageUrl) => api("/api/listings/RP2/reports", { uid, method: "POST", json: { selectedReason: "Diğer", imageUrl } });
  assert.equal((await report("eve", "https://evil.example/x.jpg")).status, 400);
  assert.equal((await report("eve", "https://res.cloudinary.com/demo/image/upload/v1/report_images/someone-else/a.jpg")).status, 400);
  assert.equal((await report("eve", "https://res.cloudinary.com/demo/image/upload/v1/report_images/eve/a.jpg")).status, 201);
  assert.equal((await db.doc("ListingReports/RP2/reports/eve_RP2").get()).data().imageUrl.includes("/report_images/eve/"), true);
});

test("yasaklı kullanıcı ilan oluşturamaz/raporlayamaz; token yoksa 401", async () => {
  await db.doc("Users/ban2").set({ isBanned: true });
  assert.equal((await create("ban2", valid)).status, 403);
  assert.equal((await api("/api/listings/R1/reports", { uid: "ban2", method: "POST", json: { selectedReason: "x" } })).status, 403);
  assert.equal((await api("/api/listings", { method: "POST" })).status, 401);
});

test.after(closeServer);
