export const PERMISSION_NAV_GROUPS = [
  {
    label: "Pages",
    items: [
      { key: "pages.read", label: "Pages" },
      { key: "pages.create", label: "Create Pages" },
      { key: "pages.edit", label: "Edit Pages" },
      { key: "pages.delete", label: "Delete Pages" },
    ],
  },
  {
    label: "Blog",
    items: [
      { key: "blog.read", label: "Blog" },
      { key: "blog.create", label: "Create Blog" },
      { key: "blog.edit", label: "Edit Blog" },
      { key: "blog.publish", label: "Publish Blog" },
      { key: "blog.delete", label: "Delete Blog" },
    ],
  },
  {
    label: "Contact",
    items: [
      { key: "contact.read", label: "Contact" },
      { key: "contact.reply", label: "Reply Contact" },
      { key: "contact.assign", label: "Assign Contact" },
      { key: "contact.delete", label: "Delete Contact" },
    ],
  },
  {
    label: "Support",
    items: [
      { key: "support.read", label: "Support" },
      { key: "support.reply", label: "Reply Support" },
      { key: "support.manage", label: "Manage Support" },
    ],
  },
  {
    label: "Careers",
    items: [
      { key: "careers.read", label: "Careers" },
      { key: "careers.jobs.manage", label: "Manage Jobs" },
      { key: "careers.applications.manage", label: "Manage Applications" },
    ],
  },
  {
    label: "Ecommerce",
    items: [
      { key: "ecommerce.orders.read", label: "Orders" },
      { key: "ecommerce.orders.manage", label: "Manage Orders" },
      { key: "ecommerce.products.read", label: "Products" },
      { key: "ecommerce.products.manage", label: "Manage Products" },
    ],
  },
];

export function hasPermission(permissions, key) {
  return new Set((permissions || []).map((permission) => permission.key || permission)).has(key);
}

export function toPermissionKeys(permissions = []) {
  return permissions.map((permission) => permission.key || permission).filter(Boolean);
}

export function buildModuleLinks(permissions = []) {
  const allowed = new Set(toPermissionKeys(permissions));
  return PERMISSION_NAV_GROUPS.flatMap((group) => group.items.filter((item) => allowed.has(item.key)));
}

export function summarizePermissions(permissions = []) {
  return toPermissionKeys(permissions);
}
