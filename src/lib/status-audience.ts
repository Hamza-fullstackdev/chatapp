import type { StatusAudience } from '@/types/api';

export interface StatusAudienceSelection {
  audience: StatusAudience;
  excludeUserIds: string[];
  includeUserIds: string[];
}

let current: StatusAudienceSelection | null = null;

/** Remembered audience for the *next* status the user posts (this session). */
export function getStatusAudience(): StatusAudienceSelection | null {
  return current;
}

export function setStatusAudience(selection: StatusAudienceSelection): void {
  current = selection;
}

export function resetStatusAudience(): void {
  current = null;
}