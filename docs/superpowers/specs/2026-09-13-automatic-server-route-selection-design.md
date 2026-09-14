# Automatic Server Route Selection

## Goal

Make Discordia open without asking for a server address and work both inside
and outside the host's home network. The loading screen remains visible while
the client retries automatically.

## Routes

The clients probe all supported routes concurrently:

1. `http://192.168.0.56:3002` for devices on the home LAN.
2. `https://discord-caseiro.duckdns.org:3001` for direct public access.
3. `https://discordia.tail291b3e.ts.net` as an emergency fallback.

The first endpoint that returns a valid Discordia health response wins. A
successful URL is saved as the active API origin. There is no server selector,
manual address field, or error button.

## Server Exposure

Caddy continues serving public HTTPS on port 3001 and forwarding to the Node
server on port 3002. Port 3002 is bound on the Umbrel host for LAN access but is
not forwarded by the router, so it is unavailable from the public internet.

## Retry And Recovery

Failed probes are retried after three seconds. Pending requests are aborted as
soon as a route succeeds. If the loaded application loses its server connection
for long enough, the native shell returns to route discovery and can select a
different working route without user configuration.

## Desktop Security

Electron marks the known LAN HTTP origin as secure before Chromium starts so
microphone, camera, and screen capture remain available. Permission checks
accept only the selected route from the fixed allowlist.

## Verification

- Unit-test route priority, valid health responses, failure, and cancellation.
- Run the existing client, server, and Electron smoke tests.
- Verify the LAN endpoint directly from the PC.
- Verify public HTTPS and TURN from an external probe.
- Build and inspect signed Android and Windows packages.
- Publish version 0.2.73 and verify update metadata and public downloads.
