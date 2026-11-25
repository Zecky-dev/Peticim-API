import admin from "../config/firebase.js";
import cloudinary from "../config/cloudinary.js";
import {
  validateFiles,
  uploadToCloudinary,
  deleteCloudinaryFolder,
  destroyUploaded,
  MAX_LISTING_IMAGES,
} from "../utils/imageHelpers.js";
import { HttpError } from "../utils/functions.js";
import { getOwnedListing } from "../utils/listingAccess.js";
import { db, usersCol, FieldValue } from "../utils/db.js";

const limitError = () =>
  new HttpError(400, `Her ilan için maksimum ${MAX_LISTING_IMAGES} fotoğraf yüklenebilir.`);

const uploadProfileImage = async (file, uid) => {
  const result = await uploadToCloudinary(file, `profile_images/${uid}`);
  const userRef = usersCol().doc(uid);
  try {
    const prevPublicId = (await userRef.get()).data()?.profilePicture?.publicId;
    await userRef.update({ profilePicture: { ...result, uploadedAt: new Date() } });
    await admin.auth().updateUser(uid, { photoURL: result.url });
    // Eski görsel yalnızca yenisi kaydedildikten sonra silinir; profil silinmiş bir görsele bakmasın.
    if (prevPublicId && prevPublicId !== result.publicId) {
      try {
        await cloudinary.uploader.destroy(prevPublicId);
      } catch (err) {
        console.warn("Eski profil görseli silinemedi:", err.message);
      }
    }
  } catch (err) {
    await destroyUploaded([result]);
    throw err;
  }
  return result;
};

const uploadListingImages = async (files, listingId, uid) => {
  const { ref, data } = await getOwnedListing(listingId, uid);
  const existing = Array.isArray(data.images) ? data.images.length : 0;
  // Ucuz ön kontrol: gereksiz Cloudinary yüklemesi yapılmasın.
  if (existing + files.length > MAX_LISTING_IMAGES) throw limitError();

  const folder = `Listings/${uid}/${listingId}`;
  const uploaded = [];
  try {
    for (const file of files) {
      const result = await uploadToCloudinary(file, folder);
      uploaded.push({ ...result, uploadedAt: new Date() });
    }
    // Eşzamanlı isteklere karşı sınır, yazma anında transaction içinde yeniden doğrulanır.
    await db().runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data()?.images;
      if ((Array.isArray(current) ? current.length : 0) + uploaded.length > MAX_LISTING_IMAGES) {
        throw limitError();
      }
      tx.update(ref, { images: FieldValue.arrayUnion(...uploaded) });
    });
  } catch (err) {
    await destroyUploaded(uploaded);
    throw err;
  }
  return uploaded;
};

export const uploadImages = async (req, res, next) => {
  try {
    const uid = req.uid;
    const { folder, listingId } = req.body;
    const files = req.files;

    if (typeof folder !== "string" || !folder)
      throw new HttpError(400, "folder gerekli");
    if (!files || files.length === 0) throw new HttpError(400, "Dosya yüklenmedi");

    // Klasör istemciden gelse de yalnızca bilinen türlere izin verilir; yol uid'den sunucuda üretilir.
    const isListingFolder = folder.startsWith("Listings/");
    if (!["profile_images", "report_images"].includes(folder) && !isListingFolder)
      throw new HttpError(400, "Geçersiz klasör");

    const validationError = validateFiles(files, folder);
    if (validationError) throw new HttpError(400, validationError);

    let uploadedImages;
    if (folder === "profile_images") {
      uploadedImages = [await uploadProfileImage(files[0], uid)];
    } else if (folder === "report_images") {
      // Rapor görseli ilana eklenmez; yalnızca yüklenip adresi döndürülür.
      const result = await uploadToCloudinary(files[0], `report_images/${uid}`);
      uploadedImages = [{ ...result, uploadedAt: new Date() }];
    } else {
      uploadedImages = await uploadListingImages(files, listingId, uid);
    }

    res.json({ success: true, message: "Images uploaded successfully", uploadedImages });
  } catch (err) {
    next(err);
  }
};

export const deleteImages = async (req, res, next) => {
  try {
    const uid = req.uid;
    const { listingId } = req.body;
    const { ref } = await getOwnedListing(listingId, uid);

    await deleteCloudinaryFolder(`Listings/${uid}/${listingId}`);
    await ref.update({ images: [] });

    res.json({ success: true, message: "Görseller silindi" });
  } catch (err) {
    next(err);
  }
};
