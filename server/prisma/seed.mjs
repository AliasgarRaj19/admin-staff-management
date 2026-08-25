import { canonicalPermissionSeeds } from "../src/domain/permissionSeeds.js";
import { DEFAULT_ROLE_NAME } from "../src/domain/staff.js";

async function main() {
  console.log(`Default role: ${DEFAULT_ROLE_NAME}`);
  console.log(`Canonical permissions: ${canonicalPermissionSeeds.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
