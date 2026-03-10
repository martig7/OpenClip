/**
 * Mock OBS WebSocket server implementing the OBS WebSocket v5 protocol.
 *
 * Starts a real WebSocket server (using the `ws` package) so the actual
 * obsWebSocket.js client code runs end-to-end without any module mocking.
 *
 * Protocol reference:
 *   https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
 *
 * Supported requests:
 *   GetVersion, GetSceneList, CreateScene, RemoveScene,
 *   GetSceneItemList, DuplicateSceneItem
 */

import { createRequire } from 'module';

// ws is a transitive dependency of obs-websocket-js
const _require = createRequire(import.meta.url);
const { WebSocketServer } = _require('ws');

// OBS WebSocket v5 opcodes
const Op = {
  Hello: 0,
  Identify: 1,
  Identified: 2,
  Request: 6,
  RequestResponse: 7,
};

const OBS_WS_VERSION = '5.1.0';
const RPC_VERSION = 1;
const WS_PROTOCOL = 'obswebsocket.json';

/**
 * Create and start a mock OBS WebSocket server.
 *
 * @param {object} [options]
 * @param {number}  [options.port=0]       - Port to listen on. 0 picks a random free port.
 * @param {string}  [options.password]     - Optional password. If set, clients must authenticate.
 * @param {string[]} [options.initialScenes] - Initial scene names (default: ['Scene']).
 * @returns {Promise<MockObsServer>}
 */
export async function createMockObsServer(options = {}) {
  const { port = 0, password = null, initialScenes = ['Scene'] } = options;

  // In-memory scene store.  Each scene: { name: string, items: SceneItem[] }
  // SceneItem: { sceneItemId: number, sourceName: string, sceneItemEnabled: boolean }
  let nextItemId = 1;
  const scenes = initialScenes.map(name => ({ name, items: [] }));

  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws, req) => {
    // Reject connections that don't request the correct subprotocol
    const requestedProtocols = (req.headers['sec-websocket-protocol'] || '')
      .split(',')
      .map(p => p.trim());

    if (!requestedProtocols.includes(WS_PROTOCOL)) {
      ws.close(1002, 'Invalid subprotocol');
      return;
    }

    // Send Hello
    send(ws, Op.Hello, {
      obsWebSocketVersion: OBS_WS_VERSION,
      rpcVersion: RPC_VERSION,
      // No authentication challenge when password is null
      authentication: password ? buildAuthChallenge() : undefined,
    });

    ws.on('message', rawMsg => {
      let msg;
      try {
        msg = JSON.parse(rawMsg.toString());
      } catch {
        return;
      }

      const { op, d } = msg;

      if (op === Op.Identify) {
        // Basic auth check: if we set a password we expect the client to send an
        // authentication field.  For integration testing we simply check presence.
        if (password && !d.authentication) {
          ws.close(4009, 'Not authenticated');
          return;
        }
        send(ws, Op.Identified, { negotiatedRpcVersion: RPC_VERSION });
        return;
      }

      if (op === Op.Request) {
        handleRequest(ws, d, scenes, () => nextItemId++);
      }
    });
  });

  // Wait for the server to start listening
  await new Promise((resolve, reject) => {
    wss.on('listening', resolve);
    wss.on('error', reject);
  });

  const actualPort = wss.address().port;

  return {
    /** Port the server is listening on. */
    port: actualPort,

    /** WebSocket settings object suitable for passing to obsWebSocket.js helpers. */
    wsSettings: { host: '127.0.0.1', port: actualPort, password: password || undefined },

    /** Direct access to the in-memory scenes list for assertions. */
    get scenes() {
      return scenes;
    },

    /**
     * Add a scene item to an existing scene (for test setup).
     * @param {string} sceneName
     * @param {string} sourceName
     */
    addSceneItem(sceneName, sourceName) {
      const scene = scenes.find(s => s.name === sceneName);
      if (!scene) throw new Error(`Scene "${sceneName}" not found`);
      scene.items.push({
        sceneItemId: nextItemId++,
        sourceName,
        sceneItemEnabled: true,
      });
    },

    /** Stop the server. */
    close() {
      return new Promise((resolve, reject) => {
        wss.close(err => (err ? reject(err) : resolve()));
      });
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function send(ws, op, d) {
  ws.send(JSON.stringify({ op, d }));
}

function ok(ws, requestId, responseData = {}) {
  send(ws, Op.RequestResponse, {
    requestId,
    requestStatus: { result: true, code: 100 },
    responseData,
  });
}

function fail(ws, requestId, code, comment) {
  send(ws, Op.RequestResponse, {
    requestId,
    requestStatus: { result: false, code, comment },
    responseData: {},
  });
}

function buildAuthChallenge() {
  // Minimal authentication challenge — real auth hashing is tested elsewhere.
  // The client only needs these fields to attempt authentication.
  return { salt: 'test-salt', challenge: 'test-challenge' };
}

function handleRequest(ws, { requestId, requestType, requestData = {} }, scenes, nextId) {
  switch (requestType) {
    case 'GetVersion':
      ok(ws, requestId, {
        obsVersion: '30.0.0',
        obsWebSocketVersion: OBS_WS_VERSION,
        rpcVersion: RPC_VERSION,
        availableRequests: [],
        supportedImageFormats: [],
        platform: 'linux',
        platformDescription: 'Test',
      });
      break;

    case 'GetSceneList': {
      ok(ws, requestId, {
        currentProgramSceneName: scenes[0]?.name ?? '',
        currentPreviewSceneName: scenes[0]?.name ?? '',
        scenes: scenes.map((s, i) => ({ sceneIndex: i, sceneName: s.name })),
      });
      break;
    }

    case 'CreateScene': {
      const { sceneName } = requestData;
      if (!sceneName) {
        fail(ws, requestId, 600, 'sceneName is required');
        break;
      }
      if (scenes.some(s => s.name === sceneName)) {
        fail(ws, requestId, 601, `Scene "${sceneName}" already exists`);
        break;
      }
      scenes.push({ name: sceneName, items: [] });
      ok(ws, requestId);
      break;
    }

    case 'RemoveScene': {
      const { sceneName } = requestData;
      const idx = scenes.findIndex(s => s.name === sceneName);
      if (idx === -1) {
        fail(ws, requestId, 604, `Scene "${sceneName}" not found`);
        break;
      }
      scenes.splice(idx, 1);
      ok(ws, requestId);
      break;
    }

    case 'GetSceneItemList': {
      const { sceneName } = requestData;
      const scene = scenes.find(s => s.name === sceneName);
      if (!scene) {
        fail(ws, requestId, 604, `Scene "${sceneName}" not found`);
        break;
      }
      ok(ws, requestId, { sceneItems: scene.items });
      break;
    }

    case 'DuplicateSceneItem': {
      const { sceneName, sceneItemId, destinationSceneName } = requestData;
      const src = scenes.find(s => s.name === sceneName);
      if (!src) {
        fail(ws, requestId, 604, `Source scene "${sceneName}" not found`);
        break;
      }
      const item = src.items.find(i => i.sceneItemId === sceneItemId);
      if (!item) {
        fail(ws, requestId, 604, `Scene item ${sceneItemId} not found`);
        break;
      }
      const dest = scenes.find(s => s.name === destinationSceneName);
      if (!dest) {
        fail(ws, requestId, 604, `Destination scene "${destinationSceneName}" not found`);
        break;
      }
      const newId = nextId();
      dest.items.push({ ...item, sceneItemId: newId });
      ok(ws, requestId, { sceneItemId: newId });
      break;
    }

    default:
      fail(ws, requestId, 204, `Unknown request type: ${requestType}`);
  }
}
