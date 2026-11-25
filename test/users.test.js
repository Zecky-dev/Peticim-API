import { test } from "node:test";
import assert from "node:assert/strict";
import { api, db, claims, authUpdates, makeListing, closeServer } from "./helpers.js";

const me = (uid, method, json, path = "") => api(`/api/users/me${path}`, { uid, method, json });

test("profil oluşturma: e-posta kaydı; rol/yasak sunucuda sabit, e-posta token'dan", async () => {
  claims.u1 = { email: "u1@example.com" };
  const res = await me("u1", "POST", { name: "Ayşe", surname: "Kaya", privacyPolicyAccepted: true, fcmToken: "tok-1" });
  assert.equal(res.status, 201);
  const d = (await db.doc("Users/u1").get()).data();
  assert.equal(d.name, "Ayşe");
  assert.equal(d.email, "u1@example.com");
  assert.equal(d.role, "user");
  assert.equal(d.isBanned, false);
  assert.equal(d.fcmToken, "tok-1");
  assert.ok(d.createdAt && d.privacyPolicyAcceptedAt);
  assert.ok(authUpdates.some((u) => u.uid === "u1" && u.displayName === "Ayşe Kaya"));
});

test("profil oluşturma: istemci rol/yasak/e-posta gönderemez (katı şema)", async () => {
  claims.u2 = { email: "u2@example.com" };
  for (const extra of [{ role: "admin" }, { isBanned: false }, { email: "x@y.z" }]) {
    const res = await me("u2", "POST", { name: "A", surname: "B", privacyPolicyAccepted: true, ...extra });
    assert.equal(res.status, 400, JSON.stringify(extra));
  }
  assert.equal((await db.doc("Users/u2").get()).exists, false);
});

test("profil oluşturma: gizlilik politikası kabul edilmeden oluşmaz", async () => {
  claims.u3 = { email: "u3@example.com" };
  assert.equal((await me("u3", "POST", { name: "A", surname: "B" })).status, 400);
  assert.equal((await db.doc("Users/u3").get()).exists, false);
});

test("profil oluşturma: Google — ad ve fotoğraf token'dan", async () => {
  claims.g1 = { email: "g@example.com", name: "Mehmet Ali Yılmaz", picture: "https://lh3.example/p.jpg" };
  assert.equal((await me("g1", "POST", { privacyPolicyAccepted: true })).status, 201);
  const d = (await db.doc("Users/g1").get()).data();
  assert.equal(d.name, "Mehmet Ali");
  assert.equal(d.surname, "Yılmaz");
  assert.equal(d.profilePicture.url, "https://lh3.example/p.jpg");
});

test("profil garantisi tekrar çağrılabilir: mevcut profil ezilmez, yalnızca giriş zamanı/token", async () => {
  await db.doc("Users/e1").set({ name: "Özel", surname: "Ad", role: "user", isBanned: false, profilePicture: { url: "mine", publicId: "p" }, fcmToken: "old" });
  claims.e1 = { email: "e1@example.com", name: "Google Adı", picture: "https://lh3.example/other.jpg" };
  const res = await me("e1", "POST", { fcmToken: "new" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).created, false);
  const d = (await db.doc("Users/e1").get()).data();
  assert.equal(d.name, "Özel");
  assert.equal(d.profilePicture.url, "mine");
  assert.equal(d.fcmToken, "new");
  assert.ok(d.lastLoginAt);
  // token verilmezse eski token silinmez
  await me("e1", "POST", {});
  assert.equal((await db.doc("Users/e1").get()).data().fcmToken, "new");
});

test("profil oluşturma: eşzamanlı iki çağrı tek profil üretir", async () => {
  claims.race = { email: "r@example.com" };
  const body = { name: "R", surname: "R", privacyPolicyAccepted: true };
  const [a, b] = await Promise.all([me("race", "POST", body), me("race", "POST", body)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
});

test("profil güncelleme: yalnızca izinli alanlar; rol/yasak/favoriler değiştirilemez", async () => {
  await db.doc("Users/p1").set({ name: "Eski", surname: "Ad", role: "user", isBanned: false, favorites: ["a"] });
  const ok = await me("p1", "PATCH", { name: "Yeni", phone: "505 988 01 37", bio: "merhaba", address: { formattedAddress: "Çankaya, Ankara", latitude: 39.9, longitude: 32.8 } });
  assert.equal(ok.status, 200);
  const d = (await db.doc("Users/p1").get()).data();
  assert.equal(d.name, "Yeni");
  assert.equal(d.phone, "505 988 01 37");
  assert.equal(d.address.latitude, 39.9);
  for (const bad of [{ role: "admin" }, { isBanned: true }, { favorites: [] }, { email: "x@y.z" }, { fcmToken: "t" }]) {
    assert.equal((await me("p1", "PATCH", bad)).status, 400, JSON.stringify(bad));
  }
  const after = (await db.doc("Users/p1").get()).data();
  assert.equal(after.role, "user");
  assert.equal(after.isBanned, false);
  assert.deepEqual(after.favorites, ["a"]);
});

test("profil güncelleme: doğrulama (telefon, biyografi uzunluğu, boş gövde) ve profil yoksa 404", async () => {
  await db.doc("Users/p2").set({ name: "A", surname: "B" });
  assert.equal((await me("p2", "PATCH", { phone: "123" })).status, 400);
  assert.equal((await me("p2", "PATCH", { bio: "x".repeat(121) })).status, 400);
  assert.equal((await me("p2", "PATCH", {})).status, 400);
  assert.equal((await me("p2", "PATCH", { phone: "" })).status, 200);
  assert.equal((await db.doc("Users/p2").get()).data().phone, null);
  const missing = await me("nobody", "PATCH", { name: "X" });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "profile_missing");
});

test("fcm token: güncellenir, boş ve aşırı uzun reddedilir", async () => {
  await db.doc("Users/t1").set({ name: "A" });
  assert.equal((await me("t1", "PUT", { token: "abc" }, "/fcm-token")).status, 200);
  assert.equal((await db.doc("Users/t1").get()).data().fcmToken, "abc");
  assert.equal((await me("t1", "PUT", { token: "" }, "/fcm-token")).status, 400);
  assert.equal((await me("t1", "PUT", { token: "x".repeat(5000) }, "/fcm-token")).status, 400);
});

test("fcm token silme: yalnızca kayıtlı token eşleşirse siler (başka cihazın token'ı bozulmaz)", async () => {
  await db.doc("Users/c1").set({ name: "A", fcmToken: "dev-A" });
  // Başka bir cihazın (eski) token'ı: silmez.
  const other = await me("c1", "DELETE", { token: "dev-OLD" }, "/fcm-token");
  assert.equal(other.status, 200);
  assert.equal((await other.json()).cleared, false);
  assert.equal((await db.doc("Users/c1").get()).data().fcmToken, "dev-A");
  // Eşleşen token: siler.
  const ok = await me("c1", "DELETE", { token: "dev-A" }, "/fcm-token");
  assert.equal((await ok.json()).cleared, true);
  assert.equal((await db.doc("Users/c1").get()).data().fcmToken, undefined);
  // Tekrar çağrılabilir; profili olmayan kullanıcı da hata almaz; token zorunlu.
  assert.equal((await me("c1", "DELETE", { token: "dev-A" }, "/fcm-token")).status, 200);
  assert.equal((await me("c-yok", "DELETE", { token: "x" }, "/fcm-token")).status, 200);
  assert.equal((await me("c1", "DELETE", {}, "/fcm-token")).status, 400);
  assert.equal((await api("/api/users/me/fcm-token", { method: "DELETE", json: { token: "x" } })).status, 401);
});

test("fcm token: aynı cihaz token'ı yalnızca son giriş yapan hesapta kalır", async () => {
  await db.doc("Users/s1").set({ name: "A", fcmToken: "shared-dev" });
  await db.doc("Users/s2").set({ name: "B" });
  await db.doc("Users/s3").set({ name: "C", fcmToken: "baska-cihaz" });
  // s2 aynı cihazda giriş yaptı (PUT): s1'in token'ı silinir, s3'e dokunulmaz.
  assert.equal((await me("s2", "PUT", { token: "shared-dev" }, "/fcm-token")).status, 200);
  assert.equal((await db.doc("Users/s2").get()).data().fcmToken, "shared-dev");
  assert.equal((await db.doc("Users/s1").get()).data().fcmToken, undefined);
  assert.equal((await db.doc("Users/s3").get()).data().fcmToken, "baska-cihaz");
  // Aynısı profil garantileme (giriş) akışında da geçerli.
  await db.doc("Users/s4").set({ name: "D" });
  assert.equal((await me("s4", "POST", { fcmToken: "shared-dev" })).status, 200);
  assert.equal((await db.doc("Users/s4").get()).data().fcmToken, "shared-dev");
  assert.equal((await db.doc("Users/s2").get()).data().fcmToken, undefined);
});

test("favoriler: ekle/çıkar, tekrar eklemek çift kayıt üretmez; olmayan ilan 404", async () => {
  await db.doc("Users/f1").set({ name: "A", favorites: [] });
  await makeListing("FL1", "someone");
  assert.equal((await me("f1", "POST", undefined, "/favorites/FL1")).status, 200);
  assert.equal((await me("f1", "POST", undefined, "/favorites/FL1")).status, 200);
  assert.deepEqual((await db.doc("Users/f1").get()).data().favorites, ["FL1"]);
  assert.equal((await me("f1", "POST", undefined, "/favorites/yok")).status, 404);
  assert.equal((await me("f1", "DELETE", undefined, "/favorites/FL1")).status, 200);
  assert.deepEqual((await db.doc("Users/f1").get()).data().favorites, []);
  assert.equal((await me("f1", "POST", undefined, "/favorites/a%20b")).status, 400);
});

test("yasaklı kullanıcı hiçbir kullanıcı ucunu kullanamaz; token yoksa 401", async () => {
  await db.doc("Users/ban1").set({ name: "B", isBanned: true });
  assert.equal((await me("ban1", "PATCH", { name: "Y" })).status, 403);
  assert.equal((await me("ban1", "PUT", { token: "x" }, "/fcm-token")).status, 403);
  assert.equal((await api("/api/users/me", { method: "PATCH", json: { name: "Y" } })).status, 401);
});

test.after(closeServer);
