import "dotenv/config";

const num = (v, d) => (v !== undefined && v !== "" ? Number(v) : d);
const MB = 1024 * 1024;
const production = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET || "dev-secret-change-me";

if (production && jwtSecret === "dev-secret-change-me") {
  throw new Error("JWT_SECRET must be set to a strong, unique value in production");
}

export const cfg = {
  port: num(process.env.PORT, 8080),
  dataDir: process.env.DATA_DIR || "./data",
  jwtSecret,
  secureCookies: production,
  corsOrigins: String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  // Telegram
  apiId: num(process.env.TG_API_ID, 0),
  apiHash: process.env.TG_API_HASH || "",
  botToken: process.env.TG_BOT_TOKEN || "",
  botUsername: process.env.TG_BOT_USERNAME || "Telemoon2bot",
  session: process.env.TG_SESSION || "", // optional: reuse a saved session (or a premium user session)
  channel: process.env.TG_CHANNEL_ID || "", // "-100xxxxxxxxxx" or "@username"

  // Chunking. Telegram hard cap: 2 GB/message via bot MTProto, 4 GB via premium user session.
  chunkBytes: Math.min(num(process.env.CHUNK_MB, 1536), 1900) * MB,
};
