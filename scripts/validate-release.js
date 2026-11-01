#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

  const gitCommit = (ref) => execFileSync('git', ['rev-parse', '--verify', ref], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  let taggedCommit;
  try {
    taggedCommit = gitCommit(`refs/tags/${tag}^{commit}`);
  } catch {
    throw new Error(`Release tag ${JSON.stringify(tag)} must exist and resolve to a commit.`);
  }
  const head = gitCommit('HEAD');
  if (taggedCommit !== head) {
    throw new Error(`Release tag ${JSON.stringify(tag)} must point to HEAD (${head}), but points to ${taggedCommit}.`);
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
