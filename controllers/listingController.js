import * as geofire from "geofire-common";
import { HttpError } from "../utils/functions.js";
import { getOwnedListing } from "../utils/listingAccess.js";
import { deleteCloudinaryFolder, destroyUploaded, uploadToCloudinary, validateFiles } from "../utils/imageHelpers.js";
import { createListingSchema, resolvedSchema, reportSchema } from "../utils/schemas.js";
import { db, listingsCol, FieldValue } from "../utils/db.js";

const MAX_PENDING_PER_USER = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const parseJsonField = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Geçersiz ilan verisi");
  }
};

/**
 * İlan oluşturur. Görseller ve ilan verisi tek istekte gelir (multipart: `data` JSON + `files`).
 * Önce görseller yüklenir, sonra ilan yazılır: yarım kalan akışta görselsiz ilan oluşmaz; hata olursa
 * yüklenmiş görseller geri alınır. `userId`, `status`, `views`, `geohash` ve `createdAt` sunucuda belirlenir.
 */
export const createListing = async (req, res, next) => {
  const uploaded = [];
  try {
    const uid = req.uid;
    const input = createListingSchema.parse(parseJsonField(req.body?.data));
    const files = req.files;

    const fileError = validateFiles(files, "Listings");
    if (fileError) throw new HttpError(400, fileError);

    const pending = await db()
      .collection("Listings")
      .where("userId", "==", uid)
      .where("status", "==", "pending")
      .count()
      .get();
    if (pending.data().count >= MAX_PENDING_PER_USER) {
      throw new HttpError(429, "Onay bekleyen çok fazla ilanınız var. Lütfen onaylanmalarını bekleyin.");
    }

    const ref = listingsCol().doc();
    const folder = `Listings/${uid}/${ref.id}`;

    try {
      for (const file of files) {
        const result = await uploadToCloudinary(file, folder);
        uploaded.push({ ...result, uploadedAt: new Date() });
      }
    } catch {
      throw new HttpError(502, "Görseller yüklenemedi, lütfen tekrar deneyin.");
    }

    const lost = input.listingType === "lost";
    await ref.create({
      userId: uid,
      listingType: input.listingType,
      title: input.title,
      description: input.description,
      phone: input.phone,
      animalType: input.animalType,
      animalBreed: input.animalBreed,
      gender: input.gender,
      // Kayıp ilanında yaş ve sağlık bilgisi sorulmaz.
      age: lost ? null : (input.age ?? null),
      vaccinated: lost ? null : (input.vaccinated ?? null),
      sterilized: lost ? null : (input.sterilized ?? null),
      whatsappEnabled: input.whatsappEnabled,
      address: input.address,
      geohash: geofire.geohashForLocation([input.address.latitude, input.address.longitude]),
      images: uploaded,
      status: "pending",
      views: 0,
      createdAt: FieldValue.serverTimestamp(),
    });

    res.status(201).json({ success: true, id: ref.id, images: uploaded });
  } catch (err) {
    // Yazma başarısız olduysa yüklenmiş görseller yetim kalmasın.
    await destroyUploaded(uploaded);
    next(err);
  }
};

/**
 * İlanı sahibi için tamamen siler: Cloudinary görselleri, `viewers` alt koleksiyonu, ilana ait raporlar
 * ve ilan dokümanı.
 */
export const deleteListing = async (req, res, next) => {
  try {
    const uid = req.uid;
    const listingId = req.params.id;
    const { ref } = await getOwnedListing(listingId, uid);

    await deleteCloudinaryFolder(`Listings/${uid}/${listingId}`);
    await db().recursiveDelete(db().collection("ListingReports").doc(listingId));
    await db().recursiveDelete(ref);

    res.json({ success: true, message: "İlan silindi" });
  } catch (err) {
    next(err);
  }
};

/** Sahibi onaylı ilanını "tamamlandı" yapar ya da geri alır. Başka hiçbir durum geçişi yapılamaz. */
export const setResolved = async (req, res, next) => {
  try {
    const { resolved } = resolvedSchema.parse(req.body ?? {});
    const { ref } = await getOwnedListing(req.params.id, req.uid);

    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const status = snap.data()?.status;
      const from = resolved ? "approved" : "resolved";
      if (status !== from) {
        throw new HttpError(409, "İlanın durumu bu işleme uygun değil", "invalid_transition");
      }
      tx.update(ref, {
        status: resolved ? "resolved" : "approved",
        resolvedAt: resolved ? FieldValue.serverTimestamp() : FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

/** Görüntülenmeyi sayar: aynı kullanıcı için 24 saatte en çok bir kez; kendi ilanı ve onaysız ilan sayılmaz. */
export const registerView = async (req, res, next) => {
  try {
    const uid = req.uid;
    const listingRef = listingsCol().doc(req.params.id);
    const viewerRef = listingRef.collection("viewers").doc(uid);

    const counted = await db().runTransaction(async (tx) => {
      const [listing, viewer] = await Promise.all([tx.get(listingRef), tx.get(viewerRef)]);
      if (!listing.exists) throw new HttpError(404, "İlan bulunamadı");
      const data = listing.data();
      if (data.userId === uid || data.status !== "approved") return false;
      const last = viewer.exists ? viewer.data().at?.toMillis?.() : undefined;
      if (typeof last === "number" && Date.now() - last < DAY_MS) return false;
      tx.set(viewerRef, { at: FieldValue.serverTimestamp() });
      tx.update(listingRef, { views: FieldValue.increment(1) });
      return true;
    });
    res.json({ success: true, counted });
  } catch (err) {
    next(err);
  }
};

const isOwnReportImage = (url, uid) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "res.cloudinary.com" && u.pathname.includes(`/report_images/${uid}/`);
  } catch {
    return false;
  }
};

/** İlanı raporlar. Kullanıcı başına ilan başına tek rapor; rapor görseli kullanıcının kendi yüklemesi olmalı. */
export const reportListing = async (req, res, next) => {
  try {
    const uid = req.uid;
    const listingId = req.params.id;
    const input = reportSchema.parse(req.body ?? {});
    if (input.imageUrl && !isOwnReportImage(input.imageUrl, uid)) {
      throw new HttpError(400, "Geçersiz rapor görseli");
    }

    const listingSnap = await listingsCol().doc(listingId).get();
    if (!listingSnap.exists) throw new HttpError(404, "İlan bulunamadı");
    if (listingSnap.data().userId === uid) throw new HttpError(400, "Kendi ilanınızı raporlayamazsınız");

    const parentRef = db().collection("ListingReports").doc(listingId);
    const reportRef = parentRef.collection("reports").doc(`${uid}_${listingId}`);

    await db().runTransaction(async (tx) => {
      if ((await tx.get(reportRef)).exists) {
        throw new HttpError(409, "Bu ilanı daha önce raporladınız", "already_reported");
      }
      tx.set(parentRef, { createdAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.create(reportRef, {
        userId: uid,
        selectedReason: input.selectedReason,
        reasonText: input.reasonText,
        imageUrl: input.imageUrl || null,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
};
