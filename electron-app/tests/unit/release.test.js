import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const _req = createRequire(import.meta.url);
const { collectArtifacts, buildGhCommand } = _req('../../scripts/release.js');

// ─── collectArtifacts ────────────────────────────────────────────────────────
describe('collectArtifacts', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-release-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function touch(...names) {
    for (const name of names) fs.writeFileSync(path.join(tmpDir, name), '');
  }

  it('includes the .exe installer', () => {
    touch('Open Clip Setup 1.0.0.exe');
    expect(collectArtifacts(tmpDir)).toContain('Open Clip Setup 1.0.0.exe');
  });

  it('includes the .exe.blockmap file', () => {
    touch('Open Clip Setup 1.0.0.exe.blockmap');
    expect(collectArtifacts(tmpDir)).toContain('Open Clip Setup 1.0.0.exe.blockmap');
  });

  it('includes latest.yml', () => {
    touch('latest.yml');
    expect(collectArtifacts(tmpDir)).toContain('latest.yml');
  });

  it('excludes unrelated files', () => {
    touch('win-unpacked', 'builder-debug.yml', 'builder-effective-config.yaml', 'Open Clip Setup 1.0.0.exe');
    const result = collectArtifacts(tmpDir);
    expect(result).not.toContain('win-unpacked');
    expect(result).not.toContain('builder-debug.yml');
    expect(result).not.toContain('builder-effective-config.yaml');
  });

  it('returns all three expected artifacts when all are present', () => {
    touch(
      'Open Clip Setup 1.2.3.exe',
      'Open Clip Setup 1.2.3.exe.blockmap',
      'latest.yml',
      'builder-debug.yml',
    );
    const result = collectArtifacts(tmpDir);
    expect(result).toHaveLength(3);
    expect(result).toContain('Open Clip Setup 1.2.3.exe');
    expect(result).toContain('Open Clip Setup 1.2.3.exe.blockmap');
    expect(result).toContain('latest.yml');
  });

  it('returns empty array when dist is empty', () => {
    expect(collectArtifacts(tmpDir)).toEqual([]);
  });

  it('does not include .yaml files (only latest.yml)', () => {
    touch('latest.yml', 'latest-mac.yml');
    // latest-mac.yml should not match (it ends in .yml but is not exactly 'latest.yml')
    const result = collectArtifacts(tmpDir);
    expect(result).toContain('latest.yml');
    expect(result).not.toContain('latest-mac.yml');
  });
});

// ─── buildGhCommand ──────────────────────────────────────────────────────────
describe('buildGhCommand', () => {
  const distDir = '/fake/dist';
  const tag = 'v1.2.3';

  it('starts with gh release create and the tag', () => {
    const cmd = buildGhCommand(tag, distDir, ['latest.yml']);
    expect(cmd).toMatch(/^gh release create "v1\.2\.3"/);
  });

  it('appends --title with the tag', () => {
    const cmd = buildGhCommand(tag, distDir, ['latest.yml']);
    expect(cmd).toContain('--title "v1.2.3"');
  });

  it('appends --generate-notes flag', () => {
    const cmd = buildGhCommand(tag, distDir, ['latest.yml']);
    expect(cmd).toContain('--generate-notes');
  });

  it('includes quoted full paths for each artifact', () => {
    const files = ['Open Clip Setup 1.2.3.exe', 'latest.yml'];
    const cmd = buildGhCommand(tag, distDir, files);
    expect(cmd).toContain(`"${path.join(distDir, 'Open Clip Setup 1.2.3.exe')}"`);
    expect(cmd).toContain(`"${path.join(distDir, 'latest.yml')}"`);
  });

  it('quotes all artifacts (handles filenames with spaces)', () => {
    const cmd = buildGhCommand(tag, distDir, ['My App Setup 2.0.0.exe']);
    // Every file argument must be inside double quotes
    expect(cmd).toContain('"');
    const fileSegment = cmd.replace(/^gh release create "[^"]*" /, '').replace(/ --title.*$/, '');
    const args = fileSegment.match(/"[^"]+"/g) ?? [];
    expect(args.length).toBe(1);
    expect(args[0]).toContain('My App Setup 2.0.0.exe');
  });

  it('all three standard artifacts appear in the command', () => {
    const files = [
      'Open Clip Setup 1.0.0.exe',
      'Open Clip Setup 1.0.0.exe.blockmap',
      'latest.yml',
    ];
    const cmd = buildGhCommand(tag, distDir, files);
    for (const f of files) {
      expect(cmd).toContain(f);
    }
  });

  it('handles a tag with a pre-release suffix', () => {
    const cmd = buildGhCommand('v1.0.0-beta.3', distDir, ['latest.yml']);
    expect(cmd).toContain('"v1.0.0-beta.3"');
  });
});
