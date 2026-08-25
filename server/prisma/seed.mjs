import "dotenv/config";
import { canonicalPermissionSeeds } from "../src/domain/permissionSeeds.js";
import { DEFAULT_ROLE_NAME } from "../src/domain/staff.js";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const result = await prisma.permission.createMany({ data: canonicalPermissionSeeds, skipDuplicates: true });
  console.log(`Default role: ${DEFAULT_ROLE_NAME}`);
  console.log(`Canonical permissions: ${result.count}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (prisma.$disconnect) {
    await prisma.$disconnect();
  }
});
