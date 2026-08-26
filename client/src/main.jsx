import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import "./styles.css";
import { request } from "./api.js";
import { getRouterBasename } from "./appConfig.js";
import { getProtectedRouteRedirect, getRoleLoginRedirect, getRootRedirect } from "./authRouting.js";
import { applyRoleSession, clearRoleSession, createInitialSessionState, mergeSessionState, normalizeAuthResponse } from "./session.js";
import { buildModuleLinks, summarizePermissions } from "./permissions.js";
import { broadcastPermissionChange, broadcastRoleLogout, broadcastSessionChange, listenSessionSync } from "./sessionSync.js";
import { restoreSessionOnce } from "./sessionRestore.js";
import { refreshWithRetry } from "./refreshSession.js";

const AuthContext = createContext(null);

function useAuth() {
  return useContext(AuthContext);
}

async function apiRefresh(role) {
  const endpoint = role === "masterAdmin" ? "/api/master-admin/auth/refresh" : "/api/staff/auth/refresh";
  const payload = await request(endpoint, { method: "POST" });
  return normalizeAuthResponse(role, payload);
}

async function restoreRole(role) {
  try {
    return await restoreSessionOnce(role, async () => refreshWithRetry(role, apiRefresh));
  } catch {
    return null;
  }
}

function AuthProvider({ children }) {
  const [state, setState] = useState(createInitialSessionState());

  useEffect(() => {
    const unsubscribe = listenSessionSync((event) => {
      if (event?.type === "session-change" && event.message?.role) {
        setState((current) => applyRoleSession(current, event.message.role, event.message.session));
      }
      if (event?.type === "logout" && event.role) {
        setState((current) => clearRoleSession(current, event.role));
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [staff, masterAdmin] = await Promise.all([restoreRole("staff"), restoreRole("masterAdmin")]);
      if (cancelled) return;
      setState((current) => mergeSessionState(current, {
        staff: { ...(staff || {}), ready: true, restoring: false },
        masterAdmin: { ...(masterAdmin || {}), ready: true, restoring: false },
      }));
    })();
    return () => { cancelled = true; };
  }, []);

  const value = useMemo(() => ({ state, setState }), [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useSession(role) {
  const auth = useAuth();
  return {
    session: auth.state[role],
    setSession(patch) {
      auth.setState((current) => applyRoleSession(current, role, patch));
    },
    clearSession() {
      auth.setState((current) => clearRoleSession(current, role));
    },
  };
}

function usePermissionRefresh(role = "staff") {
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    const unsubscribe = listenSessionSync((event) => {
      if (event?.type === "permissions-change" && event.role === role) {
        setRefreshIndex((current) => current + 1);
      }
    });
    const onFocus = () => setRefreshIndex((current) => current + 1);
    window.addEventListener("focus", onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [role]);

  return [refreshIndex, setRefreshIndex];
}

function normalizePermissionGroups(groups = {}, permissions = []) {
  const flatPermissions = permissions.length > 0 ? permissions : Object.values(groups).flat();
  return {
    groups,
    permissions: flatPermissions,
  };
}

function permissionKeysFromSelection(selection = []) {
  return selection.map((permission) => permission.key || permission).filter(Boolean);
}

function groupPermissionSelections(registry = { groups: {} }, selectedKeys = []) {
  return Object.entries(registry.groups || {}).map(([groupName, items]) => ({
    groupName,
    items,
    selected: items.filter((permission) => selectedKeys.includes(permission.key)),
  }));
}

function getPermissionHref(permissionKey) {
  const [moduleName] = String(permissionKey || "").split(".");
  return `/admin/permissions?module=${encodeURIComponent(moduleName || "pages")}`;
}

function LoadingShell({ title, message = "Restoring session..." }) {
  return <Shell title={title}><p>{message}</p></Shell>;
}

function Shell({ title, children, aside }) {
  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="hero">
          <div>
            <p className="eyebrow">Admin + Staff Management</p>
            <h1>{title}</h1>
          </div>
          <p className="hero-copy">MasterAdmin handles governance. Staff accounts keep their own independent session and permission state.</p>
        </header>
        <div className="content-grid">
          <section className="panel">{children}</section>
          {aside ? <aside className="panel panel-muted">{aside}</aside> : null}
        </div>
      </div>
    </main>
  );
}

function Field({ label, hint, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function TextArea({ label, hint, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea {...props} />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Button({ className = "", variant = "primary", ...props }) {
  return <button {...props} className={`btn btn-${variant} ${className}`.trim()} />;
}

function LinkButton({ to, children, className = "", variant = "secondary" }) {
  return <Link to={to} className={`btn btn-${variant} ${className}`.trim()}>{children}</Link>;
}

function Notice({ children, tone = "info" }) {
  if (!children) return null;
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

function AppRouter() {
  const auth = useAuth();
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<StaffLoginGate><StaffLoginPage /></StaffLoginGate>} />
      <Route path="/dashboard" element={<RequireRole role="staff"><StaffDashboardPage /></RequireRole>} />
      <Route path="/change-password" element={<RequireRole role="staff"><ChangePasswordPage /></RequireRole>} />
      <Route path="/staff/register" element={<PublicPage><StaffInvitationRegistrationPage /></PublicPage>} />
      <Route path="/admin/login" element={<AdminLoginGate><AdminLoginPage /></AdminLoginGate>} />
      <Route path="/admin/dashboard" element={<RequireRole role="masterAdmin"><AdminDashboardPage /></RequireRole>} />
      <Route path="/admin/staff" element={<RequireRole role="masterAdmin"><AdminStaffListPage /></RequireRole>} />
      <Route path="/admin/staff/new" element={<RequireRole role="masterAdmin"><AdminInviteStaffPage /></RequireRole>} />
      <Route path="/admin/staff/:id" element={<RequireRole role="masterAdmin"><AdminStaffDetailPage /></RequireRole>} />
      <Route path="/admin/roles" element={<RequireRole role="masterAdmin"><AdminRolesPage /></RequireRole>} />
      <Route path="/admin/permissions" element={<RequireRole role="masterAdmin"><AdminPermissionsPage /></RequireRole>} />
      <Route path="/admin/audit-logs" element={<RequireRole role="masterAdmin"><AdminAuditLogsPage /></RequireRole>} />
      <Route path="*" element={<Navigate to={getRootRedirect(auth.state)} replace />} />
    </Routes>
  );
}

function RootRedirect() {
  const auth = useAuth();
  if (!auth.state.staff.ready || !auth.state.masterAdmin.ready) {
    return <LoadingShell title="Loading" />;
  }
  return <Navigate to={getRootRedirect(auth.state)} replace />;
}

function PublicPage({ children }) {
  return children;
}

function StaffLoginGate({ children }) {
  const auth = useAuth();
  const redirect = getRoleLoginRedirect(auth.state, "staff");
  if (!auth.state.staff.ready) return <LoadingShell title="Loading" />;
  if (redirect) return <Navigate to={redirect} replace />;
  return children;
}

function AdminLoginGate({ children }) {
  const auth = useAuth();
  const redirect = getRoleLoginRedirect(auth.state, "masterAdmin");
  if (!auth.state.masterAdmin.ready) return <LoadingShell title="Loading" />;
  if (redirect) return <Navigate to={redirect} replace />;
  return children;
}

function RequireRole({ role, children }) {
  const auth = useAuth();
  const redirect = getProtectedRouteRedirect(auth.state, role);
  if (!auth.state[role].ready) return <LoadingShell title="Loading" />;
  if (redirect) return <Navigate to={redirect} replace />;
  return children;
}

function StaffLoginPage() {
  const navigate = useNavigate();
  const { session, setSession } = useSession("staff");
  const [form, setForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const data = await request("/api/staff/auth/login", { method: "POST", body: form });
      const next = normalizeAuthResponse("staff", data);
      setSession(next);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Staff Login" aside={<div className="stack"><LinkButton to="/staff/register">Join via Invitation</LinkButton><LinkButton to="/admin/login" variant="ghost">MasterAdmin Login</LinkButton></div>}>
      <form className="stack" onSubmit={submit}>
        <Notice tone="error">{message}</Notice>
        <Field label="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        <Field label="Password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        <Button disabled={busy}>{busy ? "Signing in..." : "Login"}</Button>
      </form>
      <p className="subtle">Staff sessions remain isolated from MasterAdmin sessions.</p>
    </Shell>
  );
}

function AdminLoginPage() {
  const navigate = useNavigate();
  const { setSession } = useSession("masterAdmin");
  const [form, setForm] = useState({ username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const data = await request("/api/master-admin/auth/login", { method: "POST", body: form });
      const next = normalizeAuthResponse("masterAdmin", data);
      setSession(next);
      navigate("/admin/dashboard", { replace: true });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="MasterAdmin Login" aside={<LinkButton to="/login">Back to Staff Login</LinkButton>}>
      <form className="stack" onSubmit={submit}>
        <Notice tone="error">{message}</Notice>
        <Field label="Username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
        <Field label="Password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        <Button disabled={busy}>{busy ? "Signing in..." : "Login as MasterAdmin"}</Button>
      </form>
    </Shell>
  );
}

function LogoutButton({ role, endpoint, csrfToken, onCleared, label = "Logout" }) {
  const navigate = useNavigate();
  return (
    <Button type="button" variant="ghost" onClick={async () => {
      await request(endpoint, { method: "POST", csrfToken });
      onCleared();
      broadcastRoleLogout(role);
      navigate(role === "masterAdmin" ? "/admin/login" : "/login", { replace: true });
    }}>{label}</Button>
  );
}

function StaffDashboardPage() {
  const { session, clearSession } = useSession("staff");
  const navigate = useNavigate();
  const [refreshIndex, setRefreshIndex] = usePermissionRefresh("staff");
  const [permissionState, setPermissionState] = useState({
    loading: true,
    groups: {},
    permissions: [],
    directPermissions: [],
    effectivePermissions: [],
    roles: [],
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await request("/api/staff/auth/permissions", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (cancelled) return;
        const normalized = normalizePermissionGroups(data.groups, data.permissions);
        setPermissionState({
          loading: false,
          groups: normalized.groups || {},
          permissions: normalized.permissions || [],
          directPermissions: data.directPermissions || [],
          effectivePermissions: data.effectivePermissions || normalized.permissions || [],
          roles: data.roles || [],
        });
      } catch {
        if (!cancelled) {
          setPermissionState({
            loading: false,
            groups: {},
            permissions: [],
            directPermissions: [],
            effectivePermissions: [],
            roles: [],
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [session.accessToken, refreshIndex]);

  const navigationLinks = buildModuleLinks(permissionState.effectivePermissions);
  const permissionSummary = summarizePermissions(permissionState.effectivePermissions);

  return (
    <Shell
      title="Staff Dashboard"
      aside={
        <div className="stack">
          <LinkButton to="/change-password">Change Password</LinkButton>
          <LogoutButton role="staff" endpoint="/api/staff/auth/logout" csrfToken={session.csrfToken} onCleared={clearSession} />
        </div>
      }
    >
      <div className="stack">
        <p>Signed in as <strong>{session.user?.email || "staff member"}</strong>.</p>
        <p>Designation: {session.user?.roleName || "Moderator"}</p>
        <div className="detail-card">
          <h3>Security Roles</h3>
          <p>{permissionState.roles.map((role) => role.name).join(", ") || "None"}</p>
        </div>
        <div className="detail-card">
          <h3>Direct Permissions</h3>
          <p>{permissionState.directPermissions.map((permission) => permission.key).join(", ") || "None"}</p>
        </div>
        <div className="detail-card">
          <h3>Effective Permissions</h3>
          <p>{permissionSummary.join(", ") || "None"}</p>
        </div>
        {navigationLinks.length === 0 ? (
          <Notice tone="info">Please ask your administrator for permission.</Notice>
        ) : (
          <div className="card-grid">
            {navigationLinks.map((link) => (
              <article className="mini-card" key={link.key}>
                <h3>{link.label}</h3>
                <p>{link.key}</p>
              </article>
            ))}
          </div>
        )}
        <div className="link-grid">
          {navigationLinks.map((link) => (
            <LinkButton key={link.key} to={getPermissionHref(link.key)}>{link.label}</LinkButton>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function ChangePasswordPage() {
  const { session, clearSession } = useSession("staff");
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", repeatNewPassword: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const isValid = form.currentPassword.trim() && form.newPassword.length >= 12 && form.newPassword === form.repeatNewPassword;

  async function submit(event) {
    event.preventDefault();
    if (!isValid || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await request("/api/user/change-password", {
        method: "POST",
        body: form,
        csrfToken: session.csrfToken,
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      setMessage("Password changed successfully.");
      setForm({ currentPassword: "", newPassword: "", repeatNewPassword: "" });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="Change Password"
      aside={
        <div className="stack">
          <LinkButton to="/dashboard">Back to User Panel</LinkButton>
          <LogoutButton role="staff" endpoint="/api/staff/auth/logout" csrfToken={session.csrfToken} onCleared={clearSession} />
        </div>
      }
    >
      <form className="stack" onSubmit={submit}>
        <Notice tone={message.includes("success") ? "success" : "error"}>{message}</Notice>
        <Field label="Current Password" type="password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} />
        <Field label="New Password" type="password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} />
        <Field label="Repeat New Password" type="password" value={form.repeatNewPassword} onChange={(event) => setForm({ ...form, repeatNewPassword: event.target.value })} />
        <Button disabled={!isValid || busy}>{busy ? "Updating..." : "Update Password"}</Button>
      </form>
    </Shell>
  );
}

function StaffInvitationRegistrationPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const [validation, setValidation] = useState({ loading: true, valid: false, reason: "invalid", data: null });
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", password: "", confirmPassword: "" });
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        if (!cancelled) setValidation({ loading: false, valid: false, reason: "invalid", data: null });
        return;
      }
      try {
        const result = await request("/api/staff/invitations/validate", { method: "POST", body: { token } });
        if (!cancelled) setValidation({ loading: false, valid: true, reason: "valid", data: result });
      } catch (error) {
        if (!cancelled) setValidation({ loading: false, valid: false, reason: error.payload?.status || "invalid", data: null });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (validation.loading) {
    return <Shell title="Complete Staff Registration"><p>Checking invitation link...</p></Shell>;
  }

  if (!validation.valid) {
    return (
      <Shell title="Complete Staff Registration">
        <Notice tone="error">This invitation link is invalid, expired, or has already been used.</Notice>
        <LinkButton to="/login">Return to Login</LinkButton>
      </Shell>
    );
  }

  const roleName = validation.data?.invitation?.roleName || "Moderator";

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    try {
      await request("/api/staff/invitations/accept", {
        method: "POST",
        body: { ...form, token },
      });
      setForm({ firstName: "", lastName: "", phone: "", password: "", confirmPassword: "" });
      setMessage("Your account has been created successfully.");
      navigate("/login", { replace: true });
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <Shell title="Complete Staff Registration" aside={<LinkButton to="/login">Back to Login</LinkButton>}>
      <form className="stack" onSubmit={submit}>
        <Notice tone={message.includes("success") ? "success" : "error"}>{message}</Notice>
        <p className="subtle">Role / designation: <strong>{roleName}</strong></p>
        <Field label="First Name" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />
        <Field label="Last Name" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
        <Field label="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        <Field label="Password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        <Field label="Repeat Password" type="password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} />
        <Button>Complete Registration</Button>
      </form>
    </Shell>
  );
}

function AdminDashboardPage() {
  const { session, clearSession } = useSession("masterAdmin");
  const navigate = useNavigate();
  const [stats, setStats] = useState({ staff: 0, roles: 0, permissions: 0, auditLogs: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [staff, roles, permissions, audit] = await Promise.all([
          request("/api/admin/staff?status=active", { headers: { Authorization: `Bearer ${session.accessToken}` } }),
          request("/api/admin/roles", { headers: { Authorization: `Bearer ${session.accessToken}` } }),
          request("/api/admin/permissions", { headers: { Authorization: `Bearer ${session.accessToken}` } }),
          request("/api/admin/audit-logs", { headers: { Authorization: `Bearer ${session.accessToken}` } }),
        ]);
        if (!cancelled) {
          setStats({
            staff: staff.staff?.length || 0,
            roles: roles.roles?.length || 0,
            permissions: permissions.count || permissions.permissions?.length || 0,
            auditLogs: audit.total || audit.auditLogs?.length || 0,
          });
        }
      } catch {
        if (!cancelled) setStats({ staff: 0, roles: 0, permissions: 0, auditLogs: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [session.accessToken]);

  return (
    <Shell
      title="MasterAdmin Dashboard"
      aside={
        <div className="stack">
          <LinkButton to="/admin/staff/new">Invite Staff</LinkButton>
          <LogoutButton role="masterAdmin" endpoint="/api/master-admin/auth/logout" csrfToken={session.csrfToken} onCleared={clearSession} />
        </div>
      }
    >
      <div className="stack">
        <p>Signed in as <strong>{session.user?.username || "MasterAdmin"}</strong>.</p>
        <div className="card-grid">
          <MiniStat label="Active Staff" value={stats.staff} />
          <MiniStat label="Roles" value={stats.roles} />
          <MiniStat label="Permissions" value={stats.permissions} />
          <MiniStat label="Audit Logs" value={stats.auditLogs} />
        </div>
        <div className="link-grid">
          <LinkButton to="/admin/staff">Manage Staff</LinkButton>
          <LinkButton to="/admin/roles">Manage Roles</LinkButton>
          <LinkButton to="/admin/permissions">Direct Permissions</LinkButton>
          <LinkButton to="/admin/audit-logs">Audit Log</LinkButton>
        </div>
      </div>
    </Shell>
  );
}

function MiniStat({ label, value }) {
  return (
    <article className="mini-card">
      <h3>{label}</h3>
      <p>{value}</p>
    </article>
  );
}

function AdminStaffListPage() {
  const auth = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [staff, setStaff] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const tab = searchParams.get("tab") || "registered";
  const isInvitedTab = tab === "invited";
  const isRegisteredTab = tab === "registered";
  const isBlockedTab = tab === "blocked";
  const isRemovedTab = tab === "removed";

  useEffect(() => {
    if (location.state?.flashMessage) {
      setMessage(location.state.flashMessage);
    }
  }, [location.state]);

  async function loadStaff(nextStatus) {
    const data = await request(`/api/admin/staff?status=${encodeURIComponent(nextStatus)}`, {
      headers: { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` },
    });
    setStaff(data.staff || []);
  }

  async function loadInvitations() {
    const data = await request("/api/admin/staff/invitations?status=pending", {
      headers: { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` },
    });
    setInvitations(data.invitations || []);
  }

  useEffect(() => {
    if (isInvitedTab) {
      loadInvitations().catch(() => setInvitations([]));
      return;
    }
    if (isRegisteredTab) {
      loadStaff("active").catch(() => setStaff([]));
      return;
    }
    if (isBlockedTab) {
      loadStaff("blocked").catch(() => setStaff([]));
      return;
    }
    if (isRemovedTab) {
      loadStaff("removed").catch(() => setStaff([]));
    }
  }, [auth.state.masterAdmin.accessToken, tab]);

  async function runLifecycle(path, body) {
    setMessage("");
    try {
      await request(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` },
        body,
      });
      broadcastPermissionChange("staff");
      if (isInvitedTab) {
        await loadInvitations();
      } else if (isRegisteredTab) {
        await loadStaff("active");
      } else if (isBlockedTab) {
        await loadStaff("blocked");
      } else if (isRemovedTab) {
        await loadStaff("removed");
      }
      setMessage("Staff record updated successfully.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleInviteAction(action, item) {
    const confirmed = window.confirm(action === "resend"
      ? `Resend invitation to ${item.email}?`
      : `Revoke invitation for ${item.email}?`);
    if (!confirmed) return;
    setBusyId(item.staffAccountId);
    setMessage("");
    try {
      const endpoint = action === "resend"
        ? `/api/admin/staff/invitations/${item.staffAccountId}/resend`
        : `/api/admin/staff/invitations/${item.staffAccountId}/revoke`;
      await request(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` },
      });
      broadcastPermissionChange("staff");
      await loadInvitations();
      setMessage(action === "resend" ? "Invitation resent successfully." : "Invitation revoked.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <Shell
      title="Manage Staff"
      aside={
        <div className="stack">
          <LinkButton to="/admin/staff/new">Invite Staff</LinkButton>
          <LinkButton to="/admin/dashboard">Back to Dashboard</LinkButton>
        </div>
      }
    >
      <div className="stack">
        <Notice tone={message.includes("success") ? "success" : "error"}>{message}</Notice>
        <div className="button-row">
          <Button variant={isInvitedTab ? "primary" : "secondary"} onClick={() => setSearchParams({ tab: "invited" })}>Invited Staff</Button>
          <Button variant={isRegisteredTab ? "primary" : "secondary"} onClick={() => setSearchParams({ tab: "registered" })}>Registered Staff</Button>
          <Button variant={isBlockedTab ? "primary" : "secondary"} onClick={() => setSearchParams({ tab: "blocked" })}>Blocked Staff</Button>
          <Button variant={isRemovedTab ? "primary" : "secondary"} onClick={() => setSearchParams({ tab: "removed" })}>Removed Staff</Button>
        </div>
        {isInvitedTab ? (
          invitations.length === 0 ? (
            <Notice tone="info">No pending invitations right now.</Notice>
          ) : invitations.map((item) => (
            <article className="detail-card" key={item.id}>
              <h3>{item.email}</h3>
              <p>Designation: {item.roleName}</p>
              <p>Status: {item.status}</p>
              <p>Invited At: {item.createdAt ? new Date(item.createdAt).toLocaleString() : "n/a"}</p>
              <p>Expires At: {item.expiresAt ? new Date(item.expiresAt).toLocaleString() : "n/a"}</p>
              <p>Invited By: {item.invitedByType || "n/a"}</p>
              <div className="button-row">
                <Button variant="secondary" disabled={busyId === item.staffAccountId} onClick={() => handleInviteAction("resend", item)}>
                  {busyId === item.staffAccountId ? "Processing..." : "Resend Invitation"}
                </Button>
                <Button variant="danger" disabled={busyId === item.staffAccountId} onClick={() => handleInviteAction("revoke", item)}>
                  {busyId === item.staffAccountId ? "Processing..." : "Revoke Invitation"}
                </Button>
              </div>
            </article>
          ))
        ) : staff.length === 0 ? (
          <Notice tone="info">No staff found for this category.</Notice>
        ) : staff.map((item) => (
          <article className="detail-card" key={item.id}>
            <h3>{item.email}</h3>
            <p>Designation: {item.roleName}</p>
            <p>Status: {item.status}</p>
            <p>Invited: {item.invitedAt ? new Date(item.invitedAt).toLocaleString() : "n/a"}</p>
            <div className="button-row">
              <LinkButton to={`/admin/staff/${item.id}`}>Open Staff Detail</LinkButton>
              <Button variant="secondary" onClick={() => runLifecycle(`/api/admin/staff/${item.id}/block`)}>Block</Button>
              <Button variant="secondary" onClick={() => runLifecycle(`/api/admin/staff/${item.id}/unblock`)}>Unblock</Button>
              <Button variant="secondary" onClick={() => runLifecycle(`/api/admin/staff/${item.id}/remove`)}>Remove</Button>
              <Button variant="secondary" onClick={() => runLifecycle(`/api/admin/staff/${item.id}/restore`)}>Restore</Button>
              <Button variant="danger" onClick={() => runLifecycle(`/api/admin/staff/${item.id}`, { confirm: "DELETE" })}>DELETE</Button>
            </div>
          </article>
        ))}
      </div>
    </Shell>
  );
}

function AdminInviteStaffPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", roleName: "Moderator" });
  const [message, setMessage] = useState("");

  async function submit(event) {
    event.preventDefault();
    try {
      const result = await request("/api/admin/staff/invitations", {
        method: "POST",
        body: form,
        headers: { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` },
      });
      setMessage("Invitation created successfully.");
      setForm({ email: "", roleName: "Moderator" });
      navigate("/admin/staff?tab=invited", { replace: true, state: { flashMessage: "Invitation created successfully." } });
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <Shell title="Invite Staff" aside={<LinkButton to="/admin/dashboard">Back to Dashboard</LinkButton>}>
      <form className="stack" onSubmit={submit}>
        <Notice tone={message.includes("success") ? "success" : "error"}>{message}</Notice>
        <Field label="Email Address" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        <Field label="Role / Designation" value={form.roleName} onChange={(event) => setForm({ ...form, roleName: event.target.value })} hint="Blank values default to Moderator." />
        <Button>Create Invitation</Button>
      </form>
    </Shell>
  );
}

function AdminStaffDetailPage() {
  const auth = useAuth();
  const params = useParams();
  const [detail, setDetail] = useState(null);
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [effectivePermissions, setEffectivePermissions] = useState([]);
  const [allRoles, setAllRoles] = useState([]);
  const [permissionRegistry, setPermissionRegistry] = useState({ groups: {}, permissions: [] });
  const [selectedRoleIds, setSelectedRoleIds] = useState([]);
  const [selectedPermissionKeys, setSelectedPermissionKeys] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const headers = { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` };
    const staff = await request(`/api/admin/staff/${params.id}`, { headers });
    setDetail(staff.staff || null);
    try {
      const staffRoles = await request(`/api/admin/staff/${params.id}/roles`, { headers });
      setRoles(staffRoles.roles || []);
      setSelectedRoleIds((staffRoles.roles || []).map((role) => role.id));
    } catch {
      setRoles([]);
      setSelectedRoleIds([]);
    }
    try {
      const staffPermissions = await request(`/api/admin/staff/${params.id}/permissions`, { headers });
      setPermissions(staffPermissions.permissions || []);
      setSelectedPermissionKeys((staffPermissions.permissions || []).map((permission) => permission.key));
    } catch {
      setPermissions([]);
      setSelectedPermissionKeys([]);
    }
    try {
      const staffEffective = await request(`/api/admin/staff/${params.id}/effective-permissions`, { headers });
      setEffectivePermissions(staffEffective.permissions || []);
    } catch {
      setEffectivePermissions([]);
    }
    try {
      const [rolesList, permissionList] = await Promise.all([
        request("/api/admin/roles", { headers }),
        request("/api/admin/permissions", { headers }),
      ]);
      setAllRoles(rolesList.roles || []);
      setPermissionRegistry(permissionList);
    } catch {
      setAllRoles([]);
      setPermissionRegistry({ groups: {}, permissions: [] });
    }
  }

  useEffect(() => { load().catch(() => setDetail(null)); }, [params.id, auth.state.masterAdmin.accessToken]);

  async function runAction(path) {
    setMessage("");
    await request(path, {
      method: path.endsWith("/block") || path.endsWith("/unblock") || path.endsWith("/remove") || path.endsWith("/restore") ? "POST" : "DELETE",
      headers: { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` },
      body: path.endsWith(`/${detail?.id}`) ? { confirm: confirmDelete } : undefined,
    });
    broadcastPermissionChange("staff");
    await load();
  }

  async function saveRoles(event) {
    event.preventDefault();
    setMessage("");
    try {
      await request(`/api/admin/staff/${params.id}/roles`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` },
        body: { roleIds: selectedRoleIds },
      });
      setMessage("Staff roles updated successfully.");
      broadcastPermissionChange("staff");
      await load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function savePermissions(event) {
    event.preventDefault();
    setMessage("");
    try {
      await request(`/api/admin/staff/${params.id}/permissions`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` },
        body: { permissionKeys: selectedPermissionKeys },
      });
      setMessage("Staff permissions updated successfully.");
      broadcastPermissionChange("staff");
      await load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <Shell title="Staff Detail" aside={<LinkButton to="/admin/staff">Back to Staff List</LinkButton>}>
      {!detail ? <p>Loading staff detail...</p> : (
        <div className="stack">
          <Notice tone={message.includes("success") ? "success" : "error"}>{message}</Notice>
          <h3>{detail.email}</h3>
          <p>Designation: {detail.roleName}</p>
          <p>Status: {detail.status}</p>
          <p>Created: {detail.createdAt ? new Date(detail.createdAt).toLocaleString() : "n/a"}</p>
          <p>Updated: {detail.updatedAt ? new Date(detail.updatedAt).toLocaleString() : "n/a"}</p>
          <p>Invited: {detail.invitedAt ? new Date(detail.invitedAt).toLocaleString() : "n/a"}</p>
          <p>Registered: {detail.registeredAt ? new Date(detail.registeredAt).toLocaleString() : "n/a"}</p>
          <p>Activated: {detail.activatedAt ? new Date(detail.activatedAt).toLocaleString() : "n/a"}</p>
          <p>Blocked: {detail.blockedAt ? new Date(detail.blockedAt).toLocaleString() : "n/a"}</p>
          <p>Removed: {detail.removedAt ? new Date(detail.removedAt).toLocaleString() : "n/a"}</p>
          <form className="stack" onSubmit={saveRoles}>
            <h4>Assign Roles</h4>
            <div className="permission-grid">
              {allRoles.map((role) => (
                <label key={role.id} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selectedRoleIds.includes(role.id)}
                    onChange={(event) => {
                      setSelectedRoleIds((current) => (
                        event.target.checked
                          ? [...current, role.id]
                          : current.filter((value) => value !== role.id)
                      ));
                    }}
                  />
                  <span>{role.name}</span>
                </label>
              ))}
            </div>
            <Button>Save Roles</Button>
          </form>
          <form className="stack" onSubmit={savePermissions}>
            <h4>Direct Permissions</h4>
            <p className="subtle">RolePermission {`∪`} StaffPermission determines effective permissions.</p>
            <div className="permission-grid">
              {Object.entries(permissionRegistry.groups || {}).map(([moduleName, items]) => (
                <section className="detail-card" key={moduleName}>
                  <h5>{moduleName}</h5>
                  <div className="stack">
                    {items.map((permission) => (
                      <label key={permission.id} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={selectedPermissionKeys.includes(permission.key)}
                          onChange={(event) => {
                            setSelectedPermissionKeys((current) => (
                              event.target.checked
                                ? [...current, permission.key]
                                : current.filter((value) => value !== permission.key)
                            ));
                          }}
                        />
                        <span>{permission.displayName}</span>
                      </label>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <Button>Save Direct Permissions</Button>
          </form>
          <div className="button-row">
            <Button variant="secondary" onClick={() => runAction(`/api/admin/staff/${detail.id}/block`)}>Block</Button>
            <Button variant="secondary" onClick={() => runAction(`/api/admin/staff/${detail.id}/unblock`)}>Unblock</Button>
            <Button variant="secondary" onClick={() => runAction(`/api/admin/staff/${detail.id}/remove`)}>Remove</Button>
            <Button variant="secondary" onClick={() => runAction(`/api/admin/staff/${detail.id}/restore`)}>Restore</Button>
            <label className="field">
              <span>Type DELETE to permanently delete</span>
              <input value={confirmDelete} onChange={(event) => setConfirmDelete(event.target.value)} />
            </label>
            <Button variant="danger" onClick={() => runAction(`/api/admin/staff/${detail.id}`)} disabled={confirmDelete !== "DELETE"}>DELETE</Button>
          </div>
          <section className="detail-card">
            <h4>Assigned Roles</h4>
            <p>{roles.map((role) => role.name).join(", ") || "None"}</p>
          </section>
          <section className="detail-card">
            <h4>Direct Permissions</h4>
            <p>{permissions.map((permission) => permission.key).join(", ") || "None"}</p>
          </section>
          <section className="detail-card">
            <h4>Effective Permissions</h4>
            <p>{effectivePermissions.map((permission) => permission.key).join(", ") || "None"}</p>
          </section>
        </div>
      )}
    </Shell>
  );
}

function AdminRolesPage() {
  const auth = useAuth();
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState({ name: "", description: "", permissionKeys: "" });
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const data = await request("/api/admin/roles", { headers: { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` } });
    setRoles(data.roles || []);
  }

  useEffect(() => { load().catch(() => setRoles([])); }, [auth.state.masterAdmin.accessToken]);

  useEffect(() => {
    if (!selectedRoleId) return;
    const role = roles.find((item) => item.id === selectedRoleId);
    if (role) {
      setForm({
        name: role.name || "",
        description: role.description || "",
        permissionKeys: (role.permissionKeys || []).join(", "),
      });
    }
  }, [selectedRoleId, roles]);

  async function createRole(event) {
    event.preventDefault();
    setMessage("");
    const body = {
      name: form.name,
      description: form.description,
      permissionKeys: form.permissionKeys.split(",").map((value) => value.trim()).filter(Boolean),
    };
    try {
      if (selectedRoleId) {
        await request(`/api/admin/roles/${selectedRoleId}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` },
          body,
        });
        setMessage("Role updated successfully.");
      } else {
        await request("/api/admin/roles", {
          method: "POST",
          headers: { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` },
          body,
        });
        setMessage("Role created successfully.");
      }
      broadcastPermissionChange("staff");
      setForm({ name: "", description: "", permissionKeys: "" });
      setSelectedRoleId("");
      await load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function deleteRole(roleId) {
    setMessage("");
    try {
      await request(`/api/admin/roles/${roleId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` },
      });
      broadcastPermissionChange("staff");
      setMessage("Role deleted successfully.");
      await load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <Shell title="Manage Roles" aside={<LinkButton to="/admin/dashboard">Back to Dashboard</LinkButton>}>
      <div className="stack">
        <Notice tone={message.includes("success") ? "success" : "error"}>{message}</Notice>
        <form className="stack" onSubmit={createRole}>
          <label className="field">
            <span>Existing Role</span>
            <select value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)}>
              <option value="">Create new role</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </label>
          <Field label="Role Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <TextArea label="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          <Field label="Permission Keys (comma separated)" value={form.permissionKeys} onChange={(event) => setForm({ ...form, permissionKeys: event.target.value })} />
          <div className="button-row">
            <Button>{selectedRoleId ? "Update Role" : "Create Role"}</Button>
            {selectedRoleId ? <Button type="button" variant="danger" onClick={() => deleteRole(selectedRoleId)}>Delete Role</Button> : null}
          </div>
        </form>
        <div className="stack">
          {roles.map((role) => (
            <article className="detail-card" key={role.id}>
              <h3>{role.name}</h3>
              <p>{role.description || "No description."}</p>
              <p>Permissions: {role.permissionKeys?.join(", ") || "None"}</p>
              <div className="button-row">
                <Button type="button" variant="secondary" onClick={() => setSelectedRoleId(role.id)}>Edit</Button>
                <Button type="button" variant="danger" onClick={() => deleteRole(role.id)}>Delete</Button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function AdminPermissionsPage() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const [registry, setRegistry] = useState({ groups: {}, permissions: [] });
  const [staffList, setStaffList] = useState([]);
  const [roles, setRoles] = useState([]);
  const [mode, setMode] = useState("role");
  const [targetId, setTargetId] = useState("");
  const [selected, setSelected] = useState([]);
  const [message, setMessage] = useState("");
  const moduleFilter = searchParams.get("module") || "";

  useEffect(() => {
    (async () => {
      const headers = { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` };
      const [permissions, staff, roleList] = await Promise.all([
        request("/api/admin/permissions", { headers }),
        request("/api/admin/staff?status=active", { headers }),
        request("/api/admin/roles", { headers }),
      ]);
      setRegistry(permissions);
      setStaffList(staff.staff || []);
      setRoles(roleList.roles || []);
    })().catch(() => {});
  }, [auth.state.masterAdmin.accessToken]);

  async function submit(event) {
    event.preventDefault();
    const headers = { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` };
    const body = { permissionKeys: selected };
    if (mode === "role") {
      await request(`/api/admin/roles/${targetId}/permissions`, { method: "PUT", headers, body });
    } else {
      await request(`/api/admin/staff/${targetId}/permissions`, { method: "PUT", headers, body });
    }
    broadcastPermissionChange("staff");
    setMessage("Permissions updated successfully.");
  }

  return (
    <Shell title="Direct Permissions" aside={<LinkButton to="/admin/dashboard">Back to Dashboard</LinkButton>}>
      <form className="stack" onSubmit={submit}>
        <Notice tone={message.includes("success") ? "success" : "error"}>{message}</Notice>
        <p className="subtle">Module focus: {moduleFilter || "all"}</p>
        <label className="field">
          <span>Assignment Target</span>
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="role">Role permissions</option>
            <option value="staff">Staff direct permissions</option>
          </select>
        </label>
        <label className="field">
          <span>{mode === "role" ? "Role" : "Staff Member"}</span>
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            <option value="">Select one</option>
            {(mode === "role" ? roles : staffList).map((item) => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}
          </select>
        </label>
        <div className="permission-grid">
          {Object.entries(registry.groups || {}).filter(([moduleName]) => !moduleFilter || moduleName.toLowerCase() === moduleFilter.toLowerCase()).map(([moduleName, items]) => (
            <section className="detail-card" key={moduleName}>
              <h3>{moduleName}</h3>
              <p>{items.length} permissions</p>
              <div className="stack">
                {items.map((permission) => (
                  <label key={permission.id} className="checkbox-row">
                    <input type="checkbox" checked={selected.includes(permission.key)} onChange={(event) => {
                      setSelected((current) => event.target.checked ? [...current, permission.key] : current.filter((value) => value !== permission.key));
                    }} />
                    <span>{permission.displayName}</span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
        <Button disabled={!targetId}>Save Permissions</Button>
      </form>
    </Shell>
  );
}

function AdminAuditLogsPage() {
  const auth = useAuth();
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    request("/api/admin/audit-logs", { headers: { Authorization: `Bearer ${auth.state.masterAdmin.accessToken}` } })
      .then((data) => setLogs(data.auditLogs || []))
      .catch(() => setLogs([]));
  }, [auth.state.masterAdmin.accessToken]);

  return (
    <Shell title="Audit Log" aside={<LinkButton to="/admin/dashboard">Back to Dashboard</LinkButton>}>
      <div className="stack">
        {logs.map((entry) => (
          <article className="detail-card" key={entry.id}>
            <h3>{entry.action}</h3>
            <p>Actor: {entry.actorType}</p>
            <p>Resource: {entry.resourceType || "n/a"}</p>
            <p>Result: {entry.result}</p>
          </article>
        ))}
      </div>
    </Shell>
  );
}

function main() {
  const root = document.getElementById("root");
  if (!root) return;
  createRoot(root).render(
    <React.StrictMode>
      <AuthProvider>
        <BrowserRouter basename={getRouterBasename()}>
          <AppRouter />
        </BrowserRouter>
      </AuthProvider>
    </React.StrictMode>,
  );
}

if (typeof document !== "undefined") {
  main();
}

export {
  AuthContext,
  AuthProvider,
  AdminAuditLogsPage,
  AdminDashboardPage,
  AdminInviteStaffPage,
  AdminLoginPage,
  AdminPermissionsPage,
  AdminRolesPage,
  AdminStaffDetailPage,
  AdminStaffListPage,
  ChangePasswordPage,
  StaffDashboardPage,
  StaffInvitationRegistrationPage,
  StaffLoginPage,
  RequireRole,
  StaffLoginGate,
  AdminLoginGate,
  RootRedirect,
  Field,
  TextArea,
};
