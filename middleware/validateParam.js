import { HttpError } from "../utils/functions.js";
import { ID_PATTERN } from "../utils/listingAccess.js";

/** `req.params[name]` geçerli bir Firestore doküman kimliği değilse 400 döndürür. */
export const validateIdParam = (name) => (req, _res, next) =>
  ID_PATTERN.test(req.params[name]) ? next() : next(new HttpError(400, "Geçersiz ilan kimliği"));
