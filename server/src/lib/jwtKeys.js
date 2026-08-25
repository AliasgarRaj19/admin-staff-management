import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { exportJWK } from "jose";
import { env } from "../config/env.js";

const RSA_MODULUS_LENGTH = 3072;
let keyringPromise = null;

function normalizePath(value) {
  const trimmed = String(value || "").trim();
  return trimmed || "";
}

function resolveKid({ kid, fallbackKid, keyPath }) {
  const explicit = String(kid || "").trim();
  if (explicit) return explicit;
  if (keyPath) {
    const basename = path.basename(keyPath).replace(/\.pem$/i, "");
    if (basename) return basename;
  }
  return fallbackKid;
}

async function readPemFile(filePath) {
  return readFile(filePath, "utf8");
}

function generateDevelopmentKeyPair(label, kid) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: RSA_MODULUS_LENGTH,
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  return { label, kid, privateKey: createPrivateKey(privateKey), publicKey: createPublicKey(publicKey) };
}

async function loadSigningKeyset({ label, privateKeyPath, publicKeyPath, kid, fallbackKid }) {
  const normalizedPrivatePath = normalizePath(privateKeyPath);
  const normalizedPublicPath = normalizePath(publicKeyPath);
  const resolvedKid = resolveKid({ kid, fallbackKid, keyPath: normalizedPrivatePath || normalizedPublicPath });
  if (!normalizedPrivatePath) {
    if (env.NODE_ENV === "production") throw new Error(`Missing ${label} signing key path`);
    return generateDevelopmentKeyPair(label, resolvedKid);
  }
  const privatePem = await readPemFile(normalizedPrivatePath);
  const privateKey = createPrivateKey(privatePem);
  const publicKey = normalizedPublicPath ? createPublicKey(await readPemFile(normalizedPublicPath)) : createPublicKey(privateKey);
  return { label, kid: resolvedKid, privateKey, publicKey };
}

async function loadVerificationKeys({ label, currentPublicKey, previousPublicKeyPath, previousKid, fallbackPreviousKid }) {
  const keys = [{ kid: currentPublicKey.kid, publicKey: currentPublicKey.publicKey }];
  const normalizedPreviousPath = normalizePath(previousPublicKeyPath);
  if (normalizedPreviousPath) {
    const kid = resolveKid({ kid: previousKid, fallbackKid: fallbackPreviousKid, keyPath: normalizedPreviousPath });
    keys.push({ kid, publicKey: createPublicKey(await readPemFile(normalizedPreviousPath)) });
  }
  return { label, keys };
}

async function buildKeyring() {
  const access = await loadSigningKeyset({ label: "access", privateKeyPath: env.JWT_ACCESS_PRIVATE_KEY_PATH, publicKeyPath: env.JWT_ACCESS_PUBLIC_KEY_PATH, kid: env.JWT_ACCESS_KID, fallbackKid: "access-dev" });
  const refresh = await loadSigningKeyset({ label: "refresh", privateKeyPath: env.JWT_REFRESH_PRIVATE_KEY_PATH, publicKeyPath: env.JWT_REFRESH_PUBLIC_KEY_PATH, kid: env.JWT_REFRESH_KID, fallbackKid: "refresh-dev" });
  const accessVerification = await loadVerificationKeys({ label: "access", currentPublicKey: access, previousPublicKeyPath: env.JWT_ACCESS_PREVIOUS_PUBLIC_KEY_PATH, previousKid: env.JWT_ACCESS_PREVIOUS_KID, fallbackPreviousKid: "access-previous-dev" });
  const refreshVerification = await loadVerificationKeys({ label: "refresh", currentPublicKey: refresh, previousPublicKeyPath: env.JWT_REFRESH_PREVIOUS_PUBLIC_KEY_PATH, previousKid: env.JWT_REFRESH_PREVIOUS_KID, fallbackPreviousKid: "refresh-previous-dev" });
  return {
    access,
    refresh,
    verification: {
      access: new Map(accessVerification.keys.map((entry) => [entry.kid, entry.publicKey])),
      refresh: new Map(refreshVerification.keys.map((entry) => [entry.kid, entry.publicKey])),
    },
    jwks: accessVerification.keys,
  };
}

export async function getJwtKeyring() {
  if (!keyringPromise) keyringPromise = buildKeyring();
  return keyringPromise;
}

export function resetJwtKeyringForTests() {
  keyringPromise = null;
}

export async function getAccessJwks() {
  const keyring = await getJwtKeyring();
  const keys = [];
  for (const entry of keyring.jwks) {
    const jwk = await exportJWK(entry.publicKey);
    keys.push({ ...jwk, use: "sig", alg: "RS256", kid: entry.kid });
  }
  return { keys };
}
