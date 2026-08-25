import { canonicalPermissions, permissionModule } from "./permissions.js";

export const canonicalPermissionSeeds = Object.freeze(
  canonicalPermissions.map((key) => ({
    id: key,
    key,
    displayName: key
      .split(".")
      .map((segment) => segment.replaceAll("_", " "))
      .join(" ")
      .replace(/\b\w/g, (character) => character.toUpperCase()),
    description: null,
    module: permissionModule(key),
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
);
