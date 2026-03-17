/** @jest-environment node */

import {
  isExpired,
  isRevoked,
  isValidShareToken,
  normalizeTimestamp,
  resolveExpiration,
} from "@/lib/share-access";

describe("share-access", () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-03-16T12:00:00.000Z"));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it("normalizes ISO strings, epoch milliseconds, and epoch seconds", () => {
    const expectedIso = new Date(1_742_092_923_000).toISOString();

    expect(normalizeTimestamp("2026-03-15T01:02:03Z")).toBe("2026-03-15T01:02:03.000Z");
    expect(normalizeTimestamp(1_742_092_923_000)).toBe(expectedIso);
    expect(normalizeTimestamp(1_742_092_923)).toBe(expectedIso);
  });

  it("returns null for nullish and invalid timestamps", () => {
    expect(normalizeTimestamp(null)).toBeNull();
    expect(normalizeTimestamp(undefined)).toBeNull();
    expect(normalizeTimestamp("not-a-date")).toBeNull();
  });

  it("treats null as non-expired, future dates as active, and past dates as expired", () => {
    expect(isExpired(null)).toBe(false);
    expect(isExpired("2026-03-17T00:00:00.000Z")).toBe(false);
    expect(isExpired("2026-03-15T23:59:59.000Z")).toBe(true);
  });

  it("treats revoked_at or is_shareable=false as revoked", () => {
    expect(isRevoked({})).toBe(false);
    expect(isRevoked({ revoked_at: "2026-03-15T10:00:00.000Z" })).toBe(true);
    expect(isRevoked({ is_shareable: false })).toBe(true);
  });

  it("prefers share_expires_at over expires_at when both are present", () => {
    expect(
      resolveExpiration({
        share_expires_at: "2026-03-20T00:00:00.000Z",
        expires_at: "2026-03-30T00:00:00.000Z",
      })
    ).toBe("2026-03-20T00:00:00.000Z");
  });

  it("accepts valid share tokens and rejects short, long, or invalid ones", () => {
    expect(isValidShareToken("abc123_-")).toBe(true);
    expect(isValidShareToken("a".repeat(128))).toBe(true);
    expect(isValidShareToken("short7_")).toBe(false);
    expect(isValidShareToken("a".repeat(129))).toBe(false);
    expect(isValidShareToken("bad token")).toBe(false);
    expect(isValidShareToken("bad.token")).toBe(false);
  });
});
