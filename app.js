import express from "express";
import helmet from "helmet";

// CONFIGS
import * as dotenv from "dotenv";
dotenv.config();

// Firebase initialization
import "./config/firebase.js";

// ROUTES
import imageRoutes from "./routes/imageRoutes.js";
import locationRoutes from "./routes/locationRoutes.js";
import listingRoutes from "./routes/listingRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import { ZodError } from "zod";
import { globalLimiter } from "./middleware/rateLimit.js";
import { HttpError } from "./utils/functions.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Vercel arkasında gerçek istemci IP'si için (rate limit buna dayanır)
app.set("trust proxy", 1);
app.disable("x-powered-by");

// MIDDLEWARES
app.use(helmet());
// CORS bilerek açılmaz: API'yi yalnızca mobil uygulama kullanır, tarayıcıdan çağrı gerekmez.
app.use(globalLimiter);
app.use(express.json({ limit: "10kb" }));

// HEALTH CHECK
app.get("/", (req, res) => {
  res.status(200).json({ service: "peticim-api", status: "ok" });
});

// ROUTE MIDDLEWARES
app.use("/api/image", imageRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/users", userRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Bulunamadı" });
});

// Merkezi hata yönetimi: ayrıntı sızdırmaz
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res
      .status(err.status)
      .json({ success: false, error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  if (err instanceof ZodError) {
    // Yalnızca hatalı alan adları döner; gönderilen değerler yansıtılmaz.
    return res.status(400).json({
      success: false,
      error: "Geçersiz istek",
      fields: [...new Set(err.issues.map((i) => i.path.join(".") || "(gövde)"))],
    });
  }
  if (err?.name === "MulterError") {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "Dosya çok büyük (en fazla 10 MB)." : "Geçersiz dosya yükleme isteği.";
    return res.status(400).json({ success: false, error: msg });
  }
  if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
    return res.status(400).json({ success: false, error: "Geçersiz istek gövdesi" });
  }
  console.error("Beklenmeyen hata:", err?.message);
  res.status(500).json({ success: false, error: "Sunucu hatası" });
});

// SERVER LISTENER
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Server is working on http://localhost:${PORT}`);
  });
}

export default app;
