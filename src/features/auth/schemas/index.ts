import { z } from "zod";

/** Zod is the single source of truth for these shapes; TS types are inferred. */

export const loginSchema = z.object({
  email: z.email("Enter a valid email address").max(320),
  password: z.string().min(1, "Enter your password").max(200),
  next: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Password policy. Long enough to resist offline guessing without being so
 * fussy that people write it on a sticky note.
 */
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "That is too long")
  .refine((value) => /[a-z]/.test(value), "Include a lowercase letter")
  .refine((value) => /[A-Z]/.test(value), "Include an uppercase letter")
  .refine((value) => /[0-9]/.test(value), "Include a number");

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "The two passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "Choose a password you have not used here before",
    path: ["newPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateProfileSchema = z.object({
  name: z.string().min(2, "Enter your name").max(120),
  phone: z
    .string()
    .max(40)
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : null)),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
