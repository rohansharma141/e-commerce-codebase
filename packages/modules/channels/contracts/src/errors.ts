/**
 * A tenant has no default channel.
 *
 * Typed, and framework-free, so a caller can tell this one condition apart
 * from every other failure without matching on message text. The request edge
 * (C-32b) needs exactly that: a tenant with no channels at all is served as it
 * was before channels existed, while a database error must still surface.
 *
 * Today's only source is a tenant created after the C-11 backfill ran, through
 * `PUT /admin/tenant-config`, until C-35 makes onboarding create the channel.
 */
export class NoDefaultChannelError extends Error {
  constructor(readonly tenantId: string) {
    super(
      `tenant ${tenantId} has no default channel. The partial unique index allows at ` +
        `most one; nothing yet creates one for a tenant added after the C-11 backfill ran, ` +
        `so create its first channel through POST /admin/channels.`,
    );
    this.name = 'NoDefaultChannelError';
  }
}
