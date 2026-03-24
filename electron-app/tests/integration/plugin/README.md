# OpenClip plugin integration harness

## What this is

The OpenClip **native OBS plugin** exposes a small JSON-over-HTTP API on `127.0.0.1` (`POST /api`). Electron uses `electron/pluginHttpTransport.js` and `electron/obsPlugin.js` to call it.

This folder provides:

| File | Purpose |
|------|--------|
| `pluginHarness.mjs` | In-process **mock** HTTP server (same request/response shape as the DLL). |
| `openclipPlugin.harness.test.js` | Vitest contract tests: transport + round-trip track methods. |

No OBS process and no `openclip-obs.dll` are required for these tests.

## Running

From `electron-app/`:

```bash
npm run test:integration
```

Only the harness tests run under Node; the **obs** integration suite may still require a local OBS install (see `tests/integration/obs/obsHelper.mjs`).

## Environment variables (transport)

| Variable | Effect |
|----------|--------|
| `OPENCLIP_PLUGIN_HTTP_PORT` | Force the plugin client to use this port (harness or manual debugging). |
| `OPENCLIP_PLUGIN_PORT_FILE` | Read the port from this file path instead of the default runtime path. |

## Real plugin / OBS

To exercise the **real** DLL, run OBS with the plugin installed and the plugin writing `plugin_port`. Automated coverage for that is environment-specific; the mock harness is the stable CI contract.
