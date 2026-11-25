import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { imageWriteLimiter } from "../middleware/rateLimit.js";
import { createImageUpload } from "../middleware/upload.js";
import { uploadImages, deleteImages } from "../controllers/imageController.js";
import { MAX_LISTING_IMAGES } from "../utils/imageHelpers.js";

const router = express.Router();

const upload = createImageUpload({ fields: 10, fieldSize: 1024 });

// Sıra önemli: önce kimlik, sonra limit (kullanıcı başına), en son dosya ayrıştırma
router.post("/upload", requireAuth, imageWriteLimiter, upload.array("files", MAX_LISTING_IMAGES), uploadImages);
router.post("/delete", requireAuth, imageWriteLimiter, deleteImages);

export default router;
