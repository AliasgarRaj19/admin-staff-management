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
