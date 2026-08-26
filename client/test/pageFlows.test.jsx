import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  AdminInviteStaffPage,
  AdminPermissionsPage,
  AdminRolesPage,
  AdminStaffDetailPage,
  AdminStaffListPage,
  AuthContext,
  ChangePasswordPage,
  RequireRole,
  StaffPermissionPlaceholderPage,
  StaffDashboardPage,
  StaffInvitationRegistrationPage,
} from "../src/main.jsx";

vi.mock("../src/api.js", () => ({
  request: vi.fn(),
}));

const { request } = await import("../src/api.js");

function renderWithAuth(ui, state) {
  return render(
    <AuthContext.Provider value={{ state, setState: vi.fn() }}>
      <MemoryRouter initialEntries={["/"]}>{ui}</MemoryRouter>
    </AuthContext.Provider>,
  );
}

function renderWithAuthRoute(initialEntry, element, state) {
  return render(
    <AuthContext.Provider value={{ state, setState: vi.fn() }}>
      <MemoryRouter initialEntries={[initialEntry]}>{element}</MemoryRouter>
    </AuthContext.Provider>,
  );
}

function createAuthState(overrides = {}) {
  return {
    staff: {
      role: "staff",
      accessToken: "staff-token",
      csrfToken: "staff-csrf",
      user: { id: "staff-1", email: "staff@example.com", roleName: "Moderator" },
      ready: true,
      restoring: false,
      message: "",
      ...overrides.staff,
    },
    masterAdmin: {
      role: "masterAdmin",
      accessToken: "",
      csrfToken: "",
      user: null,
      ready: true,
      restoring: false,
      message: "",
      ...overrides.masterAdmin,
    },
  };
}

beforeEach(() => {
  request.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("invite and registration pages", () => {
  test("admin invite staff form defaults the designation to Moderator", () => {
    renderWithAuth(<AdminInviteStaffPage />, createAuthState({
      masterAdmin: {
        role: "masterAdmin",
        accessToken: "admin-token",
        csrfToken: "admin-csrf",
        user: { id: "admin-1", username: "admin" },
      },
    }));
    expect(screen.getByLabelText(/Role \/ Designation/i).value).toBe("Moderator");
  });

  test("staff invitation acceptance sends the token internally", async () => {
    request.mockImplementation(async (path) => {
      if (path === "/api/staff/invitations/validate") {
        return {
          status: "valid",
          invitation: { id: "invite-1", email: "staff@example.com", roleName: "Support Lead" },
          staffAccount: { id: "staff-1", email: "staff@example.com", roleName: "Support Lead" },
        };
      }
      if (path === "/api/staff/invitations/accept") {
        return { staffAccount: { id: "staff-1" }, invitationId: "invite-1" };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <MemoryRouter initialEntries={["/staff/register?token=invite-token"]}>
        <StaffInvitationRegistrationPage />
      </MemoryRouter>,
    );

    await screen.findByLabelText(/First Name/i);
    fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText(/Last Name/i), { target: { value: "Lovelace" } });
    fireEvent.change(screen.getAllByLabelText(/Password/i)[0], { target: { value: "StrongPass123!" } });
    fireEvent.change(screen.getByLabelText(/Repeat Password/i), { target: { value: "StrongPass123!" } });
    fireEvent.click(screen.getByRole("button", { name: /Complete Registration/i }));

    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/staff/invitations/accept",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ token: "invite-token" }),
      }),
    ));
  });
});

describe("staff dashboard and permissions", () => {
  test("zero-permission staff state renders the permission prompt instead of module cards", async () => {
    request.mockImplementation(async (path) => {
      if (path.startsWith("/api/staff/access-check/")) {
        const error = new Error("Denied");
        error.status = 403;
        throw error;
      }
      return {};
    });

    renderWithAuth(<StaffDashboardPage />, createAuthState());

    await screen.findByText(/Please ask your administrator for permission/i);
    expect(screen.queryByText("Pages Read Access")).toBeNull();
    expect(screen.queryByText("Pages Edit Access")).toBeNull();
    expect(screen.queryByText("Pages Create Access")).toBeNull();
  });

  test("zero-permission staff state shows the administrator permission prompt", async () => {
    request.mockImplementation(async (path) => {
      if (path.startsWith("/api/staff/access-check/")) {
        const error = new Error("Denied");
        error.status = 403;
        throw error;
      }
      return {};
    });

    renderWithAuth(<StaffDashboardPage />, createAuthState({
      staff: {
        role: "staff",
        accessToken: "staff-token",
        csrfToken: "staff-csrf",
        user: { id: "staff-1", email: "staff@example.com", roleName: "Moderator" },
      },
    }));

    await screen.findByText(/Please ask your administrator for permission/i);
    expect(screen.queryByText("Pages Read Access")).toBeNull();
  });

  test("role CRUD form submits the provided role data", async () => {
    request.mockImplementation(async (path, options = {}) => {
      if (path === "/api/admin/roles") {
        if (options.method === "POST") {
          return { role: { id: "role-1", name: options.body.name } };
        }
        return { roles: [] };
      }
      return {};
    });

    renderWithAuth(<AdminRolesPage />, createAuthState({
      masterAdmin: {
        role: "masterAdmin",
        accessToken: "admin-token",
        csrfToken: "admin-csrf",
        user: { id: "admin-1", username: "admin" },
      },
    }));

    fireEvent.change(screen.getByLabelText(/Role Name/i), { target: { value: "  Sales Manager  " } });
    fireEvent.change(screen.getByLabelText(/Permission Keys/i), { target: { value: "pages.read, pages.edit" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Role/i }));

    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/admin/roles",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          name: "  Sales Manager  ",
          permissionKeys: ["pages.read", "pages.edit"],
        }),
      }),
    ));
  });

  test("permission assignment page renders target selectors", async () => {
    request.mockImplementation(async (path) => {
      if (path === "/api/admin/permissions") {
        return {
          groups: { pages: [{ id: "perm-1", key: "pages.read", displayName: "Read Pages" }] },
          permissions: [{ id: "perm-1", key: "pages.read", displayName: "Read Pages" }],
        };
      }
      if (path === "/api/admin/staff?status=active") {
        return { staff: [{ id: "staff-1", email: "staff@example.com" }] };
      }
      if (path === "/api/admin/roles") {
        return { roles: [{ id: "role-1", name: "Moderator" }] };
      }
      return {};
    });

    renderWithAuth(<AdminPermissionsPage />, createAuthState({
      masterAdmin: {
        role: "masterAdmin",
        accessToken: "admin-token",
        csrfToken: "admin-csrf",
        user: { id: "admin-1", username: "admin" },
      },
    }));

    await screen.findByText("Read Pages");
    expect(screen.getByText("Role permissions")).toBeTruthy();
    expect(screen.getByText("Staff direct permissions")).toBeTruthy();
  });

  test("staff dashboard renders permission-driven navigation", async () => {
    request.mockImplementation(async (path) => {
      if (path === "/api/staff/auth/permissions") {
        return {
          roles: [{ id: "role-1", name: "Editor" }],
          directPermissions: [{ key: "pages.read" }],
          effectivePermissions: [{ key: "pages.read" }, { key: "blog.edit" }],
        };
      }
      return {};
    });

    renderWithAuth(<StaffDashboardPage />, createAuthState());

    await screen.findByText(/Security Roles/i);
    expect(screen.getByRole("link", { name: "Pages" }).getAttribute("href")).toContain("/staff/access/pages.read");
    expect(screen.getByRole("link", { name: "Edit Blog" }).getAttribute("href")).toContain("/staff/access/blog.edit");
  });

  test("staff permission placeholder renders granted access and keeps staff users out of admin login", async () => {
    request.mockImplementation(async (path, options = {}) => {
      if (path === "/api/staff/access-check/pages.read") {
        expect(options.headers.Authorization).toBe("Bearer staff-token");
        return { ok: true, message: "You have been granted access.", permissionKey: "pages.read" };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderWithAuthRoute("/staff/access/pages.read", (
      <Routes>
        <Route path="/staff/access/:permissionKey" element={<RequireRole role="staff"><StaffPermissionPlaceholderPage /></RequireRole>} />
        <Route path="/login" element={<div>Staff Login</div>} />
        <Route path="/admin/login" element={<div>MasterAdmin Login</div>} />
      </Routes>
    ), createAuthState());

    await screen.findAllByText(/You have been granted access\./i);
    expect(screen.getByText(/Permission: pages \/ read/i)).toBeTruthy();
    expect(screen.queryByText("MasterAdmin Login")).toBeNull();
  });

  test("staff permission placeholder denies missing permission without redirecting to admin login", async () => {
    request.mockImplementation(async (path) => {
      if (path.startsWith("/api/staff/access-check/")) {
        const error = new Error("Permission denied.");
        error.status = 403;
        throw error;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderWithAuthRoute("/staff/access/pages.read", (
      <Routes>
        <Route path="/staff/access/:permissionKey" element={<RequireRole role="staff"><StaffPermissionPlaceholderPage /></RequireRole>} />
        <Route path="/login" element={<div>Staff Login</div>} />
        <Route path="/admin/login" element={<div>MasterAdmin Login</div>} />
      </Routes>
    ), createAuthState());

    await screen.findByText(/Permission denied\./i);
    expect(screen.queryByText("MasterAdmin Login")).toBeNull();
  });

  test("invalid staff session on a permission route returns the staff login page", async () => {
    renderWithAuthRoute("/staff/access/pages.read", (
      <Routes>
        <Route path="/staff/access/:permissionKey" element={<RequireRole role="staff"><StaffPermissionPlaceholderPage /></RequireRole>} />
        <Route path="/login" element={<div>Staff Login</div>} />
        <Route path="/admin/login" element={<div>MasterAdmin Login</div>} />
      </Routes>
    ), createAuthState({ staff: { accessToken: "" } }));

    await screen.findByText("Staff Login");
    expect(screen.queryByText("MasterAdmin Login")).toBeNull();
  });
});

describe("admin lifecycle and role management", () => {
  function createAdminState() {
    return createAuthState({
      masterAdmin: {
        role: "masterAdmin",
        accessToken: "admin-token",
        csrfToken: "admin-csrf",
        user: { id: "admin-1", username: "admin" },
      },
    });
  }

  test("staff lifecycle list exposes status filters and status-aware action buttons", async () => {
    request.mockImplementation(async (path) => {
      if (path === "/api/admin/staff?status=active") {
        return { staff: [{ id: "staff-1", email: "staff@example.com", roleName: "Moderator", status: "active" }] };
      }
      if (path === "/api/admin/staff?status=blocked") {
        return { staff: [{ id: "staff-2", email: "blocked@example.com", roleName: "Moderator", status: "blocked" }] };
      }
      if (path === "/api/admin/staff?status=removed") {
        return { staff: [{ id: "staff-3", email: "removed@example.com", roleName: "Moderator", status: "removed" }] };
      }
      if (path.startsWith("/api/admin/staff/")) {
        return { ok: true };
      }
      return {};
    });

    renderWithAuth(<AdminStaffListPage />, createAdminState());

    await screen.findByText("staff@example.com");
    expect(screen.getAllByRole("link", { name: "Manage Roles" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Manage Permissions" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Blocked Staff" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/admin/staff?status=blocked",
      expect.any(Object),
    ));
    expect(screen.getByRole("button", { name: "Unblock" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Removed Staff" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/admin/staff?status=removed",
      expect.any(Object),
    ));
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Permanently" })).toBeTruthy();
  });

  test("removed staff opens a delete confirmation modal and sends the correct body on success", async () => {
    request.mockImplementation(async (path, options = {}) => {
      if (path === "/api/admin/staff?status=active") {
        return { staff: [] };
      }
      if (path === "/api/admin/staff?status=blocked") {
        return { staff: [] };
      }
      if (path === "/api/admin/staff?status=removed") {
        return { staff: [{ id: "staff-1", email: "removed@example.com", roleName: "Moderator", status: "removed" }] };
      }
      if (path === "/api/admin/staff/staff-1" && options.method === "DELETE") {
        expect(options.body).toEqual({ confirm: "DELETE" });
        return { ok: true };
      }
      if (path === "/api/admin/staff/staff-1") {
        return { staff: { id: "staff-1", email: "removed@example.com", roleName: "Moderator", status: "removed" } };
      }
      return {};
    });

    renderWithAuth(<AdminStaffListPage />, createAdminState());
    fireEvent.click(screen.getByRole("button", { name: "Removed Staff" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/admin/staff?status=removed",
      expect.any(Object),
    ));
    await screen.findByText(/removed@example.com/i);
    expect(screen.queryByLabelText(/Type DELETE to confirm permanent deletion/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete Permanently" }));
    const dialog = await screen.findByRole("dialog", { name: /Delete Staff Permanently/i });
    const dialogScope = within(dialog);
    expect(dialogScope.getByText("This action cannot be undone.")).toBeTruthy();
    expect(dialogScope.getByLabelText(/Type DELETE to confirm permanent deletion/i).value).toBe("");
    expect(dialogScope.getByRole("button", { name: "Delete Permanently" }).disabled).toBe(true);
    fireEvent.change(dialogScope.getByLabelText(/Type DELETE to confirm permanent deletion/i), { target: { value: "delete" } });
    expect(dialogScope.getByRole("button", { name: "Delete Permanently" }).disabled).toBe(true);
    fireEvent.change(dialogScope.getByLabelText(/Type DELETE to confirm permanent deletion/i), { target: { value: "DEL" } });
    expect(dialogScope.getByRole("button", { name: "Delete Permanently" }).disabled).toBe(true);
    fireEvent.change(dialogScope.getByLabelText(/Type DELETE to confirm permanent deletion/i), { target: { value: "DELETE" } });
    expect(dialogScope.getByRole("button", { name: "Delete Permanently" }).disabled).toBe(false);
    fireEvent.click(dialogScope.getByRole("button", { name: "Delete Permanently" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/admin/staff/staff-1",
      expect.objectContaining({ method: "DELETE", body: { confirm: "DELETE" } }),
    ));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(/Staff permanently deleted\./i)).toBeTruthy();
  });

  test("delete confirmation modal supports cancel and safe backend errors", async () => {
    request.mockImplementation(async (path, options = {}) => {
      if (path === "/api/admin/staff?status=active") {
        return { staff: [] };
      }
      if (path === "/api/admin/staff?status=blocked") {
        return { staff: [] };
      }
      if (path === "/api/admin/staff?status=removed") {
        return { staff: [{ id: "staff-1", email: "removed@example.com", roleName: "Moderator", status: "removed" }] };
      }
      if (path === "/api/admin/staff/staff-1" && options.method === "DELETE") {
        const error = new Error("Forbidden");
        error.payload = { message: "This staff member cannot be deleted right now." };
        error.status = 400;
        throw error;
      }
      return {};
    });

    renderWithAuth(<AdminStaffListPage />, createAdminState());
    fireEvent.click(screen.getByRole("button", { name: "Removed Staff" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/admin/staff?status=removed",
      expect.any(Object),
    ));
    await screen.findByText(/removed@example.com/i);
    fireEvent.click(screen.getByRole("button", { name: "Delete Permanently" }));
    const dialog = await screen.findByRole("dialog", { name: /Delete Staff Permanently/i });
    const dialogScope = within(dialog);
    fireEvent.click(dialogScope.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Delete Permanently" }));
    const reopenedDialog = await screen.findByRole("dialog", { name: /Delete Staff Permanently/i });
    const reopenedScope = within(reopenedDialog);
    fireEvent.change(reopenedScope.getByLabelText(/Type DELETE to confirm permanent deletion/i), { target: { value: "DELETE" } });
    fireEvent.click(reopenedScope.getByRole("button", { name: "Delete Permanently" }));
    await waitFor(() => expect(screen.getByText(/This staff member cannot be deleted right now\./i)).toBeTruthy());
    expect(screen.getByRole("dialog", { name: /Delete Staff Permanently/i })).toBeTruthy();
  });

  test("staff detail page supports role assignment, direct permissions, and delete confirmation modal", async () => {
    request.mockImplementation(async (path, options = {}) => {
      if (path === "/api/admin/staff/staff-1") {
        if (options.method === "DELETE") {
          expect(options.body).toEqual({ confirm: "DELETE" });
          return { ok: true };
        }
        return { staff: { id: "staff-1", email: "staff@example.com", roleName: "Moderator", status: "removed" } };
      }
      if (path === "/api/admin/staff/staff-1/roles" && options.method === "PUT") {
        return { staffId: "staff-1", roles: [{ id: "role-2", name: "Moderator" }] };
      }
      if (path === "/api/admin/staff/staff-1/permissions" && options.method === "PUT") {
        return { staffId: "staff-1", permissions: [{ key: "pages.read" }] };
      }
      if (path === "/api/admin/staff/staff-1/roles") {
        return { staffId: "staff-1", roles: [{ id: "role-1", name: "Editor" }] };
      }
      if (path === "/api/admin/staff/staff-1/permissions") {
        return { staffId: "staff-1", permissions: [{ key: "pages.read", displayName: "Read Pages" }] };
      }
      if (path === "/api/admin/staff/staff-1/effective-permissions") {
        return { staffId: "staff-1", permissions: [{ key: "pages.read", displayName: "Read Pages" }] };
      }
      if (path === "/api/admin/roles") {
        return { roles: [{ id: "role-1", name: "Editor" }, { id: "role-2", name: "Moderator" }] };
      }
      if (path === "/api/admin/permissions") {
        return {
          groups: { pages: [{ id: "perm-1", key: "pages.read", displayName: "Read Pages" }] },
          permissions: [{ id: "perm-1", key: "pages.read", displayName: "Read Pages" }],
        };
      }
      return {};
    });

    render(
      <AuthContext.Provider value={{ state: createAdminState(), setState: vi.fn() }}>
        <MemoryRouter initialEntries={["/admin/staff/staff-1"]}>
          <Routes>
            <Route path="/admin/staff/:id" element={<AdminStaffDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    await screen.findByText(/staff@example.com/i);
    fireEvent.click(screen.getByRole("checkbox", { name: "Editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Permanently" }));
    const dialog = await screen.findByRole("dialog", { name: /Delete Staff Permanently/i });
    const dialogScope = within(dialog);
    fireEvent.change(dialogScope.getByLabelText(/Type DELETE to confirm permanent deletion/i), { target: { value: "DELETE" } });
    fireEvent.click(dialogScope.getByRole("button", { name: "Delete Permanently" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/admin/staff/staff-1",
      expect.objectContaining({ method: "DELETE", body: { confirm: "DELETE" } }),
    ));
  });

  test("role management supports editing and deleting roles", async () => {
    request.mockImplementation(async (path, options = {}) => {
      if (path === "/api/admin/roles") {
        if (options.method === "POST") {
          return { role: { id: "role-2", name: options.body.name } };
        }
        return { roles: [{ id: "role-1", name: "Editor", description: "Writes content", permissionKeys: ["pages.read"] }] };
      }
      if (path === "/api/admin/roles/role-1" && options.method === "PATCH") {
        return { role: { id: "role-1", name: options.body.name } };
      }
      if (path === "/api/admin/roles/role-1" && options.method === "DELETE") {
        return { ok: true };
      }
      return {};
    });

    renderWithAuth(<AdminRolesPage />, createAdminState());

    await screen.findByText(/Writes content/i);
    fireEvent.change(screen.getByLabelText(/Existing Role/i), { target: { value: "role-1" } });
    fireEvent.change(screen.getByLabelText(/Role Name/i), { target: { value: "Senior Editor" } });
    fireEvent.click(screen.getByRole("button", { name: /Update Role/i }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/admin/roles/role-1",
      expect.objectContaining({ method: "PATCH", body: expect.objectContaining({ name: "Senior Editor" }) }),
    ));
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/admin/roles/role-1",
      expect.objectContaining({ method: "DELETE" }),
    ));
  });

  test("change password submits the existing staff contract and surfaces backend messages", async () => {
    request.mockImplementation(async (path, options = {}) => {
      if (path === "/api/user/change-password" && options.method === "POST") {
        expect(options.body).toEqual({
          currentPassword: "OldPass123!",
          newPassword: "NewStrongPass123!",
          repeatNewPassword: "NewStrongPass123!",
        });
        expect(options.csrfToken).toBe("staff-csrf");
        expect(options.headers.Authorization).toBe("Bearer staff-token");
        return { ok: true, message: "Password changed successfully." };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <AuthContext.Provider value={{ state: createAuthState(), setState: vi.fn() }}>
        <MemoryRouter initialEntries={["/change-password"]}>
          <Routes>
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route path="/login" element={<div>Staff Login</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    fireEvent.change(screen.getByLabelText(/Current Password/i), { target: { value: "OldPass123!" } });
    fireEvent.change(screen.getAllByLabelText(/^New Password$/i)[0], { target: { value: "NewStrongPass123!" } });
    fireEvent.change(screen.getByLabelText(/Repeat New Password/i), { target: { value: "NewStrongPass123!" } });
    expect(screen.getByRole("button", { name: /Update Password/i }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Update Password/i }));

    await waitFor(() => expect(screen.getByText(/Password changed successfully\./i)).toBeTruthy());
    expect(screen.getByLabelText(/Current Password/i).value).toBe("");
    expect(screen.getAllByLabelText(/^New Password$/i)[0].value).toBe("");
    expect(screen.getByLabelText(/Repeat New Password/i).value).toBe("");
  });

  test("change password shows the backend message for a safe validation error", async () => {
    request.mockImplementation(async (path) => {
      if (path === "/api/user/change-password") {
        const error = new Error("Current password is incorrect.");
        error.status = 400;
        error.payload = { message: "Current password is incorrect." };
        throw error;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <AuthContext.Provider value={{ state: createAuthState(), setState: vi.fn() }}>
        <MemoryRouter initialEntries={["/change-password"]}>
          <Routes>
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route path="/login" element={<div>Staff Login</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    fireEvent.change(screen.getByLabelText(/Current Password/i), { target: { value: "WrongPass123!" } });
    fireEvent.change(screen.getAllByLabelText(/^New Password$/i)[0], { target: { value: "NewStrongPass123!" } });
    fireEvent.change(screen.getByLabelText(/Repeat New Password/i), { target: { value: "NewStrongPass123!" } });
    fireEvent.click(screen.getByRole("button", { name: /Update Password/i }));

    await screen.findByText(/Current password is incorrect\./i);
    expect(screen.getByLabelText(/Current Password/i)).toBeTruthy();
  });

  test("change password routes invalid staff sessions back to the staff login page", async () => {
    request.mockImplementation(async (path) => {
      if (path === "/api/user/change-password") {
        const error = new Error("Unauthorized");
        error.status = 401;
        throw error;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <AuthContext.Provider value={{ state: createAuthState(), setState: vi.fn() }}>
        <MemoryRouter initialEntries={["/change-password"]}>
          <Routes>
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route path="/login" element={<div>Staff Login</div>} />
            <Route path="/admin/login" element={<div>MasterAdmin Login</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    fireEvent.change(screen.getByLabelText(/Current Password/i), { target: { value: "WrongPass123!" } });
    fireEvent.change(screen.getAllByLabelText(/^New Password$/i)[0], { target: { value: "NewStrongPass123!" } });
    fireEvent.change(screen.getByLabelText(/Repeat New Password/i), { target: { value: "NewStrongPass123!" } });
    fireEvent.click(screen.getByRole("button", { name: /Update Password/i }));

    await screen.findByText("Staff Login");
    expect(screen.queryByText("MasterAdmin Login")).toBeNull();
  });
});

describe("invited staff management", () => {
  function createAdminState() {
    return createAuthState({
      masterAdmin: {
        role: "masterAdmin",
        accessToken: "admin-token",
        csrfToken: "admin-csrf",
        user: { id: "admin-1", username: "admin" },
      },
    });
  }

  test("invited staff tab renders safe invitation fields only", async () => {
    request.mockImplementation(async (path) => {
      if (path === "/api/admin/staff/invitations?status=pending") {
        return {
          invitations: [{
            id: "inv-1",
            staffAccountId: "staff-1",
            email: "invite@example.com",
            roleName: "Support Lead",
            status: "pending",
            createdAt: "2026-08-26T00:00:00.000Z",
            expiresAt: "2026-08-28T00:00:00.000Z",
            invitedByType: "master_admin",
            tokenHash: "secret-hash",
            rawToken: "secret-token",
          }],
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderWithAuthRoute("/admin/staff?tab=invited", <Routes><Route path="/admin/staff" element={<AdminStaffListPage />} /></Routes>, createAdminState());

    await screen.findByText("invite@example.com");
    expect(screen.getByText(/Designation: Support Lead/i)).toBeTruthy();
    expect(screen.getByText(/Status: pending/i)).toBeTruthy();
    expect(screen.getByText(/Invited By: master_admin/i)).toBeTruthy();
    expect(screen.queryByText(/secret-hash/i)).toBeNull();
    expect(screen.queryByText(/secret-token/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Resend Invitation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revoke Invitation" })).toBeTruthy();
  });

  test("create invitation redirects to invited staff and shows the new row immediately", async () => {
    const pendingInvitations = [];
    request.mockImplementation(async (path, options = {}) => {
      if (path === "/api/admin/staff/invitations" && options.method === "POST") {
        const invitation = {
          id: `inv-${pendingInvitations.length + 1}`,
          staffAccountId: `staff-${pendingInvitations.length + 1}`,
          email: options.body.email,
          roleName: options.body.roleName,
          status: "pending",
          createdAt: "2026-08-26T00:00:00.000Z",
          expiresAt: "2026-08-28T00:00:00.000Z",
          invitedByType: "master_admin",
        };
        pendingInvitations.unshift(invitation);
        return { invitation, staffAccount: { id: invitation.staffAccountId }, invitationUrl: "https://example.test/admin-staff/staff/register?token=raw-token", token: "raw-token" };
      }
      if (path === "/api/admin/staff/invitations?status=pending") {
        return { invitations: pendingInvitations };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <AuthContext.Provider value={{ state: createAdminState(), setState: vi.fn() }}>
        <MemoryRouter initialEntries={["/admin/staff/new"]}>
          <Routes>
            <Route path="/admin/staff/new" element={<AdminInviteStaffPage />} />
            <Route path="/admin/staff" element={<AdminStaffListPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: "invite@example.com" } });
    fireEvent.change(screen.getByLabelText(/Role \/ Designation/i), { target: { value: "Support Lead" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Invitation/i }));

    await waitFor(() => expect(screen.getByText("Invitation created successfully.")).toBeTruthy());
    await screen.findByText("invite@example.com");
  });

  test("resend and revoke invitation actions call backend and refresh the pending list", async () => {
    const pendingInvitations = [{
      id: "inv-1",
      staffAccountId: "staff-1",
      email: "invite@example.com",
      roleName: "Support Lead",
      status: "pending",
      createdAt: "2026-08-26T00:00:00.000Z",
      expiresAt: "2026-08-28T00:00:00.000Z",
      invitedByType: "master_admin",
    }];
    const calls = [];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    request.mockImplementation(async (path, options = {}) => {
      calls.push([path, options]);
      if (path === "/api/admin/staff/invitations?status=pending") {
        return { invitations: pendingInvitations };
      }
      if (path === "/api/admin/staff/invitations/staff-1/resend" && options.method === "POST") {
        pendingInvitations[0] = { ...pendingInvitations[0], id: "inv-2", createdAt: "2026-08-26T01:00:00.000Z" };
        return { invitation: pendingInvitations[0], staffAccount: { id: "staff-1" } };
      }
      if (path === "/api/admin/staff/invitations/staff-1/revoke" && options.method === "POST") {
        pendingInvitations.length = 0;
        return { invitationId: "inv-2", staffAccount: { id: "staff-1" } };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderWithAuthRoute("/admin/staff?tab=invited", <Routes><Route path="/admin/staff" element={<AdminStaffListPage />} /></Routes>, createAdminState());

    await screen.findByText("invite@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Resend Invitation" }));
    await waitFor(() => expect(calls.some(([path, options]) => path === "/api/admin/staff/invitations/staff-1/resend" && options.method === "POST")).toBe(true));
    await waitFor(() => expect(screen.getByText("Invitation resent successfully.")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Revoke Invitation" }));
    await waitFor(() => expect(calls.some(([path, options]) => path === "/api/admin/staff/invitations/staff-1/revoke" && options.method === "POST")).toBe(true));
    await waitFor(() => expect(screen.getByText("Invitation revoked.")).toBeTruthy());
    await waitFor(() => expect(screen.queryByText("invite@example.com")).toBeNull());

    window.confirm.mockRestore();
  });

  test("registered staff tab does not include invited users", async () => {
    request.mockImplementation(async (path) => {
      if (path === "/api/admin/staff?status=active") {
        return { staff: [{ id: "staff-1", email: "active@example.com", roleName: "Moderator", status: "active" }] };
      }
      if (path === "/api/admin/staff/invitations?status=pending") {
        return { invitations: [{ id: "inv-1", staffAccountId: "staff-2", email: "invite@example.com", roleName: "Support Lead", status: "pending", createdAt: "2026-08-26T00:00:00.000Z", expiresAt: "2026-08-28T00:00:00.000Z", invitedByType: "master_admin" }] };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderWithAuthRoute("/admin/staff?tab=registered", <Routes><Route path="/admin/staff" element={<AdminStaffListPage />} /></Routes>, createAdminState());

    await screen.findByText("active@example.com");
    expect(screen.queryByText("invite@example.com")).toBeNull();
  });
});
