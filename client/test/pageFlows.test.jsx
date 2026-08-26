import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  AdminInviteStaffPage,
  AdminPermissionsPage,
  AdminRolesPage,
  AdminStaffDetailPage,
  AdminStaffListPage,
  AuthContext,
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
    expect(screen.getByRole("link", { name: "Pages" }).getAttribute("href")).toContain("/admin/permissions?module=pages");
    expect(screen.getByRole("link", { name: "Edit Blog" }).getAttribute("href")).toContain("/admin/permissions?module=blog");
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

  test("staff lifecycle list exposes status filters and action buttons", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Blocked" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/admin/staff?status=blocked",
      expect.any(Object),
    ));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(request.mock.calls.some(([path]) => String(path).endsWith("/remove"))).toBe(true));
  });

  test("staff detail page supports role assignment, direct permissions, and typed delete", async () => {
    request.mockImplementation(async (path, options = {}) => {
      if (path === "/api/admin/staff/staff-1") {
        return { staff: { id: "staff-1", email: "staff@example.com", roleName: "Moderator", status: "active" } };
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
      if (path === "/api/admin/staff/staff-1" && options.method === "DELETE") {
        return { ok: true };
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
    fireEvent.change(screen.getByLabelText(/Type DELETE to permanently delete/i), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: "DELETE" }));
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
});
