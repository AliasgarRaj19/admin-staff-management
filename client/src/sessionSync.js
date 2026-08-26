const CHANNEL_NAME = "admin-staff-session-sync";
const canUseBroadcast = typeof window !== "undefined" && typeof window.BroadcastChannel !== "undefined";
const channel = canUseBroadcast ? new window.BroadcastChannel(CHANNEL_NAME) : null;

export function broadcastSessionChange(message) {
  channel?.postMessage({ type: "session-change", message: { role: message?.role || null } });
}

export function broadcastRoleLogout(role) {
  channel?.postMessage({ type: "logout", role });
}

export function broadcastPermissionChange(role = "staff") {
  channel?.postMessage({ type: "permissions-change", role });
}

export function listenSessionSync(handler) {
  if (!channel) return () => {};
  channel.onmessage = (event) => handler(event.data);
  return () => {
    channel.onmessage = null;
  };
}
