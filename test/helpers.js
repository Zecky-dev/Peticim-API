// Entegrasyon testi yardımcıları. Gerçek Firestore EMÜLATÖRÜ kullanılır (FIRESTORE_EMULATOR_HOST);
// Firebase Auth, Cloudinary ve dış HTTP (Nominatim/turkiyeapi) sahtelenir. Gerçek projeye hiçbir şey gitmez.
import { mock } from "node:test";
import { createRequire } from "node:module";

process.env.NODE_ENV = "production"; // app.listen çağrılmasın
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST tanımlı değil: testleri `npm run test:emu` ile (emülatörle) çalıştırın.");
}

// Her test dosyası temiz veritabanıyla başlar (emülatör REST ucu).
await fetch(
  `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-peticim/databases/(default)/documents`,
  { method: "DELETE" },
);

const require = createRequire(import.meta.url);
const realAdmin = require("firebase-admin");
if (!realAdmin.apps.length) realAdmin.initializeApp({ projectId: "demo-peticim" });

/** Sahte kimlik: "tok_<uid>" geçerli token'dır. Token içeriği (email, name, picture) `claims[uid]` ile verilir. */
export const claims = {};
export const authUpdates = [];
const fakeAuth = {
  verifyIdToken: async (token) => {
    if (typeof token === "string" && token.startsWith("tok_")) {
      const uid = token.slice(4);
      return { uid, ...(claims[uid] ?? {}) };
    }
    throw Object.assign(new Error("bad token"), { code: "auth/argument-error" });
  },
  updateUser: async (uid, data) => void authUpdates.push({ uid, ...data }),
};
const fakeAdmin = new Proxy(realAdmin, {
  get: (t, p) => (p === "auth" ? () => fakeAuth : t[p]),
});

export const cloudinaryCalls = { uploads: [], destroys: [], deletedPrefixes: [], failNext: false };
const fakeCloudinary = {
  uploader: {
    upload: async (_dataUri, opts) => {
      if (cloudinaryCalls.failNext) throw new Error("cloudinary down");
      cloudinaryCalls.uploads.push(opts.folder);
      const publicId = `${opts.folder}/img_${cloudinaryCalls.uploads.length}`;
      return { secure_url: `https://res.example/${publicId}.jpg`, public_id: publicId };
    },
    destroy: async (id) => void cloudinaryCalls.destroys.push(id),
  },
  api: {
    delete_resources_by_prefix: async (p) => void cloudinaryCalls.deletedPrefixes.push(p),
    delete_folder: async () => ({}),
  },
};

export const httpCalls = [];
export const httpBehavior = { fail: false };
const httpGet = async (url, config) => {
  httpCalls.push({ url, params: config?.params });
  if (httpBehavior.fail) throw new Error("upstream down");
  if (url.includes("/reverse")) {
    return { data: { display_name: "Test Mah., Çankaya, Ankara", address: { road: "Test Cd.", province: "Ankara", suburb: "Çankaya" } } };
  }
  if (url.includes("/search")) return { data: [{ lat: "39.9", lon: "32.8" }] };
  return { data: { data: [] } };
};
const fakeAxios = { create: () => ({ get: httpGet }), get: httpGet };

mock.module("../config/firebase.js", { defaultExport: fakeAdmin });
mock.module("../config/cloudinary.js", { defaultExport: fakeCloudinary });
mock.module("axios", { defaultExport: fakeAxios });

const { default: app } = await import("../app.js");
const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
export const BASE = `http://127.0.0.1:${server.address().port}`;
export const closeServer = () => new Promise((r) => server.close(r));

export const db = realAdmin.firestore();

export const api = (path, { uid, method = "GET", json, form } = {}) => {
  const headers = {};
  if (uid) headers.Authorization = `Bearer tok_${uid}`;
  if (json) headers["Content-Type"] = "application/json";
  return fetch(`${BASE}${path}`, { method, headers, body: json ? JSON.stringify(json) : form });
};

// Geçerli (JPEG başlıklı) küçük bir görsel
export const jpegBytes = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
export const imageForm = (fields, files) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const buf of files) f.append("files", new Blob([buf], { type: "image/jpeg" }), "p.jpg");
  return f;
};

export const makeListing = async (id, userId, extra = {}) => {
  await db.collection("Listings").doc(id).set({ userId, status: "approved", title: "t", images: [], ...extra });
  return id;
};
