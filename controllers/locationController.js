import axios from "axios";
import { HttpError } from "../utils/functions.js";

// Nominatim politikası iletişim bilgisi içeren bir User-Agent ister; adres koda gömülmez.
const USER_AGENT = `PeticimApp (${process.env.GEOCODER_CONTACT || "contact-not-set"})`;

const turkeyApi = axios.create({
  baseURL: "https://api.turkiyeapi.dev/v1",
  timeout: 8000,
});

// Basit bellek içi önbellek: dış servislere gidilen istek sayısını azaltır.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 2000;
const cache = new Map();

const cached = async (key, loader) => {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await loader();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
};

const parseId = (value, name) => {
  const s = String(value ?? "");
  if (!/^\d{1,6}$/.test(s)) throw new HttpError(400, `${name} geçersiz`);
  return s;
};

const parseText = (value, name) => {
  if (typeof value !== "string") throw new HttpError(400, `${name} gerekli`);
  const s = value.trim();
  if (!s || s.length > 100) throw new HttpError(400, `${name} geçersiz`);
  return s;
};

const fetchTurkeyData = (endpoint, params, key) =>
  cached(key, async () => {
    try {
      const { data } = await turkeyApi.get(endpoint, { params });
      return data.data || data;
    } catch (err) {
      console.error("turkiyeapi hatası:", err.message);
      throw new HttpError(502, "Konum servisine ulaşılamadı");
    }
  });

export const getCities = async (req, res, next) => {
  try {
    res.json(await fetchTurkeyData("/provinces", { fields: "name,id" }, "cities"));
  } catch (err) {
    next(err);
  }
};

export const getDistricts = async (req, res, next) => {
  try {
    const provinceId = parseId(req.query.provinceId, "provinceId");
    res.json(
      await fetchTurkeyData("/districts", { provinceId, fields: "id,name" }, `d:${provinceId}`),
    );
  } catch (err) {
    next(err);
  }
};

export const getNeighborhoods = async (req, res, next) => {
  try {
    const districtId = parseId(req.query.districtId, "districtId");
    res.json(
      await fetchTurkeyData("/neighborhoods", { districtId, fields: "name,id" }, `n:${districtId}`),
    );
  } catch (err) {
    next(err);
  }
};

export const getCoordinates = async (req, res, next) => {
  try {
    const city = parseText(req.query.city, "city");
    const district = parseText(req.query.district, "district");
    // Mahalle isteğe bağlı: mobil ilan formu yalnızca il + ilçe seçtirir.
    const neighborhood = req.query.neighborhood ? parseText(req.query.neighborhood, "neighborhood") : null;

    const result = await cached(`geo:${city}|${district}|${neighborhood ?? ""}`.toLowerCase(), async () => {
      try {
        const q = [neighborhood, district, city, "Turkey"].filter(Boolean).join(", ");
        const { data } = await axios.get("https://nominatim.openstreetmap.org/search", {
          params: { q, format: "json", limit: 1 },
          headers: { "User-Agent": USER_AGENT },
          timeout: 8000,
        });
        return data?.length ? { latitude: data[0].lat, longitude: data[0].lon } : null;
      } catch (err) {
        console.error("Geocoding hatası:", err.message);
        throw new HttpError(502, "Konum servisine ulaşılamadı");
      }
    });

    if (!result) throw new HttpError(404, "Konum bulunamadı");
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const parseCoord = (value, name, limit) => {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > limit) throw new HttpError(400, `${name} geçersiz`);
  return n;
};

/** Koordinattan adres (ters geocode). Sonuç ~110 m'lik ızgaraya yuvarlanıp önbelleğe alınır. */
export const reverseGeocode = async (req, res, next) => {
  try {
    const lat = parseCoord(req.query.lat, "lat", 90);
    const lon = parseCoord(req.query.lon, "lon", 180);
    const key = `rev:${lat.toFixed(3)},${lon.toFixed(3)}`;

    const result = await cached(key, async () => {
      try {
        const { data } = await axios.get("https://nominatim.openstreetmap.org/reverse", {
          params: { format: "json", lat, lon, "accept-language": "tr" },
          headers: { "User-Agent": USER_AGENT },
          timeout: 8000,
        });
        return { address: data?.address ?? null, displayName: data?.display_name ?? null };
      } catch (err) {
        console.error("Reverse geocoding hatası:", err.message);
        throw new HttpError(502, "Konum servisine ulaşılamadı");
      }
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
};
