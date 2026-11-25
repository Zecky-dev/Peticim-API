import admin from "../config/firebase.js";

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

/** "Bearer <idToken>" başlığını doğrular ve çözülmüş token'ı döndürür. */
export const verifyToken = async (authHeader) => {
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    throw new HttpError(401, "Yetkisiz erişim");
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw new HttpError(401, "Yetkisiz erişim");
  try {
    // checkRevoked: hesabı kapatılan/oturumu iptal edilen kullanıcıların token'ı reddedilir
    return await admin.auth().verifyIdToken(token, true);
  } catch {
    throw new HttpError(401, "Yetkisiz erişim");
  }
};
