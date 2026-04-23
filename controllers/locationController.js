import axios from "axios";

const turkeyApi = axios.create({
  baseURL: "https://api.turkiyeapi.dev/v1",
});

const fetchTurkeyData = async (endpoint, params, res, errorMsg) => {
  try {
    const { data } = await turkeyApi.get(endpoint, { params });
    return res.json(data.data || data);
  } catch (err) {
    console.error(`${errorMsg}:`, err.response?.data || err.message);
    return res.status(500).json({ error: `External API error: ${errorMsg}` });
  }
};

export const getCities = (req, res) =>
  fetchTurkeyData(
    "/provinces",
    { fields: "name,id" },
    res,
    "Failed to fetch cities",
  );

export const getDistricts = (req, res) => {
  const { provinceId } = req.query;
  if (!provinceId)
    return res.status(400).json({ error: "provinceId is required" });

  return fetchTurkeyData(
    "/districts",
    { provinceId, fields: "id,name" },
    res,
    "Failed to fetch districts",
  );
};

export const getNeighborhoods = (req, res) => {
  const { districtId } = req.query;
  if (!districtId)
    return res.status(400).json({ error: "districtId is required" });

  return fetchTurkeyData(
    "/neighborhoods",
    { districtId, fields: "name,id" },
    res,
    "Failed to fetch neighborhoods",
  );
};

export const getCoordinates = async (req, res) => {
  const { city, district, neighborhood } = req.query;

  if (!city || !district || !neighborhood) {
    return res
      .status(400)
      .json({
        error:
          "Missing parameters: city, district, and neighborhood are required",
      });
  }

  try {
    const { data } = await axios.get(
      "https://nominatim.openstreetmap.org/search",
      {
        params: {
          q: `${neighborhood}, ${district}, ${city}, Turkey`,
          format: "json",
          limit: 1,
        },
        headers: { "User-Agent": "PeticimApp (info@peticimapp.com)" },
      },
    );

    if (!data?.length)
      return res.status(404).json({ error: "Location not found" });

    res.json({ latitude: data[0].lat, longitude: data[0].lon });
  } catch (err) {
    console.error("Geocoding error:", err.message);
    res
      .status(500)
      .json({ error: "Location service error: Failed to fetch coordinates" });
  }
};
