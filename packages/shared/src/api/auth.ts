import { z } from 'zod';
import { emailSchema, nameSchema, passwordSchema, type IsoDate } from './common';

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
});
export type RegisterRequest = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(256),
});
export type LoginRequest = z.input<typeof loginSchema>;

export const tokenSchema = z.object({ token: z.string().min(16).max(512) });
export type TokenRequest = z.input<typeof tokenSchema>;

export const emailOnlySchema = z.object({ email: emailSchema });
export type EmailOnlyRequest = z.input<typeof emailOnlySchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(512),
  password: passwordSchema,
});
export type ResetPasswordRequest = z.input<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.input<typeof changePasswordSchema>;

export const OAUTH_PROVIDERS = ['google', 'github'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export type ThemePreference = 'light' | 'dark' | 'system';

export interface UserPreferences {
  theme: ThemePreference;
  highContrast: boolean;
  reduceMotion: boolean;
  grid: { enabled: boolean; type: 'dot' | 'square' | 'isometric'; size: number };
  snapping: { toGrid: boolean; toObjects: boolean; angle: boolean };
  canvas: { zoomWithWheel: boolean; showMinimap: boolean; penMode: boolean };
  defaultStyles: {
    strokeColor: string;
    backgroundColor: string;
    strokeWidth: number;
    roughness: number;
    fontFamily: string;
    fontSize: number;
  };
  notifications: { email: boolean; mentions: boolean; shares: boolean; comments: boolean };
  /** User overrides of keyboard shortcuts, keyed by action id. */
  shortcuts: Record<string, string>;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: 'system',
  highContrast: false,
  reduceMotion: false,
  grid: { enabled: true, type: 'dot', size: 20 },
  snapping: { toGrid: false, toObjects: true, angle: true },
  canvas: { zoomWithWheel: false, showMinimap: false, penMode: false },
  defaultStyles: {
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    roughness: 1,
    fontFamily: 'hand',
    fontSize: 20,
  },
  notifications: { email: true, mentions: true, shares: true, comments: true },
  shortcuts: {},
};

export const userPreferencesSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']),
    highContrast: z.boolean(),
    reduceMotion: z.boolean(),
    grid: z.object({
      enabled: z.boolean(),
      type: z.enum(['dot', 'square', 'isometric']),
      size: z.number().int().min(4).max(200),
    }),
    snapping: z.object({ toGrid: z.boolean(), toObjects: z.boolean(), angle: z.boolean() }),
    canvas: z.object({
      zoomWithWheel: z.boolean(),
      showMinimap: z.boolean(),
      penMode: z.boolean(),
    }),
    defaultStyles: z.object({
      strokeColor: z.string().max(32),
      backgroundColor: z.string().max(32),
      strokeWidth: z.number().min(0.5).max(32),
      roughness: z.number().min(0).max(3),
      fontFamily: z.string().max(32),
      fontSize: z.number().min(4).max(400),
    }),
    notifications: z.object({
      email: z.boolean(),
      mentions: z.boolean(),
      shares: z.boolean(),
      comments: z.boolean(),
    }),
    shortcuts: z.record(z.string().max(64), z.string().max(64)),
  })
  .partial();

export interface UserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  oauthProviders: OAuthProvider[];
  preferences: UserPreferences;
  createdAt: IsoDate;
}

export interface AuthResponse {
  user: UserDto;
}

export interface RegisterResponse {
  user: UserDto;
  /** True when the account must be verified by email before signing in. */
  requiresVerification: boolean;
}

export interface AuthProvidersResponse {
  password: true;
  google: boolean;
  github: boolean;
}

export interface CsrfResponse {
  csrfToken: string;
}

export interface SessionDto {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: IsoDate;
  lastUsedAt: IsoDate;
  expiresAt: IsoDate;
  current: boolean;
}

export const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  avatarUrl: z.url().max(2048).nullable().optional(),
  preferences: userPreferencesSchema.optional(),
});
export type UpdateMeRequest = z.input<typeof updateMeSchema>;

/** Name of the non-HttpOnly cookie holding the CSRF token and the header it must be echoed in. */
export const CSRF_COOKIE = 'inkflow_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const ACCESS_COOKIE = 'inkflow_at';
export const REFRESH_COOKIE = 'inkflow_rt';
export const SHARE_TOKEN_HEADER = 'x-share-token';
export const SHARE_TOKEN_QUERY = 'st';
