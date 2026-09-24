# Authorized emergency-partner case and tracking contract

This feature is inside the existing **Emergency Partner** integration. It is inactive until a verified partner supplies the documented HTTPS endpoints and the server is configured with credentials. No credentials belong in the browser or repository.

## Contract boundary

- A dispatch response must contain the partner's non-empty `referenceId` before the app receives a short-lived, signed case-status capability.
- The reference ID is not treated as a case number. Case number, partner acceptance, assigned responder, distance, ETA, and stage are shown only when returned by the configured partner's status endpoint and matched to the same SOS/reference.
- Invalid, stale, cross-case, unassigned, closed, or malformed partner data is rejected or shown as unavailable. The app never estimates distance or ETA.
- TEST/DEMO, LOCAL_ONLY, and PUBLIC_CONTACT records cannot receive case tokens or tracking.

## Endpoints supplied by the partner

The server-side adapter expects separate HTTPS endpoints for:

- `AUTHORIZED_PARTNER_STATUS_URL`: POST `{ sosId, referenceId }`, returning matching case facts.
- `AUTHORIZED_PARTNER_LOCATION_URL`: POST `{ sosId, referenceId, caseNumber, userConsentAt, latitude, longitude, accuracyMeters, timestamp }`, returning `{ accepted: true, referenceId, caseNumber }`.
- `AUTHORIZED_PARTNER_STOP_URL`: POST `{ sosId, referenceId, caseNumber, userConsentAt, reason: "USER_STOPPED_SHARING" }`, returning `{ accepted: true, referenceId, caseNumber }`.

The existing `AUTHORIZED_PARTNER_API_URL` and `AUTHORIZED_PARTNER_API_KEY` remain server-only. The tracking secret signs internal, short-lived case capabilities and is not sent to the partner.

## Consent and lifecycle

1. One-time GPS inclusion is a separate checkbox in the existing partner handoff review and is off by default.
2. Live GPS requires a second, explicit user confirmation and a fresh status response showing partner acceptance, a case number, an assigned responder, and tracking acceptance.
3. GPS is watched only while the queue panel is open, online, visible, and the user has consented. It stops on user action, tab hide/lock, offline transition, navigation, stale/revoked partner status, GPS failure, or unconfirmed update.
4. GPS points are not queued, persisted, automatically retried, or resumed after reconnect. A stop revokes the local session first; if the partner cannot confirm the stop, the UI says so.
5. Offline mode can display a locally stored last-known partner report as stale; it cannot request status, send GPS, or claim a live ETA.

This adapter is a contract implementation and controlled-stub test target. It does not prove that a real emergency organization has accepted a deployment until its documented endpoint and credentials are configured and verified with that organization.
