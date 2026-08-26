import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { bootstrapMasterAdmin } from "../src/services/masterAdminBootstrap.js";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

async function main() {
  const username = readArg("--username") || String(process.env.MASTER_ADMIN_USERNAME || "").trim();
  const password = readArg("--password") || String(process.env.MASTER_ADMIN_PASSWORD || "").trim();
  const email = readArg("--email") || String(process.env.MASTER_ADMIN_EMAIL || "").trim();
  if (!username || !password) {
    throw new Error("MASTER_ADMIN_USERNAME and MASTER_ADMIN_PASSWORD must be provided.");
  }
  const result = await bootstrapMasterAdmin(prisma, {
    username,
    password,
    email: email || null,
  });
  console.log(result.created ? "MasterAdmin created." : "MasterAdmin already exists.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
}).finally(async () => {
  if (prisma.$disconnect) await prisma.$disconnect();
});
