import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const registrationSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email(),
  password: z.string().min(12),
});

export const tokenSchema = z.object({ token: z.string().min(1) });

export const passwordResetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12),
  repeatPassword: z.string().min(12),
});

const identifierList = z.array(z.string().min(1)).default([]);

export const roleManagementSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  permissionIds: identifierList.optional(),
  permissionKeys: identifierList.optional(),
});

export const rolePermissionUpdateSchema = z.object({
  permissionIds: identifierList.optional(),
  permissionKeys: identifierList.optional(),
});

export const staffRoleUpdateSchema = z.object({
  roleIds: identifierList.optional(),
});

export const staffPermissionUpdateSchema = z.object({
  permissionIds: identifierList.optional(),
  permissionKeys: identifierList.optional(),
});
