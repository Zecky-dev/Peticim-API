import express from "express";

// CONFIGS
import * as dotenv from "dotenv";
dotenv.config();

// Firebase initialization (if needed for other services)
import "./config/firebase.js";

// ROUTES
import imageRoutes from "./routes/imageRoutes.js";
import locationRoutes from "./routes/locationRoutes.js";

const app = express();
const PORT = process.env.PORT || 3000;

// MIDDLEWARES
app.use(express.json());

// HEALTH CHECK
app.get("/", (req, res) => {
  res.status(200).send("Hello API is working!");
});

// ROUTE MIDDLEWARES
app.use("/api/image", imageRoutes);
app.use("/api/location", locationRoutes);

// SERVER LISTENER
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Server is working on http://localhost:${PORT}`);
  });
}

export default app;
