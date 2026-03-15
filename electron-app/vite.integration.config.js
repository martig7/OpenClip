/**
 * Vitest configuration for integration tests.
 *
 * Integration tests (tests/integration/obs/**) are kept separate from the unit and
 * component tests because they:
 *
 *  - Spawn real external processes (OBS Studio) and therefore need the genuine
 *    `child_process` and `fs` modules — not the vi.fn() stubs that
 *    tests/setup.js injects for unit/component tests.
 *
 *  - Communicate over real network sockets (OBS WebSocket server).
 *
 *  - May take tens of seconds to complete due to OBS startup time.
 *
 * Keeping a separate config ensures that no module mocks bleed into the
 * integration layer and vice-versa.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/obs/**/*.test.{js,ts}'],
    // No setupFiles — integration tests use real modules without any mocking.
    testTimeout: 90_000, // Allow up to 90 s per test (OBS startup + operation)
    hookTimeout: 90_000, // Allow up to 90 s in beforeAll/afterAll hooks
  },
});
