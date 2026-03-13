/**
 * Mock OBS Integration for E2E testing.
 * Returns deterministic paths without requiring real OBS.
 */

function readOBSRecordingPath() {
  return 'C:\\Users\\TestUser\\Videos\\TestRecordings';
}

function getProfiles() {
  return ['TestProfile'];
}

function readEncodingSettings(profileDir) {
  return {
    encoder: 'x264',
    preset: 'veryfast',
    bitrate: 6000,
  };
}

function writeEncodingSettings(profileDir, settings) {}

function isOBSRunning() {
  return false;
}

function findOBSExecutable() {
  return null;
}

module.exports = {
  readOBSRecordingPath,
  getProfiles,
  readEncodingSettings,
  writeEncodingSettings,
  isOBSRunning,
  findOBSExecutable,
};
