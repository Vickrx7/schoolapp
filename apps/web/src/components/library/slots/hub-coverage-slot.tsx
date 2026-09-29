import type { SessionContext } from '@/server/session';

export interface HubCoverageSlotProps {
  session: SessionContext;
}

/**
 * « Couverture du curriculum » on the library hub (DECISIONS D-094, slice S5): the link to the
 * attentes with no or few board-approved resources, by grade and subject. Rendered on the
 * server in the hub's browsing section, under « Parcourir par attente ». Renders nothing until
 * S5 fills it.
 */
export async function HubCoverageSlot(_props: HubCoverageSlotProps) {
  return null;
}
