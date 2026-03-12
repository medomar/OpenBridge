/**
 * Integration Hub Module
 * Manages connections to external business services (Stripe, Google Drive, databases, etc.)
 *
 * Exports:
 * - IntegrationHub: Registry and lifecycle manager for business integrations
 * - credential-store: AES-256-GCM encryption for credentials at rest
 * - webhook-router: Incoming webhook dispatcher for integration events
 *
 * Adapters (in src/integrations/adapters/):
 * - stripe-adapter: Stripe payment integration
 * - google-drive-adapter: Google Drive file storage
 * - google-sheets-adapter: Google Sheets read/write sync
 * - openapi-adapter: Universal REST API connector
 * - email-adapter: Email (SMTP send + IMAP/Gmail read)
 * - database-adapter: PostgreSQL/MySQL read-only connections
 * - dropbox-adapter: Dropbox file storage
 * - google-calendar-adapter: Google Calendar scheduling
 */

export { IntegrationHub } from './hub.js';
export { CredentialStore } from './credential-store.js';
export type { EncryptedCredential } from './credential-store.js';
export { WebhookRouter } from './webhook-router.js';
export type { WebhookHandler } from './webhook-router.js';
export { StripeAdapter } from './adapters/stripe-adapter.js';
