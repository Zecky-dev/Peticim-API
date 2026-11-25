// config/firebase.js
import "dotenv/config";
import admin from "firebase-admin";

if (!admin.apps.length) {
  const { FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_PROJECT_ID } = process.env;
  const missing = Object.entries({ FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_PROJECT_ID })
    .filter(([, value]) => !value)
    .map(([name]) => name);

  // Eksik yapılandırmada ayağa kalkmak yerine hemen durulur: aksi halde her istek 500 döner.
  if (missing.length > 0) {
    throw new Error(`Firebase yapılandırması eksik: ${missing.join(", ")}`);
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      projectId: FIREBASE_PROJECT_ID,
    }),
  });
}

export default admin;
