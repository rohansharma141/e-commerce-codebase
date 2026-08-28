/**
 * The channels module's private implementation.
 *
 * Only the Nest module and the repository are exported, and only for the
 * composition root to wire. Other modules consume channel configuration
 * through event-replicated read-models (C-14) and the `contracts` package —
 * never by importing from here, which the ESLint boundary rule enforces.
 */
export * from './channels.module';
export * from './channels.repository';
export * from './channels.service';
export * from './channels.schema';
export * from './channel-scope.middleware';
