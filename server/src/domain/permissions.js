const entries = [
  ["staff", ["staff.read", "staff.create", "staff.manage", "staff.permissions", "staff.block", "staff.restore", "staff.remove", "staff.permanent_delete"]],
  ["permissions", ["permissions.manage"]],
  ["audit", ["audit_logs.read"]],
  ["pages", ["pages.read", "pages.create", "pages.edit", "pages.delete"]],
  ["blog", ["blog.read", "blog.create", "blog.edit", "blog.publish", "blog.delete"]],
  ["contact", ["contact.read", "contact.reply", "contact.assign", "contact.delete"]],
  ["support", ["support.read", "support.reply", "support.manage"]],
  ["careers", ["careers.read", "careers.jobs.manage", "careers.applications.manage"]],
  ["ecommerce", ["ecommerce.orders.read", "ecommerce.orders.manage", "ecommerce.products.read", "ecommerce.products.manage"]],
];

export const permissionGroups = Object.freeze(Object.fromEntries(entries.map(([key, value]) => [key, Object.freeze([...value])])));
export const canonicalPermissions = Object.freeze([...new Set(entries.flatMap(([, value]) => value))]);

export function permissionModule(permissionKey) {
  const [moduleName] = String(permissionKey).split(".");
  return moduleName ?? "unknown";
}
