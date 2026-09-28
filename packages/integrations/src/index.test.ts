import { describe, expect, it } from 'vitest';
import { createMockIntegrations } from './index';

describe('mock integrations', () => {
  it('records calls instead of touching hardware', async () => {
    const integrations = createMockIntegrations();
    const { announcementId } = await integrations.paging.announce({
      zoneIds: ['zone-1'],
      message: { fr: 'Bonjour à tous', en: 'Good morning' },
    });
    expect(announcementId).toMatch(/^ann-mock-/);
    expect(integrations.calls).toHaveLength(1);
    expect(integrations.calls[0]).toMatchObject({ adapter: 'paging', method: 'announce' });
  });

  it('issues day-only door credentials and rejects longer ones', async () => {
    const { accessControl } = createMockIntegrations();
    const validFrom = new Date('2026-10-01T11:00:00Z');
    await expect(
      accessControl.issueTemporaryCredential({
        holderLabel: 'Suppléance – Local 101',
        validFrom,
        validUntil: new Date('2026-10-01T21:00:00Z'),
        doorGroupIds: ['main-entrance'],
      }),
    ).resolves.toMatchObject({ credentialId: expect.stringMatching(/^cred-mock-/) });

    await expect(
      accessControl.issueTemporaryCredential({
        holderLabel: 'Too long',
        validFrom,
        validUntil: new Date('2026-10-03T21:00:00Z'),
        doorGroupIds: ['main-entrance'],
      }),
    ).rejects.toThrow(/at most one day/);
  });

  it('validates phone numbers and never records message bodies', async () => {
    const integrations = createMockIntegrations();
    await expect(
      integrations.notifications.sendSms({ to: '613-555-0100', body: 'x' }),
    ).rejects.toThrow();
    await integrations.notifications.sendSms({ to: '+16135550100', body: 'Code : 123456' });
    expect(JSON.stringify(integrations.calls)).not.toContain('123456');
  });
});
