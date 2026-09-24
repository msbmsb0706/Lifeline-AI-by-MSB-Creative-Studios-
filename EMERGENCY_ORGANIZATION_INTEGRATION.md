# LifeLine AI — Emergency Organization Integration Guide

**LifeLine AI · BY MSB CREATIVE STUDIOS**

This guide documents the LifeLine AI Emergency Organization Integration
Framework. It is the reference for emergency, rescue, public-safety, and
government organizations that want to understand — or provide — an
authorized integration with LifeLine AI.

---

## Purpose

LifeLine AI includes a country-aware Emergency Partner integration framework
that lets a user send a structured, user-confirmed SOS package to an
emergency organization over secure HTTPS — or, when no digital integration
exists, view the organization's officially published emergency contact
information.

This guide covers the framework's provider types, consent model, SOS data
mapping, credential handling, acknowledgment flow, idempotency, error
handling, sandbox testing, and offline store-and-forward behavior, and it
defines the integration boundary that applies to every provider type.

---

## Integration Boundary (Critical)

LifeLine AI does **not** claim to provide real government, emergency-service,
rescue, or public-safety dispatch.

Real government / rescue / public-safety dispatch is only possible when an
authorized organization has actually supplied, authorized, configured, and
tested its API or integration.

Accordingly:

- **LOCAL_ONLY** stores real user SOS text on this browser/device for manual sharing; it is not an API destination or a partner.
- **TEST / DEMO** accepts only the fixed synthetic example from the partner directory. Real user SOS text (including legacy queued TEST records) is blocked from demo API upload. It is **not** emergency dispatch.
- **PUBLIC_CONTACT** is an officially published contact-information
  provider. It is **not** an API dispatch integration.
- **AUTHORIZED_API** is used only when an organization has actually supplied
  and authorized the required integration. Until then, this provider type is
  a template and must be treated as disabled / not configured.

---

## Provider Types

### TEST / DEMO Provider

- Labeled clearly: `"TEST EMERGENCY PARTNER — DEMONSTRATION ONLY"`.
- Used exclusively for synthetic partner-directory demonstrations and sandbox testing. The demo endpoint rejects user SOS messages and local-only records.
- Simulates receiving a fixed example and returns a mock acknowledgment with
  a reference ID (`DEMO-ACK-XXXXX`).
- Does **not** send alerts to any real government, police, fire, or rescue
  organization.

### PUBLIC_CONTACT Provider

- Displays officially published emergency contact numbers and websites (for
  example, 911 in the US, 112 in the EU and India, 108 in India, 999 in the
  UK, 000 in Australia).
- Only populates contacts from verified official government sources.
- Clearly states that no digital API exists for automated dispatch.
- Does **not** automatically upload GPS, photos, or video to public
  telephone lines or websites unless explicitly supported by documented
  submission methods.

### AUTHORIZED_API Provider

- Used only when an organization has provided an actual, documented API
  interface.
- Sends the structured SOS package over secure HTTPS to the authorized
  endpoint.
- Credentials remain server-side and are never exposed in browser or client
  code.
- Supports request validation, authentication, provider acknowledgment,
  error handling, and safe retries.
- The in-app `AUTHORIZED_API` entry is a sample / template and is disabled
  by default until a real, authorized endpoint and its server-side
  credentials are configured and tested.

---

## Architecture

```
Real SOS → LOCAL_ONLY browser queue → user-initiated device share/clipboard (no API)
Fixed synthetic demo / explicitly approved authorized record
         → Node/Express POST /api/emergency-partner/dispatch
              ├─ PUBLIC_CONTACT   → rejected (no API capability)
              ├─ LOCAL_ONLY       → rejected (no API capability)
              ├─ AUTHORIZED_API   → server-side HTTPS call if configured
              └─ TEST / DEMO      → mock acknowledgment for fixed synthetic example ONLY
```

- The browser talks to the LifeLine backend over relative API routes.
- The backend routes each request by `providerType`.
- No partner credential is ever sent to the browser.

---

## User Confirmation & Consent

- A local save is **not** consent to partner transmission. It creates a LOCAL_ONLY record; no API upload is possible for that record.
- Explicit review/approval is required for eligible configured partner transmissions. The approved record carries its confirmation timestamp.
- Real SOS text can be reviewed, manually shared through the device or copied to clipboard, and deleted from the queue.
- No queue transmission runs on reconnect, page open, timer, focus, or battery recovery — even if an older auto-send preference was stored.

---

## SOS Package & Data Mapping

The SOS package transmitted to a provider is a structured JSON payload. The
documented fields are:

| Field | Description |
| --- | --- |
| `sosId` | Unique SOS identifier for the package. |
| `timestamp` | ISO 8601 timestamp of the report. |
| `emergencyType` | Emergency type selected or classified. |
| `category` | Standardized emergency category (e.g., `MEDICAL`, `FIRE`, `RESCUE`, `FOOD`, `WATER`, `SHELTER`, `MISSING_PERSON`, `OTHER`). |
| `severity` | Severity level for the classified emergency. |
| `message` | The report / triage message. |
| `gps` | Device coordinates with optional accuracy and timestamp, or `null`. |
| `photos` | Up to two still images as metadata entries. |
| `video` | Optional 10-second video metadata entry, or `null`. |
| `source` | `online` or `offline`. |
| `partnerId` | Identifier of the target partner/provider. |
| `providerType` | `LOCAL_ONLY` (never sent), `TEST` (synthetic only), `PUBLIC_CONTACT`, or `AUTHORIZED_API`. |
| `userConsentConfirmed` | Boolean confirming explicit user review and consent. |

---

## GPS Behavior

- Location is requested **once** for the active Silent SOS session
  (`getCurrentPosition`).
- There is no continuous tracking in ordinary SOS capture. The existing AUTHORIZED_API case flow may use a separate `watchPosition` only after a verified partner case, assigned responder, partner tracking acceptance, and a second explicit user consent. It runs only while the queue panel is open, online, visible, and the app is open; never in background, offline, or after reconnect.
- GPS is device geolocation; it is not inferred from video.
- Device GPS can be acquired offline if location hardware is available.
- A location privacy confirmation is shown before coordinates are included
  or shared.

---

## Photo & Video Evidence

- Up to **two** still images can be captured or selected as emergency
  evidence. There is no continuous camera.
- An **optional 10-second** SOS video can be recorded, starting only after
  the user taps record and stopping automatically at 10 seconds (or
  sooner).
- Photos and video are evidence only. They are **not** sent to a vision AI
  model.
- Photo/video **bytes are not retained by the SOS queue and cannot be uploaded from it**, even if a provider supports media. Only file names/types/sizes can be included in a manually approved API payload. Save video to the device or share evidence via the device sheet while the tab and files are still open.

---

## Server-Side Credential Model

- Authorized-provider configuration (endpoint URL and API credential) is
  stored only as server-side environment variables.
- The server uses them to authenticate the HTTPS call to the authorized
  endpoint.
- They are never bundled into the frontend, never returned by an API
  response, and never committed to the repository.
- No API keys, secrets, or credentials are stored in client code.

---

## Organization API Requirements

To enable a real `AUTHORIZED_API` integration, the organization must supply
and authorize all of the following, and the operator must configure and test
them:

- An HTTPS API endpoint.
- An authentication method and the server-side credential for it.
- The payload requirements accepted by the endpoint.
- Media upload rules (whether photos/video are accepted).
- A sandbox / test endpoint for staging.
- The acknowledgment format the endpoint returns.

Until these are supplied, authorized, configured, and tested, the
`AUTHORIZED_API` provider remains disabled.

---

## Onboarding & Integration Process

The documented process for bringing up an authorized organization
integration is:

1. The organization supplies and authorizes its API contract and endpoint.
2. The SOS package fields are mapped to the endpoint's payload requirements.
3. The authentication method and server-side credential are configured in
   the server environment only.
4. The provider's acknowledgment format and idempotency behavior are
   confirmed.
5. Media rules and the sandbox environment are supplied for testing.
6. The integration is validated against the sandbox / test endpoint before
   any real endpoint is enabled.

This is a template process. LifeLine AI does not ship with a pre-configured
real organization integration.

---

## API Request, Response & Acknowledgment Handling

- The client transmits the SOS package over HTTPS to the backend dispatch
  endpoint with `userConsentConfirmed` set.
- The backend enforces explicit consent and required fields, then routes by
  provider type.
- `TEST / DEMO` returns a mock acknowledgment with status `ACKNOWLEDGED` and
  a reference ID in the `DEMO-ACK-XXXXX` format, and states that no real
  emergency service received the alert.
- `AUTHORIZED_API` returns `ACKNOWLEDGED` with a reference ID from the
  authorized endpoint only after a successful HTTPS response.
- `PUBLIC_CONTACT` never produces an acknowledgment; requests are rejected
  because public telephone numbers do not support digital API dispatches.

---

## Idempotency

- An SOS is marked `SENT` only after receiving a valid provider
  acknowledgment.
- Items already `SENT` and in-flight `SENDING` records are skipped during a normal session. An interrupted `SENDING` record is recovered for manual review on restart, **not automatically retried**.
- Exactly-once delivery is **not guaranteed**: if a partner accepted the request but the browser closed before saving the receipt, a later manual retry could duplicate it. A real partner must implement idempotency by `sosId`.

---

## Error Handling

The framework returns distinct, non-sensitive error responses and never
exposes credentials:

- Transmission is refused when explicit user consent has not been confirmed.
- Requests missing required SOS fields are rejected.
- `PUBLIC_CONTACT` targets are rejected, because public telephone numbers do
  not support digital API dispatches.
- `AUTHORIZED_API` dispatch is refused when no authorized endpoint or
  credential is configured; the template provider remains disabled until an
  organization supplies and authorizes the integration.
- A non-success response from an authorized partner is surfaced to the user
  as a failure.
- Timeouts and network failures during an authorized-provider call are
  surfaced as dispatch failures.

Failed eligible partner records remain in the local queue with an error message.
Only an explicit user action can retry them. Local-only SOS records are never
API retry candidates; old auto-send preferences are ignored.

---

## Sandbox Testing

- The built-in TEST / DEMO provider accepts only a fixed synthetic partner-directory fixture. It returns a mock endpoint receipt, never an actual emergency-service delivery or acknowledgment.
- A real `AUTHORIZED_API` integration must be validated against the
  organization's own sandbox / test endpoint before the real endpoint is
  enabled.

---

## Offline & Store-and-Forward Behavior

- Offline SOS generation continues to work without internet: device GPS (if
  available), local classification, photo evidence (up to 2 images), and
  10-second video recording.
- A real SOS package is saved only after explicit user confirmation, locally in browser storage; a failed save is reported and storage can be evicted by the browser/OS.
- No automatic upload setting exists. Reconnecting/restarting never uploads any SOS (including older consented partner records); review and share manually after connectivity returns if desired.
- Partner API dispatch is unavailable until a documented authorized integration is actually configured. The included TEST endpoint is for synthetic examples only.
- Photo/video file contents are never queued or uploaded by the partner API flow; only metadata survives closing the tab.

---

## Security & Privacy Requirements

- All server communication occurs over HTTPS.
- Partner credentials remain server-side only.
- Explicit user consent is required before any transmission.
- No secrets, credentials, or private URLs are committed to the repository.
- Photos and video are evidence only and are not sent to a vision AI model.
- LifeLine AI does not automatically contact government or rescue services;
  a real dispatch occurs only through an authorized, configured, and tested
  organization API.

---

## Organization API Information Sheet (Template)

For a real integration to be evaluated and enabled, the organization must
provide and authorize the following information. This sheet is a template;
LifeLine AI does not predefine any of the values.

| Item | Detail |
| --- | --- |
| Organization name | `[To be provided by the organization]` |
| Organization website / official source | `[To be provided by the organization]` |
| API endpoint (HTTPS) | `[To be provided and authorized by the organization]` |
| Authentication method | `[To be provided and authorized by the organization]` |
| Server-side credential (reference only) | `[Configured in the server environment; never committed]` |
| Payload requirements | `[To be provided and authorized by the organization]` |
| Media upload rules | `[To be provided and authorized by the organization]` |
| Acknowledgment format | `[To be provided and authorized by the organization]` |
| Sandbox / test endpoint | `[To be provided and authorized by the organization]` |
| Production endpoint | `[To be provided and authorized by the organization]` |

---

## Current Framework Status

- **LOCAL_ONLY**: saves real SOS text on device for manual sharing, without a partner or API destination.
- **TEST / DEMO**: synthetic directory example only, never real emergency dispatch.
- **PUBLIC_CONTACT**: available with verified official emergency contact
  information for the documented countries; not an API integration.
- **AUTHORIZED_API**: framework-only template, disabled unless an
  organization has actually supplied, authorized, configured, and tested its
  API.
- No real government, rescue, or public-safety dispatch integration is
  currently claimed or active.
