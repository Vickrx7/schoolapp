/**
 * Adapters for the school's physical and telecom systems.
 *
 * Phase 1 ships interfaces and mock implementations only: nothing here talks to real
 * hardware. Real adapters (Asterisk SIP paging, VantageCore/ICT Protege WX, Akuvox,
 * DW Spectrum, an SMS/voice provider) implement the same interfaces later.
 *
 * Life-safety note: emergency functions (lockdown, hold-and-secure, roll call) are NOT part
 * of these interfaces. They need their own design review, redundancy and offline operation
 * on the edge appliance before any code is written (SPEC section 12).
 */
import { z } from 'zod';

export interface IntegrationHealth {
  ok: boolean;
  detail?: string;
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------------------
// Paging / PA and bells (SIP, Asterisk-based)
// ---------------------------------------------------------------------------------------

export const announcementSchema = z.object({
  zoneIds: z.array(z.string().min(1)).min(1),
  message: z.object({ fr: z.string().min(1).max(1000), en: z.string().max(1000).optional() }),
  priority: z.enum(['normal', 'high']).default('normal'),
});
export type Announcement = z.input<typeof announcementSchema>;

export interface PagingAdapter {
  announce(input: Announcement): Promise<{ announcementId: string }>;
  playTone(input: { zoneIds: string[]; tone: 'bell' | 'chime' }): Promise<void>;
  health(): Promise<IntegrationHealth>;
}

// ---------------------------------------------------------------------------------------
// Access control through the VantageCore appliance (ICT Protege WX)
// ---------------------------------------------------------------------------------------

export const temporaryCredentialSchema = z
  .object({
    /** A label only, e.g. "Suppléance – Local 101". Never a student or personal detail. */
    holderLabel: z.string().min(1).max(80),
    validFrom: z.date(),
    validUntil: z.date(),
    doorGroupIds: z.array(z.string().min(1)).min(1),
  })
  .refine((c) => c.validUntil > c.validFrom, 'validUntil must be after validFrom')
  .refine(
    (c) => c.validUntil.getTime() - c.validFrom.getTime() <= 24 * 3600 * 1000,
    'temporary credentials last at most one day',
  );
export type TemporaryCredentialRequest = z.input<typeof temporaryCredentialSchema>;

export interface AccessControlAdapter {
  issueTemporaryCredential(
    input: TemporaryCredentialRequest,
  ): Promise<{ credentialId: string; pin?: string }>;
  revokeCredential(credentialId: string): Promise<void>;
  health(): Promise<IntegrationHealth>;
}

// ---------------------------------------------------------------------------------------
// Intercoms (Akuvox) and video (Digital Watchdog DW Spectrum)
// ---------------------------------------------------------------------------------------

export interface DeviceInfo {
  id: string;
  name: string;
  location: string;
  online: boolean;
}

export interface IntercomAdapter {
  listDevices(): Promise<DeviceInfo[]>;
  health(): Promise<IntegrationHealth>;
}

export interface VideoAdapter {
  listCameras(): Promise<DeviceInfo[]>;
  /** A short-lived URL for a live view, for authorized staff only. */
  getLiveViewUrl(cameraId: string): Promise<string>;
  health(): Promise<IntegrationHealth>;
}

// ---------------------------------------------------------------------------------------
// Notifications: SMS, email, voice calls and the IVR absence line
// ---------------------------------------------------------------------------------------

export const smsSchema = z.object({
  to: z.string().regex(/^\+1\d{10}$/, 'Canadian number in E.164 format, e.g. +16135550100'),
  body: z.string().min(1).max(640),
});
export const emailSchema = z.object({
  to: z.email(),
  subject: z.string().min(1).max(200),
  text: z.string().min(1),
  html: z.string().optional(),
});
export const voiceCallSchema = z.object({
  to: smsSchema.shape.to,
  messageFr: z.string().min(1).max(1000),
  messageEn: z.string().max(1000).optional(),
});

export interface NotificationAdapter {
  sendSms(input: z.input<typeof smsSchema>): Promise<{ messageId: string }>;
  sendEmail(input: z.input<typeof emailSchema>): Promise<{ messageId: string }>;
  placeVoiceCall(input: z.input<typeof voiceCallSchema>): Promise<{ callId: string }>;
  health(): Promise<IntegrationHealth>;
}

export interface Integrations {
  paging: PagingAdapter;
  accessControl: AccessControlAdapter;
  intercom: IntercomAdapter;
  video: VideoAdapter;
  notifications: NotificationAdapter;
}

// ---------------------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------------------

export interface RecordedCall {
  adapter: keyof Integrations;
  method: string;
  input: unknown;
  at: Date;
}

export interface MockIntegrations extends Integrations {
  /** Every call made, in order: handy in tests and in the dev console. */
  calls: RecordedCall[];
}

const silentLogger: Logger = { info: () => undefined };

export function createMockIntegrations(logger: Logger = silentLogger): MockIntegrations {
  const calls: RecordedCall[] = [];
  let seq = 0;
  const id = (prefix: string) => `${prefix}-mock-${++seq}`;
  const record = (adapter: keyof Integrations, method: string, input: unknown) => {
    calls.push({ adapter, method, input, at: new Date() });
    logger.info(`[mock ${adapter}] ${method}`, { input });
  };
  const healthy = async (): Promise<IntegrationHealth> => ({ ok: true, detail: 'mock' });
  const revoked = new Set<string>();

  return {
    calls,
    paging: {
      async announce(input) {
        const parsed = announcementSchema.parse(input);
        record('paging', 'announce', parsed);
        return { announcementId: id('ann') };
      },
      async playTone(input) {
        record('paging', 'playTone', input);
      },
      health: healthy,
    },
    accessControl: {
      async issueTemporaryCredential(input) {
        const parsed = temporaryCredentialSchema.parse(input);
        record('accessControl', 'issueTemporaryCredential', parsed);
        return { credentialId: id('cred'), pin: '000000' };
      },
      async revokeCredential(credentialId) {
        record('accessControl', 'revokeCredential', { credentialId });
        revoked.add(credentialId);
      },
      health: healthy,
    },
    intercom: {
      async listDevices() {
        record('intercom', 'listDevices', null);
        return [
          {
            id: 'intercom-front',
            name: 'Porte principale',
            location: 'Entrée principale',
            online: true,
          },
        ];
      },
      health: healthy,
    },
    video: {
      async listCameras() {
        record('video', 'listCameras', null);
        return [
          { id: 'cam-front', name: 'Entrée principale', location: 'Extérieur', online: true },
        ];
      },
      async getLiveViewUrl(cameraId) {
        record('video', 'getLiveViewUrl', { cameraId });
        return `https://example.invalid/mock-live/${encodeURIComponent(cameraId)}`;
      },
      health: healthy,
    },
    notifications: {
      async sendSms(input) {
        const parsed = smsSchema.parse(input);
        record('notifications', 'sendSms', { to: parsed.to, length: parsed.body.length });
        return { messageId: id('sms') };
      },
      async sendEmail(input) {
        const parsed = emailSchema.parse(input);
        record('notifications', 'sendEmail', { to: parsed.to, subject: parsed.subject });
        return { messageId: id('email') };
      },
      async placeVoiceCall(input) {
        const parsed = voiceCallSchema.parse(input);
        record('notifications', 'placeVoiceCall', { to: parsed.to });
        return { callId: id('call') };
      },
      health: healthy,
    },
  };
}

export type IntegrationsMode = 'mock';

export function createIntegrations(mode: IntegrationsMode, logger?: Logger): Integrations {
  switch (mode) {
    case 'mock':
      return createMockIntegrations(logger);
  }
}
