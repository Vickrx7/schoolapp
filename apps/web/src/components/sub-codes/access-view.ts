/**
 * A plan's substitute codes and devices as staff see them (list_sub_plan_access). Metadata
 * only: a code is shown once when it is generated and can never be looked up again (DECISIONS
 * D-050). Pure, so it can be unit tested.
 */

export interface SubAccessCode {
  codeId: string;
  createdAt: string;
  createdByName: string | null;
  validFrom: string;
  expiresAt: string;
  revokedAt: string | null;
  deviceCount: number;
}

export interface SubAccessSession {
  sessionId: string;
  codeId: string;
  deviceNumber: number;
  startedAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  /** Revoked by staff (« Couper »), as opposed to ended by the substitute or replaced. */
  cut: boolean;
}

export interface SubAccess {
  codes: SubAccessCode[];
  sessions: SubAccessSession[];
}

/** One device: all its sessions for the plan, summed up. */
export interface SubDevice {
  deviceNumber: number;
  /** The session « Couper » is sent for (the database cuts every session of the device). */
  sessionId: string;
  firstSeenAt: string;
  lastSeenAt: string | null;
  /** Signed in now: its latest session is neither ended nor cut, and not expired. */
  active: boolean;
  /** Cut by staff: it cannot sign in again with the same code. */
  cut: boolean;
}

export interface SubAccessView {
  /** Codes that still work (not cut, not expired), oldest first. */
  activeCodes: SubAccessCode[];
  devices: SubDevice[];
}

export function summarizeAccess(access: SubAccess, now: Date): SubAccessView {
  const activeCodes = access.codes.filter((c) => !c.revokedAt && new Date(c.expiresAt) > now);
  const byDevice = new Map<number, SubAccessSession[]>();
  for (const s of [...access.sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    byDevice.set(s.deviceNumber, [...(byDevice.get(s.deviceNumber) ?? []), s]);
  }
  const devices = [...byDevice.entries()]
    .sort(([a], [b]) => a - b)
    .map(([deviceNumber, sessions]): SubDevice => {
      const latest = sessions[sessions.length - 1]!;
      const seen = sessions
        .map((s) => s.lastSeenAt)
        .filter((t): t is string => !!t)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      return {
        deviceNumber,
        sessionId: latest.sessionId,
        firstSeenAt: sessions[0]!.startedAt,
        lastSeenAt: seen.at(-1) ?? null,
        active: !latest.revokedAt && new Date(latest.expiresAt) > now,
        cut: sessions.some((s) => s.cut),
      };
    });
  return { activeCodes, devices };
}
