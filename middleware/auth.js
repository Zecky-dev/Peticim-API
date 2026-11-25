import { usersCol } from "../utils/db.js";
import { verifyToken, HttpError } from "../utils/functions.js";

/**
 * Geçerli Firebase ID token zorunlu kılar. Doğrulanan uid `req.uid` olarak eklenir;
 * kullanıcı kimliği asla istek gövdesinden alınmaz.
 * Yasaklı (isBanned) kullanıcılar işlem yapamaz.
 */
export const requireAuth = async (req, res, next) => {
  try {
    const decoded = await verifyToken(req.headers.authorization);
    const userSnap = await usersCol().doc(decoded.uid).get();
    if (userSnap.exists && userSnap.data()?.isBanned === true) {
      throw new HttpError(403, "Hesabınız askıya alınmıştır");
    }
    req.uid = decoded.uid;
    req.token = decoded;
    next();
  } catch (err) {
    next(err);
  }
};
