export function getRootRedirect(state) {
  if (state.staff?.accessToken) return "/dashboard";
  if (state.masterAdmin?.accessToken) return "/admin/dashboard";
  return "/login";
}

export function getRoleLoginRedirect(state, role) {
  const target = role === "masterAdmin" ? "/admin/dashboard" : "/dashboard";
  return state[role]?.accessToken ? target : null;
}

export function getProtectedRouteRedirect(state, role) {
  return state[role]?.accessToken ? null : (role === "masterAdmin" ? "/admin/login" : "/login");
}
