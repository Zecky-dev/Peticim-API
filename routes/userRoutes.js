import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rateLimit.js";
import { validateIdParam } from "../middleware/validateParam.js";
import {
  ensureProfile,
  updateProfile,
  setFcmToken,
  clearFcmToken,
  addFavorite,
  removeFavorite,
} from "../controllers/userController.js";

const router = express.Router();
router.use(requireAuth, writeLimiter);

const validListingId = validateIdParam("listingId");

router.post("/me", ensureProfile);
router.patch("/me", updateProfile);
router.put("/me/fcm-token", setFcmToken);
router.delete("/me/fcm-token", clearFcmToken);
router.post("/me/favorites/:listingId", validListingId, addFavorite);
router.delete("/me/favorites/:listingId", validListingId, removeFavorite);

export default router;
