// Minimal INI parser for OBS config files
function parse(content) {
  const result = {};
  let currentSection = null;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      result[currentSection] = result[currentSection] || {};
      continue;
    }

    const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
    if (kvMatch && currentSection) {
      result[currentSection][kvMatch[1].trim()] = kvMatch[2].trim();
    }
  }

  return result;
}

module.exports = { parse };
