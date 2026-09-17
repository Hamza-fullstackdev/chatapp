import { env } from '@/constants/env';
import type { ApiEnvelope, AuthResponse } from '@/types/api';
import { getRefreshToken, setRefreshToken } from './secure';

let authToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function doRequest<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (authToken) headers.set('Authorization', `Bearer ${authToken}`);

  const res = await fetch(`${env.apiUrl}${path}`, { ...init, headers });

  let body: ApiEnvelope<T> | undefined;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    body = undefined;
  }

  if (!res.ok || !body?.success) {
    const err = body?.error;
    throw new ApiError(
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `Request failed (${res.status})`,
      res.status,
      err?.details,
    );
  }

  return body.data;
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken || !authToken) return false;
  try {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    const res = await fetch(`${env.apiUrl}/api/auth/refresh`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as ApiEnvelope<{ token: string; refreshToken: string }>;
    if (!body.success) return false;
    authToken = body.data.token;
    await setRefreshToken(body.data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  try {
    return await doRequest<T>(path, { ...init });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && (!init.method || init.method === 'GET' || init.method === 'POST' || init.method === 'PUT' || init.method === 'PATCH' || init.method === 'DELETE')) {
      const refreshed = await refreshAccessToken();
      if (refreshed && authToken) {
        try {
          return await doRequest<T>(path, { ...init });
        } catch (retryErr) {
          if (retryErr instanceof ApiError && retryErr.status === 401) {
            onSessionExpired?.();
          }
          throw retryErr;
        }
      }
      onSessionExpired?.();
    }
    throw err;
  }
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `?${qs}` : '';
}

export const http = {
  get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    return request<T>(params ? `${path}${toQuery(params)}` : path, { method: 'GET' });
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
  },
  delete<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'DELETE',
      body: body == null ? undefined : JSON.stringify(body),
    });
  },
};

export { AuthResponse, authToken as currentAuthToken };