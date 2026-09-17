/**
 * Mobile environment configuration.
 *
 * All values are set via .env files (EXPO_PUBLIC_ prefixed => inlined at build time).
 * See https://docs.expo.dev/guides/environment-variables/
 */

const mobileEnvSchema = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
} as const;

function assertEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing EXPO_PUBLIC_ environment variable: ${name}. Add it to app/.env (see app/.env.example).`,
    );
  }
  return value.trim().replace(/\/+$/, '');
}

export const env = {
  apiUrl: assertEnv('EXPO_PUBLIC_API_URL', mobileEnvSchema.apiUrl),
  supabaseUrl: assertEnv('EXPO_PUBLIC_SUPABASE_URL', mobileEnvSchema.supabaseUrl),
  supabasePublishableKey: assertEnv(
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    mobileEnvSchema.supabasePublishableKey,
  ),
} as const;

export const isDev = process.env.NODE_ENV !== 'production';