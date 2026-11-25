import { rateLimit, ipKeyGenerator } from "express-rate-limit";

// Kimliği doğrulanmış isteklerde kullanıcı başına, aksi halde IP başına sayar
const byUserOrIp = (req) => req.uid || ipKeyGenerator(req.ip);

const make = (windowMs, limit, message, keyGenerator) =>
  rateLimit({
    ...(keyGenerator ? { keyGenerator } : {}),
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, error: message },
  });

// Tüm istekler için genel tavan (IP başına)
export const globalLimiter = make(
  60 * 1000,
  120,
  "Çok fazla istek. Lütfen biraz sonra tekrar deneyin.",
);

// Görsel yükleme/silme: pahalı işlemler (Cloudinary + Firestore)
export const imageWriteLimiter = make(
  10 * 60 * 1000,
  30,
  "Çok fazla görsel işlemi yaptınız. Lütfen daha sonra tekrar deneyin.",
  byUserOrIp,
);

// Nominatim politikası ~1 istek/sn; ayrıca sonuçlar önbelleğe alınır
export const geocodeLimiter = make(
  60 * 1000,
  20,
  "Çok fazla konum isteği. Lütfen biraz sonra tekrar deneyin.",
);

export const locationLimiter = make(
  60 * 1000,
  60,
  "Çok fazla istek. Lütfen biraz sonra tekrar deneyin.",
);

// Hafif yazma işlemleri (profil, favori, token, görüntülenme, tamamlandı): kullanıcı başına
export const writeLimiter = make(
  10 * 60 * 1000,
  120,
  "Çok fazla işlem yaptınız. Lütfen biraz sonra tekrar deneyin.",
  byUserOrIp,
);

// İlan oluşturma: pahalı (görsel yükleme) ve kötüye kullanıma açık
export const createListingLimiter = make(
  60 * 60 * 1000,
  10,
  "Saatlik ilan oluşturma sınırına ulaştınız. Lütfen daha sonra tekrar deneyin.",
  byUserOrIp,
);

export const reportLimiter = make(
  60 * 60 * 1000,
  20,
  "Çok fazla rapor gönderdiniz. Lütfen daha sonra tekrar deneyin.",
  byUserOrIp,
);
