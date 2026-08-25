import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/env.js";
import { getAccessJwks, getJwtKeyring, resetJwtKeyringForTests } from "./jwtKeys.js";

async function getKeyset(name) {
  const keyring = await getJwtKeyring();
  return keyring[name];
}

async function signToken({ payload, keysetName, type, expiresIn, extraClaims = {} }) {
  const keyset = await getKeyset(keysetName);
  let builder = new SignJWT({ ...payload, ...extraClaims, typ: type })
    .setProtectedHeader({ alg: "RS256", kid: keyset.kid })
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn);
  if (extraClaims.jti) builder = builder.setJti(extraClaims.jti);
  return builder.sign(keyset.privateKey);
}

async function verifyWithKeyset(token, keysetName) {
  return jwtVerify(token, async (header) => {
    const kid = String(header?.kid || "").trim();
    if (!kid) throw new Error("Missing kid");
    const keyring = await getJwtKeyring();
    const key = keyring.verification[keysetName].get(kid);
    if (!key) throw new Error("Unknown kid");
    return key;
  }, { issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE, algorithms: ["RS256"] });
}

export async function signAccessToken(payload) {
  return signToken({
    payload,
    keysetName: "access",
    type: "access",
    expiresIn: "15m",
    extraClaims: { jti: crypto.randomUUID() },
  });
}

export async function signRefreshToken(payload) {
  return signToken({
    payload,
    keysetName: "refresh",
    type: "refresh",
    expiresIn: "7d",
    extraClaims: { jti: crypto.randomUUID() },
  });
}

export async function verifyAccessToken(token) {
  const result = await verifyWithKeyset(token, "access");
  if (result.payload.typ !== "access") throw new Error("Invalid token type");
  return result;
}

export async function verifyRefreshToken(token) {
  const result = await verifyWithKeyset(token, "refresh");
  if (result.payload.typ !== "refresh") throw new Error("Invalid token type");
  return result;
}

export { getAccessJwks, resetJwtKeyringForTests };
