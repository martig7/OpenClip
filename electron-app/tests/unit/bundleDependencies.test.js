import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { builtinModules, createRequire } from 'module';

const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json');

const dependencyNames = new Set(Object.keys(pkg.dependencies || {}));
const devDependencyNames = new Set(Object.keys(pkg.devDependencies || {}));
const builtinSet = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

// Modules provided by Electron runtime itself.
const runtimeProvidedModules = new Set(['electron']);

function isRelativeOrAbsolute(specifier) {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/')
  );
}

function toPackageName(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return `${scope}/${name}`;
  }
  return specifier.split('/')[0];
}

function walkJsFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJsFiles(fullPath));
    } else if (/\.(cjs|mjs|js)$/i.test(entry.name)) {
      out.push(fullPath);
    }
  }

  return out;
}

function collectSpecifiers(source) {
  const specs = new Set();

  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const importFromRe = /import\s+[^'"\n]+\s+from\s+['"]([^'"]+)['"]/g;
  const dynamicImportRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

  let m;
  while ((m = requireRe.exec(source)) !== null) specs.add(m[1]);
  while ((m = importFromRe.exec(source)) !== null) specs.add(m[1]);
  while ((m = dynamicImportRe.exec(source)) !== null) specs.add(m[1]);

  return [...specs];
}

describe('bundle runtime dependencies', () => {
  it('declares all external modules used by electron/** in dependencies', () => {
    const electronDir = path.resolve(process.cwd(), 'electron');
    const files = walkJsFiles(electronDir);

    const missing = [];

    for (const filePath of files) {
      const source = fs.readFileSync(filePath, 'utf8');
      const specs = collectSpecifiers(source);

      for (const spec of specs) {
        if (isRelativeOrAbsolute(spec)) continue;
        if (builtinSet.has(spec)) continue;

        const packageName = toPackageName(spec);
        if (runtimeProvidedModules.has(packageName)) continue;

        if (!dependencyNames.has(packageName)) {
          missing.push({
            packageName,
            file: path.relative(process.cwd(), filePath).replace(/\\/g, '/'),
          });
        }
      }
    }

    const uniqueMissing = Array.from(
      new Map(missing.map((m) => [`${m.packageName}|${m.file}`, m])).values(),
    );

    expect(uniqueMissing, `Missing runtime dependencies: ${JSON.stringify(uniqueMissing, null, 2)}`).toEqual([]);
  });

  it('keeps semver in production dependencies when used by auto-updater', () => {
    expect(dependencyNames.has('semver')).toBe(true);
    expect(devDependencyNames.has('semver')).toBe(false);
  });
});
