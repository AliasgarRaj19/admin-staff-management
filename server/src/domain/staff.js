export const STAFF_ACCOUNT_STATUS = Object.freeze({
  INVITED: "invited",
  ACTIVE: "active",
  BLOCKED: "blocked",
  REMOVED: "removed",
});

export const STAFF_INVITATION_STATUS = Object.freeze({
  PENDING: "pending",
  ACCEPTED: "accepted",
  REVOKED: "revoked",
  EXPIRED: "expired",
});

export const STAFF_PASSWORD_RESET_STATUS = Object.freeze({
  PENDING: "pending",
  CONSUMED: "consumed",
  REVOKED: "revoked",
  EXPIRED: "expired",
});

export const DEFAULT_ROLE_NAME = "Moderator";
export const MAX_ROLE_NAME_LENGTH = 80;

export function normalizeRoleName(input) {
  const value = input == null ? "" : String(input).trim();
  if (value.length > MAX_ROLE_NAME_LENGTH) {
    throw new Error(`Role name must be ${MAX_ROLE_NAME_LENGTH} characters or fewer.`);
  }
  return value.length > 0 ? value : DEFAULT_ROLE_NAME;
}

export function normalizeStaffEmail(input) {
  return String(input).trim().toLowerCase();
}
