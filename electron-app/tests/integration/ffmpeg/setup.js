/**
 * Setup for ffmpeg integration tests.
 * Mocks `electron` (so constants.js can call app.getPath / app.isPackaged)
 * but leaves child_process untouched — these tests run real ffmpeg/ffprobe.
 */
import { createRequire } from 'module'

const _req = createRequire(import.meta.url)

const electronPath = _req.resolve('electron')
const electronMock = _req('../../../__mocks__/electron.js')

_req.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: electronMock,
}
