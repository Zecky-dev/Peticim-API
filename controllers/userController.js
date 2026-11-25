import admin from "../config/firebase.js";
import { HttpError } from "../utils/functions.js";
import { listingsCol, usersCol, FieldValue } from "../utils/db.js";
import { ensureProfileSchema, updateProfileSchema, fcmTokenSchema } from "../utils/schemas.js";

/**
 * Bir cihaz token'ı aynı anda tek hesapta tutulur. Aynı cihazda hesap değişince (çıkış yapılmadan,
 * uygulama silinip kurularak ya da ağ hatasıyla çıkışta temizlenemeyerek) eski hesapta kalan token'ı
 * siler; aksi halde önceki hesabın bildirimleri yeni kullanıcının cihazına gider.
 */
const releaseTokenFromOthers = async (token, uid) => {
  try {
    const snap = await usersCol().where("fcmToken", "==", token).get();
    const stale = snap.docs.filter((d) => d.id !== uid);
    await Promise.all(stale.map((d) => d.ref.update({ fcmToken: FieldValue.delete() })));
  } catch {
    // Temizlik başarısızsa asıl işlem (token'ı kaydetmek) engellenmez.
  }
};

const splitName = (displayName) => {
  const parts = String(displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { name: parts[0] ?? "", surname: "" };
  const surname = parts.pop();
  return { name: parts.join(" "), surname };
};

const syncDisplayName = async (uid, name, surname) => {
  try {
    await admin.auth().updateUser(uid, { displayName: `${name} ${surname}`.trim() });
  } catch {
    // Görünen ad yalnızca kozmetik; başarısız olması profili bozmamalı.
  }
};

/**
 * Oturum açan kullanıcının profilini garanti eder (tekrar çağrılabilir).
 * Profil yoksa oluşturur: e-posta ve fotoğraf token'dan, rol/yasak durumu sunucuda sabit.
 * Varsa yalnızca `lastLoginAt` (ve verildiyse `fcmToken`) güncellenir.
 */
export const ensureProfile = async (req, res, next) => {
  try {
    const input = ensureProfileSchema.parse(req.body ?? {});
    const uid = req.uid;
    const token = req.token;
    const ref = usersCol().doc(uid);

    const touch = async () => {
      await ref.update({
        lastLoginAt: FieldValue.serverTimestamp(),
        ...(input.fcmToken ? { fcmToken: input.fcmToken } : {}),
      });
      if (input.fcmToken) await releaseTokenFromOthers(input.fcmToken, uid);
    };

    if ((await ref.get()).exists) {
      await touch();
      return res.json({ success: true, created: false });
    }

    if (input.privacyPolicyAccepted !== true) {
      throw new HttpError(400, "Devam etmek için Gizlilik Politikası kabul edilmelidir");
    }

    const fromToken = splitName(token.name);
    const name = input.name || fromToken.name;
    const surname = input.surname ?? fromToken.surname;

    try {
      await ref.create({
        name,
        surname,
        email: token.email ?? null,
        role: "user",
        isBanned: false,
        privacyPolicyAccepted: true,
        privacyPolicyAcceptedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        ...(token.picture ? { profilePicture: { url: token.picture } } : {}),
        ...(input.fcmToken ? { fcmToken: input.fcmToken } : {}),
      });
    } catch (err) {
      // Eşzamanlı iki çağrı: biri oluşturdu, diğeri yalnızca giriş zamanını günceller.
      if (err?.code === 6) {
        await touch();
        return res.json({ success: true, created: false });
      }
      throw err;
    }

    if (input.fcmToken) await releaseTokenFromOthers(input.fcmToken, uid);
    if (name) await syncDisplayName(uid, name, surname);
    res.status(201).json({ success: true, created: true });
  } catch (err) {
    next(err);
  }
};

/** Profil düzenleme: yalnızca izinli alanlar (ad, soyad, telefon, biyografi, adres). */
export const updateProfile = async (req, res, next) => {
  try {
    const input = updateProfileSchema.parse(req.body ?? {});
    const ref = usersCol().doc(req.uid);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, "Profil bulunamadı", "profile_missing");

    const update = {};
    for (const key of ["name", "surname", "bio", "address"]) {
      if (input[key] !== undefined) update[key] = input[key];
    }
    if (input.phone !== undefined) update.phone = input.phone || null;
    if (Object.keys(update).length === 0) throw new HttpError(400, "Güncellenecek alan yok");

    update.updatedAt = FieldValue.serverTimestamp();
    await ref.update(update);

    if (update.name !== undefined || update.surname !== undefined) {
      const current = snap.data();
      await syncDisplayName(req.uid, update.name ?? current.name ?? "", update.surname ?? current.surname ?? "");
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

export const setFcmToken = async (req, res, next) => {
  try {
    const { token } = fcmTokenSchema.parse(req.body ?? {});
    const ref = usersCol().doc(req.uid);
    if (!(await ref.get()).exists) throw new HttpError(404, "Profil bulunamadı", "profile_missing");
    await ref.update({ fcmToken: token });
    await releaseTokenFromOthers(token, req.uid);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

/**
 * Çıkışta çağrılır: yalnızca gönderilen token hesapta kayıtlıysa siler. Böylece kullanıcı başka bir
 * cihazda hâlâ girişliyse onun (daha yeni) token'ı bozulmaz. Profil/token yoksa da başarılı döner.
 */
export const clearFcmToken = async (req, res, next) => {
  try {
    const { token } = fcmTokenSchema.parse(req.body ?? {});
    const ref = usersCol().doc(req.uid);
    const snap = await ref.get();
    let cleared = false;
    if (snap.exists && snap.data().fcmToken === token) {
      await ref.update({ fcmToken: FieldValue.delete() });
      cleared = true;
    }
    res.json({ success: true, cleared });
  } catch (err) {
    next(err);
  }
};

const MAX_FAVORITES = 500;

export const addFavorite = async (req, res, next) => {
  try {
    const listingId = req.params.listingId;
    const userRef = usersCol().doc(req.uid);
    const [userSnap, listingSnap] = await Promise.all([
      userRef.get(),
      listingsCol().doc(listingId).get(),
    ]);
    if (!userSnap.exists) throw new HttpError(404, "Profil bulunamadı", "profile_missing");
    if (!listingSnap.exists) throw new HttpError(404, "İlan bulunamadı");
    const favorites = userSnap.data().favorites ?? [];
    if (!favorites.includes(listingId) && favorites.length >= MAX_FAVORITES) {
      throw new HttpError(400, "Favori sınırına ulaştınız");
    }
    await userRef.update({ favorites: FieldValue.arrayUnion(listingId) });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

export const removeFavorite = async (req, res, next) => {
  try {
    const userRef = usersCol().doc(req.uid);
    if (!(await userRef.get()).exists) throw new HttpError(404, "Profil bulunamadı", "profile_missing");
    await userRef.update({ favorites: FieldValue.arrayRemove(req.params.listingId) });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
