import { z } from "zod";

// İstemciden gelen hiçbir şeye güvenilmez: tüm gövdeler katı (strict) şemalarla ayrıştırılır.

const text = (min, max) => z.string().trim().min(min).max(max);

/** 10 haneli cep numarası (5XX...), boşluk/tire/parantez serbest. Orijinal biçim korunur. */
const phone = z
  .string()
  .trim()
  .max(20)
  .refine((v) => {
    const digits = v.replace(/[\s\-()]/g, "");
    return /^5\d{9}$/.test(digits);
  }, "Geçerli bir telefon numarası girin");

const address = z
  .object({
    // Konumdan bulunan adreslerde il/ilçe boş gelebilir.
    city: z.string().trim().max(60).optional(),
    district: z.string().trim().max(60).optional(),
    formattedAddress: text(1, 200),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strip();

export const ensureProfileSchema = z
  .object({
    name: z.string().trim().max(40).optional(),
    surname: z.string().trim().max(40).optional(),
    privacyPolicyAccepted: z.boolean().optional(),
    fcmToken: z.string().min(1).max(4096).nullish(),
  })
  .strict();

export const updateProfileSchema = z
  .object({
    name: text(1, 40).optional(),
    surname: text(1, 40).optional(),
    phone: z.union([phone, z.literal(""), z.null()]).optional(),
    bio: z.union([z.string().trim().max(120), z.null()]).optional(),
    address: z.union([address, z.null()]).optional(),
  })
  .strict();

export const fcmTokenSchema = z.object({ token: z.string().min(1).max(4096) }).strict();

export const createListingSchema = z
  .object({
    listingType: z.enum(["adoption", "lost"]).default("adoption"),
    title: text(8, 48),
    description: text(16, 2000),
    phone,
    animalType: text(1, 40),
    animalBreed: text(1, 60),
    gender: z.enum(["male", "female", ""]).default(""),
    age: z.number().gt(0).max(20).multipleOf(0.5).nullish(),
    vaccinated: z.boolean().nullish(),
    sterilized: z.boolean().nullish(),
    whatsappEnabled: z.boolean().default(true),
    address,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.listingType === "adoption" && !v.gender) {
      ctx.addIssue({ code: "custom", path: ["gender"], message: "Cinsiyet seçilmelidir" });
    }
  });

export const resolvedSchema = z.object({ resolved: z.boolean() }).strict();

export const reportSchema = z
  .object({
    selectedReason: text(1, 100),
    reasonText: z.string().trim().max(500).default(""),
    imageUrl: z.string().url().max(500).nullish(),
  })
  .strict();
