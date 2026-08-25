export async function sendInvitationEmail(sender, { email, url, roleName, expiresInHours = 48 }) {
  return sender({
    kind: "invitation",
    email,
    url,
    roleName,
    expiresInHours,
  });
}
