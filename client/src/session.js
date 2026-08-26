export function createRoleSession(role) {
  return {
    role,
    accessToken: "",
    csrfToken: "",
    user: null,
    ready: false,
    restoring: false,
    message: "",
  };
}

export function createInitialSessionState() {
  return {
    staff: createRoleSession("staff"),
    masterAdmin: createRoleSession("masterAdmin"),
  };
}

export function mergeRoleSession(current, patch = {}) {
  return {
    ...current,
    ...patch,
    user: patch.user === undefined ? current.user : patch.user,
    message: patch.message === undefined ? current.message : patch.message,
  };
}

export function mergeSessionState(current, patch = {}) {
  return {
    staff: mergeRoleSession(current.staff, patch.staff || {}),
    masterAdmin: mergeRoleSession(current.masterAdmin, patch.masterAdmin || {}),
  };
}

export function applyRoleSession(state, role, patch) {
  return mergeSessionState(state, { [role]: patch });
}

export function clearRoleSession(state, role) {
  return applyRoleSession(state, role, {
    accessToken: "",
    csrfToken: "",
    user: null,
    message: "",
  });
}

export function getRoleSession(state, role) {
  return state[role];
}

export function normalizeAuthResponse(role, response) {
  return {
    accessToken: response.accessToken || "",
    csrfToken: response.csrfToken || "",
    user: response.user || null,
    ready: true,
    restoring: false,
    message: "",
    role,
  };
}
