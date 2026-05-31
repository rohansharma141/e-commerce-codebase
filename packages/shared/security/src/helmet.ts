import helmet, { type HelmetOptions } from 'helmet';

/**
 * Helmet config exported as a single, auditable policy. CSP is disabled
 * because the GraphQL landing page injects inline scripts at /graphql; a
 * stricter CSP would land alongside the production gateway that fronts
 * this api and never serves the GraphQL UI to the public.
 */
export const helmetOptions: HelmetOptions = {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
};

export const helmetMiddleware = (): ReturnType<typeof helmet> => helmet(helmetOptions);
