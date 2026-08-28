/**
 * The channels module's private implementation.
 *
 * Empty at C-6 by design: the contracts land first, per CLAUDE.md's rule that
 * "every module: contracts define the interface + DTOs + event types before src
 * is written". The schema and migrations arrive in C-5, the repository in C-7,
 * and the Nest module wiring with them.
 *
 * The package exists now rather than later so the boundary rule is enforceable
 * against a real target: without it, another module importing
 * `@platform/modules/channels/src` would fail as "module not found" — passing
 * the boundary check for the wrong reason.
 */
export {};
