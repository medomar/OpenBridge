# Feature Proposal — Shareable App Links + Web App Deployment

> **Status:** Proposed | **Target:** v0.0.12 (Phases 82–84) | **Last Updated:** 2026-03-04
> **Related:** docs/ROADMAP.md (Tunnel + Ephemeral Apps + Interaction Relay)

---

## Overview

Enable users to generate a secure, shareable link to a deployed web app produced by OpenBridge. The system can deploy the app locally with a tunnel (self-hosted) or via a managed relay (hosted by OpenBridge). Links should be short-lived by default, revocable, and scoped to a specific app build.

---

## Requirements

- Generate a unique link per app build with metadata (app name, build id, owner, created_at).
- Support immediate share and optional access gating (passcode or authenticated viewer).
- Support one-click link revocation and auto-expiry.
- Record link lifecycle in `openbridge.db` (created, active, revoked, expired).
- Provide status reporting to user (link URL, expiry time, viewer count, last access).
- Zero-config defaults (local tunnel + short expiry) with optional overrides.

---

## Security Considerations

**Auth**

- Links are signed, unguessable, and bound to a single app build.
- Optional viewer auth modes: none, passcode, or connector-auth (same user identity as chat session).

**Expiry**

- Default expiry: 24 hours (configurable per link).
- Server enforces expiry on every request; no client-only timers.
- Expired links return a static "link expired" page with instructions to request a new link.

**Access Control**

- Owner can revoke links at any time from any connector.
- Access scope: single app build, read-only by default, optional write/interactive mode if explicitly enabled.
- IP rate limits and basic abuse detection (burst throttling, request caps per minute).

---

## Deployment Modes

**Self-hosted (default)**

- App served locally by OpenBridge.
- Tunnel provider forwards traffic to the local app server.
- User manages DNS and certificates implicitly via tunnel provider.

**Managed (hosted by OpenBridge)**

- App packaged and pushed to a managed app relay.
- OpenBridge issues the link and hosts the app runtime.
- Requires explicit opt-in and managed deployment credentials.

---

## UX Flows

**Generate Link**

1. User: "Share this web app" or UI button "Generate Link".
2. Master validates app build artifacts and starts deployment.
3. System returns link + expiry + access mode summary.
4. User can copy link, change expiry, or revoke.

**Deploy Web App**

1. System builds app (static or server) and validates output.
2. Deploy to chosen mode (self-hosted tunnel or managed).
3. Health check verifies app availability.
4. Link becomes active only after health check passes.

---

## Acceptance Criteria

- Link creation, access, and revocation are fully logged in `openbridge.db`.
- Default link expires automatically without manual action.
- Auth, expiry, and access control are enforced server-side.
- Both self-hosted and managed modes are documented and selectable.
- User receives a clear summary of link status and expiry in all connectors.
