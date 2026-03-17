export function normalizeTimestamp(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw > 1_000_000_000_000 ? raw : raw * 1000;
    return new Date(ms).toISOString();
  }

  return null;
}

export function resolveExpiration(row: {
  share_expires_at?: unknown;
  expires_at?: unknown;
}): string | null {
  const preferred = normalizeTimestamp(row.share_expires_at);
  if (preferred) {
    return preferred;
  }

  return normalizeTimestamp(row.expires_at);
}

export function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return false;
  }

  return Date.parse(expiresAt) <= Date.now();
}

export function isRevoked(row: {
  revoked_at?: unknown;
  is_shareable?: unknown;
}): boolean {
  return normalizeTimestamp(row.revoked_at) !== null || row.is_shareable === false;
}

export function isValidShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(token);
}
