#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function syncVersion(root = path.join(__dirname, '..')) {
  const packagePath = path.join(root, 'package.json');
  const manifestPath = path.join(root, 'manifest.json');
  const versionsPath = path.join(root, 'versions.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));

  manifestJson.version = packageJson.version;
  versions[packageJson.version] = manifestJson.minAppVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifestJson, null, 2) + '\n');
  fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + '\n');
}

if (require.main === module) {
  syncVersion();
  console.log(`Synced manifest and versions.json to ${JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version}`);
}

module.exports = { syncVersion };
