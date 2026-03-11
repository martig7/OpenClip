const fs = require('fs');
const path = require('path');
const ini = require('./iniParser');

function readOBSRecordingPath() {
  const appdata = process.env.APPDATA;
  if (!appdata) return null;

  const profilesDir = path.join(appdata, 'obs-studio', 'basic', 'profiles');
  if (!fs.existsSync(profilesDir)) return null;

  const profiles = fs.readdirSync(profilesDir, { withFileTypes: true })
    .filter(f => {
      if (f.isDirectory()) return true;
      if (f.isSymbolicLink()) {
        try {
          return fs.statSync(path.join(profilesDir, f.name)).isDirectory();
        } catch {
          return false;
        }
      }
      return false;
    })
    .map(f => f.name);

  for (const profile of profiles) {
    const configPath = path.join(profilesDir, profile, 'basic.ini');
    if (!fs.existsSync(configPath)) continue;

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = ini.parse(content);

      // Try SimpleOutput first, then AdvOut
      const recPath =
        config.SimpleOutput?.FilePath ||
        config.AdvOut?.RecFilePath ||
        null;

      if (recPath && fs.existsSync(recPath)) return recPath;
    } catch {
      continue;
    }
  }

  // Fallback: common default locations
  const userProfile = process.env.USERPROFILE || '';
  const fallbacks = [
    path.join(userProfile, 'Videos', 'OBS'),
    path.join(userProfile, 'Videos'),
  ];
  for (const p of fallbacks) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

module.exports = { readOBSRecordingPath };
