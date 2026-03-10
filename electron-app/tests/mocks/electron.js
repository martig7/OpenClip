// @vitest-environment node
// Mock for the 'electron' module in tests.
// Used via vite.config.js test.alias so both ESM import and CJS require are intercepted.
// This file re-exports the canonical mock from __mocks__/electron.js to avoid duplication.
module.exports = require('../../__mocks__/electron.js')
