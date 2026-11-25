import cloudinary from "../config/cloudinary.js";

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_LISTING_IMAGES = 5;

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/bmp",
  "image/tiff",
  "image/webp",
];

/** Dosya içeriğinin (magic bytes) gerçekten bir görsel olduğunu doğrular; mimetype istemciden gelir, güvenilmez. */
const hasImageSignature = (buf) => {
  if (!buf || buf.length < 12) return false;
  const startsWith = (...bytes) => bytes.every((b, i) => buf[i] === b);
  if (startsWith(0xff, 0xd8, 0xff)) return true; // JPEG
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return true; // PNG
  if (startsWith(0x42, 0x4d)) return true; // BMP
  if (startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a)) return true; // TIFF
  const tag = buf.toString("ascii", 0, 4);
  if (tag === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return true; // WebP
  if (buf.toString("ascii", 4, 8) === "ftyp") return true; // HEIC/HEIF
  return false;
};

export const validateFiles = (files, folder) => {
  if (!files || files.length === 0) return "Dosya yüklenmedi.";
  for (const file of files) {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return `Geçersiz dosya tipi: ${file.mimetype}`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return "Dosya çok büyük (en fazla 10 MB).";
    }
    if (!hasImageSignature(file.buffer)) {
      return "Dosya geçerli bir görsel değil.";
    }
  }
  if ((folder === "profile_images" || folder === "report_images") && files.length > 1) {
    return "Bu alan için sadece 1 fotoğraf yükleyebilirsin.";
  }
  if (files.length > MAX_LISTING_IMAGES) {
    return `Her ilan için maksimum ${MAX_LISTING_IMAGES} fotoğraf yüklenebilir.`;
  }
  return null;
};

// Cloudinary upload öncesi resim düzenlemeleri
const getTransformation = (folder) => {
  if (folder.startsWith("profile_images")) {
    return [
      { width: 400, height: 400, crop: "limit" },
      { quality: "auto" },
      { fetch_format: "auto" },
    ];
  }
  if (folder.startsWith("Listings") || folder.startsWith("report_images")) {
    return [
      { width: 1200, height: 1200, crop: "limit" },
      { quality: "auto:good" },
      { fetch_format: "auto" },
    ];
  }
  return [];
};

export const uploadToCloudinary = async (file, folder) => {
  const dataUri = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder,
    resource_type: "image",
    transformation: getTransformation(folder),
  });
  return { url: result.secure_url, publicId: result.public_id };
};

export const deleteCloudinaryFolder = async (folderPrefix) => {
  try {
    await cloudinary.api.delete_resources_by_prefix(folderPrefix);
    await cloudinary.api.delete_folder(folderPrefix);
  } catch (err) {
    console.warn("Cloudinary folder deletion failed:", err.message);
  }
};

/** Yüklenmiş görselleri geri alır (yarım kalan akışta yetim dosya bırakmamak için). Hatalar yutulur. */
export const destroyUploaded = (images) =>
  Promise.allSettled(images.map((img) => cloudinary.uploader.destroy(img.publicId)));
