import { listingsCol } from "./db.js";
import { HttpError } from "./functions.js";

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Kullanıcının sahibi olduğu ilanı döndürür; yoksa 404, başkasınınsa 403 fırlatır. */
export const getOwnedListing = async (listingId, uid) => {
  if (typeof listingId !== "string" || !ID_PATTERN.test(listingId)) {
    throw new HttpError(400, "Geçersiz ilan kimliği");
  }
  const ref = listingsCol().doc(listingId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, "İlan bulunamadı");
  if (snap.data().userId !== uid) throw new HttpError(403, "Bu ilan üzerinde yetkiniz yok");
  return { ref, data: snap.data() };
};
