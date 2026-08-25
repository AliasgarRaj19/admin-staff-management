const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_ROLE_NAME_LENGTH = 80;
export const MAX_NAME_LENGTH = 120;
export const MAX_PHONE_LENGTH = 30;
export const MIN_PASSWORD_LENGTH = 12;

export function normalizeEmail(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalized)) {
    throw new Error("Enter a valid email address.");
  }
  return normalized;
}

export function normalizeRoleName(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "Moderator";
  if (normalized.length > MAX_ROLE_NAME_LENGTH) {
    throw new Error(`Role name must be ${MAX_ROLE_NAME_LENGTH} characters or fewer.`);
  }
  return normalized;
}

export function normalizeName(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > MAX_NAME_LENGTH) {
    throw new Error(`${label} must be ${MAX_NAME_LENGTH} characters or fewer.`);
  }
  return normalized;
}

export function normalizeOptionalPhone(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (normalized.length > MAX_PHONE_LENGTH) {
    throw new Error(`Phone must be ${MAX_PHONE_LENGTH} characters or fewer.`);
  }
  return normalized;
}

export function validatePassword(password) {
  const value = String(password ?? "");
  if (value.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  if (!/[A-Z]/.test(value)) throw new Error("Password must contain at least one uppercase letter.");
  if (!/[a-z]/.test(value)) throw new Error("Password must contain at least one lowercase letter.");
  if (!/[0-9]/.test(value)) throw new Error("Password must contain at least one number.");
  return value;
}

export function validatePasswordConfirmation(password, confirmation) {
  if (String(password ?? "") !== String(confirmation ?? "")) {
    throw new Error("Passwords do not match.");
  }
  return true;
}
