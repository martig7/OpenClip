---
type: concept
tags: [testing, integration, obs-plugin, vitest, http-mock]
updated: 2026-04-08
sources: 0
---

# Plugin Integration Harness

The OBS plugin (`openclip-obs.dll`) exposes a JSON-over-HTTP API on `127.0.0.1` (`POST /api`). Rather than requiring a live OBS process and a compiled DLL to test the transport layer, OpenClip provides an in-process mock HTTP server that mirrors the real plugin's request/response contract.

## Key Points

### Files

| File | Purpose |
|------|---------|
| `tests/integration/plugin/pluginHarness.mjs` | In-process mock HTTP server — same request/response shape as the real DLL |
| `tests/integration/plugin/openclipPlugin.harness.test.js` | Vitest contract tests: transport layer + round-trip track method calls |

The harness runs entirely under Node. No OBS binary and no DLL are needed.

### What the harness tests

- `electron/pluginHttpTransport.js` — the HTTP client that sends requests to the plugin
- `electron/obsPlugin.js` — higher-level wrapper that calls the transport

The tests verify the full round-trip: a call into `obsPlugin.js` produces a correctly shaped HTTP request, and the harness response is correctly decoded and returned.

### Running

```bash
# From electron-app/
npm run test:integration
```

A separate `tests/integration/obs/obsOrchestration.test.js` suite tests OBS WebSocket helpers against a live headless OBS process started by `obsHelper.mjs`. The whole suite skips automatically when OBS is not installed (`describe.skipIf(!isOBSAvailable())`). Tests within the suite that depend on resources that may be absent (e.g. audio inputs, which `_writeOBSConfig` does not seed) guard with Vitest's `ctx.skip()` rather than a hard assertion — see [[obs-audio-tracks-no-inputs]].

### Environment variables (transport layer)

| Variable | Effect |
|----------|--------|
| `OPENCLIP_PLUGIN_HTTP_PORT` | Force the plugin client to use this port (useful for harness or manual debugging) |
| `OPENCLIP_PLUGIN_PORT_FILE` | Read the port from this file path instead of the default runtime path |

These variables let both the harness and manual debugging scenarios override the port without changing code.

### Real DLL testing

To exercise the real DLL: run OBS with the plugin installed and let it write `plugin_port` to the expected file path. The transport will pick up the port automatically. Automated coverage at this level is environment-specific and not part of CI.

## Related

- [[e2e-test-architecture]]
