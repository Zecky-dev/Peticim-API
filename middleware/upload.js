import multer from "multer";
import { MAX_FILE_SIZE, MAX_LISTING_IMAGES } from "../utils/imageHelpers.js";

/** Dosyalar bellekte tutulduğu için boyut/adet sınırı multer seviyesinde uygulanır. */
export const createImageUpload = ({ fields, fieldSize }) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_LISTING_IMAGES, fields, fieldSize },
  });
