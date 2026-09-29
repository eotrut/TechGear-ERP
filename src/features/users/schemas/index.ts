import { z } from "zod";

import { passwordSchema } from "@/features/auth/schemas";
import { text } from "@/lib/validation";

export const ROLE_VALUES = ["ADMIN", "MANAGER", "SALES", "WAREHOUSE"] as const;

export const createUserSchema = z.object({
  name: text(120, { min: 2, required: "Enter a name" }),
  email: z.email("Enter a valid email address").max(320),
  role: z.enum(ROLE_VALUES),
  password: passwordSchema,
  phone: z
    .string()
    .max(40)
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : null)),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  userId: z.string().min(1),
  name: text(120, { min: 2, required: "Enter a name" }),
  role: z.enum(ROLE_VALUES),
  phone: z
    .string()
    .max(40)
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : null)),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const setUserActiveSchema = z.object({
  userId: z.string().min(1),
  isActive: z.coerce.boolean(),
});

export const resetPasswordSchema = z.object({
  userId: z.string().min(1),
  newPassword: passwordSchema,
});
