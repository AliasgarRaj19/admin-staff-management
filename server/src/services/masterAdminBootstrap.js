import { hashPassword } from "../lib/crypto.js";
import { env } from "../config/env.js";

export async function bootstrapMasterAdmin(prisma, { username, password, email }) {
  const resolvedEmail = email ? String(email).toLowerCase() : (String(username).includes("@") ? String(username).toLowerCase() : null);
  const existing = await prisma.masterAdmin.findFirst({
    where: {
      OR: [
        { username },
        ...(resolvedEmail ? [{ email: resolvedEmail }] : []),
      ],
    },
  });
  if (existing) {
    return { created: false, masterAdmin: existing };
  }
  const passwordHash = await hashPassword(password);
  const masterAdmin = await prisma.masterAdmin.create({
    data: {
      username,
      email: resolvedEmail,
      passwordHash,
      status: "active",
    },
  });
  return { created: true, masterAdmin };
}

export async function ensureMasterAdmin(prisma) {
  return bootstrapMasterAdmin(prisma, {
    username: env.MASTER_ADMIN_USERNAME,
    password: env.MASTER_ADMIN_PASSWORD,
    email: env.MASTER_ADMIN_USERNAME.includes("@") ? env.MASTER_ADMIN_USERNAME : null,
  });
}
