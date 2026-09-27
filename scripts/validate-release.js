#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function readJson(rootDir, filename) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, filename), 'utf8'));
}

function validateReleaseIdentity(tag, rootDir = path.join(__dirname, '..')) {
  const packageJson = readJson(rootDir, 'package.json');
  const manifestJson = readJson(rootDir, 'manifest.json');
  const versions = readJson(rootDir, 'versions.json');
  const version = packageJson.version;

  if (!tag || tag !== version) throw new Error(`Release tag ${JSON.stringify(tag)} must equal package.json version ${JSON.stringify(version)}.`);
  if (manifestJson.version !== version) throw new Error(`manifest.json version ${JSON.stringify(manifestJson.version)} must equal package.json version ${JSON.stringify(version)}.`);
  if (!Object.prototype.hasOwnProperty.call(versions, version)) throw new Error(`versions.json must contain current version ${version}.`);
  if (versions[version] !== manifestJson.minAppVersion) {
    throw new Error(`versions.json[${version}] (${JSON.stringify(versions[version])}) must equal manifest.json minAppVersion (${JSON.stringify(manifestJson.minAppVersion)}).`);
  }
}

if (require.main === module) {
  try {
    validateReleaseIdentity(process.argv[2], process.argv[3] || path.join(__dirname, '..'));
    process.stdout.write(`Release identity valid for ${process.argv[2]}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { validateReleaseIdentity };
