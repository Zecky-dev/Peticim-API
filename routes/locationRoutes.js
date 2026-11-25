import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { geocodeLimiter, locationLimiter } from "../middleware/rateLimit.js";
import { getCities, getDistricts, getNeighborhoods, getCoordinates, reverseGeocode } from "../controllers/locationController.js";

const router = express.Router();

router.use(requireAuth);
router.get("/cities", locationLimiter, getCities);
router.get("/districts", locationLimiter, getDistricts);
router.get("/neighborhoods", locationLimiter, getNeighborhoods);
router.get("/coordinates", geocodeLimiter, getCoordinates);
router.get("/reverse", geocodeLimiter, reverseGeocode);

export default router;
