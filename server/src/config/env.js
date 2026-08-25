import "dotenv/config";

const toBool = (value, fallback = false) => {
  if (value == null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
};

export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT || 5500),
  CLIENT_URL: process.env.CLIENT_URL || "http://localhost:5501",
  APP_URL: process.env.APP_URL || "http://localhost:5500",
  APP_BASE_PATH: process.env.APP_BASE_PATH || "",
  DATABASE_URL: process.env.DATABASE_URL || "",
  JWT_ISSUER: process.env.JWT_ISSUER || "admin-staff-management",
  JWT_AUDIENCE: process.env.JWT_AUDIENCE || "admin-staff-management-staff",
  JWT_ACCESS_PRIVATE_KEY_PATH: process.env.JWT_ACCESS_PRIVATE_KEY_PATH || "",
  JWT_ACCESS_PUBLIC_KEY_PATH: process.env.JWT_ACCESS_PUBLIC_KEY_PATH || "",
  JWT_ACCESS_PREVIOUS_PUBLIC_KEY_PATH: process.env.JWT_ACCESS_PREVIOUS_PUBLIC_KEY_PATH || "",
  JWT_ACCESS_KID: process.env.JWT_ACCESS_KID || "",
  JWT_ACCESS_PREVIOUS_KID: process.env.JWT_ACCESS_PREVIOUS_KID || "",
  JWT_REFRESH_PRIVATE_KEY_PATH: process.env.JWT_REFRESH_PRIVATE_KEY_PATH || "",
  JWT_REFRESH_PUBLIC_KEY_PATH: process.env.JWT_REFRESH_PUBLIC_KEY_PATH || "",
  JWT_REFRESH_PREVIOUS_PUBLIC_KEY_PATH: process.env.JWT_REFRESH_PREVIOUS_PUBLIC_KEY_PATH || "",
  JWT_REFRESH_KID: process.env.JWT_REFRESH_KID || "",
  JWT_REFRESH_PREVIOUS_KID: process.env.JWT_REFRESH_PREVIOUS_KID || "",
  RATE_LIMIT_DEV_MULTIPLIER: Number(process.env.RATE_LIMIT_DEV_MULTIPLIER || 20),
  RATE_LIMIT_DEV_WINDOW_MS: Number(process.env.RATE_LIMIT_DEV_WINDOW_MS || 60_000),
  TRUST_PROXY_HOPS: Number(process.env.TRUST_PROXY_HOPS || 0),
  COOKIE_SECURE: toBool(process.env.COOKIE_SECURE, process.env.NODE_ENV === "production"),
  MASTER_ADMIN_USERNAME: process.env.MASTER_ADMIN_USERNAME || "admin@example.com",
  MASTER_ADMIN_PASSWORD: process.env.MASTER_ADMIN_PASSWORD || "change-me",
};
