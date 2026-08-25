export async function hashPassword(password, hasher) {
  return hasher(password);
}
