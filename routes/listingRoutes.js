import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { createListingLimiter, imageWriteLimiter, reportLimiter, writeLimiter } from "../middleware/rateLimit.js";
import { createImageUpload } from "../middleware/upload.js";
import { validateIdParam } from "../middleware/validateParam.js";
import { MAX_LISTING_IMAGES } from "../utils/imageHelpers.js";
import {
  createListing,
  deleteListing,
  setResolved,
  registerView,
  reportListing,
} from "../controllers/listingController.js";

const router = express.Router();
router.use(requireAuth);

const upload = createImageUpload({ fields: 5, fieldSize: 16 * 1024 });
const validId = validateIdParam("id");

router.post("/", createListingLimiter, upload.array("files", MAX_LISTING_IMAGES), createListing);
router.delete("/:id", validId, imageWriteLimiter, deleteListing);
router.patch("/:id/resolved", validId, writeLimiter, setResolved);
router.post("/:id/view", validId, writeLimiter, registerView);
router.post("/:id/reports", validId, reportLimiter, reportListing);

export default router;
