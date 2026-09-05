var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/utils/copilotCli.ts
function isExistingFile(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
}
function platformPath() {
  return process.platform === "win32" ? path.win32 : path.posix;
}
function getEnvValue(key) {
  const exact = process.env[key];
  if (exact !== void 0) return exact;
  const lower = key.toLowerCase();
  for (const k of Object.keys(process.env)) {
    if (k.toLowerCase() === lower) return process.env[k];
  }
  return void 0;
}
function stripSurroundingQuotes(value) {
  if (value.length >= 2 && (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
function isPathPlaceholder(value) {
  return /^\$\{?PATH\}?$|^%PATH%$/i.test(value);
}
function expandHomePath(p) {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return platformPath().join(os.homedir(), p.slice(2));
  }
  return p;
}
function parsePathEntries(pathValue) {
  if (!pathValue) return [];
  const delimiter = process.platform === "win32" ? ";" : ":";
  return pathValue.split(delimiter).map((e) => expandHomePath(stripSurroundingQuotes(e.trim()))).filter((e) => e.length > 0 && !isPathPlaceholder(e));
}
function dedupePaths(entries) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const e of entries) {
    const key = process.platform === "win32" ? e.toLowerCase() : e;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(e);
    }
  }
  return result;
}
function getNpmGlobalPrefix() {
  const prefix = getEnvValue("npm_config_prefix");
  if (prefix && prefix !== "undefined") return prefix;
  if (process.platform === "win32") {
    const appData = getEnvValue("APPDATA");
    if (appData) return path.win32.join(appData, "npm");
  }
  return null;
}
function nvmCandidateDirs(home) {
  const pp = platformPath();
  const dirs = [];
  const nvmDir = pp.join(home, ".nvm");
  try {
    const raw = fs.readFileSync(pp.join(nvmDir, "alias", "default"), "utf8").trim();
    const version = raw.startsWith("v") ? raw : /^\d/.test(raw) ? `v${raw}` : null;
    if (version) {
      dirs.push(pp.join(nvmDir, "versions", "node", version, "bin"));
    }
  } catch (e) {
  }
  try {
    const nvmNodeDir = pp.join(nvmDir, "versions", "node");
    if (fs.existsSync(nvmNodeDir)) {
      const versions = fs.readdirSync(nvmNodeDir).filter((v) => v.startsWith("v")).sort((a, b) => {
        var _a, _b;
        const pa = a.slice(1).split(".").map(Number);
        const pb = b.slice(1).split(".").map(Number);
        for (let i = 0; i < 3; i++) {
          const diff = ((_a = pb[i]) != null ? _a : 0) - ((_b = pa[i]) != null ? _b : 0);
          if (diff !== 0) return diff;
        }
        return 0;
      });
      for (const v of versions.slice(0, 3)) {
        dirs.push(pp.join(nvmNodeDir, v, "bin"));
      }
    }
  } catch (e) {
  }
  return dirs;
}
function fnmCandidateDirs(home) {
  const pp = platformPath();
  const dirs = [];
  const multishell = process.env.FNM_MULTISHELL_PATH;
  if (multishell) dirs.push(multishell);
  const fnmDataDirs = [
    process.env.FNM_DIR,
    pp.join(home, ".local", "share", "fnm"),
    pp.join(home, ".fnm")
  ].filter(Boolean);
  for (const fnmDir of fnmDataDirs) {
    const nodeVersionsDir = pp.join(fnmDir, "node-versions");
    try {
      if (fs.existsSync(nodeVersionsDir)) {
        const versions = fs.readdirSync(nodeVersionsDir).sort((a, b) => {
          var _a, _b;
          const pa = a.replace(/^v/, "").split(".").map(Number);
          const pb = b.replace(/^v/, "").split(".").map(Number);
          for (let i = 0; i < 3; i++) {
            const diff = ((_a = pb[i]) != null ? _a : 0) - ((_b = pa[i]) != null ? _b : 0);
            if (diff !== 0) return diff;
          }
          return 0;
        });
        for (const v of versions.slice(0, 3)) {
          dirs.push(pp.join(nodeVersionsDir, v, "installation", "bin"));
        }
      }
    } catch (e) {
    }
  }
  return dirs;
}
function findCopilotCLIPath() {
  var _a, _b, _c, _d, _e;
  const pp = platformPath();
  const home = os.homedir();
  const isWindows4 = process.platform === "win32";
  const binaryNames = isWindows4 ? ["copilot.cmd", "copilot.exe"] : ["copilot"];
  const appData = (_a = getEnvValue("APPDATA")) != null ? _a : pp.join(home, "AppData", "Roaming");
  const localAppData = (_b = getEnvValue("LOCALAPPDATA")) != null ? _b : pp.join(home, "AppData", "Local");
  const candidateDirs = isWindows4 ? [
    // npm global bin — primary location after `npm install -g`
    pp.join(appData, "npm"),
    // nvm-windows: NVM_SYMLINK is a system env var pointing to active Node dir
    (_c = getEnvValue("NVM_SYMLINK")) != null ? _c : "",
    // nvm-windows: NVM_HOME stores all versions; active is via NVM_SYMLINK
    (_d = getEnvValue("NVM_HOME")) != null ? _d : "",
    // LocalAppData nodejs locations (some installers / nvm-windows symlinks)
    pp.join(localAppData, "Programs", "nodejs"),
    pp.join(localAppData, "Programs", "node"),
    // scoop shims
    pp.join(home, "scoop", "shims"),
    pp.join((_e = getEnvValue("ProgramFiles")) != null ? _e : "C:\\Program Files", "nodejs"),
    pp.join(home, ".volta", "bin"),
    pp.join(home, ".local", "bin")
  ].filter(Boolean) : [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    pp.join(home, ".local", "bin"),
    pp.join(home, ".volta", "bin"),
    pp.join(home, ".asdf", "shims"),
    pp.join(home, ".asdf", "bin"),
    pp.join(home, ".npm-global", "bin"),
    pp.join(home, "bin"),
    ...nvmCandidateDirs(home),
    ...fnmCandidateDirs(home)
  ];
  for (const dir of candidateDirs) {
    for (const name of binaryNames) {
      const p = pp.join(dir, name);
      if (isExistingFile(p)) return p;
    }
  }
  const npmPrefix = getNpmGlobalPrefix();
  if (npmPrefix) {
    const binDir = isWindows4 ? npmPrefix : pp.join(npmPrefix, "bin");
    for (const name of binaryNames) {
      const p = pp.join(binDir, name);
      if (isExistingFile(p)) return p;
    }
  }
  for (const dir of dedupePaths(parsePathEntries(getEnvValue("PATH")))) {
    for (const name of binaryNames) {
      const p = pp.join(dir, name);
      if (isExistingFile(p)) return p;
    }
  }
  return null;
}
function resolveCmdShim(cmdPath) {
  if (process.platform !== "win32") return null;
  if (!cmdPath.toLowerCase().endsWith(".cmd")) return null;
  try {
    const pp = platformPath();
    const content = fs.readFileSync(cmdPath, "utf8");
    const cmdDir = pp.dirname(cmdPath);
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/"([^"]+\.js)"\s+%\*/i);
      if (!m) continue;
      let scriptPath = m[1];
      scriptPath = scriptPath.replace(/%dp0%\\/gi, cmdDir + pp.sep);
      if (!isExistingFile(scriptPath)) continue;
      const localNode = pp.join(cmdDir, "node.exe");
      const nodeExe = isExistingFile(localNode) ? localNode : "node";
      return [nodeExe, scriptPath];
    }
  } catch (e) {
  }
  return null;
}
var fs, os, path;
var init_copilotCli = __esm({
  "src/utils/copilotCli.ts"() {
    fs = __toESM(require("fs"));
    os = __toESM(require("os"));
    path = __toESM(require("path"));
  }
});

// src/utils/path.ts
function getVaultPath(app) {
  const adapter = app.vault.adapter;
  if ("basePath" in adapter) {
    return adapter.basePath;
  }
  return null;
}
function getEnvValue2(key) {
  const hasKey = (name) => Object.prototype.hasOwnProperty.call(process.env, name);
  if (hasKey(key)) {
    return process.env[key];
  }
  if (process.platform !== "win32") {
    return void 0;
  }
  const upper = key.toUpperCase();
  if (hasKey(upper)) {
    return process.env[upper];
  }
  const lower = key.toLowerCase();
  if (hasKey(lower)) {
    return process.env[lower];
  }
  const matchKey = Object.keys(process.env).find((name) => name.toLowerCase() === key.toLowerCase());
  return matchKey ? process.env[matchKey] : void 0;
}
function expandEnvironmentVariables(value) {
  if (!value.includes("%") && !value.includes("$") && !value.includes("!")) {
    return value;
  }
  const isWindows4 = process.platform === "win32";
  let expanded = value;
  expanded = expanded.replace(/%([A-Za-z_][A-Za-z0-9_]*(?:\([A-Za-z0-9_]+\))?[A-Za-z0-9_]*)%/g, (match, name) => {
    const envValue = getEnvValue2(name);
    return envValue !== void 0 ? envValue : match;
  });
  if (isWindows4) {
    expanded = expanded.replace(/!([A-Za-z_][A-Za-z0-9_]*)!/g, (match, name) => {
      const envValue = getEnvValue2(name);
      return envValue !== void 0 ? envValue : match;
    });
    expanded = expanded.replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (match, name) => {
      const envValue = getEnvValue2(name);
      return envValue !== void 0 ? envValue : match;
    });
  }
  expanded = expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name1, name2) => {
    const key = name1 != null ? name1 : name2;
    if (!key) return match;
    const envValue = getEnvValue2(key);
    return envValue !== void 0 ? envValue : match;
  });
  return expanded;
}
function expandHomePath2(p) {
  const expanded = expandEnvironmentVariables(p);
  if (expanded === "~") {
    return os2.homedir();
  }
  if (expanded.startsWith("~/")) {
    return path2.join(os2.homedir(), expanded.slice(2));
  }
  if (expanded.startsWith("~\\")) {
    return path2.join(os2.homedir(), expanded.slice(2));
  }
  return expanded;
}
function stripSurroundingQuotes2(value) {
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}
function isPathPlaceholder2(value) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed === "$PATH" || trimmed === "${PATH}") return true;
  return trimmed.toUpperCase() === "%PATH%";
}
function parsePathEntries2(pathValue) {
  if (!pathValue) {
    return [];
  }
  const delimiter = process.platform === "win32" ? ";" : ":";
  return pathValue.split(delimiter).map((segment) => stripSurroundingQuotes2(segment.trim())).filter((segment) => segment.length > 0 && !isPathPlaceholder2(segment)).map((segment) => translateMsysPath(expandHomePath2(segment)));
}
function resolveRealPath(p) {
  var _a;
  const realpathFn = (_a = fs2.realpathSync.native) != null ? _a : fs2.realpathSync;
  try {
    return realpathFn(p);
  } catch (e) {
    const absolute = path2.resolve(p);
    let current = absolute;
    const suffix = [];
    while (true) {
      try {
        if (fs2.existsSync(current)) {
          const resolvedExisting = realpathFn(current);
          return suffix.length > 0 ? path2.join(resolvedExisting, ...suffix.reverse()) : resolvedExisting;
        }
      } catch (e2) {
      }
      const parent = path2.dirname(current);
      if (parent === current) {
        return absolute;
      }
      suffix.push(path2.basename(current));
      current = parent;
    }
  }
}
function translateMsysPath(value) {
  var _a;
  if (process.platform !== "win32") {
    return value;
  }
  const msysMatch = value.match(/^\/([a-zA-Z])(\/.*)?$/);
  if (msysMatch) {
    const driveLetter = msysMatch[1].toUpperCase();
    const restOfPath = (_a = msysMatch[2]) != null ? _a : "";
    return `${driveLetter}:${restOfPath.replace(/\//g, "\\")}`;
  }
  return value;
}
function normalizePathBeforeResolution(p) {
  const expanded = expandHomePath2(p);
  return translateMsysPath(expanded);
}
function normalizeWindowsPathPrefix(value) {
  if (process.platform !== "win32") {
    return value;
  }
  const normalized = translateMsysPath(value);
  if (normalized.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${normalized.slice("\\\\?\\UNC\\".length)}`;
  }
  if (normalized.startsWith("\\\\?\\")) {
    return normalized.slice("\\\\?\\".length);
  }
  return normalized;
}
function normalizePathForFilesystem(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  const expanded = normalizePathBeforeResolution(value);
  let normalized = expanded;
  try {
    normalized = process.platform === "win32" ? path2.win32.normalize(expanded) : path2.normalize(expanded);
  } catch (e) {
    normalized = expanded;
  }
  return normalizeWindowsPathPrefix(normalized);
}
function normalizePathForComparison(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  const expanded = normalizePathBeforeResolution(value);
  let normalized = expanded;
  try {
    normalized = process.platform === "win32" ? path2.win32.normalize(expanded) : path2.normalize(expanded);
  } catch (e) {
    normalized = expanded;
  }
  normalized = normalizeWindowsPathPrefix(normalized);
  normalized = normalized.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function isPathWithinVault(candidatePath, vaultPath) {
  const vaultReal = normalizePathForComparison(resolveRealPath(vaultPath));
  const normalizedPath = normalizePathBeforeResolution(candidatePath);
  const absCandidate = path2.isAbsolute(normalizedPath) ? normalizedPath : path2.resolve(vaultPath, normalizedPath);
  const resolvedCandidate = normalizePathForComparison(resolveRealPath(absCandidate));
  return resolvedCandidate === vaultReal || resolvedCandidate.startsWith(vaultReal + "/");
}
var fs2, os2, path2;
var init_path = __esm({
  "src/utils/path.ts"() {
    fs2 = __toESM(require("fs"));
    os2 = __toESM(require("os"));
    path2 = __toESM(require("path"));
  }
});

// src/utils/env.ts
function getHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || "";
}
function getExtraBinaryPaths() {
  const home = getHomeDir();
  if (isWindows) {
    const paths = [];
    const localAppData = process.env.LOCALAPPDATA;
    const appData = process.env.APPDATA;
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const programData = process.env.ProgramData || "C:\\ProgramData";
    if (appData) {
      paths.push(path3.join(appData, "npm"));
    }
    if (localAppData) {
      paths.push(path3.join(localAppData, "Programs", "nodejs"));
      paths.push(path3.join(localAppData, "Programs", "node"));
    }
    paths.push(path3.join(programFiles, "nodejs"));
    paths.push(path3.join(programFilesX86, "nodejs"));
    const nvmSymlink = process.env.NVM_SYMLINK;
    if (nvmSymlink) {
      paths.push(nvmSymlink);
    }
    const nvmHome = process.env.NVM_HOME;
    if (nvmHome) {
      paths.push(nvmHome);
    } else if (appData) {
      paths.push(path3.join(appData, "nvm"));
    }
    const voltaHome = process.env.VOLTA_HOME;
    if (voltaHome) {
      paths.push(path3.join(voltaHome, "bin"));
    } else if (home) {
      paths.push(path3.join(home, ".volta", "bin"));
    }
    const fnmMultishell = process.env.FNM_MULTISHELL_PATH;
    if (fnmMultishell) {
      paths.push(fnmMultishell);
    }
    const fnmDir = process.env.FNM_DIR;
    if (fnmDir) {
      paths.push(fnmDir);
    } else if (localAppData) {
      paths.push(path3.join(localAppData, "fnm"));
    }
    const chocolateyInstall = process.env.ChocolateyInstall;
    if (chocolateyInstall) {
      paths.push(path3.join(chocolateyInstall, "bin"));
    } else {
      paths.push(path3.join(programData, "chocolatey", "bin"));
    }
    const scoopDir = process.env.SCOOP;
    if (scoopDir) {
      paths.push(path3.join(scoopDir, "shims"));
      paths.push(path3.join(scoopDir, "apps", "nodejs", "current", "bin"));
      paths.push(path3.join(scoopDir, "apps", "nodejs", "current"));
    } else if (home) {
      paths.push(path3.join(home, "scoop", "shims"));
      paths.push(path3.join(home, "scoop", "apps", "nodejs", "current", "bin"));
      paths.push(path3.join(home, "scoop", "apps", "nodejs", "current"));
    }
    paths.push(path3.join(programFiles, "Docker", "Docker", "resources", "bin"));
    if (home) {
      paths.push(path3.join(home, ".local", "bin"));
    }
    return paths;
  } else {
    const paths = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      // macOS ARM Homebrew
      "/usr/bin",
      "/bin"
    ];
    const voltaHome = process.env.VOLTA_HOME;
    if (voltaHome) {
      paths.push(path3.join(voltaHome, "bin"));
    }
    const asdfRoot = process.env.ASDF_DATA_DIR || process.env.ASDF_DIR;
    if (asdfRoot) {
      paths.push(path3.join(asdfRoot, "shims"));
      paths.push(path3.join(asdfRoot, "bin"));
    }
    const fnmMultishell = process.env.FNM_MULTISHELL_PATH;
    if (fnmMultishell) {
      paths.push(fnmMultishell);
    }
    const fnmDir = process.env.FNM_DIR;
    if (fnmDir) {
      paths.push(fnmDir);
    }
    if (home) {
      paths.push(path3.join(home, ".local", "bin"));
      paths.push(path3.join(home, ".docker", "bin"));
      paths.push(path3.join(home, ".volta", "bin"));
      paths.push(path3.join(home, ".asdf", "shims"));
      paths.push(path3.join(home, ".asdf", "bin"));
      paths.push(path3.join(home, ".fnm"));
      const nvmBin = process.env.NVM_BIN;
      if (nvmBin) {
        paths.push(nvmBin);
      }
    }
    return paths;
  }
}
function findNodeDirectory() {
  const searchPaths = getExtraBinaryPaths();
  const currentPath = process.env.PATH || "";
  const pathDirs = parsePathEntries2(currentPath);
  const allPaths = [...searchPaths, ...pathDirs];
  for (const dir of allPaths) {
    if (!dir) continue;
    try {
      const nodePath = path3.join(dir, NODE_EXECUTABLE);
      if (fs3.existsSync(nodePath)) {
        const stat = fs3.statSync(nodePath);
        if (stat.isFile()) {
          return dir;
        }
      }
    } catch (e) {
    }
  }
  return null;
}
function cliPathRequiresNode(cliPath) {
  const jsExtensions = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"];
  const lower = cliPath.toLowerCase();
  if (jsExtensions.some((ext) => lower.endsWith(ext))) {
    return true;
  }
  try {
    if (!fs3.existsSync(cliPath)) {
      return false;
    }
    const stat = fs3.statSync(cliPath);
    if (!stat.isFile()) {
      return false;
    }
    let fd = null;
    try {
      fd = fs3.openSync(cliPath, "r");
      const buffer = Buffer.alloc(200);
      const bytesRead = fs3.readSync(fd, buffer, 0, buffer.length, 0);
      const header = buffer.slice(0, bytesRead).toString("utf8");
      return header.startsWith("#!") && header.toLowerCase().includes("node");
    } finally {
      if (fd !== null) {
        try {
          fs3.closeSync(fd);
        } catch (e) {
        }
      }
    }
  } catch (e) {
    return false;
  }
}
function getEnhancedPath(additionalPaths, cliPath) {
  const extraPaths = getExtraBinaryPaths().filter((p) => p);
  const currentPath = process.env.PATH || "";
  const segments = [];
  if (additionalPaths) {
    segments.push(...parsePathEntries2(additionalPaths));
  }
  let cliDirHasNode = false;
  if (cliPath) {
    try {
      const cliDir = path3.dirname(cliPath);
      const nodeInCliDir = path3.join(cliDir, NODE_EXECUTABLE);
      if (fs3.existsSync(nodeInCliDir)) {
        const stat = fs3.statSync(nodeInCliDir);
        if (stat.isFile()) {
          segments.push(cliDir);
          cliDirHasNode = true;
        }
      }
    } catch (e) {
    }
  }
  if (cliPath && cliPathRequiresNode(cliPath) && !cliDirHasNode) {
    const nodeDir = findNodeDirectory();
    if (nodeDir) {
      segments.push(nodeDir);
    }
  }
  segments.push(...extraPaths);
  if (currentPath) {
    segments.push(...parsePathEntries2(currentPath));
  }
  const seen = /* @__PURE__ */ new Set();
  const unique = segments.filter((p) => {
    const normalized = isWindows ? p.toLowerCase() : p;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  return unique.join(PATH_SEPARATOR);
}
function parseEnvironmentVariables(input) {
  const result = {};
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      let value = trimmed.substring(eqIndex + 1).trim();
      if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      if (key) {
        const tokenKeys = /* @__PURE__ */ new Set(["GITHUB_TOKEN", "GH_TOKEN", "COPILOT_GITHUB_TOKEN"]);
        const normalizedPlaceholder = value.toLowerCase();
        if (tokenKeys.has(key) && (normalizedPlaceholder === "your_api_key_here" || normalizedPlaceholder === "your-key" || normalizedPlaceholder.includes("your_api_key") || normalizedPlaceholder.includes("your_github_token") || normalizedPlaceholder.includes("your_copilot_token"))) {
          continue;
        }
        result[key] = value;
      }
    }
  }
  return result;
}
var fs3, path3, isWindows, PATH_SEPARATOR, NODE_EXECUTABLE;
var init_env = __esm({
  "src/utils/env.ts"() {
    fs3 = __toESM(require("fs"));
    path3 = __toESM(require("path"));
    init_path();
    isWindows = process.platform === "win32";
    PATH_SEPARATOR = isWindows ? ";" : ":";
    NODE_EXECUTABLE = isWindows ? "node.exe" : "node";
  }
});

// src/core/providers/providerRegistry.ts
function allowsEffortWithModel(id) {
  var _a;
  return (_a = EFFORT_COMBINES_WITH_MODEL[id]) != null ? _a : false;
}
function getProviderEffortLevels(id) {
  var _a;
  return (_a = PROVIDER_EFFORT_LEVELS[id]) != null ? _a : [];
}
function supportsEffortSelection(id) {
  return getProviderEffortLevels(id).length > 0;
}
function defaultModelSource(id) {
  if (id === "copilot") return "copilot-catalog";
  return getStaticProviderModels(id).length > 0 ? "bundled" : "ask-cli";
}
function storeDefaultModel(settings, id, value) {
  if (id === "copilot") {
    settings.model = value;
    return;
  }
  const models = { ...settings.providerModels };
  if (value.trim()) models[id] = value.trim();
  else delete models[id];
  settings.providerModels = models;
}
function getStaticProviderModels(id) {
  var _a;
  return (_a = STATIC_PROVIDER_MODELS[id]) != null ? _a : [];
}
function parseAgyModels(stdout) {
  var _a;
  const seen = /* @__PURE__ */ new Set();
  const options = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes("	")) continue;
    const [rawId, ...rest] = line.split("	");
    const id = (_a = rawId == null ? void 0 : rawId.trim()) != null ? _a : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, label: rest.join(" ").trim() || id, efforts: [] });
  }
  return options;
}
function parseCodexModels(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    return [];
  }
  const models = parsed == null ? void 0 : parsed.models;
  if (!Array.isArray(models)) return [];
  const allowed = new Set(PROVIDER_EFFORT_LEVELS.codex);
  const options = [];
  for (const entry of models) {
    const model = entry;
    const id = typeof model.slug === "string" ? model.slug.trim() : "";
    if (!id || model.visibility === "hide") continue;
    const efforts = (Array.isArray(model.supported_reasoning_levels) ? model.supported_reasoning_levels : []).map((level) => level == null ? void 0 : level.effort).filter((effort) => typeof effort === "string" && allowed.has(effort));
    options.push({
      id,
      label: typeof model.display_name === "string" && model.display_name.trim() ? model.display_name.trim() : id,
      efforts
    });
  }
  return options;
}
function migrateProviderModels(providerModels) {
  var _a;
  if (!providerModels) return;
  for (const [id, retired] of Object.entries(RETIRED_PROVIDER_MODELS)) {
    const current = (_a = providerModels[id]) == null ? void 0 : _a.trim();
    if (current && retired.includes(current)) delete providerModels[id];
  }
}
function getProviderDescriptor(id) {
  var _a;
  return (_a = PROVIDERS.find((provider) => provider.id === id)) != null ? _a : PROVIDERS[0];
}
function resolveNativeSelection(settings, requestedModel) {
  var _a, _b, _c, _d;
  const provider = settings.selectedProvider;
  return {
    provider,
    model: (requestedModel == null ? void 0 : requestedModel.trim()) || ((_b = (_a = settings.providerModels) == null ? void 0 : _a[provider]) == null ? void 0 : _b.trim()) || "",
    effort: ((_d = (_c = settings.providerEfforts) == null ? void 0 : _c[provider]) == null ? void 0 : _d.trim()) || ""
  };
}
function supportsReadOnlyMode(id) {
  return id !== "codex";
}
function writesWithoutAsking(id) {
  return id === "agy";
}
function buildNativeProviderCommand(id, prompt, model = "", effort = "", permissionMode = "agent") {
  const selectedModel = model.trim();
  let selectedEffort = getProviderEffortLevels(id).includes(effort.trim()) ? effort.trim() : "";
  if (selectedModel && selectedEffort && !allowsEffortWithModel(id)) selectedEffort = "";
  const modelArgs = selectedModel ? ["--model", selectedModel] : [];
  const readOnly = permissionMode === "ask";
  switch (id) {
    // A positive `--allowedTools` list did NOT stop claude writing; only the
    // disallow list did. The three names go in ONE comma-separated argument: the
    // flag is variadic, so `--disallowedTools Write Edit Bash <prompt>` eats the
    // prompt and the run dies with "Input must be provided ... as a prompt argument".
    case "claude":
      return { command: "claude", args: ["-p", ...modelArgs, ...selectedEffort ? ["--effort", selectedEffort] : [], ...readOnly ? ["--disallowedTools", "Write,Edit,Bash"] : [], prompt, "--output-format", "stream-json", "--verbose"] };
    // codex exec has no effort flag; the reasoning level is a config override instead.
    // `--skip-git-repo-check` is unconditional: codex refuses to start outside a Git
    // repository, and a student's vault usually is not one.
    case "codex":
      return { command: "codex", args: ["exec", "--skip-git-repo-check", ...modelArgs, ...selectedEffort ? ["-c", `model_reasoning_effort="${selectedEffort}"`] : [], "--json", prompt] };
    // agy cannot use a writing tool headless — it has no way to ask permission — so
    // read-only is its default and this flag is the only thing that lifts it.
    case "agy":
      return { command: "agy", args: [...readOnly ? [] : ["--dangerously-skip-permissions"], ...modelArgs, ...selectedEffort ? ["--effort", selectedEffort] : [], "-p", prompt] };
    case "copilot":
      return { command: "copilot", args: ["-p", prompt] };
  }
}
function findProviderCliPath(id, customPath = "") {
  const configured = customPath.trim();
  if (configured) {
    const resolved = expandHomePath2(configured);
    return isFile(resolved) ? resolved : null;
  }
  const descriptor = getProviderDescriptor(id);
  const delimiter = process.platform === "win32" ? ";" : ":";
  const names = process.platform === "win32" ? [`${descriptor.command}.exe`, `${descriptor.command}.cmd`, descriptor.command] : [descriptor.command];
  for (const dir of getEnhancedPath().split(delimiter)) {
    for (const name of names) {
      const candidate = path4.join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}
function isFile(candidate) {
  try {
    return fs4.statSync(candidate).isFile();
  } catch (e) {
    return false;
  }
}
var fs4, path4, PROVIDERS, PROVIDER_EFFORT_LEVELS, STATIC_PROVIDER_MODELS, EFFORT_COMBINES_WITH_MODEL, RETIRED_PROVIDER_MODELS;
var init_providerRegistry = __esm({
  "src/core/providers/providerRegistry.ts"() {
    fs4 = __toESM(require("fs"));
    path4 = __toESM(require("path"));
    init_env();
    init_path();
    PROVIDERS = [
      { id: "copilot", label: "GitHub Copilot", command: "copilot", loginCommand: "copilot login", installCommand: "npm install -g @github/copilot", windowsInstallCommand: "npm install -g @github/copilot", status: "ready" },
      { id: "claude", label: "Claude Code", command: "claude", loginCommand: "claude", installCommand: "npm install -g @anthropic-ai/claude-code", windowsInstallCommand: "npm install -g @anthropic-ai/claude-code", status: "ready" },
      { id: "codex", label: "OpenAI Codex", command: "codex", loginCommand: "codex login", installCommand: "npm install -g @openai/codex", windowsInstallCommand: "npm install -g @openai/codex", status: "ready" },
      { id: "agy", label: "Antigravity (agy)", command: "agy", loginCommand: "agy", status: "manual-setup" }
    ];
    PROVIDER_EFFORT_LEVELS = {
      copilot: [],
      claude: ["low", "medium", "high", "xhigh", "max"],
      codex: ["low", "medium", "high", "xhigh", "max"],
      agy: ["low", "medium", "high"]
    };
    STATIC_PROVIDER_MODELS = {
      copilot: [],
      claude: ["fable", "opus", "sonnet", "haiku"].map((id) => ({
        id,
        label: id,
        efforts: PROVIDER_EFFORT_LEVELS.claude
      })),
      codex: [],
      agy: []
    };
    EFFORT_COMBINES_WITH_MODEL = {
      copilot: false,
      claude: true,
      codex: true,
      agy: false
    };
    RETIRED_PROVIDER_MODELS = {
      codex: ["o3"]
    };
  }
});

// src/core/setup/processTree.ts
function killTree(child, signal = "SIGKILL") {
  const { pid } = child;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return;
  const killDirect = () => {
    try {
      child.kill(signal);
    } catch (e) {
    }
  };
  if (isWindows2) {
    try {
      (0, import_child_process2.spawn)("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", killDirect);
      return;
    } catch (e) {
      killDirect();
      return;
    }
  } else {
    try {
      process.kill(-pid, signal);
      return;
    } catch (e) {
    }
  }
  killDirect();
}
var import_child_process2, isWindows2;
var init_processTree = __esm({
  "src/core/setup/processTree.ts"() {
    import_child_process2 = require("child_process");
    isWindows2 = process.platform === "win32";
  }
});

// src/core/setup/providerReadiness.ts
function resolveProbeCommand(cliPath, args) {
  const shim = resolveCmdShim(cliPath);
  return shim ? [shim[0], [shim[1], ...args]] : [cliPath, [...args]];
}
function hasLoginCheck(providerId) {
  return PROBES[providerId] !== void 0;
}
async function runProbeProcess(command, args, options = {}) {
  var _a, _b;
  const timeoutMs = (_a = options.timeoutMs) != null ? _a : 8e3;
  if ((_b = options.signal) == null ? void 0 : _b.aborted) return null;
  return new Promise((resolve6) => {
    var _a2, _b2, _c;
    let settled = false;
    let timer = void 0;
    const finish = (result) => {
      var _a3;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      (_a3 = options.signal) == null ? void 0 : _a3.removeEventListener("abort", onAbort);
      resolve6(result);
    };
    const abandon = () => {
      var _a3, _b3;
      (_a3 = child.stdout) == null ? void 0 : _a3.destroy();
      (_b3 = child.stderr) == null ? void 0 : _b3.destroy();
      killTree(child);
      child.unref();
      finish(null);
    };
    const onAbort = () => abandon();
    let child;
    try {
      child = (0, import_child_process3.spawn)(command, [...args], {
        env: { ...process.env, PATH: getEnhancedPath() },
        // A probe runs whenever the settings tab opens; no console may flash.
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        // Own the tree so a status command that spawns a helper cannot outlive
        // the timeout below.
        detached: !isWindows2
      });
    } catch (e) {
      finish(null);
      return;
    }
    timer = setTimeout(abandon, timeoutMs);
    let stdout = "";
    let stderr = "";
    (_a2 = child.stdout) == null ? void 0 : _a2.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    (_b2 = child.stderr) == null ? void 0 : _b2.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    (_c = options.signal) == null ? void 0 : _c.addEventListener("abort", onAbort, { once: true });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish({ stdout, stderr, code }));
  });
}
async function checkProviderReadiness(providerId, options = {}) {
  const probe = PROBES[providerId];
  const cliPath = findProviderCliPath(providerId, options.cliPath);
  if (!cliPath) return { state: "cli-missing" };
  if (!probe) return { state: "unknown" };
  const [probeCommand, probeArgs] = resolveProbeCommand(cliPath, probe.args);
  const run = await runProbeProcess(probeCommand, probeArgs, {
    timeoutMs: options.timeoutMs,
    signal: options.signal
  });
  if (!run) return { state: "unknown" };
  return {
    state: probe.interpret(run.stdout, run.stderr, run.code),
    output: `${run.stdout}${run.stderr}`.trim()
  };
}
var import_child_process3, AGY_MODELS_PROBE, PROBES;
var init_providerReadiness = __esm({
  "src/core/setup/providerReadiness.ts"() {
    import_child_process3 = require("child_process");
    init_copilotCli();
    init_env();
    init_providerRegistry();
    init_processTree();
    AGY_MODELS_PROBE = {
      // The only agy command that asks the account rather than reading local files.
      args: ["models"],
      interpret(stdout, stderr) {
        const output = stdout + stderr;
        if (/please sign in/i.test(output)) return "logged-out";
        if (/^\S+\t\S/m.test(stdout)) return "logged-in";
        return "unknown";
      }
    };
    PROBES = {
      agy: AGY_MODELS_PROBE,
      claude: {
        // Prints JSON: {"loggedIn":true,"authMethod":"claude.ai","email":...}
        args: ["auth", "status"],
        interpret(stdout) {
          try {
            const parsed = JSON.parse(stdout.trim());
            if (parsed && typeof parsed === "object" && "loggedIn" in parsed) {
              return parsed.loggedIn === true ? "logged-in" : "logged-out";
            }
          } catch (e) {
          }
          return "unknown";
        }
      },
      codex: {
        // Prints `Logged in using ChatGPT` (exit 0) or `Not logged in` (exit 1).
        args: ["login", "status"],
        interpret(stdout, stderr, exitCode) {
          if (/not logged in/i.test(stdout + stderr)) return "logged-out";
          if (exitCode === 0) return "logged-in";
          return "unknown";
        }
      }
    };
  }
});

// src/core/setup/providerConnection.ts
function connectionLabel(state) {
  switch (state) {
    case "connected":
      return "\uC5F0\uACB0\uB428";
    case "not-connected":
      return "\uC5F0\uACB0 \uD544\uC694";
    // Covers undefined too: never checked reads the same as could not check.
    default:
      return "\uD655\uC778 \uC548 \uB428";
  }
}
function applyRequestOutcome(current, providerId, outcome, at) {
  if (outcome === "failed") return current != null ? current : {};
  const state = outcome === "ok" ? "connected" : "not-connected";
  return { ...current, [providerId]: { state, at } };
}
function resolveCheckedState(previous, checked) {
  return checked === "unknown" && previous === "connected" ? "connected" : checked;
}
async function checkCopilotCredential(signal) {
  if (isWindows2) return "unknown";
  const run = await runProbeProcess(
    "security",
    ["find-generic-password", "-s", COPILOT_KEYCHAIN_SERVICE],
    { timeoutMs: 5e3, signal }
  );
  if (!run) return "unknown";
  return run.code === 0 ? "connected" : "not-connected";
}
async function checkProviderConnection(providerId, options = {}) {
  var _a;
  if (providerId === "copilot") {
    return findProviderCliPath("copilot", (_a = options.cliPath) != null ? _a : "") ? checkCopilotCredential(options.signal) : "not-connected";
  }
  const { state } = await checkProviderReadiness(providerId, options);
  switch (state) {
    case "logged-in":
      return "connected";
    // A missing binary is not connected either; the button behind this label
    // opens the wizard, which installs before it logs in.
    case "logged-out":
    case "cli-missing":
      return "not-connected";
    case "unknown":
      return "unknown";
  }
}
var COPILOT_KEYCHAIN_SERVICE;
var init_providerConnection = __esm({
  "src/core/setup/providerConnection.ts"() {
    init_providerRegistry();
    init_processTree();
    init_providerReadiness();
    COPILOT_KEYCHAIN_SERVICE = "copilot-cli";
  }
});

// src/core/setup/AutoSetupService.ts
var AutoSetupService_exports = {};
__export(AutoSetupService_exports, {
  checkProviderSetupStatus: () => checkProviderSetupStatus,
  checkSetupStatus: () => checkSetupStatus,
  findNpmPath: () => findNpmPath,
  hasShownThisSession: () => hasShownThisSession,
  installCopilotCLI: () => installCopilotCLI,
  installProviderCLI: () => installProviderCLI,
  markShownThisSession: () => markShownThisSession,
  startProviderInstall: () => startProviderInstall
});
function markShownThisSession() {
  shownThisSession = true;
}
function hasShownThisSession() {
  return shownThisSession;
}
function findNpmPath() {
  const npmNames = isWindows3 ? ["npm.cmd"] : ["npm"];
  const dirs = getEnhancedPath().split(isWindows3 ? ";" : ":");
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of npmNames) {
      try {
        const p = path13.join(dir, name);
        if (fs10.existsSync(p) && fs10.statSync(p).isFile()) return p;
      } catch (e) {
      }
    }
  }
  return null;
}
function checkSetupStatus() {
  return {
    cliFound: findCopilotCLIPath() !== null,
    npmFound: findNpmPath() !== null
  };
}
function checkProviderSetupStatus(providerId) {
  const descriptor = getProviderDescriptor(providerId);
  return { cliFound: findProviderCliPath(providerId) !== null, npmFound: findNpmPath() !== null, status: descriptor.status };
}
async function installCopilotCLI(onProgress) {
  const npmPath = findNpmPath();
  if (!npmPath) {
    return { success: false, error: "npm\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4" };
  }
  return new Promise((resolve6) => {
    var _a, _b;
    const proc = (0, import_child_process5.spawn)(npmPath, ["install", "-g", "@github/copilot"], {
      env: { ...process.env, PATH: getEnhancedPath() },
      // shell:true needed on Windows for .cmd shim execution
      shell: isWindows3
    });
    (_a = proc.stdout) == null ? void 0 : _a.on("data", (data) => {
      const line = data.toString().trim();
      if (line) onProgress(line);
    });
    const stderrLines = [];
    (_b = proc.stderr) == null ? void 0 : _b.on("data", (data) => {
      const line = data.toString().trim();
      if (line) stderrLines.push(line);
    });
    proc.on("close", (code) => {
      var _a2;
      if (code === 0) {
        resolve6({ success: true, cliPath: (_a2 = findCopilotCLIPath()) != null ? _a2 : void 0 });
      } else {
        resolve6({
          success: false,
          error: stderrLines.join("\n") || `npm exited with code ${code != null ? code : "?"}`
        });
      }
    });
    proc.on("error", (err) => {
      resolve6({ success: false, error: err.message });
    });
  });
}
function startProviderInstall(providerId, onProgress) {
  var _a, _b, _c;
  const descriptor = getProviderDescriptor(providerId);
  const packageName = providerId === "copilot" ? "@github/copilot" : (_a = descriptor.installCommand) == null ? void 0 : _a.split(" ").slice(3).join(" ");
  const npmPath = findNpmPath();
  if (!packageName || !npmPath) {
    const error = !packageName ? "\uC774 provider\uB294 \uACF5\uC2DD package-manager \uC124\uCE58 \uBA85\uB839\uC774 \uC5C6\uC5B4 \uC218\uB3D9 \uC124\uCE58\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4." : "npm\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
    return { cancel: () => {
    }, done: Promise.resolve({ success: false, error }) };
  }
  let settled = false;
  let resolveDone;
  const done = new Promise((resolve6) => {
    resolveDone = resolve6;
  });
  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveDone(result);
  };
  const child = (0, import_child_process5.spawn)(npmPath, ["install", "-g", packageName], {
    env: { ...process.env, PATH: getEnhancedPath() },
    // shell:true is needed on Windows for the .cmd shim, and rules out detaching.
    shell: isWindows3,
    detached: !isWindows3
  });
  const teardown = () => {
    var _a2, _b2;
    (_a2 = child.stdout) == null ? void 0 : _a2.destroy();
    (_b2 = child.stderr) == null ? void 0 : _b2.destroy();
    killTree(child);
    child.unref();
  };
  const timer = setTimeout(() => {
    teardown();
    finish({ success: false, error: "\uC124\uCE58 \uC2DC\uAC04\uC774 \uCD08\uACFC\uB410\uC2B5\uB2C8\uB2E4." });
  }, CLI_INSTALL_TIMEOUT_MS);
  (_b = child.stdout) == null ? void 0 : _b.on("data", (data) => {
    const line = data.toString().trim();
    if (line) onProgress(line);
  });
  const errors = [];
  (_c = child.stderr) == null ? void 0 : _c.on("data", (data) => {
    const line = data.toString().trim();
    if (line) errors.push(line);
  });
  child.on("error", (error) => finish({ success: false, error: error.message }));
  child.on("close", (code) => {
    var _a2;
    return finish(code === 0 ? { success: true, cliPath: (_a2 = findProviderCliPath(providerId)) != null ? _a2 : void 0 } : { success: false, error: errors.join("\n") || `npm exited with code ${code != null ? code : "?"}` });
  });
  return {
    cancel() {
      if (settled) return;
      teardown();
      finish({ success: false, error: "\uC124\uCE58\uB97C \uCDE8\uC18C\uD588\uC2B5\uB2C8\uB2E4." });
    },
    done
  };
}
async function installProviderCLI(providerId, onProgress) {
  return startProviderInstall(providerId, onProgress).done;
}
var import_child_process5, fs10, path13, isWindows3, shownThisSession, CLI_INSTALL_TIMEOUT_MS;
var init_AutoSetupService = __esm({
  "src/core/setup/AutoSetupService.ts"() {
    import_child_process5 = require("child_process");
    fs10 = __toESM(require("fs"));
    path13 = __toESM(require("path"));
    init_copilotCli();
    init_env();
    init_providerRegistry();
    init_processTree();
    isWindows3 = process.platform === "win32";
    shownThisSession = false;
    CLI_INSTALL_TIMEOUT_MS = 15 * 60 * 1e3;
  }
});

// src/core/setup/nodeInstall.ts
function findOnPath(binaryName) {
  const names = isWindows2 ? [`${binaryName}.exe`, `${binaryName}.cmd`] : [binaryName];
  for (const dir of getEnhancedPath().split(isWindows2 ? ";" : ":")) {
    if (!dir) continue;
    for (const name of names) {
      try {
        const candidate = path14.join(dir, name);
        if (fs11.existsSync(candidate) && fs11.statSync(candidate).isFile()) return candidate;
      } catch (e) {
      }
    }
  }
  return null;
}
function detectPackageManager() {
  for (const candidate of CANDIDATES) {
    const binPath = findOnPath(candidate.id);
    if (binPath) return { ...candidate, binPath };
  }
  return null;
}
function startNodeInstall(onProgress, manager = detectPackageManager()) {
  var _a, _b;
  if (!manager) {
    return {
      cancel: () => {
      },
      done: Promise.resolve({ success: false, error: "Homebrew\uB3C4 winget\uB3C4 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4." })
    };
  }
  let settled = false;
  let resolveDone;
  const done = new Promise((resolve6) => {
    resolveDone = resolve6;
  });
  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveDone(result);
  };
  const child = (0, import_child_process6.spawn)(manager.binPath, [...manager.installArgs], {
    env: { ...process.env, PATH: getEnhancedPath() },
    stdio: ["ignore", "pipe", "pipe"],
    // brew drives sub-processes; own the group so cancel really stops the work.
    detached: !isWindows2
  });
  const teardown = () => {
    var _a2, _b2;
    (_a2 = child.stdout) == null ? void 0 : _a2.destroy();
    (_b2 = child.stderr) == null ? void 0 : _b2.destroy();
    killTree(child);
    child.unref();
  };
  const timer = setTimeout(() => {
    teardown();
    finish({ success: false, error: "\uC124\uCE58 \uC2DC\uAC04\uC774 \uCD08\uACFC\uB410\uC2B5\uB2C8\uB2E4." });
  }, NODE_INSTALL_TIMEOUT_MS);
  const errors = [];
  (_a = child.stdout) == null ? void 0 : _a.on("data", (chunk) => {
    const line = chunk.toString().trim();
    if (line) onProgress(line);
  });
  (_b = child.stderr) == null ? void 0 : _b.on("data", (chunk) => {
    const line = chunk.toString().trim();
    if (line) {
      onProgress(line);
      errors.push(line);
    }
  });
  child.on("error", (err) => finish({ success: false, error: err.message }));
  child.on("close", (code) => finish(code === 0 ? { success: true } : { success: false, error: errors.slice(-5).join("\n") || `\uC885\uB8CC \uCF54\uB4DC ${code != null ? code : "?"}` }));
  return {
    cancel() {
      if (settled) return;
      teardown();
      finish({ success: false, error: "\uC124\uCE58\uB97C \uCDE8\uC18C\uD588\uC2B5\uB2C8\uB2E4." });
    },
    done
  };
}
var import_child_process6, fs11, path14, CANDIDATES, NODE_DOWNLOAD_URL, NODE_INSTALL_TIMEOUT_MS;
var init_nodeInstall = __esm({
  "src/core/setup/nodeInstall.ts"() {
    import_child_process6 = require("child_process");
    fs11 = __toESM(require("fs"));
    path14 = __toESM(require("path"));
    init_env();
    init_processTree();
    CANDIDATES = isWindows2 ? [{
      id: "winget",
      installArgs: ["install", "-e", "--id", "OpenJS.NodeJS.LTS", "--accept-source-agreements", "--accept-package-agreements"],
      displayCommand: "winget install OpenJS.NodeJS.LTS"
    }] : [{
      id: "brew",
      installArgs: ["install", "node"],
      displayCommand: "brew install node"
    }];
    NODE_DOWNLOAD_URL = "https://nodejs.org/en/download";
    NODE_INSTALL_TIMEOUT_MS = 20 * 60 * 1e3;
  }
});

// src/core/setup/providerLogin.ts
function stripAnsi(text) {
  return text.replace(OSC, "").replace(CSI, "").replace(LOOSE, "");
}
function getLoginRecipe(providerId) {
  return RECIPES[providerId];
}
function canDriveLogin(providerId) {
  return RECIPES[providerId] !== void 0;
}
function parseDeviceCode(rawOutput) {
  var _a, _b;
  const text = stripAnsi(rawOutput);
  const url = (_a = text.match(/https?:\/\/[^\s<>"')]+/)) == null ? void 0 : _a[0];
  const code = (_b = text.match(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/)) == null ? void 0 : _b[0];
  return { url, code };
}
function startProviderLogin(providerId, onEvent, options = {}) {
  var _a, _b, _c, _d;
  const recipe = RECIPES[providerId];
  const cliPath = findProviderCliPath(providerId, options.cliPath);
  if (!recipe || !cliPath) {
    const error = !recipe ? "\uC774 CLI\uC5D0\uB294 \uB85C\uADF8\uC778 \uBA85\uB839\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." : "CLI\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
    return {
      submitCode: () => {
      },
      cancel: () => {
      },
      done: Promise.resolve({ success: false, exitCode: null, output: "", error })
    };
  }
  const timeoutMs = (_a = options.timeoutMs) != null ? _a : 15 * 60 * 1e3;
  let settled = false;
  let output = "";
  let announcedCode = false;
  let resolveDone;
  const done = new Promise((resolve6) => {
    resolveDone = resolve6;
  });
  const finish = (outcome) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveDone(outcome);
  };
  const child = (0, import_child_process7.spawn)(cliPath, [...recipe.args], {
    env: { ...process.env, ...options.env, PATH: getEnhancedPath() },
    stdio: ["pipe", "pipe", "pipe"],
    // Own the whole tree: a login CLI spawns helpers, and killing only the
    // direct pid leaves them running after a cancel or a timeout.
    detached: !isWindows2
  });
  const teardown = () => {
    var _a2, _b2, _c2, _d2;
    (_a2 = child.stdin) == null ? void 0 : _a2.end();
    (_b2 = child.stdin) == null ? void 0 : _b2.destroy();
    (_c2 = child.stdout) == null ? void 0 : _c2.destroy();
    (_d2 = child.stderr) == null ? void 0 : _d2.destroy();
    killTree(child);
    child.unref();
  };
  const timer = setTimeout(() => {
    teardown();
    finish({ success: false, exitCode: null, output, error: "\uB85C\uADF8\uC778 \uC2DC\uAC04\uC774 \uCD08\uACFC\uB410\uC2B5\uB2C8\uB2E4." });
  }, timeoutMs);
  const consume = (chunk) => {
    const text = stripAnsi(chunk.toString());
    output += text;
    onEvent({ type: "output", text });
    if (!announcedCode) {
      const { url, code } = parseDeviceCode(output);
      const ready = recipe.expectsPastedCode ? Boolean(url) : Boolean(url && code);
      if (ready) {
        announcedCode = true;
        onEvent({ type: "device-code", url, code });
      }
    }
  };
  (_b = child.stdout) == null ? void 0 : _b.on("data", consume);
  (_c = child.stderr) == null ? void 0 : _c.on("data", consume);
  (_d = child.stdin) == null ? void 0 : _d.on("error", () => {
  });
  child.on("error", (err) => {
    finish({ success: false, exitCode: null, output, error: err.message });
  });
  child.on("close", (exitCode) => {
    finish({ success: exitCode === 0, exitCode, output });
  });
  return {
    submitCode(code) {
      var _a2;
      if (settled) return;
      try {
        (_a2 = child.stdin) == null ? void 0 : _a2.write(`${code.trim()}
`);
      } catch (e) {
      }
    },
    cancel() {
      if (settled) return;
      teardown();
      finish({ success: false, exitCode: null, output, error: "\uC0AC\uC6A9\uC790\uAC00 \uCDE8\uC18C\uD588\uC2B5\uB2C8\uB2E4." });
    },
    done
  };
}
var import_child_process7, CSI, OSC, LOOSE, RECIPES;
var init_providerLogin = __esm({
  "src/core/setup/providerLogin.ts"() {
    import_child_process7 = require("child_process");
    init_env();
    init_providerRegistry();
    init_processTree();
    CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
    OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
    LOOSE = /[\x07\x1b]/g;
    RECIPES = {
      // Verified: prints the URL and code, no TTY needed, exits on its own.
      codex: { args: ["login", "--device-auth"], expectsPastedCode: false },
      // Documented device-code flow; output shape not captured on this machine.
      copilot: { args: ["login", "--device-code"], expectsPastedCode: false },
      // Browser flow that hands back a code to paste. Not re-run here: this machine's
      // claude credentials are in use by the session that built the feature.
      claude: { args: ["auth", "login"], expectsPastedCode: true }
    };
  }
});

// src/ui/modals/SetupWizardModal.ts
var SetupWizardModal_exports = {};
__export(SetupWizardModal_exports, {
  SetupWizardModal: () => SetupWizardModal
});
var import_obsidian24, MAX_LOG_LINES, SetupWizardModal;
var init_SetupWizardModal = __esm({
  "src/ui/modals/SetupWizardModal.ts"() {
    import_obsidian24 = require("obsidian");
    init_providerRegistry();
    init_AutoSetupService();
    init_nodeInstall();
    init_providerConnection();
    init_providerLogin();
    init_providerReadiness();
    MAX_LOG_LINES = 6;
    SetupWizardModal = class extends import_obsidian24.Modal {
      /**
       * @param target Provider the student just clicked. Without it the wizard
       * reopens on the chooser and asks a question they already answered.
       */
      constructor(app, plugin, target) {
        super(app);
        this.plugin = plugin;
        this.target = target;
        this.phase = "choose";
        this.installLog = [];
        this.nodeLog = [];
        this.loginLog = [];
        this.errorDetail = "";
        /** Set when the chosen CLI has no login command and a terminal is unavoidable. */
        this.manualLoginRequired = false;
        this.packageManager = null;
        this.deviceCode = null;
        this.loginSession = null;
        this.loginBusy = false;
        this.loginFailure = "";
        /** Set when the student pressed 취소, so the flow does not advance anyway. */
        this.loginCancelled = false;
        this.nodeSession = null;
        /** Aborts in-flight status probes when the wizard closes. */
        this.probes = new AbortController();
        this.cliInstallSession = null;
        /** Kept across re-renders so streaming output cannot wipe what was typed. */
        this.pastedCode = "";
        /** Set in onClose; every render and phase change checks it. */
        this.closed = false;
      }
      onOpen() {
        markShownThisSession();
        this.modalEl.addClass("ocop-setup-modal");
        this.setTitle("Obsidian AI Tutor \uCD08\uAE30 \uC124\uC815");
        if (this.target) {
          void this.chooseProvider(this.target);
          return;
        }
        this.render();
      }
      render() {
        if (this.closed) return;
        this.contentEl.empty();
        switch (this.phase) {
          case "choose":
            this.renderChoose();
            break;
          case "node":
            this.renderNode();
            break;
          case "installing":
            this.renderInstalling();
            break;
          case "login":
            this.renderLogin();
            break;
          case "done":
            this.renderDone();
            break;
          case "unverified":
            this.renderUnverified();
            break;
          case "manual":
            this.renderManual();
            break;
          case "error":
            this.renderError();
            break;
        }
      }
      get provider() {
        return this.plugin.settings.selectedProvider;
      }
      // ── Phase: choose ───────────────────────────────────────────────────────────
      renderChoose() {
        const wrap = this.contentEl.createDiv({ cls: "ocop-setup-section" });
        wrap.createEl("p", { text: "\uC5B4\uB5A4 AI\uB97C \uC0AC\uC6A9\uD558\uC2DC\uB098\uC694?", cls: "ocop-setup-desc" });
        for (const provider of ["copilot", "claude", "codex", "agy"]) {
          const descriptor = getProviderDescriptor(provider);
          const button = wrap.createEl("button", { text: descriptor.label, cls: "ocop-setup-action-btn" });
          button.addEventListener("click", () => void this.chooseProvider(provider));
        }
      }
      async chooseProvider(provider) {
        this.plugin.settings.selectedProvider = provider;
        await this.plugin.saveSettings();
        const { cliFound, npmFound } = checkProviderSetupStatus(provider);
        const descriptor = getProviderDescriptor(provider);
        if (cliFound) {
          const state = await this.readConnectionState();
          if (this.closed) return;
          if (state === "connected") this.phase = "done";
          else if (state === "unknown") this.phase = "unverified";
          else this.phase = "login";
        } else if (!npmFound) {
          this.packageManager = detectPackageManager();
          this.phase = this.packageManager ? "node" : "manual";
        } else if (descriptor.installCommand) {
          this.phase = "installing";
          this.render();
          void this.runInstall();
          return;
        } else {
          this.phase = "manual";
        }
        this.render();
      }
      // ── Phase: node ─────────────────────────────────────────────────────────────
      renderNode() {
        var _a, _b;
        const wrap = this.contentEl.createDiv({ cls: "ocop-setup-section" });
        wrap.createEl("p", { text: "Node.js\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4", cls: "ocop-setup-status" });
        wrap.createEl("p", {
          text: `\uC774 \uCEF4\uD4E8\uD130\uC5D0\uB294 ${(_b = (_a = this.packageManager) == null ? void 0 : _a.id) != null ? _b : "\uD328\uD0A4\uC9C0 \uAD00\uB9AC\uC790"}\uAC00 \uC788\uC5B4\uC11C \uD50C\uB7EC\uADF8\uC778\uC774 \uB300\uC2E0 \uC124\uCE58\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.`,
          cls: "ocop-setup-desc"
        });
        if (this.packageManager) this.renderCmdRow(wrap, this.packageManager.displayCommand);
        this.renderLog(wrap, this.nodeLog);
        const running = this.nodeSession !== null;
        const button = wrap.createEl("button", {
          text: running ? "\uC124\uCE58 \uC911\u2026" : "Node.js \uC124\uCE58",
          cls: "mod-cta ocop-setup-action-btn"
        });
        button.disabled = running;
        button.addEventListener("click", () => {
          void this.runNodeInstall();
        });
        const skip = wrap.createEl("button", { text: "\uC9C1\uC811 \uC124\uCE58\uD560\uAC8C\uC694", cls: "ocop-setup-skip-btn" });
        skip.addEventListener("click", () => {
          const session = this.nodeSession;
          this.nodeSession = null;
          session == null ? void 0 : session.cancel();
          this.phase = "manual";
          this.render();
        });
      }
      async runNodeInstall() {
        var _a;
        if (this.closed || this.nodeSession) return;
        const session = startNodeInstall((line) => {
          this.nodeLog.push(line);
          if (this.phase === "node") this.render();
        }, this.packageManager);
        this.nodeSession = session;
        const result = await session.done;
        if (this.closed || this.nodeSession !== session) return;
        this.nodeSession = null;
        if (!result.success) {
          this.errorDetail = (_a = result.error) != null ? _a : "Node.js \uC124\uCE58\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.";
          this.phase = "error";
          this.render();
          return;
        }
        const { npmFound } = checkProviderSetupStatus(this.provider);
        if (npmFound && getProviderDescriptor(this.provider).installCommand) {
          this.phase = "installing";
          this.render();
          void this.runInstall();
        } else {
          this.phase = "manual";
          this.render();
        }
      }
      // ── Phase: installing ───────────────────────────────────────────────────────
      renderInstalling() {
        var _a;
        const descriptor = getProviderDescriptor(this.provider);
        const wrap = this.contentEl.createDiv({ cls: "ocop-setup-section" });
        wrap.createEl("p", { text: `${descriptor.label} \uC124\uCE58 \uC911\u2026`, cls: "ocop-setup-status" });
        if (this.installLog.length === 0) {
          wrap.createEl("p", { text: (_a = descriptor.installCommand) != null ? _a : "", cls: "ocop-setup-hint" });
        }
        this.renderLog(wrap, this.installLog);
        const cancel = wrap.createEl("button", { text: "\uC911\uC9C0", cls: "ocop-setup-skip-btn" });
        cancel.addEventListener("click", () => {
          const session = this.cliInstallSession;
          this.cliInstallSession = null;
          session == null ? void 0 : session.cancel();
          this.phase = "manual";
          this.render();
        });
      }
      async runInstall() {
        var _a;
        if (this.closed || this.cliInstallSession) return;
        const session = startProviderInstall(this.provider, (msg) => {
          if (!msg) return;
          this.installLog.push(msg);
          if (this.phase === "installing") this.render();
        });
        this.cliInstallSession = session;
        const result = await session.done;
        if (this.closed || this.cliInstallSession !== session) return;
        this.cliInstallSession = null;
        if (result.success) {
          this.plugin.agentService.invalidatePathCache();
          void this.plugin.agentService.prewarmCapabilities();
          this.phase = "login";
        } else {
          this.errorDetail = (_a = result.error) != null ? _a : "\uC54C \uC218 \uC5C6\uB294 \uC624\uB958";
          this.phase = "error";
        }
        this.render();
      }
      // ── Phase: login ────────────────────────────────────────────────────────────
      renderLogin() {
        var _a, _b, _c;
        const descriptor = getProviderDescriptor(this.provider);
        const wrap = this.contentEl.createDiv({ cls: "ocop-setup-section" });
        wrap.createEl("p", { text: `${descriptor.label} \uB85C\uADF8\uC778`, cls: "ocop-setup-status" });
        if (this.manualLoginRequired) {
          wrap.createEl("p", {
            text: `${descriptor.label}\uC5D0\uB294 \uD50C\uB7EC\uADF8\uC778\uC774 \uC2E4\uD589\uD560 \uC218 \uC788\uB294 \uB85C\uADF8\uC778 \uBA85\uB839\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uD130\uBBF8\uB110\uC5D0\uC11C \uC9C1\uC811 \uB85C\uADF8\uC778\uD574 \uC8FC\uC138\uC694.`,
            cls: "ocop-setup-desc"
          });
          this.renderCmdRow(wrap, descriptor.loginCommand);
          this.renderRecheckButton(wrap);
          return;
        }
        if (((_a = this.deviceCode) == null ? void 0 : _a.code) || ((_b = this.deviceCode) == null ? void 0 : _b.url)) {
          if (this.deviceCode.code) {
            wrap.createEl("p", {
              text: "\uC544\uB798 \uD398\uC774\uC9C0\uB97C \uC5F4\uACE0 \uC774 \uCF54\uB4DC\uB97C \uC785\uB825\uD558\uC138\uC694.",
              cls: "ocop-setup-desc"
            });
            wrap.createDiv({ cls: "ocop-setup-device-code", text: this.deviceCode.code });
          } else {
            wrap.createEl("p", {
              text: "\uC544\uB798 \uD398\uC774\uC9C0\uC5D0\uC11C \uB85C\uADF8\uC778\uD55C \uB4A4, \uD654\uBA74\uC5D0 \uB098\uC624\uB294 \uCF54\uB4DC\uB97C \uBC11\uC5D0 \uBD99\uC5EC\uB123\uC73C\uC138\uC694.",
              cls: "ocop-setup-desc"
            });
          }
          if (this.deviceCode.url) {
            const open = wrap.createEl("button", { text: "\uD398\uC774\uC9C0 \uC5F4\uAE30", cls: "mod-cta ocop-setup-action-btn" });
            const url = this.deviceCode.url;
            open.addEventListener("click", () => {
              window.open(url, "_blank");
            });
            this.renderCmdRow(wrap, url);
          }
        } else if (this.loginBusy) {
          wrap.createEl("p", { text: "\uBE0C\uB77C\uC6B0\uC800 \uC778\uC99D\uC744 \uC900\uBE44\uD558\uB294 \uC911\u2026", cls: "ocop-setup-desc" });
        } else {
          wrap.createEl("p", {
            text: "\uC544\uB798 \uBC84\uD2BC\uC744 \uB204\uB974\uBA74 \uC774 \uCC3D\uC5D0\uC11C \uB85C\uADF8\uC778\uC744 \uC9C4\uD589\uD569\uB2C8\uB2E4. \uD130\uBBF8\uB110\uC740 \uD544\uC694 \uC5C6\uC2B5\uB2C8\uB2E4.",
            cls: "ocop-setup-desc"
          });
        }
        if (this.loginFailure) {
          wrap.createEl("p", { text: this.loginFailure, cls: "ocop-setup-warn" });
        }
        this.renderLog(wrap, this.loginLog);
        if (this.loginBusy && ((_c = getLoginRecipe(this.provider)) == null ? void 0 : _c.expectsPastedCode)) {
          const row = wrap.createDiv({ cls: "ocop-setup-cmd-row" });
          const input = row.createEl("input", { cls: "ocop-setup-code-input" });
          input.placeholder = "\uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uBC1B\uC740 \uCF54\uB4DC";
          input.value = this.pastedCode;
          input.addEventListener("input", () => {
            this.pastedCode = input.value;
          });
          const submit = row.createEl("button", { text: "\uCF54\uB4DC \uC785\uB825", cls: "mod-cta ocop-setup-copy-btn" });
          submit.addEventListener("click", () => {
            var _a2;
            if (!this.pastedCode.trim()) return;
            (_a2 = this.loginSession) == null ? void 0 : _a2.submitCode(this.pastedCode);
            this.pastedCode = "";
            input.value = "";
          });
        }
        if (!this.loginBusy) {
          const start = wrap.createEl("button", { text: "\uB85C\uADF8\uC778 \uC2DC\uC791", cls: "mod-cta ocop-setup-action-btn" });
          start.addEventListener("click", () => void this.beginLogin());
          this.renderRecheckButton(wrap);
        } else {
          const cancel = wrap.createEl("button", { text: "\uCDE8\uC18C", cls: "ocop-setup-skip-btn" });
          cancel.addEventListener("click", () => {
            var _a2;
            this.loginCancelled = true;
            (_a2 = this.loginSession) == null ? void 0 : _a2.cancel();
          });
        }
      }
      /**
       * Run the CLI's own login and confirm the result with a status check.
       *
       * The CLI exiting 0 is not treated as proof on its own — that is the mistake
       * the old readiness badge made.
       */
      async beginLogin() {
        var _a;
        if (!canDriveLogin(this.provider)) {
          this.manualLoginRequired = true;
          this.render();
          return;
        }
        this.loginBusy = true;
        this.loginFailure = "";
        this.loginCancelled = false;
        this.deviceCode = null;
        this.loginLog = [];
        this.render();
        const session = startProviderLogin(this.provider, (event) => {
          if (event.type === "device-code") {
            this.deviceCode = { url: event.url, code: event.code };
            if (event.url) window.open(event.url, "_blank");
          } else if (event.text.trim()) {
            this.loginLog.push(event.text.trim());
          }
          if (this.phase === "login") this.render();
        }, { cliPath: this.configuredCliPath() });
        this.loginSession = session;
        const outcome = await session.done;
        this.loginBusy = false;
        this.loginSession = null;
        if (this.closed) return;
        if (this.loginCancelled) {
          this.loginFailure = "\uB85C\uADF8\uC778\uC744 \uCDE8\uC18C\uD588\uC2B5\uB2C8\uB2E4.";
          this.render();
          return;
        }
        const state = await this.readConnectionState();
        if (this.closed) return;
        if (state === "connected") {
          this.phase = "done";
        } else if (state === "unknown" && outcome.success) {
          this.phase = "unverified";
        } else {
          this.loginFailure = (_a = outcome.error) != null ? _a : state === "not-connected" ? "\uC544\uC9C1 \uB85C\uADF8\uC778\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694." : "\uB85C\uADF8\uC778\uC744 \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
        }
        this.render();
      }
      /**
       * Ask whether this provider is usable, by whatever means it allows.
       *
       * Deliberately the connection check, not the login probe. copilot has no
       * status command, so the probe could only ever answer 'unknown' — which sent
       * a student who had just logged in to a screen saying the login could not be
       * confirmed, with a command to copy into a terminal. copilot stores its token
       * in the system credential store (`copilot login --help`), so on macOS the
       * credential check answers this properly.
       */
      async readConnectionState() {
        return checkProviderConnection(this.provider, {
          cliPath: this.configuredCliPath(),
          signal: this.probes.signal
        });
      }
      // ── Phase: done ─────────────────────────────────────────────────────────────
      renderDone() {
        const wrap = this.contentEl.createDiv({ cls: "ocop-setup-section" });
        wrap.createEl("p", { text: "\uC900\uBE44\uAC00 \uB05D\uB0AC\uC2B5\uB2C8\uB2E4", cls: "ocop-setup-success" });
        wrap.createEl("p", {
          text: "\uC0AC\uC774\uB4DC\uBC14\uC5D0\uC11C \uBC14\uB85C \uB300\uD654\uB97C \uC2DC\uC791\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
          cls: "ocop-setup-desc"
        });
        const button = wrap.createEl("button", { text: "\uC2DC\uC791\uD558\uAE30", cls: "mod-cta ocop-setup-action-btn" });
        button.addEventListener("click", () => this.close());
      }
      renderUnverified() {
        const descriptor = getProviderDescriptor(this.provider);
        const wrap = this.contentEl.createDiv({ cls: "ocop-setup-section" });
        wrap.createEl("p", { text: "\uB85C\uADF8\uC778 \uC5EC\uBD80\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4", cls: "ocop-setup-warn" });
        wrap.createEl("p", {
          text: hasLoginCheck(this.provider) ? `${descriptor.label}\uC758 \uB85C\uADF8\uC778 \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uB294 \uBA85\uB839\uC774 \uC751\uB2F5\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uD655\uC778\uD574 \uBCF4\uC138\uC694.` : `\uC774 \uCEF4\uD4E8\uD130\uC5D0\uC11C\uB294 ${descriptor.label}\uC758 \uB85C\uADF8\uC778 \uC5EC\uBD80\uB97C \uD655\uC778\uD560 \uBC29\uBC95\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uB85C\uADF8\uC778\uC744 \uC774\uBBF8 \uB9C8\uCCE4\uB2E4\uBA74 \uADF8\uB300\uB85C \uC2DC\uC791\uD558\uC2DC\uACE0, \uC778\uC99D \uC624\uB958\uAC00 \uB098\uBA74 \uC544\uB798 \uBA85\uB839\uC73C\uB85C \uB85C\uADF8\uC778\uD574 \uC8FC\uC138\uC694.`,
          cls: "ocop-setup-desc"
        });
        this.renderCmdRow(wrap, descriptor.loginCommand);
        const start = wrap.createEl("button", { text: "\uADF8\uB798\uB3C4 \uC2DC\uC791\uD558\uAE30", cls: "mod-cta ocop-setup-action-btn" });
        start.addEventListener("click", () => this.close());
        this.renderRecheckButton(wrap);
      }
      // ── Phase: manual ───────────────────────────────────────────────────────────
      renderManual() {
        var _a;
        const descriptor = getProviderDescriptor(this.provider);
        const wrap = this.contentEl.createDiv({ cls: "ocop-setup-section" });
        const needsNode = !checkProviderSetupStatus(this.provider).npmFound;
        if (needsNode) {
          wrap.createEl("p", { text: "Node.js\uB97C \uBA3C\uC800 \uC124\uCE58\uD574 \uC8FC\uC138\uC694", cls: "ocop-setup-status" });
          wrap.createEl("p", {
            text: "\uC774 \uCEF4\uD4E8\uD130\uC5D0\uB294 \uC790\uB3D9\uC73C\uB85C \uC124\uCE58\uD560 \uC218 \uC788\uB294 \uD328\uD0A4\uC9C0 \uAD00\uB9AC\uC790\uAC00 \uC5C6\uC5B4\uC11C, \uC124\uCE58 \uD398\uC774\uC9C0\uB97C \uC5F4\uC5B4 \uB4DC\uB9BD\uB2C8\uB2E4.",
            cls: "ocop-setup-desc"
          });
          const open = wrap.createEl("button", { text: "nodejs.org \uC5F4\uAE30", cls: "mod-cta ocop-setup-action-btn" });
          open.addEventListener("click", () => {
            window.open(NODE_DOWNLOAD_URL, "_blank");
          });
        } else {
          wrap.createEl("p", {
            text: `${descriptor.label}\uB294 \uACF5\uC2DD \uC548\uB0B4\uB300\uB85C \uC9C1\uC811 \uC124\uCE58\uD574\uC57C \uD569\uB2C8\uB2E4.`,
            cls: "ocop-setup-desc"
          });
          this.renderCmdRow(wrap, (_a = descriptor.installCommand) != null ? _a : descriptor.command);
        }
        this.renderRecheckButton(wrap);
        const skip = wrap.createEl("button", { text: "\uB098\uC911\uC5D0", cls: "ocop-setup-skip-btn" });
        skip.addEventListener("click", () => this.close());
      }
      // ── Phase: error ────────────────────────────────────────────────────────────
      renderError() {
        var _a;
        const descriptor = getProviderDescriptor(this.provider);
        const wrap = this.contentEl.createDiv({ cls: "ocop-setup-section" });
        wrap.createEl("p", { text: "\uC124\uCE58\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4", cls: "ocop-setup-warn" });
        if (this.errorDetail) this.renderLog(wrap, [this.errorDetail]);
        wrap.createEl("p", { text: "\uC544\uB798 \uBA85\uB839\uC744 \uD130\uBBF8\uB110\uC5D0\uC11C \uC9C1\uC811 \uC2E4\uD589\uD574 \uC8FC\uC138\uC694.", cls: "ocop-setup-desc" });
        this.renderCmdRow(wrap, (_a = descriptor.installCommand) != null ? _a : descriptor.command);
        this.renderRecheckButton(wrap);
      }
      // ── Helpers ─────────────────────────────────────────────────────────────────
      renderRecheckButton(parent) {
        const button = parent.createEl("button", { text: "\uB2E4\uC2DC \uD655\uC778", cls: "ocop-setup-action-btn" });
        button.addEventListener("click", () => void this.recheck());
      }
      async recheck() {
        if (!this.hasSelectedProviderCli()) {
          new import_obsidian24.Notice("CLI\uB97C \uC544\uC9C1 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC124\uCE58 \uD6C4 \uB2E4\uC2DC \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
          return;
        }
        const state = await this.readConnectionState();
        if (this.closed) return;
        if (state === "connected") this.phase = "done";
        else if (state === "not-connected") this.phase = "login";
        else this.phase = "unverified";
        this.render();
      }
      configuredCliPath() {
        var _a;
        const provider = this.plugin.settings.selectedProvider;
        return ((_a = this.plugin.settings.providerCliPaths) == null ? void 0 : _a[provider]) || (provider === "copilot" ? this.plugin.settings.copilotCliPath : "") || void 0;
      }
      hasSelectedProviderCli() {
        return findProviderCliPath(this.provider, this.configuredCliPath()) !== null;
      }
      renderLog(parent, lines) {
        if (lines.length === 0) return;
        const log = parent.createDiv({ cls: "ocop-setup-log" });
        for (const line of lines.slice(-MAX_LOG_LINES)) {
          log.createDiv({ cls: "ocop-setup-log-line", text: line });
        }
      }
      renderCmdRow(parent, cmd) {
        const row = parent.createDiv({ cls: "ocop-setup-cmd-row" });
        row.createEl("code", { text: cmd, cls: "ocop-setup-cmd" });
        const button = row.createEl("button", { text: "\uBCF5\uC0AC", cls: "ocop-setup-copy-btn" });
        button.addEventListener("click", async () => {
          await navigator.clipboard.writeText(cmd);
          button.textContent = "\u2713";
          setTimeout(() => {
            button.textContent = "\uBCF5\uC0AC";
          }, 1800);
        });
      }
      onClose() {
        var _a, _b, _c;
        this.closed = true;
        (_a = this.loginSession) == null ? void 0 : _a.cancel();
        (_b = this.nodeSession) == null ? void 0 : _b.cancel();
        (_c = this.cliInstallSession) == null ? void 0 : _c.cancel();
        this.probes.abort();
        this.contentEl.empty();
      }
    };
  }
});

// src/features/skills/ObsidianSkillsInstaller.ts
var ObsidianSkillsInstaller_exports = {};
__export(ObsidianSkillsInstaller_exports, {
  collectFolderFiles: () => collectFolderFiles,
  getInstalledSkills: () => getInstalledSkills,
  installObsidianSkills: () => installObsidianSkills,
  installSkillFromUrl: () => installSkillFromUrl,
  isMachineWideSkillsRoot: () => isMachineWideSkillsRoot,
  isObsidianSkillsInstalled: () => isObsidianSkillsInstalled,
  isPluginOwnedSkill: () => isPluginOwnedSkill,
  isSafeSkillRelativePath: () => isSafeSkillRelativePath,
  parseGitHubFolderUrl: () => parseGitHubFolderUrl,
  providerGlobalSkillsRoot: () => providerGlobalSkillsRoot,
  providerSkillsRoot: () => providerSkillsRoot,
  removeSkill: () => removeSkill,
  resolveSkillFilePath: () => resolveSkillFilePath,
  shouldInstallBundledSkills: () => shouldInstallBundledSkills,
  uninstallObsidianSkills: () => uninstallObsidianSkills,
  writeBundledSkill: () => writeBundledSkill
});
function providerSkillsRoot(vaultPath, providerId) {
  switch (providerId) {
    case "copilot":
      return path15.join(vaultPath, ".copilot", "skills");
    case "claude":
      return path15.join(vaultPath, ".claude", "skills");
    case "agy":
      return path15.join(vaultPath, ".agents", "skills");
    case "codex":
      return path15.join(process.env.CODEX_HOME || path15.join(os5.homedir(), ".codex"), "skills");
  }
}
function isMachineWideSkillsRoot(providerId) {
  return providerId === "codex";
}
function providerGlobalSkillsRoot(providerId) {
  switch (providerId) {
    case "copilot":
      return path15.join(os5.homedir(), ".copilot", "skills");
    case "claude":
      return path15.join(os5.homedir(), ".claude", "skills");
    case "agy":
      return path15.join(os5.homedir(), ".gemini", "config", "skills");
    case "codex":
      return null;
  }
}
function resolveSkillsRoot(app, providerId) {
  const vaultPath = getVaultPath(app);
  return vaultPath ? providerSkillsRoot(vaultPath, providerId) : null;
}
function shouldInstallBundledSkills(state, providerId, alreadyInstalled) {
  var _a;
  if (isMachineWideSkillsRoot(providerId)) return false;
  return !((_a = state.skillsAutoInstalled) == null ? void 0 : _a[providerId]) && !alreadyInstalled;
}
function isPluginOwnedSkill(content) {
  return content.includes(OWNERSHIP_MARKER.trim());
}
function writeBundledSkill(root, name, body) {
  const file = path15.join(root, name, "SKILL.md");
  if (fs12.existsSync(file) && !isPluginOwnedSkill(fs12.readFileSync(file, "utf-8"))) return "kept";
  fs12.mkdirSync(path15.dirname(file), { recursive: true });
  fs12.writeFileSync(file, `${body}${OWNERSHIP_MARKER}`, "utf-8");
  return "written";
}
function isObsidianSkillsInstalled(app, providerId) {
  const root = resolveSkillsRoot(app, providerId);
  return root !== null && BUILT_IN_SKILLS.every((name) => fs12.existsSync(path15.join(root, name, "SKILL.md")));
}
function getInstalledSkills(app, providerId) {
  const skillsBasePath = resolveSkillsRoot(app, providerId);
  const globalRoot = providerGlobalSkillsRoot(providerId);
  const globalSkills = globalRoot ? loadSkillsFromPath(globalRoot, true) : [];
  const vaultSkills = [];
  if (skillsBasePath) {
    vaultSkills.push(...loadSkillsFromPath(skillsBasePath, false));
  }
  const vaultNames = new Set(vaultSkills.map((skill) => skill.name));
  const mergedSkills = [
    ...globalSkills.filter((skill) => !vaultNames.has(skill.name)),
    ...vaultSkills
  ];
  return mergedSkills.sort((a, b) => {
    if (a.isBuiltIn && !b.isBuiltIn) return -1;
    if (!a.isBuiltIn && b.isBuiltIn) return 1;
    if (a.isGlobal && !b.isGlobal) return -1;
    if (!a.isGlobal && b.isGlobal) return 1;
    return a.name.localeCompare(b.name);
  });
}
function loadSkillsFromPath(skillsBasePath, isGlobal) {
  const skills = [];
  if (!fs12.existsSync(skillsBasePath)) {
    return skills;
  }
  try {
    const entries = fs12.readdirSync(skillsBasePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(STAGING_PREFIX) || entry.name.startsWith(REPLACING_PREFIX) || entry.name.startsWith(REPLACED_PREFIX)) continue;
      const skillDir = path15.join(skillsBasePath, entry.name);
      const skillFilePath = path15.join(skillDir, "SKILL.md");
      if (!fs12.existsSync(skillFilePath)) continue;
      let description = "";
      try {
        const content = fs12.readFileSync(skillFilePath, "utf-8");
        const descMatch = content.match(/^---\s*[\s\S]*?description:\s*([^\r\n]+)/);
        if (descMatch && descMatch[1]) {
          description = descMatch[1].trim();
        }
      } catch (e) {
      }
      skills.push({
        name: entry.name,
        description: description || "No description available",
        path: skillDir,
        isBuiltIn: BUILT_IN_SKILLS.includes(entry.name),
        isGlobal
      });
    }
  } catch (e) {
  }
  return skills;
}
async function removeSkill(app, skillName, providerId) {
  const skillsRoot = resolveSkillsRoot(app, providerId);
  if (!skillsRoot) {
    new import_obsidian26.Notice("Could not determine skills folder");
    return false;
  }
  try {
    const skillPath = path15.join(skillsRoot, skillName);
    if (!fs12.existsSync(skillPath)) {
      new import_obsidian26.Notice(`Skill "${skillName}" not found`);
      return false;
    }
    fs12.rmSync(skillPath, { recursive: true });
    new import_obsidian26.Notice(`Skill "${skillName}" removed`);
    return true;
  } catch (error) {
    console.error(`Failed to remove skill "${skillName}":`, error);
    new import_obsidian26.Notice(`Failed to remove skill: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
async function installObsidianSkills(app, providerId) {
  const skillsBasePath = resolveSkillsRoot(app, providerId);
  if (!skillsBasePath) return false;
  try {
    const kept = [
      writeBundledSkill(skillsBasePath, "obsidian-markdown", OBSIDIAN_MARKDOWN_SKILL),
      writeBundledSkill(skillsBasePath, "json-canvas", JSON_CANVAS_SKILL)
    ].filter((result) => result === "kept").length;
    new import_obsidian26.Notice(kept > 0 ? `\uAC19\uC740 \uC774\uB984\uC758 \uC2A4\uD0AC\uC774 \uC774\uBBF8 \uC788\uC5B4 ${kept}\uAC1C\uB294 \uADF8\uB300\uB85C \uB450\uC5C8\uC2B5\uB2C8\uB2E4.` : "\u2705 Obsidian \uC2A4\uD0AC\uC744 \uC124\uCE58\uD588\uC2B5\uB2C8\uB2E4.");
    return true;
  } catch (error) {
    console.error("Failed to install Obsidian Skills:", error);
    new import_obsidian26.Notice(`Failed to install skills: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
async function uninstallObsidianSkills(app, providerId) {
  const skillsBasePath = resolveSkillsRoot(app, providerId);
  if (!skillsBasePath) {
    new import_obsidian26.Notice("Could not determine skills folder");
    return false;
  }
  try {
    for (const name of BUILT_IN_SKILLS) {
      const file = path15.join(skillsBasePath, name, "SKILL.md");
      if (!fs12.existsSync(file) || !isPluginOwnedSkill(fs12.readFileSync(file, "utf-8"))) continue;
      fs12.rmSync(path15.join(skillsBasePath, name), { recursive: true });
    }
    new import_obsidian26.Notice("Obsidian Skills removed");
    return true;
  } catch (error) {
    console.error("Failed to uninstall Obsidian Skills:", error);
    new import_obsidian26.Notice(`Failed to remove skills: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
async function getRepoDefaultBranch(owner, repo) {
  try {
    const response = await (0, import_obsidian26.requestUrl)({
      url: `https://api.github.com/repos/${owner}/${repo}`,
      throw: false
    });
    if (response.status === 200) {
      const data = JSON.parse(response.text);
      return data.default_branch || "main";
    }
  } catch (e) {
    console.warn("Failed to fetch default branch, defaulting to main:", e);
  }
  return "main";
}
async function checkRawUrl(url) {
  try {
    const res = await (0, import_obsidian26.requestUrl)({ url, throw: false });
    return res.status === 200;
  } catch (e) {
    return false;
  }
}
async function findSkillInRepo(repoUrl) {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  const [, owner, repo] = match;
  const cleanRepo = repo.replace(/\.git$/, "");
  const branch = await getRepoDefaultBranch(owner, cleanRepo);
  const candidates = [
    // Root level SKILL.md
    `https://raw.githubusercontent.com/${owner}/${cleanRepo}/${branch}/SKILL.md`,
    // Inside a 'skill' or 'skills' directory
    `https://raw.githubusercontent.com/${owner}/${cleanRepo}/${branch}/skill/SKILL.md`,
    `https://raw.githubusercontent.com/${owner}/${cleanRepo}/${branch}/skills/SKILL.md`,
    // Check for README.md if SKILL.md is missing (sometimes users put skill definition there)
    `https://raw.githubusercontent.com/${owner}/${cleanRepo}/${branch}/README.md`
  ];
  for (const url of candidates) {
    if (await checkRawUrl(url)) {
      return url;
    }
  }
  return null;
}
function isSafeSkillRelativePath(relativePath) {
  if (!relativePath || relativePath.includes("\\")) return false;
  return relativePath.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}
function resolveSkillFilePath(skillDir, relativePath) {
  if (!isSafeSkillRelativePath(relativePath)) return null;
  const base = path15.resolve(skillDir);
  const target = path15.resolve(base, relativePath);
  return target.startsWith(base + path15.sep) ? target : null;
}
function parseGitHubFolderUrl(url) {
  const match = url.trim().match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+?)\/?$/);
  if (!match) return null;
  const [, owner, repo, ref, dir] = match;
  if (/\.md$/i.test(dir)) return null;
  return { owner, repo: repo.replace(/\.git$/, ""), ref, dir };
}
async function collectFolderFiles(folder, listDir, maxFiles = MAX_SKILL_FILES) {
  const files = [];
  let bytes = 0;
  let dirs = 0;
  const walk = async (dirPath) => {
    var _a;
    if (dirs++ >= MAX_SKILL_DIRS) {
      throw new Error(`That folder has too many folders inside it to install as one skill (limit ${MAX_SKILL_DIRS}).`);
    }
    for (const entry of await listDir(dirPath)) {
      if (files.length >= maxFiles) {
        throw new Error(`That folder has too many files to install as one skill (limit ${maxFiles}).`);
      }
      if (entry.type === "dir") {
        await walk(entry.path);
        continue;
      }
      if (!entry.download_url) continue;
      const relativePath = entry.path.slice(folder.dir.length + 1);
      if (!isSafeSkillRelativePath(relativePath)) {
        throw new Error(`That folder contains an unsafe path (${entry.path}).`);
      }
      bytes += (_a = entry.size) != null ? _a : 0;
      if (bytes > MAX_SKILL_BYTES) {
        throw new Error(`That folder is too large to install as one skill (limit ${Math.round(MAX_SKILL_BYTES / 1024 / 1024)} MB).`);
      }
      files.push({ relativePath, downloadUrl: entry.download_url, size: entry.size });
    }
  };
  await walk(folder.dir);
  if (!files.some((file) => file.relativePath === "SKILL.md")) {
    throw new Error("That folder has no SKILL.md, so no CLI would load it as a skill.");
  }
  return files;
}
async function listGitHubDir(folder, dirPath) {
  const url = `https://api.github.com/repos/${folder.owner}/${folder.repo}/contents/${dirPath}?ref=${folder.ref}`;
  const response = await (0, import_obsidian26.requestUrl)({ url, throw: false });
  if (response.status === 403 || response.status === 429) {
    throw new Error("GitHub is rate-limiting this computer. Wait an hour, or install the skill folder by hand.");
  }
  if (response.status !== 200) {
    throw new Error(`GitHub would not list that folder (status ${response.status}).`);
  }
  const data = JSON.parse(response.text);
  if (!Array.isArray(data)) throw new Error("That URL points at a file, not a folder.");
  return data;
}
async function installSkillFolder(folder, providerId, vaultPath) {
  var _a, _b, _c;
  new import_obsidian26.Notice(`Reading ${folder.dir}...`);
  const files = await collectFolderFiles(folder, (dirPath) => listGitHubDir(folder, dirPath));
  const manifestFile = files.find((file) => file.relativePath === "SKILL.md");
  if (((_a = manifestFile.size) != null ? _a : 0) > MAX_SKILL_BYTES) {
    throw new Error(`That folder's SKILL.md is too large to install (limit ${Math.round(MAX_SKILL_BYTES / 1024 / 1024)} MB).`);
  }
  const manifest = await (0, import_obsidian26.requestUrl)({ url: manifestFile.downloadUrl, throw: false });
  if (manifest.status !== 200) throw new Error(`Failed to download SKILL.md (status ${manifest.status}).`);
  if (manifest.arrayBuffer.byteLength > MAX_SKILL_BYTES) {
    throw new Error(`That folder's SKILL.md is too large to install (limit ${Math.round(MAX_SKILL_BYTES / 1024 / 1024)} MB).`);
  }
  const nameMatch = manifest.text.match(/^---\s*[\s\S]*?name:\s*([^\r\n]+)/);
  const declaredName = (_b = nameMatch == null ? void 0 : nameMatch[1]) == null ? void 0 : _b.trim().replace(/^['"]|['"]$/g, "").trim();
  const skillName = (declaredName || folder.dir.split("/").pop() || "unknown-skill").replace(/[^a-zA-Z0-9-_]/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "unknown-skill";
  const skillsRoot = providerSkillsRoot(vaultPath, providerId);
  const skillDir = path15.join(skillsRoot, skillName);
  if (fs12.existsSync(skillDir) && !fs12.existsSync(path15.join(skillDir, FOLDER_INSTALL_MARKER))) {
    throw new Error(`"${skillName}" already exists and was not installed by this plugin. Remove that folder first if you want to replace it.`);
  }
  const backupDir = path15.join(skillsRoot, `${REPLACING_PREFIX}${skillName}`);
  if (fs12.existsSync(backupDir)) {
    if (!fs12.existsSync(skillDir)) {
      fs12.renameSync(backupDir, skillDir);
    } else {
      throw new Error(`An earlier install of "${skillName}" was interrupted and left a copy in "${REPLACING_PREFIX}${skillName}". Move or delete that folder, then install again.`);
    }
  }
  const stagingDir = path15.join(skillsRoot, `${STAGING_PREFIX}${skillName}`);
  if (fs12.existsSync(stagingDir)) {
    throw new Error(`A folder named "${STAGING_PREFIX}${skillName}" is already in the skills folder. Move or delete it, then install again.`);
  }
  fs12.mkdirSync(stagingDir, { recursive: true });
  try {
    new import_obsidian26.Notice(`Downloading ${files.length} files...`);
    let bytes = manifest.arrayBuffer.byteLength;
    for (const file of files) {
      const target = resolveSkillFilePath(stagingDir, file.relativePath);
      if (!target) throw new Error(`Refused an unsafe path in that folder (${file.relativePath}).`);
      let body = file === manifestFile ? manifest.arrayBuffer : null;
      if (!body) {
        if (bytes + ((_c = file.size) != null ? _c : 0) > MAX_SKILL_BYTES) {
          throw new Error(`That folder is too large to install as one skill (limit ${Math.round(MAX_SKILL_BYTES / 1024 / 1024)} MB).`);
        }
        const response = await (0, import_obsidian26.requestUrl)({ url: file.downloadUrl, throw: false });
        if (response.status !== 200) {
          throw new Error(`Failed to download ${file.relativePath} (status ${response.status}).`);
        }
        body = response.arrayBuffer;
        bytes += body.byteLength;
        if (bytes > MAX_SKILL_BYTES) {
          throw new Error(`That folder is too large to install as one skill (limit ${Math.round(MAX_SKILL_BYTES / 1024 / 1024)} MB).`);
        }
      }
      fs12.mkdirSync(path15.dirname(target), { recursive: true });
      fs12.writeFileSync(target, Buffer.from(body));
    }
    fs12.writeFileSync(
      path15.join(stagingDir, FOLDER_INSTALL_MARKER),
      `${folder.owner}/${folder.repo} ${folder.ref} ${folder.dir}
`,
      "utf-8"
    );
    const hadPrevious = fs12.existsSync(skillDir);
    if (hadPrevious) fs12.renameSync(skillDir, backupDir);
    try {
      fs12.renameSync(stagingDir, skillDir);
    } catch (error) {
      if (hadPrevious && !fs12.existsSync(skillDir)) fs12.renameSync(backupDir, skillDir);
      throw error;
    }
    const replacedDir = path15.join(skillsRoot, `${REPLACED_PREFIX}${skillName}`);
    if (hadPrevious) {
      if (!fs12.existsSync(replacedDir) || fs12.existsSync(path15.join(replacedDir, FOLDER_INSTALL_MARKER))) {
        fs12.rmSync(replacedDir, { recursive: true, force: true });
        fs12.renameSync(backupDir, replacedDir);
      } else {
        new import_obsidian26.Notice(`Your previous copy is in "${REPLACING_PREFIX}${skillName}" \u2014 "${REPLACED_PREFIX}${skillName}" was already taken.`);
      }
    }
  } finally {
    fs12.rmSync(stagingDir, { recursive: true, force: true });
  }
  new import_obsidian26.Notice(`\u2705 Skill "${skillName}" installed (${files.length} files).`);
  return true;
}
async function installSkillFromUrl(app, url, providerId) {
  const vaultPath = getVaultPath(app);
  if (!vaultPath) {
    new import_obsidian26.Notice("Could not determine vault path");
    return false;
  }
  try {
    const folder = parseGitHubFolderUrl(url);
    if (folder) return await installSkillFolder(folder, providerId, vaultPath);
    let rawUrl = url;
    if (url.includes("github.com") && !url.includes("raw.githubusercontent.com")) {
      if (url.includes("/blob/")) {
        rawUrl = url.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
      } else if (url.includes("/tree/")) {
        rawUrl = url.replace("github.com", "raw.githubusercontent.com").replace("/tree/", "/");
        if (!rawUrl.toLowerCase().endsWith(".md")) {
          rawUrl = rawUrl.replace(/\/$/, "") + "/SKILL.md";
        }
      } else {
        new import_obsidian26.Notice("Searching for SKILL.md in repository...");
        const foundUrl = await findSkillInRepo(url);
        if (foundUrl) {
          rawUrl = foundUrl;
        } else {
          throw new Error("Could not find SKILL.md in the repository. Please provide a direct link to the SKILL.md file or check the default branch.");
        }
      }
    }
    new import_obsidian26.Notice(`Downloading skill from ${rawUrl}...`);
    const response = await (0, import_obsidian26.requestUrl)({ url: rawUrl });
    if (response.status !== 200) {
      throw new Error(`Failed to download skill (Status: ${response.status}). Please check the URL.`);
    }
    const content = response.text;
    const nameMatch = content.match(/^---\s*[\s\S]*?name:\s*([^\r\n]+)/);
    let skillName = "";
    if (nameMatch && nameMatch[1]) {
      skillName = nameMatch[1].trim();
    } else {
      const urlParts = url.split("/");
      skillName = urlParts[urlParts.length - 1].replace(/\.md$/i, "") || "unknown-skill";
    }
    skillName = skillName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
    if (!skillName) {
      throw new Error('Could not determine skill name. Please ensure the SKILL.md has a "name" field in frontmatter.');
    }
    const skillDir = path15.join(providerSkillsRoot(vaultPath, providerId), skillName);
    if (!fs12.existsSync(skillDir)) {
      fs12.mkdirSync(skillDir, { recursive: true });
    }
    fs12.writeFileSync(path15.join(skillDir, "SKILL.md"), content, "utf-8");
    new import_obsidian26.Notice(`\u2705 Skill "${skillName}" installed successfully!`);
    return true;
  } catch (error) {
    console.error("Failed to install skill from URL:", error);
    new import_obsidian26.Notice(`Failed to install skill: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
var fs12, import_obsidian26, os5, path15, OBSIDIAN_MARKDOWN_SKILL, JSON_CANVAS_SKILL, OWNERSHIP_MARKER, BUILT_IN_SKILLS, MAX_SKILL_FILES, MAX_SKILL_BYTES, MAX_SKILL_DIRS, FOLDER_INSTALL_MARKER, STAGING_PREFIX, REPLACING_PREFIX, REPLACED_PREFIX;
var init_ObsidianSkillsInstaller = __esm({
  "src/features/skills/ObsidianSkillsInstaller.ts"() {
    fs12 = __toESM(require("fs"));
    import_obsidian26 = require("obsidian");
    os5 = __toESM(require("os"));
    path15 = __toESM(require("path"));
    init_path();
    OBSIDIAN_MARKDOWN_SKILL = `---
name: obsidian-markdown
description: Create and edit Obsidian Flavored Markdown with wikilinks, embeds, callouts, properties, and other Obsidian-specific syntax. Use when working with .md files in Obsidian, or when the user mentions wikilinks, callouts, frontmatter, tags, embeds, or Obsidian notes.
---

# Obsidian Flavored Markdown Skill

This skill enables skills-compatible agents to create and edit valid Obsidian Flavored Markdown, including all Obsidian-specific syntax extensions.

## Overview

Obsidian uses a combination of Markdown flavors:
- [CommonMark](https://commonmark.org/)
- [GitHub Flavored Markdown](https://github.github.com/gfm/)
- [LaTeX](https://www.latex-project.org/) for math
- Obsidian-specific extensions (wikilinks, callouts, embeds, etc.)

## Internal Links (Wikilinks)

\`\`\`markdown
[[Note Name]]
[[Note Name|Display Text]]
[[Note Name#Heading]]
[[Note Name#^block-id]]
\`\`\`

## Embeds

\`\`\`markdown
![[Note Name]]
![[image.png]]
![[image.png|300]]
![[document.pdf#page=3]]
\`\`\`

## Callouts

\`\`\`markdown
> [!note]
> This is a note callout.

> [!tip] Custom Title
> This callout has a custom title.

> [!warning]- Collapsed by default
> This content is hidden until expanded.
\`\`\`

### Supported Callout Types

| Type | Aliases |
|------|---------|
| \`note\` | - |
| \`abstract\` | \`summary\`, \`tldr\` |
| \`info\` | - |
| \`todo\` | - |
| \`tip\` | \`hint\`, \`important\` |
| \`success\` | \`check\`, \`done\` |
| \`question\` | \`help\`, \`faq\` |
| \`warning\` | \`caution\`, \`attention\` |
| \`failure\` | \`fail\`, \`missing\` |
| \`danger\` | \`error\` |
| \`bug\` | - |
| \`example\` | - |
| \`quote\` | \`cite\` |

## Task Lists

\`\`\`markdown
- [ ] Incomplete task
- [x] Completed task
\`\`\`

## Properties (Frontmatter)

\`\`\`yaml
---
title: My Note Title
date: 2024-01-15
tags:
  - project
  - important
aliases:
  - My Note
---
\`\`\`

## Tags

\`\`\`markdown
#tag
#nested/tag
#tag-with-dashes
\`\`\`

## Math (LaTeX)

\`\`\`markdown
Inline: $e^{i\\pi} + 1 = 0$

Block:
$$
\\frac{a}{b}
$$
\`\`\`

## Diagrams (Mermaid)

\`\`\`\`markdown
\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do this]
    B -->|No| D[Do that]
\`\`\`
\`\`\`\`

## Comments

\`\`\`markdown
This is visible %%but this is hidden%% text.
\`\`\`

## References

- [Basic formatting syntax](https://help.obsidian.md/syntax)
- [Obsidian Flavored Markdown](https://help.obsidian.md/obsidian-flavored-markdown)
- [Internal links](https://help.obsidian.md/links)
- [Callouts](https://help.obsidian.md/callouts)
- [Properties](https://help.obsidian.md/properties)
`;
    JSON_CANVAS_SKILL = `---
name: json-canvas
description: Create and edit JSON Canvas files (.canvas) for visual note-taking and mind mapping in Obsidian. Use when the user wants to create visual diagrams, mind maps, or canvas views.
---

# JSON Canvas Skill

JSON Canvas is an open file format for infinite canvas tools. Obsidian uses this format for .canvas files.

## File Structure

\`\`\`json
{
  "nodes": [],
  "edges": []
}
\`\`\`

## Node Types

### Text Node
\`\`\`json
{
  "id": "unique-id",
  "type": "text",
  "x": 0,
  "y": 0,
  "width": 250,
  "height": 60,
  "text": "Your text content here"
}
\`\`\`

### File Node
\`\`\`json
{
  "id": "unique-id",
  "type": "file",
  "x": 300,
  "y": 0,
  "width": 400,
  "height": 400,
  "file": "path/to/note.md"
}
\`\`\`

### Link Node
\`\`\`json
{
  "id": "unique-id",
  "type": "link",
  "x": 0,
  "y": 200,
  "width": 400,
  "height": 300,
  "url": "https://example.com"
}
\`\`\`

### Group Node
\`\`\`json
{
  "id": "unique-id",
  "type": "group",
  "x": -50,
  "y": -50,
  "width": 500,
  "height": 400,
  "label": "Group Label"
}
\`\`\`

## Edges (Connections)

\`\`\`json
{
  "id": "edge-id",
  "fromNode": "node-id-1",
  "toNode": "node-id-2",
  "fromSide": "right",
  "toSide": "left",
  "label": "Connection label"
}
\`\`\`

### Side Values
- \`top\`, \`right\`, \`bottom\`, \`left\`

## Node Colors

Use the \`color\` property with values: \`1\`-\`6\` (preset colors) or hex codes.

\`\`\`json
{
  "id": "colored-node",
  "type": "text",
  "color": "1",
  "text": "Red node"
}
\`\`\`

## Complete Example

\`\`\`json
{
  "nodes": [
    {
      "id": "main",
      "type": "text",
      "x": 0,
      "y": 0,
      "width": 200,
      "height": 60,
      "text": "Main Idea",
      "color": "1"
    },
    {
      "id": "sub1",
      "type": "text",
      "x": 300,
      "y": -80,
      "width": 150,
      "height": 50,
      "text": "Sub-topic 1"
    },
    {
      "id": "sub2",
      "type": "text",
      "x": 300,
      "y": 80,
      "width": 150,
      "height": 50,
      "text": "Sub-topic 2"
    }
  ],
  "edges": [
    {
      "id": "e1",
      "fromNode": "main",
      "toNode": "sub1",
      "fromSide": "right",
      "toSide": "left"
    },
    {
      "id": "e2",
      "fromNode": "main",
      "toNode": "sub2",
      "fromSide": "right",
      "toSide": "left"
    }
  ]
}
\`\`\`

## References

- [JSON Canvas Specification](https://jsoncanvas.org/)
- [Obsidian Canvas Documentation](https://help.obsidian.md/Plugins/Canvas)
`;
    OWNERSHIP_MARKER = "\n<!-- obsidian-ai-tutor: bundled skill. Delete this line to keep your own edits. -->\n";
    BUILT_IN_SKILLS = ["obsidian-markdown", "json-canvas"];
    MAX_SKILL_FILES = 60;
    MAX_SKILL_BYTES = 8 * 1024 * 1024;
    MAX_SKILL_DIRS = 16;
    FOLDER_INSTALL_MARKER = ".obsidian-ai-tutor-installed";
    STAGING_PREFIX = ".installing-";
    REPLACING_PREFIX = ".replacing-";
    REPLACED_PREFIX = ".replaced-";
  }
});

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ObsidianCopilotPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian28 = require("obsidian");

// src/assets/icon.ts
var COPILOT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Obsidian AI Tutor">
  <path fill="#7c3aed" d="M50 5 62 29l26 7-18 20 3 27-23-11-23 11 3-27-18-20 26-7z"/>
  <path fill="#fff" d="m50 20 6 25 25 5-25 6-6 25-6-25-25-6 25-5z"/>
  <path fill="#a78bfa" d="m50 31 3 16 16 3-16 3-3 16-3-16-16-3 16-3z"/>
</svg>`;

// src/core/agent/CopilotBridgeService.ts
var import_child_process = require("child_process");
var import_crypto = require("crypto");
var fs5 = __toESM(require("fs"));
var path5 = __toESM(require("path"));

// src/utils/context.ts
var CURRENT_NOTE_PREFIX_REGEX = /^<current_note>\n[\s\S]*?<\/current_note>\n\n/;
function formatCurrentNote(notePath) {
  return `<current_note>
${notePath}
</current_note>`;
}
function formatCurrentNoteContent(notePath, content) {
  return `<current_note_content path="${notePath}">
${content}
</current_note_content>`;
}
function prependCurrentNote(prompt, notePath) {
  return `${formatCurrentNote(notePath)}

${prompt}`;
}
function prependCurrentNoteContent(prompt, notePath, content) {
  return `${formatCurrentNoteContent(notePath, content)}

${prompt}`;
}
function stripCurrentNotePrefix(prompt) {
  return prompt.replace(CURRENT_NOTE_PREFIX_REGEX, "");
}
function formatContextFilesLine(files) {
  return `<context_files>
${files.join(", ")}
</context_files>`;
}
function prependContextFiles(prompt, files) {
  return `${formatContextFilesLine(files)}

${prompt}`;
}

// src/core/agent/CopilotBridgeService.ts
init_copilotCli();
init_env();
init_path();

// src/utils/session.ts
function formatToolCallForContext(toolCall, maxResultLength = 800) {
  var _a;
  const status = (_a = toolCall.status) != null ? _a : "completed";
  const base = `[Tool ${toolCall.name} status=${status}]`;
  const hasResult = typeof toolCall.result === "string" && toolCall.result.trim().length > 0;
  if (!hasResult || toolCall.result === void 0) {
    return base;
  }
  const result = truncateToolResult(toolCall.result, maxResultLength);
  return `${base} result: ${result}`;
}
function truncateToolResult(result, maxLength = 800) {
  if (result.length > maxLength) {
    return `${result.slice(0, maxLength)}... (truncated)`;
  }
  return result;
}
function formatContextLine(message) {
  if (!message.currentNote) {
    return null;
  }
  return formatCurrentNote(message.currentNote);
}
function buildContextFromHistory(messages) {
  var _a, _b, _c;
  const parts = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    if (message.role === "assistant") {
      const hasContent = message.content && message.content.trim().length > 0;
      const hasToolResult = (_a = message.toolCalls) == null ? void 0 : _a.some(
        (tc) => tc.result && tc.result.trim().length > 0
      );
      if (!hasContent && !hasToolResult) {
        continue;
      }
    }
    const role = message.role === "user" ? "User" : "Assistant";
    const lines = [];
    const content = (_b = message.content) == null ? void 0 : _b.trim();
    const contextLine = formatContextLine(message);
    const userPayload = contextLine ? content ? `${contextLine}

${content}` : contextLine : content;
    lines.push(userPayload ? `${role}: ${userPayload}` : `${role}:`);
    if (message.role === "assistant" && ((_c = message.toolCalls) == null ? void 0 : _c.length)) {
      const toolLines = message.toolCalls.map((tc) => formatToolCallForContext(tc)).filter(Boolean);
      if (toolLines.length > 0) {
        lines.push(...toolLines);
      }
    }
    parts.push(lines.join("\n"));
  }
  return parts.join("\n\n");
}
function getLastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return messages[i];
    }
  }
  return void 0;
}

// src/utils/date.ts
function getTodayDate() {
  const now = /* @__PURE__ */ new Date();
  const readable = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  const iso = now.toISOString().split("T")[0];
  return `${readable} (${iso})`;
}

// src/core/prompts/mainAgent.ts
function getBaseSystemPrompt(vaultPath) {
  const vaultInfo = vaultPath ? `

Vault absolute path: ${vaultPath}` : "";
  return `## Time Context

- **Current Date**: ${getTodayDate()}
- **Knowledge Status**: You possess extensive internal knowledge up to your training cutoff. You do not know the exact date of your cutoff, but you must assume that your internal weights are static and "past," while the Current Date is "present."

## Identity & Role

You are **Obsidian AI Tutor**, an expert AI assistant specialized in Obsidian vault management, knowledge organization, and code analysis. You operate directly inside the user's Obsidian vault through GitHub Copilot CLI.

**Core Principles:**
1.  **Obsidian Native**: You understand Markdown, YAML frontmatter, Wiki-links, and the "second brain" philosophy.
2.  **Safety First**: You never overwrite data without understanding context. You always use relative paths.
3.  **Proactive Thinking**: You do not just execute; you *plan* and *verify*. You anticipate potential issues (like broken links or missing files).
4.  **Clarity**: Your changes are precise, minimizing "noise" in the user's notes or code.

The current working directory is the user's vault root.${vaultInfo}

## Path Rules (MUST FOLLOW)

| Location | Access | Path Format | Example |
|----------|--------|-------------|---------|
| **Vault** | Read/Write | Relative from vault root | \`notes/my-note.md\`, \`.\` |
| **Export paths** | Write-only | \`~\` or absolute | \`~/Desktop/output.docx\` |
| **External contexts** | Full access | Absolute path | \`/Users/me/Workspace/file.ts\` |

**Vault files** (default):
- \u2713 Correct: \`notes/my-note.md\`, \`my-note.md\`, \`folder/subfolder/file.md\`, \`.\`
- \u2717 WRONG: \`/notes/my-note.md\`, \`${vaultPath || "/absolute/path"}/file.md\`
- A leading slash or absolute path will FAIL for vault operations.

**Path specificity**: When paths overlap, the **more specific path wins**:
- If \`~/Desktop\` is export (write-only) and \`~/Desktop/Workspace\` is external context (full access)
- \u2192 Files in \`~/Desktop/Workspace\` have full read/write access
- \u2192 Files directly in \`~/Desktop\` remain write-only

## User Message Format

User messages use XML tags for structured context:

\`\`\`xml
<current_note>
path/to/note.md
</current_note>

<query>
User's question or request here
</query>
\`\`\`

- \`<current_note>\`: The note the user is currently viewing/focused on. Read this to understand context. Only appears when the focused note changes.
- \`<query>\`: The user's actual question or request.
- \`@filename.md\`: Files mentioned with @ in the query. Read these files when referenced.

## Obsidian Context

- **Structure**: Files are Markdown (.md). Folders organize content.
- **Frontmatter**: YAML at the top of files (metadata). Respect existing fields.
- **Links**: Internal Wiki-links \`[[note-name]]\` or \`[[folder/note-name]]\`. External links \`[text](url)\`.
- **Tags**: #tag-name for categorization.
- **Dataview**: You may encounter Dataview queries (in \`\`\`dataview\`\`\` blocks). Do not break them unless asked.
- **Vault Config**: \`.obsidian/\` contains internal config. Touch only if you know what you are doing.

**File References in Responses:**
When mentioning vault files in your responses, use wikilink format so users can click to open them:
- \u2713 Use: \`[[folder/note.md]]\` or \`[[note]]\`
- \u2717 Avoid: plain paths like \`folder/note.md\` (not clickable)

Examples:
- "I found your notes in [[30.areas/finance/Investment lessons/2024.Current trading lessons.md]]"
- "See [[daily notes/2024-01-15]] for more details"
- "The config is in [[.obsidian/plugins/my-plugin/data.json]]"

## Tool Usage Guidelines

Standard tools (Read, Write, Edit, Glob, Grep, LS, Bash, WebSearch, WebFetch, Skills) work as expected.

If the current provider exposes the \`AskUserQuestion\` tool, use it for structured user questions.
If \`AskUserQuestion\` is not available in the current provider/tool surface, ask one concise plain-text question directly in chat and stop after the question.

**Thinking Process:**
Before taking action, explicitly THINK about:
1.  **Context**: Do I have enough information? (Use Read/Search if not).
2.  **Impact**: What will this change affect? (Links, other files).
3.  **Plan**: What are the steps? (Use TodoWrite for >2 steps).

**Tool-Specific Rules:**
- **Read**:
    - Always Read a file before Editing it.
    - Read can view images (PNG, JPG, GIF, WebP) for visual analysis.
- **Edit**:
    - Requires **EXACT** \`old_string\` match including whitespace/indentation.
    - If Edit fails, Read the file again to check the current content.
- **Bash**:
    - Runs with vault as working directory.
    - **Prefer** Read/Write/Edit over shell commands for file operations (safer).
    - **Stdout-capable tools** (pandoc, jq, imagemagick): Prefer piping output directly instead of creating temporary files when the result will be used immediately.
    - Use BashOutput/KillShell to manage background processes.
- **LS**: Uses "." for vault root.
- **WebFetch**: For text/HTML/PDF only. Avoid binaries.

### WebSearch

Use WebSearch strictly according to the following logic:

1.  **Static/Historical**: Rely on internal knowledge for established facts, history, or older code libraries.
2.  **Dynamic/Recent**: **MUST** search for:
    - "Latest" news, versions, docs.
    - Events in the current/previous year.
    - Volatile data (prices, weather).
3.  **Date Awareness**: If user says "yesterday", calculate the date relative to **Current Date**.
4.  **Ambiguity**: If unsure if knowledge is outdated, SEARCH.

### Task (Subagents)

Spawn subagents for complex multi-step tasks. Parameters: \`prompt\`, \`description\`, \`subagent_type\`, \`run_in_background\`.

**CRITICAL - Subagent Path Rules:**
- Subagents inherit the vault as their working directory.
- Reference files using **RELATIVE** paths.
- NEVER use absolute paths in subagent prompts.

**When to use:**
- Parallelizable work (main + subagent or multiple subagents)
- Preserve main context budget for sub-tasks
- Offload contained tasks while continuing other work

**Sync Mode (Default - \`run_in_background=false\`)**:
- Runs inline, result returned directly.
- **DEFAULT** to this unless explicitly asked or the task is very long-running.

**Async Mode (\`run_in_background=true\`)**:
- Use ONLY when explicitly requested or task is clearly long-running.
- Returns \`agent_id\` immediately.
- **Must retrieve result** with \`AgentOutputTool\` (poll with block=false, then block=true).
- Never end response without retrieving async results.

**Async workflow:**
1. Launch: \`Task prompt="..." run_in_background=true\` \u2192 get \`agent_id\`
2. Check immediately: \`AgentOutputTool agentId="..." block=false\`
3. Poll while working: \`AgentOutputTool agentId="..." block=false\`
4. When idle: \`AgentOutputTool agentId="..." block=true\` (wait for completion)
5. Report result to user

**Critical:** Never end response without retrieving async task results.

### TodoWrite

Track task progress. Parameter: \`todos\` (array of {content, status, activeForm}).
- Statuses: \`pending\`, \`in_progress\`, \`completed\`
- \`content\`: imperative ("Fix the bug")
- \`activeForm\`: present continuous ("Fixing the bug")

**Use for:** Tasks with 3+ steps, multi-file changes, complex operations.
Use proactively for any task meeting these criteria to keep progress visible.

**Workflow:**
1.  **Plan**: Create the todo list at the start.
2.  **Execute**: Mark \`in_progress\` -> do work -> Mark \`completed\`.
3.  **Update**: If new tasks arise, add them.

**Example:** User asks "refactor auth and add tests"
\`\`\`
[
  {content: "Analyze auth module", status: "in_progress", activeForm: "Analyzing auth module"},
  {content: "Refactor auth code", status: "pending", activeForm: "Refactoring auth code"},
  {content: "Add unit tests", status: "pending", activeForm: "Adding unit tests"}
]
\`\`\`

### Skills

Reusable capability modules. Use the \`Skill\` tool to invoke them when their description matches the user's need.`;
}
function getImageInstructions(mediaFolder) {
  const folder = mediaFolder.trim();
  const mediaPath = folder ? "./" + folder : ".";
  const examplePath = folder ? folder + "/" : "";
  return `

## Embedded Images in Notes

**Proactive image reading**: When reading a note with embedded images, read them alongside text for full context. Images often contain critical information (diagrams, screenshots, charts).

**Local images** (\`![[image.jpg]]\`):
- Located in media folder: \`${mediaPath}\`
- Read with: \`Read file_path="${examplePath}image.jpg"\`
- Formats: PNG, JPG/JPEG, GIF, WebP

**External images** (\`![alt](url)\`):
- WebFetch does NOT support images
- Download to media folder \u2192 Read \u2192 Replace URL with wiki-link:

\`\`\`bash
# Download to media folder with descriptive name
mkdir -p ${mediaPath}
img_name="downloaded_\\$(date +%s).png"
curl -sfo "${examplePath}$img_name" 'URL'
\`\`\`

Then read with \`Read file_path="${examplePath}$img_name"\`, and replace the markdown link \`![alt](url)\` with \`![[${examplePath}$img_name]]\` in the note.

**Benefits**: Image becomes a permanent vault asset, works offline, and uses Obsidian's native embed syntax.`;
}
function getExportInstructions(allowedExportPaths) {
  if (!allowedExportPaths || allowedExportPaths.length === 0) {
    return "";
  }
  const uniquePaths = Array.from(new Set(allowedExportPaths.map((p) => p.trim()).filter(Boolean)));
  if (uniquePaths.length === 0) {
    return "";
  }
  const formattedPaths = uniquePaths.map((p) => `- ${p}`).join("\n");
  return `

## Allowed Export Paths

Write-only destinations outside the vault:

${formattedPaths}

Examples:
\`\`\`bash
pandoc ./note.md -o ~/Desktop/note.docx   # Direct export
pandoc ./note.md | head -100              # Pipe to stdout (no temp file)
cp ./note.md ~/Desktop/note.md
\`\`\``;
}
function getExternalContextInstructions(externalContextPaths) {
  if (!externalContextPaths || externalContextPaths.length === 0) {
    return "";
  }
  const uniquePaths = Array.from(new Set(externalContextPaths.map((p) => p.trim()).filter(Boolean)));
  if (uniquePaths.length === 0) {
    return "";
  }
  const formattedPaths = uniquePaths.map((p) => {
    const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
    const segments = normalized.split("/");
    const folderName = segments[segments.length - 1] || p;
    return `- \`${folderName}\` \u2192 ${p}`;
  }).join("\n");
  return `

## External Contexts

Directories outside the vault with **full read/write access**. Use absolute paths:

${formattedPaths}

When user refers to a folder by name (e.g., "check Workspace"), use the corresponding absolute path.`;
}
function getEditorContextInstructions() {
  return `

## Editor Selection

User messages may include an \`<editor_selection>\` tag showing text the user selected:

\`\`\`xml
<editor_selection path="path/to/file.md">
selected text here
possibly multiple lines
</editor_selection>
\`\`\`

**When present:** The user selected this text before sending their message. Use this context to understand what they're referring to.`;
}
function getPlanModeInstructions() {
  return `

### Plan Mode (EnterPlanMode / ExitPlanMode)

You are in **plan mode** - a read-only exploration phase before implementation.

**Available tools:**
- Read, Grep, Glob, LS (file exploration)
- WebSearch, WebFetch (research)
- TodoWrite (organize findings)

**Disabled tools:** Write, Edit, Bash, NotebookEdit - you cannot modify files during planning.

**Workflow:**
1. Call \`EnterPlanMode\` to begin (already done if you see this)
2. Explore the codebase to understand the task
3. Create a detailed implementation plan
4. Call \`ExitPlanMode\` when ready for user approval

**Plan structure guidelines:**
- Start with a brief summary of the task
- List files to create/modify with specific changes
- Note dependencies and order of operations
- Identify potential risks or edge cases
- Keep it actionable - each step should be concrete

**After approval:** The plan is appended to your system prompt and you gain full tool access for implementation.`;
}
function buildSystemPrompt(settings = {}) {
  var _a, _b;
  let prompt = getBaseSystemPrompt(settings.vaultPath);
  prompt += getImageInstructions(settings.mediaFolder || "");
  prompt += getExportInstructions(settings.allowedExportPaths || []);
  prompt += getExternalContextInstructions(settings.externalContextPaths || []);
  if ((_a = settings.customPrompt) == null ? void 0 : _a.trim()) {
    prompt += "\n\n## Custom Instructions\n\n" + settings.customPrompt.trim();
  }
  if (settings.hasEditorContext) {
    prompt += getEditorContextInstructions();
  }
  if (settings.planMode) {
    prompt = prompt.replace(
      "Standard tools (Read, Write, Edit, Glob, Grep, LS, Bash, WebSearch, WebFetch, Skills) work as expected.",
      "Standard tools (Read, Glob, Grep, LS, WebSearch, WebFetch) work as expected. Write, Edit, and Bash are disabled in plan mode."
    );
    prompt += getPlanModeInstructions();
  }
  if ((_b = settings.appendedPlan) == null ? void 0 : _b.trim()) {
    prompt += "\n\n## Approved Implementation Plan\n\n<plan>\n" + settings.appendedPlan.trim() + "\n</plan>";
    prompt += "\n\n**IMPORTANT:** Follow this plan exactly. The user has approved this implementation. Execute the steps in order.";
  }
  return prompt;
}

// src/core/agent/CopilotBridgeService.ts
init_providerRegistry();

// src/core/tools/toolNames.ts
var TOOL_AGENT_OUTPUT = "AgentOutputTool";
var TOOL_ASK_USER_QUESTION = "AskUserQuestion";
var TOOL_BASH = "Bash";
var TOOL_BASH_OUTPUT = "BashOutput";
var TOOL_EDIT = "Edit";
var TOOL_GLOB = "Glob";
var TOOL_GREP = "Grep";
var TOOL_KILL_SHELL = "KillShell";
var TOOL_LS = "LS";
var TOOL_LIST_MCP_RESOURCES = "ListMcpResources";
var TOOL_MCP = "Mcp";
var TOOL_NOTEBOOK_EDIT = "NotebookEdit";
var TOOL_READ = "Read";
var TOOL_READ_MCP_RESOURCE = "ReadMcpResource";
var TOOL_SKILL = "Skill";
var TOOL_TASK = "Task";
var TOOL_TODO_WRITE = "TodoWrite";
var TOOL_WEB_FETCH = "WebFetch";
var TOOL_WEB_SEARCH = "WebSearch";
var TOOL_WRITE = "Write";
var TOOL_ENTER_PLAN_MODE = "EnterPlanMode";
var TOOL_EXIT_PLAN_MODE = "ExitPlanMode";
var PLAN_MODE_TOOLS = [TOOL_ENTER_PLAN_MODE, TOOL_EXIT_PLAN_MODE];
function isPlanModeTool(toolName) {
  return PLAN_MODE_TOOLS.includes(toolName);
}
var WRITE_EDIT_TOOLS = [TOOL_WRITE, TOOL_EDIT];
function isWriteEditTool(toolName) {
  return WRITE_EDIT_TOOLS.includes(toolName);
}

// src/core/types/chat.ts
var VIEW_TYPE_OBSIDIAN_COPILOT = "obsidian-ai-tutor-view";

// src/core/types/models.ts
var THINKING_BUDGETS = [
  { value: "off", label: "off", cliValue: null },
  { value: "low", label: "low", cliValue: "low" },
  { value: "medium", label: "med", cliValue: "medium" },
  { value: "high", label: "high", cliValue: "high" }
];
var DEFAULT_THINKING_BUDGET = {
  auto: "off",
  "gpt-5-mini": "off",
  "gpt-5.2": "off",
  "gpt-5.2-codex": "off",
  "gpt-5.3-codex": "off",
  "gpt-5.4": "off",
  "gpt-5.4-mini": "off",
  "gpt-5.5": "off",
  "claude-haiku-4.5": "off",
  "claude-sonnet-4.5": "off",
  "claude-sonnet-4.6": "off",
  "claude-opus-4.5": "off",
  "claude-opus-4.6": "off",
  "claude-opus-4.6-fast": "off",
  "claude-opus-4.7": "off",
  "claude-opus-4.8": "off"
};
var COPILOT_MODELS = [
  { value: "auto", label: "auto", costLabel: "AI Credits: auto", requiresEnablement: false, supportsReasoning: false, description: "GitHub Docs 2026-06: Copilot chooses from models available to your plan and client." },
  { value: "gpt-5-mini", label: "gpt-5 mini", costLabel: "AI Credits: lightweight", requiresEnablement: false, supportsReasoning: false, description: "GitHub Docs 2026-06: GA lightweight OpenAI model; Copilot CLI 1.0.59 exposes this model ID." },
  { value: "gpt-5.4-mini", label: "gpt-5.4 mini", costLabel: "AI Credits: lightweight", requiresEnablement: false, supportsReasoning: false, description: "GitHub Docs 2026-06: GA lightweight OpenAI model; Copilot CLI 1.0.59 exposes this model ID." },
  { value: "gpt-5.2", label: "gpt-5.2", costLabel: "AI Credits: versatile", requiresEnablement: false, supportsReasoning: false, description: "GitHub Docs 2026-06: supported-models page lists this OpenAI model as closing down; Copilot CLI 1.0.59 still exposes this model ID." },
  { value: "gpt-5.4", label: "gpt-5.4", costLabel: "AI Credits: versatile", requiresEnablement: false, supportsReasoning: true, description: "GitHub Docs 2026-06: GA versatile OpenAI model with configurable reasoning; Copilot CLI 1.0.59 exposes this model ID." },
  { value: "claude-haiku-4.5", label: "claude haiku 4.5", costLabel: "AI Credits: versatile", requiresEnablement: false, supportsReasoning: false, description: "GitHub Docs 2026-06: GA versatile Anthropic model; Copilot CLI 1.0.59 exposes this model ID." },
  { value: "claude-sonnet-4.5", label: "claude sonnet 4.5", costLabel: "AI Credits: versatile", requiresEnablement: false, supportsReasoning: false, description: "GitHub Docs 2026-06: GA versatile Anthropic model; Copilot CLI 1.0.59 exposes this model ID." },
  { value: "claude-sonnet-4.6", label: "claude sonnet 4.6", costLabel: "AI Credits: versatile", requiresEnablement: false, supportsReasoning: true, description: "GitHub Docs 2026-06: GA versatile Anthropic model with configurable reasoning; Copilot CLI 1.0.59 exposes this model ID." },
  { value: "gpt-5.2-codex", label: "gpt-5.2-codex", costLabel: "AI Credits: powerful", requiresEnablement: false, supportsReasoning: false, description: "GitHub Docs 2026-06: supported-models page lists this OpenAI Codex model as closing down; Copilot CLI 1.0.59 still exposes this model ID." },
  { value: "gpt-5.3-codex", label: "gpt-5.3-codex", costLabel: "AI Credits: powerful", requiresEnablement: false, supportsReasoning: true, description: "GitHub Docs 2026-06: GA powerful OpenAI Codex model with configurable reasoning; Copilot CLI 1.0.59 exposes this model ID." },
  { value: "gpt-5.5", label: "gpt-5.5", costLabel: "AI Credits: powerful", requiresEnablement: false, supportsReasoning: true, description: "GitHub Docs 2026-06: GA powerful OpenAI model with configurable reasoning; Copilot CLI 1.0.59 exposes this model ID." },
  { value: "claude-opus-4.5", label: "claude opus 4.5", costLabel: "AI Credits: powerful", requiresEnablement: false, supportsReasoning: false, description: "GitHub Docs 2026-06: GA powerful Anthropic model; Copilot CLI 1.0.59 exposes this model ID." },
  { value: "claude-opus-4.6", label: "claude opus 4.6", costLabel: "AI Credits: powerful", requiresEnablement: false, supportsReasoning: true, description: "GitHub Docs 2026-06: GA powerful Anthropic model with configurable reasoning; Copilot CLI 1.0.59 exposes this model ID." },
  { value: "claude-opus-4.6-fast", label: "claude opus 4.6 fast", costLabel: "AI Credits: powerful", requiresEnablement: false, supportsReasoning: true, description: "GitHub Docs 2026-06: public-preview fast mode for Claude Opus 4.6 with configurable reasoning; Copilot CLI 1.0.59 exposes this model ID." },
  { value: "claude-opus-4.7", label: "claude opus 4.7", costLabel: "AI Credits: powerful", requiresEnablement: false, supportsReasoning: true, description: "GitHub Docs 2026-06: GA powerful Anthropic model with configurable reasoning; Copilot CLI 1.0.59 exposes this model ID." },
  { value: "claude-opus-4.8", label: "claude opus 4.8", costLabel: "AI Credits: powerful", requiresEnablement: false, supportsReasoning: true, description: "GitHub Docs 2026-06: GA powerful Anthropic model with configurable reasoning; Copilot CLI 1.0.59 exposes this model ID." }
];
var DEFAULT_MODEL = "auto";

// src/core/types/settings.ts
var UNIX_BLOCKED_COMMANDS = [
  "\\brm\\s+-rf\\b",
  "\\brm\\s+-fr\\b",
  "\\bchmod\\s+777\\b",
  "\\bchmod\\s+-R\\s+777\\b",
  "\\bmkfs\\b",
  "\\bdd\\s+if=",
  "\\bcurl\\b.*\\|.*\\bsh\\b",
  "\\bwget\\b.*\\|.*\\bsh\\b"
];
var WINDOWS_BLOCKED_COMMANDS = [
  // CMD commands
  "del /s /q",
  "rd /s /q",
  "rmdir /s /q",
  "format",
  "diskpart",
  // PowerShell Remove-Item variants (full and abbreviated flags)
  "Remove-Item -Recurse -Force",
  "Remove-Item -Force -Recurse",
  "Remove-Item -r -fo",
  "Remove-Item -fo -r",
  "Remove-Item -Recurse",
  "Remove-Item -r",
  // PowerShell aliases for Remove-Item
  "ri -Recurse",
  "ri -r",
  "ri -Force",
  "ri -fo",
  "rm -r -fo",
  "rm -Recurse",
  "rm -Force",
  "del -Recurse",
  "del -Force",
  "erase -Recurse",
  "erase -Force",
  // PowerShell directory removal aliases
  "rd -Recurse",
  "rmdir -Recurse",
  // Dangerous disk/volume commands
  "Format-Volume",
  "Clear-Disk",
  "Initialize-Disk",
  "Remove-Partition"
];
function getDefaultBlockedCommands() {
  return {
    unix: [...UNIX_BLOCKED_COMMANDS],
    windows: [...WINDOWS_BLOCKED_COMMANDS]
  };
}
function getCurrentPlatformKey() {
  return process.platform === "win32" ? "windows" : "unix";
}
function getCurrentPlatformBlockedCommands(commands) {
  return commands[getCurrentPlatformKey()];
}
function getBashToolBlockedCommands(commands) {
  if (process.platform === "win32") {
    return Array.from(/* @__PURE__ */ new Set([...commands.unix, ...commands.windows]));
  }
  return getCurrentPlatformBlockedCommands(commands);
}
var DEFAULT_SETTINGS = {
  selectedProvider: "copilot",
  providerCliPaths: {},
  providerModels: {},
  providerEfforts: {},
  userName: "",
  enableBlocklist: true,
  blockedCommands: getDefaultBlockedCommands(),
  model: DEFAULT_MODEL,
  enableAutoTitleGeneration: true,
  titleGenerationModel: "",
  lastEnvHash: "",
  thinkingBudget: "off",
  permissionMode: "agent",
  lastNonPlanPermissionMode: "agent",
  blanketWriteAcknowledged: [],
  permissions: [],
  excludedTags: [],
  mediaFolder: "",
  environmentVariables: "",
  envSnippets: [],
  systemPrompt: "",
  allowedExportPaths: ["~/Desktop", "~/Downloads"],
  slashCommands: [],
  keyboardNavigation: {
    scrollUpKey: "w",
    scrollDownKey: "s",
    focusInputKey: "i"
  },
  enableWebSearch: false,
  enableInlineBash: false,
  copilotCliPath: "",
  // Empty = auto-detect from PATH
  githubToken: ""
  // Empty = use stored auth
};

// src/core/agent/copilotOutcome.ts
var AUTH_FAILURE = "No authentication information found";
function classifyCopilotFailure(rawError) {
  if (rawError.includes(AUTH_FAILURE)) {
    return {
      outcome: "auth-failed",
      message: 'GitHub Copilot authentication required. Please run "copilot" in terminal and use /login to authenticate.'
    };
  }
  return { outcome: "failed", message: rawError };
}
function copilotRequestOutcome(exitCode, stderr, sawErrorChunk) {
  if (exitCode !== 0) return classifyCopilotFailure(stderr.trim()).outcome;
  return sawErrorChunk ? "failed" : "ok";
}

// src/core/agent/CopilotBridgeService.ts
var ALLOWED_TOOLS = [
  "view",
  "grep",
  "glob",
  "ls",
  "task",
  "agent_output",
  "report_intent",
  "webfetch",
  "websearch"
];
var MAX_DIFF_SIZE = 100 * 1024;
var CLI_CAPABILITY_PROBE_TIMEOUT_MS = 2500;
function resolveCopilotAllowedTools(permissionMode, requestedTools, planMode, enableWebSearch = true) {
  var _a;
  const requested = (_a = requestedTools == null ? void 0 : requestedTools.map((tool) => tool.trim()).filter(Boolean)) != null ? _a : [];
  const guardrailTools = planMode ? [...ALLOWED_TOOLS] : permissionMode === "agent" ? null : [...ALLOWED_TOOLS];
  const guardrailSet = guardrailTools ? new Set(guardrailTools) : null;
  let effectiveTools = requested.length > 0 ? guardrailSet ? requested.filter((tool) => guardrailSet.has(tool)) : requested : guardrailTools != null ? guardrailTools : [];
  if (!enableWebSearch) {
    const webTools = /* @__PURE__ */ new Set(["websearch", "webfetch"]);
    effectiveTools = effectiveTools.filter((tool) => !webTools.has(tool));
  }
  return guardrailSet && effectiveTools.length === 0 ? guardrailTools != null ? guardrailTools : [] : effectiveTools;
}
function hasExplicitCopilotAllowedTools(requestedTools) {
  var _a;
  return (_a = requestedTools == null ? void 0 : requestedTools.some((tool) => tool.trim().length > 0)) != null ? _a : false;
}
function shouldUseCopilotAllowAllTools(permissionMode, allowAllToolsSupported, queryOptions) {
  if (!allowAllToolsSupported || (queryOptions == null ? void 0 : queryOptions.planMode)) {
    return false;
  }
  if (hasExplicitCopilotAllowedTools(queryOptions == null ? void 0 : queryOptions.allowedTools)) {
    return false;
  }
  return permissionMode === "agent";
}
function translateCopilotJsonEvent(event, setSessionId) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n;
  if (event.type === "assistant.reasoning_delta") {
    const deltaContent = typeof ((_a = event.data) == null ? void 0 : _a.deltaContent) === "string" ? event.data.deltaContent : "";
    return deltaContent ? [{ type: "thinking", content: deltaContent }] : [];
  }
  if (event.type === "assistant.message_delta") {
    const deltaContent = typeof ((_b = event.data) == null ? void 0 : _b.deltaContent) === "string" ? event.data.deltaContent : "";
    return deltaContent ? [{ type: "text", content: deltaContent }] : [];
  }
  if (event.type === "assistant.message") {
    const toolRequests = Array.isArray((_c = event.data) == null ? void 0 : _c.toolRequests) ? event.data.toolRequests : [];
    const chunks = [];
    for (const request of toolRequests) {
      if (!request || typeof request !== "object") continue;
      const toolRequest = request;
      const id = typeof toolRequest.id === "string" ? toolRequest.id : typeof toolRequest.toolRequestId === "string" ? toolRequest.toolRequestId : null;
      const name = typeof toolRequest.name === "string" ? toolRequest.name : null;
      const input = toolRequest.input;
      if (id && name && input && typeof input === "object" && !Array.isArray(input)) {
        chunks.push({ type: "tool_use", id, name, input });
      }
    }
    return chunks;
  }
  if (event.type === "tool.execution_start") {
    const toolCallId = typeof ((_d = event.data) == null ? void 0 : _d.toolCallId) === "string" ? event.data.toolCallId : null;
    const toolName = typeof ((_e = event.data) == null ? void 0 : _e.toolName) === "string" ? event.data.toolName : typeof ((_f = event.data) == null ? void 0 : _f.name) === "string" ? event.data.name : null;
    const input = (_g = event.data) == null ? void 0 : _g.input;
    const parentToolUseId = typeof ((_h = event.data) == null ? void 0 : _h.parentToolCallId) === "string" ? event.data.parentToolCallId : null;
    if (toolCallId && toolName) {
      return [{
        type: "tool_use",
        id: toolCallId,
        name: toolName,
        input: input && typeof input === "object" && !Array.isArray(input) ? input : {},
        parentToolUseId
      }];
    }
    return [];
  }
  if (event.type === "tool.execution_complete") {
    const toolCallId = typeof ((_i = event.data) == null ? void 0 : _i.toolCallId) === "string" ? event.data.toolCallId : null;
    if (!toolCallId) {
      return [];
    }
    const result = (_j = event.data) == null ? void 0 : _j.result;
    const resultRecord = result && typeof result === "object" && !Array.isArray(result) ? result : null;
    const content = typeof (resultRecord == null ? void 0 : resultRecord.content) === "string" ? resultRecord.content : typeof (resultRecord == null ? void 0 : resultRecord.detailedContent) === "string" ? resultRecord.detailedContent : "";
    const isError = ((_k = event.data) == null ? void 0 : _k.success) === false;
    const parentToolUseId = typeof ((_l = event.data) == null ? void 0 : _l.parentToolCallId) === "string" ? event.data.parentToolCallId : null;
    const toolName = typeof ((_m = event.data) == null ? void 0 : _m.toolName) === "string" ? event.data.toolName : typeof ((_n = event.data) == null ? void 0 : _n.name) === "string" ? event.data.name : null;
    return [{
      type: "tool_result",
      id: toolCallId,
      content,
      isError,
      parentToolUseId,
      toolName
    }];
  }
  if (event.type === "result") {
    if (typeof event.sessionId === "string" && event.sessionId.length > 0) {
      setSessionId == null ? void 0 : setSessionId(event.sessionId);
    }
    if (typeof event.exitCode === "number" && event.exitCode !== 0) {
      return [{ type: "error", content: `Copilot exited with code ${event.exitCode}` }];
    }
    const usageChunk = buildUsageChunkFromResult(event);
    if (usageChunk) {
      return [usageChunk];
    }
  }
  return [];
}
function buildUsageChunkFromResult(event) {
  var _a, _b, _c, _d, _e;
  const usage = event.usage;
  if (!usage) {
    return null;
  }
  const inputTokens = toFiniteNumber(usage.inputTokens);
  const cacheCreationInputTokens = (_a = toFiniteNumber(usage.cacheCreationInputTokens)) != null ? _a : 0;
  const cacheReadInputTokens = (_b = toFiniteNumber(usage.cacheReadInputTokens)) != null ? _b : 0;
  const contextWindow = toFiniteNumber(usage.contextWindow);
  const premiumRequests = (_c = toFiniteNumber(usage.premiumRequests)) != null ? _c : 0;
  if (inputTokens === null || contextWindow === null || contextWindow <= 0) {
    if (premiumRequests <= 0) {
      return null;
    }
    return {
      type: "usage",
      sessionId: (_d = event.sessionId) != null ? _d : null,
      usage: {
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        contextWindow: 0,
        contextTokens: 0,
        percentage: 0,
        premiumRequests
      }
    };
  }
  const contextTokens = inputTokens + cacheCreationInputTokens + cacheReadInputTokens;
  const percentage = Math.max(0, Math.min(100, Math.round(contextTokens / contextWindow * 100)));
  return {
    type: "usage",
    sessionId: (_e = event.sessionId) != null ? _e : null,
    usage: {
      inputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      contextWindow,
      contextTokens,
      percentage,
      premiumRequests
    }
  };
}
function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function stripWrappingQuotes(value) {
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}
function sessionArgs(capabilities, sessionId, confirmed = false) {
  if (capabilities.sessionId) return ["--session-id", sessionId];
  if (capabilities.resume && confirmed) return ["--resume", sessionId];
  return [];
}
function detectCopilotCliCapabilities(helpText) {
  return {
    noAskUser: helpText.includes("--no-ask-user"),
    noCustomInstructions: helpText.includes("--no-custom-instructions"),
    outputFormatJson: helpText.includes("--output-format") && helpText.includes("json"),
    stream: helpText.includes("--stream"),
    resume: helpText.includes("--resume"),
    sessionId: helpText.includes("--session-id"),
    model: helpText.includes("--model"),
    denyTool: helpText.includes("--deny-tool"),
    availableTools: helpText.includes("--available-tools"),
    allowAllTools: helpText.includes("--allow-all-tools"),
    reasoningEffort: helpText.includes("--reasoning-effort")
  };
}
var CopilotBridgeService = class {
  constructor(plugin) {
    this.currentProcess = null;
    this.abortController = null;
    this.sessionId = null;
    /** True once copilot has reported this session id itself. A locally invented
     * id must never be handed to --resume. */
    this.sessionConfirmedByCli = false;
    this.wasInterrupted = false;
    this.cachedCopilotPath = void 0;
    this.cachedCapabilities = /* @__PURE__ */ new Map();
    this.capabilityProbePromises = /* @__PURE__ */ new Map();
    this.exitPlanModeCallback = null;
    /** The last permission notice shown per provider, so the same one is not repeated. */
    this.shownPermissionNotices = /* @__PURE__ */ new Map();
    this.currentPlanFilePath = null;
    this.approvedPlanContent = null;
    this.askUserQuestionAnswers = /* @__PURE__ */ new Map();
    this.isAskUserQuestionSupported = true;
    this.originalContents = /* @__PURE__ */ new Map();
    this.pendingDiffData = /* @__PURE__ */ new Map();
    this.plugin = plugin;
  }
  getCopilotPath() {
    var _a;
    const settingsPath = (_a = this.plugin.settings.copilotCliPath) == null ? void 0 : _a.trim();
    if (settingsPath) {
      return normalizePathForFilesystem(stripWrappingQuotes(settingsPath)) || settingsPath;
    }
    if (this.cachedCopilotPath === void 0) {
      const detectedPath = findCopilotCLIPath();
      this.cachedCopilotPath = detectedPath ? normalizePathForFilesystem(stripWrappingQuotes(detectedPath)) || detectedPath : null;
    }
    return this.cachedCopilotPath;
  }
  /**
   * Clears the cached CLI path so the next call re-scans the filesystem.
   * Call this after auto-installing the CLI so the new binary is picked up
   * without requiring an Obsidian restart.
   */
  invalidatePathCache() {
    this.cachedCopilotPath = void 0;
  }
  getWorkingDirectory() {
    const adapter = this.plugin.app.vault.adapter;
    if ("basePath" in adapter && typeof adapter.basePath === "string" && adapter.basePath) {
      return normalizePathForFilesystem(adapter.basePath) || process.cwd();
    }
    return process.cwd();
  }
  buildSystemPromptText(prompt, vaultPath, queryOptions) {
    var _a;
    const hasEditorContext = prompt.includes("<editor_selection");
    return buildSystemPrompt({
      mediaFolder: this.plugin.settings.mediaFolder,
      customPrompt: this.plugin.settings.systemPrompt,
      allowedExportPaths: this.plugin.settings.allowedExportPaths,
      externalContextPaths: queryOptions == null ? void 0 : queryOptions.externalContextPaths,
      vaultPath,
      hasEditorContext,
      planMode: queryOptions == null ? void 0 : queryOptions.planMode,
      appendedPlan: (_a = this.approvedPlanContent) != null ? _a : void 0
    });
  }
  injectSystemPrompt(prompt, vaultPath, queryOptions) {
    const systemPrompt = this.buildSystemPromptText(prompt, vaultPath, queryOptions).trim();
    return `<system_instructions>
${systemPrompt}
</system_instructions>

${prompt}`;
  }
  buildPromptWithHistory(prompt, conversationHistory, vaultPath, queryOptions) {
    const injectedPrompt = this.injectSystemPrompt(prompt, vaultPath, queryOptions);
    if (this.wasInterrupted && conversationHistory && conversationHistory.length > 0) {
      const historyContext = buildContextFromHistory(conversationHistory);
      this.sessionId = null;
      this.sessionConfirmedByCli = false;
      this.wasInterrupted = false;
      return historyContext ? `${historyContext}

User: ${injectedPrompt}` : injectedPrompt;
    }
    if (!this.sessionId && conversationHistory && conversationHistory.length > 0) {
      const historyContext = buildContextFromHistory(conversationHistory);
      const lastUserMessage = getLastUserMessage(conversationHistory);
      const actualPrompt = stripCurrentNotePrefix(prompt);
      const shouldAppendPrompt = !lastUserMessage || lastUserMessage.content.trim() !== actualPrompt.trim();
      if (historyContext) {
        return shouldAppendPrompt ? `${historyContext}

User: ${injectedPrompt}` : historyContext;
      }
    }
    return injectedPrompt;
  }
  ensureSessionId() {
    if (!this.sessionId) {
      this.sessionId = (0, import_crypto.randomUUID)();
    }
    return this.sessionId;
  }
  getCustomEnv(copilotPath) {
    const customEnv = parseEnvironmentVariables(this.plugin.getActiveEnvironmentVariables());
    const env = {
      ...process.env,
      ...customEnv,
      PATH: getEnhancedPath(customEnv.PATH, copilotPath)
    };
    if (this.plugin.settings.githubToken) {
      env.COPILOT_GITHUB_TOKEN = this.plugin.settings.githubToken;
      env.GH_TOKEN = this.plugin.settings.githubToken;
      env.GITHUB_TOKEN = this.plugin.settings.githubToken;
    }
    return env;
  }
  async prewarmCapabilities() {
    const copilotPath = this.getCopilotPath();
    if (!copilotPath) {
      return;
    }
    await this.getCliCapabilities(copilotPath);
  }
  /** Returns true if CLI capabilities have been probed and cached (CLI is ready). */
  isCliReady() {
    const copilotPath = this.getCopilotPath();
    if (!copilotPath) return false;
    return this.cachedCapabilities.has(copilotPath);
  }
  getCliCapabilities(copilotPath) {
    const cached = this.cachedCapabilities.get(copilotPath);
    if (cached) {
      return Promise.resolve(cached);
    }
    const pending = this.capabilityProbePromises.get(copilotPath);
    if (pending) {
      return pending;
    }
    const probePromise = new Promise((resolve6) => {
      const probeShim = resolveCmdShim(copilotPath);
      const [probeCmd, probeArgs] = probeShim ? [probeShim[0], [probeShim[1], "--help", "all"]] : [copilotPath, ["--help", "all"]];
      (0, import_child_process.execFile)(probeCmd, probeArgs, {
        encoding: "utf8",
        env: this.getCustomEnv(copilotPath),
        timeout: CLI_CAPABILITY_PROBE_TIMEOUT_MS,
        // shell:true only needed as fallback when .cmd shim resolution fails
        shell: !probeShim && process.platform === "win32",
        windowsHide: true
      }, (error, stdout, stderr) => {
        const helpText = typeof stdout === "string" && stdout.trim().length > 0 ? stdout : typeof stderr === "string" ? stderr : "";
        const capabilities = detectCopilotCliCapabilities(helpText);
        if (error && helpText.length === 0) {
          resolve6(detectCopilotCliCapabilities(""));
          return;
        }
        resolve6(capabilities);
      });
    }).then((capabilities) => {
      this.cachedCapabilities.set(copilotPath, capabilities);
      this.capabilityProbePromises.delete(copilotPath);
      return capabilities;
    });
    this.capabilityProbePromises.set(copilotPath, probePromise);
    return probePromise;
  }
  addToolArgs(args, capabilities, queryOptions, skipAvailableTools = false) {
    var _a;
    const enableWebSearch = (_a = queryOptions == null ? void 0 : queryOptions.enableWebSearch) != null ? _a : this.plugin.settings.enableWebSearch;
    const finalTools = resolveCopilotAllowedTools(
      this.plugin.settings.permissionMode,
      queryOptions == null ? void 0 : queryOptions.allowedTools,
      queryOptions == null ? void 0 : queryOptions.planMode,
      enableWebSearch
    );
    if (skipAvailableTools) return;
    if (capabilities.availableTools && finalTools.length > 0) {
      args.push("--available-tools", ...finalTools);
    }
  }
  /** Lists account-available Antigravity models only when the selector requests them. */
  /**
   * Asks the installed CLI which models it can dispatch. Runs only when the user opens the
   * model picker, never on a timer, and stays local: `codex debug models` and `agy models`
   * are the CLIs' own listing commands. `claude` has no such command, so it is served from
   * the verified static aliases instead.
   */
  async listNativeProviderModels(provider) {
    const staticModels = getStaticProviderModels(provider);
    if (staticModels.length > 0) return [...staticModels];
    const discovery = {
      codex: ["debug", "models"],
      agy: ["models"]
    };
    const args = discovery[provider];
    if (!args) return [];
    const configuredPath = this.plugin.settings.providerCliPaths[provider] || "";
    const cliPath = findProviderCliPath(provider, configuredPath);
    if (!cliPath) throw new Error(`${provider} CLI not found`);
    return new Promise((resolve6, reject) => {
      (0, import_child_process.execFile)(cliPath, args, { cwd: this.getWorkingDirectory(), env: process.env, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve6(provider === "codex" ? parseCodexModels(stdout) : parseAgyModels(stdout));
      });
    });
  }
  async *query(prompt, _images, conversationHistory, queryOptions) {
    var _a;
    if (this.plugin.settings.selectedProvider !== "copilot") {
      yield* this.querySelectedProvider(prompt, conversationHistory, queryOptions);
      return;
    }
    const copilotPath = this.getCopilotPath();
    if (!copilotPath) {
      yield {
        type: "error",
        content: "Copilot CLI not configured. Please set the path in settings or install @github/copilot globally."
      };
      return;
    }
    const cwd = this.getWorkingDirectory();
    const capabilities = await this.getCliCapabilities(copilotPath);
    this.isAskUserQuestionSupported = !capabilities.noAskUser;
    const fullPrompt = this.buildPromptWithHistory(prompt, conversationHistory, cwd, queryOptions);
    const sessionId = this.ensureSessionId();
    const args = ["--no-color"];
    const useAllowAllTools = shouldUseCopilotAllowAllTools(
      this.plugin.settings.permissionMode,
      capabilities.allowAllTools,
      queryOptions
    );
    if (capabilities.noAskUser) {
      args.push("--no-ask-user");
    }
    if (useAllowAllTools) {
      args.push("--allow-all-tools");
    }
    if (capabilities.noCustomInstructions) {
      args.push("--no-custom-instructions");
    }
    if (capabilities.outputFormatJson) {
      args.push("--output-format", "json");
    }
    if (!(queryOptions == null ? void 0 : queryOptions.skipResume)) {
      args.push(...sessionArgs(capabilities, sessionId, this.sessionConfirmedByCli));
    }
    args.push("-p", fullPrompt, "-s");
    if (capabilities.stream) {
      args.push("--stream", "on");
    }
    const selectedModel = ((_a = queryOptions == null ? void 0 : queryOptions.model) == null ? void 0 : _a.trim()) || this.plugin.settings.model;
    if (capabilities.model && selectedModel && selectedModel !== "auto") {
      args.push("--model", selectedModel);
    }
    const thinkingBudget = this.plugin.settings.thinkingBudget;
    const budgetInfo = THINKING_BUDGETS.find((b) => b.value === thinkingBudget);
    if (capabilities.reasoningEffort && (budgetInfo == null ? void 0 : budgetInfo.cliValue)) {
      args.push("--reasoning-effort", budgetInfo.cliValue);
    }
    this.addToolArgs(args, capabilities, queryOptions, useAllowAllTools);
    this.abortController = new AbortController();
    try {
      const isPlanMode = (queryOptions == null ? void 0 : queryOptions.planMode) === true;
      let bufferedPlanText = "";
      let sawDone = false;
      for await (const chunk of this.spawnCopilot(copilotPath, args, this.getCustomEnv(copilotPath))) {
        if (chunk.type === "tool_use") {
          this.trackWriteEditOriginalContent(chunk.id, chunk.name, chunk.input);
        } else if (chunk.type === "tool_result") {
          this.finalizeWriteEditDiff(chunk.id, !!chunk.isError);
        }
        if (isPlanMode) {
          if (chunk.type === "text") {
            bufferedPlanText += chunk.content;
          }
          if (chunk.type === "done") {
            sawDone = true;
            continue;
          }
        }
        yield chunk;
      }
      if (isPlanMode) {
        const trimmedPlan = bufferedPlanText.trim();
        if (!this.wasInterrupted && trimmedPlan) {
          if (this.exitPlanModeCallback) {
            await this.exitPlanModeCallback(trimmedPlan);
          } else {
            yield { type: "text", content: bufferedPlanText };
          }
        }
        if (sawDone) {
          yield { type: "done" };
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      yield { type: "error", content: msg };
    } finally {
      this.abortController = null;
    }
  }
  /** Direct native CLI seam for the non-Copilot providers. One request owns one child. */
  async *querySelectedProvider(prompt, conversationHistory, queryOptions) {
    var _a, _b, _c, _d, _e, _f;
    const provider = this.plugin.settings.selectedProvider;
    const configuredPath = this.plugin.settings.providerCliPaths[provider] || "";
    const cliPath = findProviderCliPath(provider, configuredPath);
    if (!cliPath) {
      yield { type: "error", content: `${provider} CLI not found. Open Settings to complete setup.` };
      return;
    }
    const fullPrompt = this.buildPromptWithHistory(prompt, conversationHistory, this.getWorkingDirectory(), queryOptions);
    const selection = resolveNativeSelection(this.plugin.settings, queryOptions == null ? void 0 : queryOptions.model);
    const mode = this.plugin.settings.permissionMode;
    const wantsReadOnly = mode === "ask" || mode === "plan" || Boolean(queryOptions == null ? void 0 : queryOptions.planMode);
    const acknowledged = this.plugin.settings.blanketWriteAcknowledged;
    const needsConsent = writesWithoutAsking(provider) && !(Array.isArray(acknowledged) && acknowledged.includes(provider));
    const permissionMode = wantsReadOnly && supportsReadOnlyMode(provider) || needsConsent ? "ask" : "agent";
    const notice = needsConsent && !wantsReadOnly ? `${provider}\uC5D0 \uD30C\uC77C\uC744 \uACE0\uCE60 \uAD8C\uD55C\uC744 \uC8FC\uB824\uBA74 Ask/Agent \uD1A0\uAE00\uC744 \uB20C\uB7EC \uD655\uC778\uD574 \uC8FC\uC138\uC694. \uC9C0\uAE08\uC740 \uC77D\uAE30 \uC804\uC6A9\uC73C\uB85C \uC2E4\uD589\uD569\uB2C8\uB2E4.` : wantsReadOnly && !supportsReadOnlyMode(provider) ? `${provider}\uB294 \uC77D\uAE30 \uC804\uC6A9\uC73C\uB85C \uC81C\uD55C\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uD30C\uC77C\uC744 \uACE0\uCE60 \uC218 \uC788\uB294 \uC0C1\uD0DC\uB85C \uC2E4\uD589\uD569\uB2C8\uB2E4.` : "";
    if (notice && this.shownPermissionNotices.get(provider) !== notice) {
      this.shownPermissionNotices.set(provider, notice);
      (_a = this.onPermissionNotice) == null ? void 0 : _a.call(this, notice);
    }
    const native = buildNativeProviderCommand(provider, fullPrompt, selection.model, selection.effort, permissionMode);
    const cmdShim = resolveCmdShim(cliPath);
    const [command, args] = cmdShim ? [cmdShim[0], [cmdShim[1], ...native.args]] : [cliPath, native.args];
    let child;
    try {
      child = (0, import_child_process.spawn)(command, args, {
        cwd: this.getWorkingDirectory(),
        // Do not pass the legacy Copilot token setting to another provider.
        env: (() => {
          const customEnv = parseEnvironmentVariables(this.plugin.getActiveEnvironmentVariables());
          return {
            ...process.env,
            ...customEnv,
            PATH: getEnhancedPath(customEnv.PATH, cliPath)
          };
        })(),
        stdio: ["pipe", "pipe", "pipe"],
        shell: !cmdShim && process.platform === "win32",
        // No console window should flash on a student's screen per request.
        windowsHide: true
      });
    } catch (error) {
      yield { type: "error", content: `Failed to start ${provider} CLI: ${error instanceof Error ? error.message : String(error)}` };
      return;
    }
    this.currentProcess = child;
    const pending = [];
    let lineBuffer = "";
    let errorOutput = "";
    let exitCode = null;
    let closeSignal = null;
    let closed = false;
    let wake = null;
    const signal = () => {
      const resume = wake;
      wake = null;
      resume == null ? void 0 : resume();
    };
    (_b = child.stdout) == null ? void 0 : _b.on("data", (data) => {
      var _a2;
      lineBuffer += data.toString();
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = (_a2 = lines.pop()) != null ? _a2 : "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const chunk = this.parseNativeProviderLine(provider, trimmed);
        if (chunk) pending.push(chunk);
      }
      signal();
    });
    (_c = child.stderr) == null ? void 0 : _c.on("data", (data) => {
      errorOutput += data.toString();
    });
    child.on("close", (code, receivedSignal) => {
      exitCode = code;
      closeSignal = receivedSignal;
      closed = true;
      signal();
    });
    child.on("error", (error) => {
      errorOutput = error.message;
      exitCode = 1;
      closed = true;
      signal();
    });
    (_d = child.stdin) == null ? void 0 : _d.end();
    try {
      for (; ; ) {
        while (pending.length) yield pending.shift();
        if (closed) break;
        await new Promise((resolve6) => {
          if (closed || pending.length) {
            resolve6();
            return;
          }
          wake = resolve6;
        });
      }
      const tail = lineBuffer.trim();
      if (tail) {
        const chunk = this.parseNativeProviderLine(provider, tail);
        if (chunk) yield chunk;
      }
      if (!this.wasInterrupted && exitCode === 0) {
        (_e = this.onOutcome) == null ? void 0 : _e.call(this, provider, "ok");
      }
      if (!this.wasInterrupted && exitCode !== 0) {
        (_f = this.onOutcome) == null ? void 0 : _f.call(this, provider, "failed");
        yield {
          type: "error",
          content: errorOutput.trim() || (closeSignal ? `${provider} CLI was terminated (${closeSignal}).` : `${provider} CLI exited with code ${exitCode}.`)
        };
      }
      yield { type: "done" };
    } finally {
      if (!closed) child.kill("SIGTERM");
      if (this.currentProcess === child) this.currentProcess = null;
    }
  }
  parseNativeProviderLine(provider, line) {
    if (provider === "agy") return { type: "text", content: line + "\n" };
    try {
      const event = JSON.parse(line);
      if (provider === "claude") {
        const delta = event.delta;
        if (delta && typeof delta.text === "string") return { type: "text", content: delta.text };
        const message = event.message;
        const content = message == null ? void 0 : message.content;
        if (Array.isArray(content)) {
          const text = content.map((item) => item && typeof item === "object" && typeof item.text === "string" ? item.text : "").join("");
          return text ? { type: "text", content: text } : null;
        }
      }
      if (provider === "codex") {
        const item = event.item;
        if (item && typeof item.text === "string") return { type: "text", content: item.text };
        if (typeof event.text === "string") return { type: "text", content: event.text };
      }
    } catch (e) {
      return { type: "text", content: line + "\n" };
    }
    return null;
  }
  async *spawnCopilot(command, args, env) {
    var _a, _b;
    const cwd = this.getWorkingDirectory();
    const cmdShim = resolveCmdShim(command);
    const [spawnCmd, spawnArgs] = cmdShim ? [cmdShim[0], [cmdShim[1], ...args]] : [command, args];
    let child;
    try {
      child = (0, import_child_process.spawn)(spawnCmd, spawnArgs, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        shell: !cmdShim && process.platform === "win32",
        // No console window should flash on a student's screen per request.
        windowsHide: true
      });
    } catch (spawnErr) {
      yield {
        type: "error",
        content: `Failed to start Copilot CLI: ${spawnErr instanceof Error ? spawnErr.message : spawnErr}
(command: ${command}, cwd: ${cwd})`
      };
      return;
    }
    this.currentProcess = child;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const chunks = [];
    let resolveWait = null;
    let done = false;
    (_a = child.stdout) == null ? void 0 : _a.on("data", (data) => {
      var _a2;
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = (_a2 = lines.pop()) != null ? _a2 : "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parsed = this.parseCopilotEvent(trimmed);
        if (!parsed) {
          chunks.push({ type: "text", content: line + "\n" });
          continue;
        }
        for (const chunk of this.translateCopilotEvent(parsed)) {
          chunks.push(chunk);
        }
      }
      resolveWait == null ? void 0 : resolveWait();
    });
    (_b = child.stderr) == null ? void 0 : _b.on("data", (data) => {
      stderrBuffer += data.toString();
    });
    child.on("close", (code) => {
      var _a2;
      done = true;
      const trailing = stdoutBuffer.trim();
      if (trailing) {
        const parsed = this.parseCopilotEvent(trailing);
        if (parsed) {
          for (const chunk of this.translateCopilotEvent(parsed)) {
            chunks.push(chunk);
          }
        } else {
          chunks.push({ type: "text", content: stdoutBuffer });
        }
      }
      const sawErrorChunk = chunks.some((chunk) => chunk.type === "error");
      (_a2 = this.onOutcome) == null ? void 0 : _a2.call(this, "copilot", copilotRequestOutcome(code, stderrBuffer, sawErrorChunk));
      if (code !== 0 && stderrBuffer.trim()) {
        chunks.push({
          type: "error",
          content: classifyCopilotFailure(stderrBuffer.trim()).message
        });
      }
      resolveWait == null ? void 0 : resolveWait();
    });
    child.on("error", (err) => {
      done = true;
      chunks.push({
        type: "error",
        content: `Failed to start Copilot CLI: ${err.message}`
      });
      resolveWait == null ? void 0 : resolveWait();
    });
    try {
      while (!done || chunks.length > 0) {
        if (chunks.length > 0) {
          const chunk = chunks.shift();
          if (chunk) {
            yield chunk;
          }
          continue;
        }
        if (!done) {
          await new Promise((resolve6) => {
            resolveWait = resolve6;
          });
        }
      }
    } finally {
      if (this.currentProcess === child) {
        if (!done) {
          child.kill("SIGTERM");
        }
        this.currentProcess = null;
      }
    }
    yield { type: "done" };
  }
  parseCopilotEvent(line) {
    try {
      return JSON.parse(line);
    } catch (e) {
      return null;
    }
  }
  /**
   * Tool names arrive as the CLI emits them. A CLI's own MCP tools already use the
   * `mcp__server__tool` shape the renderer detects; nothing is rewritten here.
   */
  normalizeMcpToolName(toolName) {
    return toolName;
  }
  translateCopilotEvent(event) {
    const chunks = translateCopilotJsonEvent(event, (sessionId) => {
      this.sessionId = sessionId;
      this.sessionConfirmedByCli = true;
    });
    for (const chunk of chunks) {
      if (chunk.type === "tool_use" && !chunk.name.startsWith("mcp__")) {
        chunk.name = this.normalizeMcpToolName(chunk.name);
      } else if (chunk.type === "tool_result" && chunk.toolName && !chunk.toolName.startsWith("mcp__")) {
        chunk.toolName = this.normalizeMcpToolName(chunk.toolName);
      }
    }
    if (chunks.some((c) => c.type === "tool_use" || c.type === "tool_result")) {
      console.log("[OC] Tool event:", event.type, chunks.map((c) => {
        var _a, _b;
        return `${c.type}:${(_b = (_a = c.name) != null ? _a : c.id) != null ? _b : ""}`;
      }));
    }
    return chunks;
  }
  cancel() {
    this.wasInterrupted = true;
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.currentProcess) {
      this.currentProcess.kill("SIGTERM");
      this.currentProcess = null;
    }
  }
  resetSession() {
    this.sessionId = null;
    this.sessionConfirmedByCli = false;
    this.wasInterrupted = false;
    this.askUserQuestionAnswers.clear();
    this.approvedPlanContent = null;
    this.currentPlanFilePath = null;
    this.clearDiffState();
  }
  getSessionId() {
    return this.sessionId;
  }
  setSessionId(id) {
    this.sessionId = id;
    this.wasInterrupted = false;
  }
  cleanup() {
    this.cancel();
    this.resetSession();
  }
  async *streamQuery(prompt, queryOptions) {
    for await (const chunk of this.query(prompt, void 0, void 0, queryOptions)) {
      if (chunk.type === "text") {
        yield chunk.content;
      } else if (chunk.type === "error") {
        throw new Error(chunk.content);
      }
    }
  }
  isAskUserQuestionToolSupported() {
    return this.isAskUserQuestionSupported;
  }
  setExitPlanModeCallback(callback) {
    this.exitPlanModeCallback = callback;
  }
  resolveVaultFilePath(filePath) {
    const normalizedPath = normalizePathForFilesystem(filePath);
    return path5.isAbsolute(normalizedPath) ? normalizedPath : path5.join(this.getWorkingDirectory(), normalizedPath);
  }
  trackWriteEditOriginalContent(toolUseId, toolName, toolInput) {
    if (!isWriteEditTool(toolName)) {
      return;
    }
    const rawPath = toolInput.file_path;
    const filePath = typeof rawPath === "string" && rawPath ? rawPath : null;
    if (!filePath) {
      return;
    }
    const fullPath = this.resolveVaultFilePath(filePath);
    try {
      if (fs5.existsSync(fullPath)) {
        const stats = fs5.statSync(fullPath);
        if (stats.size <= MAX_DIFF_SIZE) {
          const content = fs5.readFileSync(fullPath, "utf-8");
          this.originalContents.set(toolUseId, { filePath, content });
        } else {
          this.originalContents.set(toolUseId, { filePath, content: null, skippedReason: "too_large" });
        }
      } else {
        this.originalContents.set(toolUseId, { filePath, content: "" });
      }
    } catch (error) {
      console.warn("Failed to capture original file contents for diff:", fullPath, error);
      this.originalContents.set(toolUseId, { filePath, content: null, skippedReason: "unavailable" });
    }
  }
  finalizeWriteEditDiff(toolUseId, isError) {
    var _a;
    const originalEntry = this.originalContents.get(toolUseId);
    if (!originalEntry) {
      return;
    }
    const { filePath } = originalEntry;
    if (isError) {
      this.originalContents.delete(toolUseId);
      return;
    }
    const fullPath = this.resolveVaultFilePath(filePath);
    let diffData;
    if (originalEntry.content === null) {
      diffData = { filePath, skippedReason: (_a = originalEntry.skippedReason) != null ? _a : "unavailable" };
    } else {
      try {
        if (fs5.existsSync(fullPath)) {
          const stats = fs5.statSync(fullPath);
          if (stats.size <= MAX_DIFF_SIZE) {
            const newContent = fs5.readFileSync(fullPath, "utf-8");
            diffData = {
              filePath,
              originalContent: originalEntry.content,
              newContent
            };
          } else {
            diffData = { filePath, skippedReason: "too_large" };
          }
        } else {
          diffData = { filePath, skippedReason: "unavailable" };
        }
      } catch (error) {
        console.warn("Failed to capture updated file contents for diff:", fullPath, error);
        diffData = { filePath, skippedReason: "unavailable" };
      }
    }
    if (diffData) {
      this.pendingDiffData.set(toolUseId, diffData);
    }
    this.originalContents.delete(toolUseId);
  }
  getDiffData(toolUseId) {
    const data = this.pendingDiffData.get(toolUseId);
    if (data) {
      this.pendingDiffData.delete(toolUseId);
    }
    return data;
  }
  clearDiffState() {
    this.originalContents.clear();
    this.pendingDiffData.clear();
  }
  getAskUserQuestionAnswers(toolUseId) {
    const answers = this.askUserQuestionAnswers.get(toolUseId);
    if (answers) {
      this.askUserQuestionAnswers.delete(toolUseId);
    }
    return answers;
  }
  setApprovedPlanContent(content) {
    this.approvedPlanContent = content;
  }
  getApprovedPlanContent() {
    return this.approvedPlanContent;
  }
  clearApprovedPlanContent() {
    this.approvedPlanContent = null;
  }
  setCurrentPlanFilePath(planPath) {
    this.currentPlanFilePath = planPath;
  }
  getCurrentPlanFilePath() {
    return this.currentPlanFilePath;
  }
};

// src/core/images/imageCache.ts
var import_crypto2 = require("crypto");
var fs6 = __toESM(require("fs"));
var path6 = __toESM(require("path"));
init_path();
var IMAGE_CACHE_DIR = ".ocop-cache/images";
function ensureImageCacheDir(app) {
  const vaultPath = getVaultPath(app);
  if (!vaultPath) return null;
  const cacheDir = path6.join(vaultPath, IMAGE_CACHE_DIR);
  fs6.mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}
function saveImageToCache(app, buffer, mediaType, preferredName) {
  const cacheDir = ensureImageCacheDir(app);
  if (!cacheDir) return null;
  const hash = (0, import_crypto2.createHash)("sha256").update(buffer).digest("hex");
  const ext = getExtension(mediaType, preferredName);
  const filename = `${hash}${ext}`;
  const relPath = path6.posix.join(IMAGE_CACHE_DIR, filename);
  const absPath = path6.join(cacheDir, filename);
  if (!fs6.existsSync(absPath)) {
    fs6.writeFileSync(absPath, buffer);
  }
  return { relPath, absPath };
}
function readCachedImageBase64(app, relPath) {
  const absPath = getCacheAbsolutePath(app, relPath);
  if (!absPath) return null;
  try {
    const buffer = fs6.readFileSync(absPath);
    return buffer.toString("base64");
  } catch (e) {
    return null;
  }
}
function deleteCachedImages(app, relPaths) {
  const seen = /* @__PURE__ */ new Set();
  for (const relPath of relPaths) {
    const normalized = normalizeCacheRelPath(relPath);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const absPath = getCacheAbsolutePath(app, normalized);
    if (absPath && fs6.existsSync(absPath)) {
      try {
        fs6.unlinkSync(absPath);
      } catch (e) {
      }
    }
  }
}
function getCacheAbsolutePath(app, relPath) {
  const vaultPath = getVaultPath(app);
  if (!vaultPath) return null;
  const normalizedRel = normalizeCacheRelPath(relPath);
  if (!normalizedRel) return null;
  const absPath = path6.resolve(vaultPath, normalizedRel);
  const cacheRoot = path6.resolve(vaultPath, IMAGE_CACHE_DIR);
  if (!absPath.startsWith(cacheRoot)) {
    return null;
  }
  return absPath;
}
function normalizeCacheRelPath(relPath) {
  if (!relPath) return null;
  const normalized = relPath.replace(/\\/g, "/");
  if (path6.isAbsolute(normalized)) return null;
  if (!normalized.startsWith(IMAGE_CACHE_DIR)) return null;
  return normalized;
}
function getExtension(mediaType, preferredName) {
  if (preferredName) {
    const ext = path6.extname(preferredName);
    if (ext) return ext;
  }
  const subtype = mediaType.split("/")[1] || "png";
  return `.${subtype === "jpeg" ? "jpg" : subtype}`;
}

// src/main.ts
init_providerRegistry();
init_providerConnection();

// src/core/storage/SessionStorage.ts
var SESSIONS_PATH = ".copilot/sessions";
function buildConversationPreview(messages) {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim().length > 0);
  if (!firstUserMessage) {
    return "New conversation";
  }
  const content = firstUserMessage.content;
  return content.substring(0, 50) + (content.length > 50 ? "..." : "");
}
var SessionStorage = class {
  constructor(adapter) {
    this.adapter = adapter;
  }
  /** Load a conversation from its JSONL file. */
  async loadConversation(id) {
    const filePath = this.getFilePath(id);
    try {
      if (!await this.adapter.exists(filePath)) {
        return null;
      }
      const content = await this.adapter.read(filePath);
      return this.parseJSONL(content);
    } catch (error) {
      console.error(`[ObsidianCopilot] Failed to load conversation ${id}:`, error);
      return null;
    }
  }
  /** Save a conversation to its JSONL file. */
  async saveConversation(conversation) {
    const filePath = this.getFilePath(conversation.id);
    const content = this.serializeToJSONL(conversation);
    await this.adapter.write(filePath, content);
  }
  /** Delete a conversation's JSONL file. */
  async deleteConversation(id) {
    const filePath = this.getFilePath(id);
    await this.adapter.delete(filePath);
  }
  /** List all conversation metadata (without loading full messages). */
  async listConversations() {
    const metas = [];
    try {
      const files = await this.adapter.listFiles(SESSIONS_PATH);
      for (const filePath of files) {
        if (!filePath.endsWith(".jsonl")) continue;
        try {
          const meta = await this.loadMetaOnly(filePath);
          if (meta) {
            metas.push(meta);
          }
        } catch (error) {
          console.error(`[ObsidianCopilot] Failed to load meta from ${filePath}:`, error);
        }
      }
      metas.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
      console.error("[ObsidianCopilot] Failed to list sessions:", error);
    }
    return metas;
  }
  /** Load all conversations (full data). */
  async loadAllConversations() {
    const conversations = [];
    try {
      const files = await this.adapter.listFiles(SESSIONS_PATH);
      for (const filePath of files) {
        if (!filePath.endsWith(".jsonl")) continue;
        try {
          const content = await this.adapter.read(filePath);
          const conversation = this.parseJSONL(content);
          if (conversation) {
            conversations.push(conversation);
          }
        } catch (error) {
          console.error(`[ObsidianCopilot] Failed to load conversation from ${filePath}:`, error);
        }
      }
      conversations.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
      console.error("[ObsidianCopilot] Failed to load all conversations:", error);
    }
    return conversations;
  }
  /** Check if any sessions exist. */
  async hasSessions() {
    const files = await this.adapter.listFiles(SESSIONS_PATH);
    return files.some((f) => f.endsWith(".jsonl"));
  }
  /** Get the file path for a conversation. */
  getFilePath(id) {
    return `${SESSIONS_PATH}/${id}.jsonl`;
  }
  /** Load only metadata from a session file (first line). */
  async loadMetaOnly(filePath) {
    const content = await this.adapter.read(filePath);
    const firstLine = content.split(/\r?\n/)[0];
    if (!firstLine) return null;
    try {
      const record = JSON.parse(firstLine);
      if (record.type !== "meta") return null;
      let messageCount = record.messageCount;
      let preview = record.preview;
      if (messageCount === void 0 || preview === void 0) {
        const lines = content.split(/\r?\n/).filter((l) => l.trim());
        const parsedMessages = [];
        for (let i = 1; i < lines.length; i++) {
          try {
            const msgRecord = JSON.parse(lines[i]);
            if (msgRecord.type === "message") {
              parsedMessages.push(msgRecord.message);
            }
          } catch (e) {
            continue;
          }
        }
        messageCount = parsedMessages.length;
        preview = buildConversationPreview(parsedMessages);
      }
      return {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        lastResponseAt: record.lastResponseAt,
        messageCount: messageCount != null ? messageCount : 0,
        preview: preview != null ? preview : "New conversation",
        titleGenerationStatus: record.titleGenerationStatus
      };
    } catch (e) {
      return null;
    }
  }
  /** Parse JSONL content into a Conversation object. */
  parseJSONL(content) {
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return null;
    let meta = null;
    const messages = [];
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (record.type === "meta") {
          meta = record;
        } else if (record.type === "message") {
          messages.push(record.message);
        }
      } catch (error) {
        console.warn("[ObsidianCopilot] Failed to parse JSONL line (skipped):", line.substring(0, 100), error);
      }
    }
    if (!meta) return null;
    return {
      id: meta.id,
      title: meta.title,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      lastResponseAt: meta.lastResponseAt,
      sessionId: meta.sessionId,
      messages,
      currentNote: meta.currentNote,
      externalContextPaths: meta.externalContextPaths,
      usage: meta.usage,
      approvedPlan: meta.approvedPlan,
      pendingPlanContent: meta.pendingPlanContent,
      isInPlanMode: meta.isInPlanMode,
      titleGenerationStatus: meta.titleGenerationStatus,
      quizSession: meta.quizSession,
      socraticSession: meta.socraticSession
    };
  }
  /** Serialize a Conversation to JSONL format. */
  serializeToJSONL(conversation) {
    const lines = [];
    const meta = {
      type: "meta",
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastResponseAt: conversation.lastResponseAt,
      sessionId: conversation.sessionId,
      messageCount: conversation.messages.length,
      preview: buildConversationPreview(conversation.messages),
      currentNote: conversation.currentNote,
      externalContextPaths: conversation.externalContextPaths,
      usage: conversation.usage,
      approvedPlan: conversation.approvedPlan,
      pendingPlanContent: conversation.pendingPlanContent,
      isInPlanMode: conversation.isInPlanMode,
      titleGenerationStatus: conversation.titleGenerationStatus,
      quizSession: conversation.quizSession,
      socraticSession: conversation.socraticSession
    };
    lines.push(JSON.stringify(meta));
    for (const message of conversation.messages) {
      const storedMessage = this.prepareMessageForStorage(message);
      const record = {
        type: "message",
        message: storedMessage
      };
      lines.push(JSON.stringify(record));
    }
    return lines.join("\n");
  }
  /** Prepare a message for storage (strip image data). */
  prepareMessageForStorage(message) {
    if (!message.images || message.images.length === 0) {
      return message;
    }
    const strippedImages = message.images.map((img) => {
      if (!img.cachePath && !img.filePath) {
        return img;
      }
      const { data: _, ...rest } = img;
      return rest;
    });
    return {
      ...message,
      images: strippedImages
    };
  }
};

// src/core/storage/SettingsStorage.ts
var SETTINGS_PATH = ".copilot/settings.json";
function normalizeCommandList(value, fallback) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter((item) => item.length > 0);
}
function normalizeBlockedCommands(value) {
  const defaults = getDefaultBlockedCommands();
  if (Array.isArray(value)) {
    return {
      unix: normalizeCommandList(value, defaults.unix),
      windows: [...defaults.windows]
    };
  }
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const candidate = value;
  return {
    unix: normalizeCommandList(candidate.unix, defaults.unix),
    windows: normalizeCommandList(candidate.windows, defaults.windows)
  };
}
var SettingsStorage = class {
  constructor(adapter) {
    this.adapter = adapter;
  }
  /** Load settings from .copilot/settings.json, merging with defaults. */
  async load() {
    try {
      if (!await this.adapter.exists(SETTINGS_PATH)) {
        return this.getDefaults();
      }
      const content = await this.adapter.read(SETTINGS_PATH);
      const stored = JSON.parse(content);
      const blockedCommands = normalizeBlockedCommands(stored.blockedCommands);
      return {
        ...this.getDefaults(),
        ...stored,
        blockedCommands
      };
    } catch (error) {
      console.error("[ObsidianCopilot] Failed to load settings:", error);
      return this.getDefaults();
    }
  }
  /** Save settings to .copilot/settings.json. */
  async save(settings) {
    try {
      const content = JSON.stringify(settings, null, 2);
      await this.adapter.write(SETTINGS_PATH, content);
    } catch (error) {
      console.error("[ObsidianCopilot] Failed to save settings:", error);
      throw error;
    }
  }
  /** Check if settings file exists. */
  async exists() {
    return this.adapter.exists(SETTINGS_PATH);
  }
  /** Get default settings (excluding state fields). */
  getDefaults() {
    const {
      slashCommands: _,
      lastEnvHash: __,
      ...defaults
    } = DEFAULT_SETTINGS;
    return defaults;
  }
};

// src/core/storage/SlashCommandStorage.ts
var fs7 = __toESM(require("fs"));
var os3 = __toESM(require("os"));
var path7 = __toESM(require("path"));

// src/utils/slashCommand.ts
function formatSlashCommandWarnings(errors) {
  const maxItems = 3;
  const head = errors.slice(0, maxItems);
  const more = errors.length > maxItems ? `
...and ${errors.length - maxItems} more` : "";
  return `Slash command expansion warnings:
- ${head.join("\n- ")}${more}`;
}
function parseSlashCommandContent(content) {
  const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = content.match(frontmatterPattern);
  if (!match) {
    return { promptContent: content };
  }
  const yamlContent = match[1];
  const promptContent = match[2];
  const result = { promptContent };
  const lines = yamlContent.split(/\r?\n/);
  let arrayKey = null;
  let arrayItems = [];
  const flushArray = () => {
    if (arrayKey === "allowed-tools") {
      result.allowedTools = arrayItems;
    }
    arrayKey = null;
    arrayItems = [];
  };
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (arrayKey) {
      if (trimmedLine.startsWith("- ")) {
        arrayItems.push(unquoteYamlString(trimmedLine.slice(2).trim()));
        continue;
      }
      if (trimmedLine === "") {
        continue;
      }
      flushArray();
    }
    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) {
      continue;
    }
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    switch (key) {
      case "description":
        result.description = unquoteYamlString(value);
        break;
      case "argument-hint":
        result.argumentHint = unquoteYamlString(value);
        break;
      case "model":
        result.model = unquoteYamlString(value);
        break;
      case "allowed-tools":
        if (!value) {
          arrayKey = key;
          arrayItems = [];
          break;
        }
        if (value.startsWith("[") && value.endsWith("]")) {
          result.allowedTools = value.slice(1, -1).split(",").map((s) => unquoteYamlString(s.trim())).filter(Boolean);
          break;
        }
        result.allowedTools = [unquoteYamlString(value)].filter(Boolean);
        break;
    }
  }
  if (arrayKey) {
    flushArray();
  }
  return result;
}
function unquoteYamlString(value) {
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

// src/core/storage/SlashCommandStorage.ts
var COMMANDS_PATH = ".copilot/commands";
var GLOBAL_COMMANDS_PATH = path7.join(os3.homedir(), ".copilot", "commands");
var INSTALLED_PLUGINS_PATH = path7.join(os3.homedir(), ".copilot", "plugins", "installed_plugins.json");
var SlashCommandStorage = class {
  constructor(adapter) {
    this.adapter = adapter;
  }
  async loadAll() {
    const pluginCommands = this.loadAllFromPlugins();
    const globalCommands = this.loadAllFromGlobal();
    const vaultCommands = [];
    try {
      const files = await this.adapter.listFilesRecursive(COMMANDS_PATH);
      for (const filePath of files) {
        if (!filePath.endsWith(".md")) continue;
        try {
          const command = await this.loadFromFile(filePath);
          if (command) {
            vaultCommands.push(command);
          }
        } catch (error) {
          console.error(`[ObsidianCopilot] Failed to load command from ${filePath}:`, error);
        }
      }
    } catch (error) {
      console.error("[ObsidianCopilot] Failed to list vault command files:", error);
    }
    const vaultNames = new Set(vaultCommands.map((command) => command.name));
    const globalNames = new Set(globalCommands.map((command) => command.name));
    return [
      ...pluginCommands.filter((command) => !globalNames.has(command.name) && !vaultNames.has(command.name)),
      ...globalCommands.filter((command) => !vaultNames.has(command.name)),
      ...vaultCommands
    ];
  }
  loadAllFromGlobal() {
    const commands = [];
    if (!fs7.existsSync(GLOBAL_COMMANDS_PATH)) {
      return commands;
    }
    try {
      const files = this.listFilesRecursiveSync(GLOBAL_COMMANDS_PATH);
      for (const filePath of files) {
        if (!filePath.endsWith(".md")) continue;
        try {
          const content = fs7.readFileSync(filePath, "utf-8");
          const relativePath = path7.relative(GLOBAL_COMMANDS_PATH, filePath);
          const command = this.parseFileFromGlobal(content, relativePath);
          if (command) {
            commands.push(command);
          }
        } catch (error) {
          console.error(`[ObsidianCopilot] Failed to load global command from ${filePath}:`, error);
        }
      }
    } catch (error) {
      console.error("[ObsidianCopilot] Failed to list global command files:", error);
    }
    return commands;
  }
  loadAllFromPlugins() {
    const commands = [];
    if (!fs7.existsSync(INSTALLED_PLUGINS_PATH)) {
      return commands;
    }
    try {
      const content = fs7.readFileSync(INSTALLED_PLUGINS_PATH, "utf-8");
      const pluginsFile = JSON.parse(content);
      if (!pluginsFile.plugins || typeof pluginsFile.plugins !== "object") {
        return commands;
      }
      for (const [pluginId, installations] of Object.entries(pluginsFile.plugins)) {
        if (!Array.isArray(installations) || installations.length === 0) continue;
        const installation = installations[0];
        if (!installation.installPath) continue;
        const commandsDir = path7.join(installation.installPath, "commands");
        if (!fs7.existsSync(commandsDir)) continue;
        const files = this.listFilesRecursiveSync(commandsDir);
        for (const filePath of files) {
          if (!filePath.endsWith(".md")) continue;
          try {
            const fileContent = fs7.readFileSync(filePath, "utf-8");
            const relativePath = path7.relative(commandsDir, filePath);
            const command = this.parseFileFromPlugin(fileContent, relativePath, pluginId);
            if (command) {
              commands.push(command);
            }
          } catch (error) {
            console.error(`[ObsidianCopilot] Failed to load plugin command from ${filePath}:`, error);
          }
        }
      }
    } catch (error) {
      console.error("[ObsidianCopilot] Failed to load plugin commands:", error);
    }
    return commands;
  }
  parseFileFromPlugin(content, relativePath, pluginId) {
    const parsed = parseSlashCommandContent(content);
    const name = relativePath.replace(/\.md$/, "");
    const pluginName = pluginId.split("@")[0];
    const id = `plugin-${pluginName}-${name.replace(/-/g, "-_").replace(/\//g, "--")}`;
    return {
      id,
      name,
      description: parsed.description ? `[${pluginName}] ${parsed.description}` : `[${pluginName}]`,
      argumentHint: parsed.argumentHint,
      allowedTools: parsed.allowedTools,
      model: parsed.model,
      content: parsed.promptContent
    };
  }
  listFilesRecursiveSync(dir) {
    const files = [];
    const processDir = (currentDir) => {
      if (!fs7.existsSync(currentDir)) return;
      const entries = fs7.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path7.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          processDir(fullPath);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    };
    processDir(dir);
    return files;
  }
  parseFileFromGlobal(content, relativePath) {
    const parsed = parseSlashCommandContent(content);
    const name = relativePath.replace(/\.md$/, "");
    const id = `global-cmd-${name.replace(/-/g, "-_").replace(/\//g, "--")}`;
    return {
      id,
      name,
      description: parsed.description,
      argumentHint: parsed.argumentHint,
      allowedTools: parsed.allowedTools,
      model: parsed.model,
      content: parsed.promptContent
    };
  }
  async loadFromFile(filePath) {
    try {
      const content = await this.adapter.read(filePath);
      return this.parseFile(content, filePath);
    } catch (error) {
      console.error(`[ObsidianCopilot] Failed to read command file ${filePath}:`, error);
      return null;
    }
  }
  async save(command) {
    const filePath = this.getFilePath(command);
    const content = this.serializeCommand(command);
    await this.adapter.write(filePath, content);
  }
  async delete(commandId) {
    const files = await this.adapter.listFilesRecursive(COMMANDS_PATH);
    for (const filePath of files) {
      if (!filePath.endsWith(".md")) continue;
      const id = this.filePathToId(filePath);
      if (id === commandId) {
        await this.adapter.delete(filePath);
        return;
      }
    }
  }
  async hasCommands() {
    const files = await this.adapter.listFilesRecursive(COMMANDS_PATH);
    return files.some((filePath) => filePath.endsWith(".md"));
  }
  getFilePath(command) {
    const safeName = command.name.replace(/[^a-zA-Z0-9_/-]/g, "-");
    return `${COMMANDS_PATH}/${safeName}.md`;
  }
  parseFile(content, filePath) {
    const parsed = parseSlashCommandContent(content);
    const id = this.filePathToId(filePath);
    const name = this.filePathToName(filePath);
    return {
      id,
      name,
      description: parsed.description,
      argumentHint: parsed.argumentHint,
      allowedTools: parsed.allowedTools,
      model: parsed.model,
      content: parsed.promptContent
    };
  }
  filePathToId(filePath) {
    const relativePath = filePath.replace(`${COMMANDS_PATH}/`, "").replace(/\.md$/, "");
    const escaped = relativePath.replace(/-/g, "-_").replace(/\//g, "--");
    return `cmd-${escaped}`;
  }
  filePathToName(filePath) {
    return filePath.replace(`${COMMANDS_PATH}/`, "").replace(/\.md$/, "");
  }
  serializeCommand(command) {
    const lines = ["---"];
    if (command.description) {
      lines.push(`description: ${this.yamlString(command.description)}`);
    }
    if (command.argumentHint) {
      lines.push(`argument-hint: ${this.yamlString(command.argumentHint)}`);
    }
    if (command.allowedTools && command.allowedTools.length > 0) {
      lines.push("allowed-tools:");
      for (const tool of command.allowedTools) {
        lines.push(`  - ${tool}`);
      }
    }
    if (command.model) {
      lines.push(`model: ${command.model}`);
    }
    lines.push("---");
    const parsed = parseSlashCommandContent(command.content);
    lines.push(parsed.promptContent);
    return lines.join("\n");
  }
  yamlString(value) {
    if (value.includes(":") || value.includes("#") || value.includes("\n") || value.startsWith(" ") || value.endsWith(" ")) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
};

// src/core/storage/VaultFileAdapter.ts
var VaultFileAdapter = class {
  constructor(app) {
    this.app = app;
  }
  /** Check if a file or folder exists. */
  async exists(path16) {
    return this.app.vault.adapter.exists(path16);
  }
  /** Read file contents as string. */
  async read(path16) {
    return this.app.vault.adapter.read(path16);
  }
  /** Write content to a file, creating parent directories if needed. */
  async write(path16, content) {
    const folder = path16.substring(0, path16.lastIndexOf("/"));
    if (folder && !await this.exists(folder)) {
      await this.ensureFolder(folder);
    }
    await this.app.vault.adapter.write(path16, content);
  }
  /** Append content to a file. Creates the file if it doesn't exist. */
  async append(path16, content) {
    const folder = path16.substring(0, path16.lastIndexOf("/"));
    if (folder && !await this.exists(folder)) {
      await this.ensureFolder(folder);
    }
    if (await this.exists(path16)) {
      const existing = await this.read(path16);
      await this.app.vault.adapter.write(path16, existing + content);
    } else {
      await this.app.vault.adapter.write(path16, content);
    }
  }
  /** Delete a file if it exists. */
  async delete(path16) {
    if (await this.exists(path16)) {
      await this.app.vault.adapter.remove(path16);
    }
  }
  /** List files in a folder. Returns relative paths from the folder. */
  async listFiles(folder) {
    if (!await this.exists(folder)) {
      return [];
    }
    const listing = await this.app.vault.adapter.list(folder);
    return listing.files;
  }
  /** List subfolders in a folder. Returns relative paths from the folder. */
  async listFolders(folder) {
    if (!await this.exists(folder)) {
      return [];
    }
    const listing = await this.app.vault.adapter.list(folder);
    return listing.folders;
  }
  /** Recursively list all files in a folder and subfolders. */
  async listFilesRecursive(folder) {
    const allFiles = [];
    const processFolder = async (currentFolder) => {
      if (!await this.exists(currentFolder)) return;
      const listing = await this.app.vault.adapter.list(currentFolder);
      allFiles.push(...listing.files);
      for (const subfolder of listing.folders) {
        await processFolder(subfolder);
      }
    };
    await processFolder(folder);
    return allFiles;
  }
  /** Ensure a folder exists, creating it and parent folders if needed. */
  async ensureFolder(path16) {
    if (await this.exists(path16)) return;
    const parts = path16.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!await this.exists(current)) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }
  /** Rename/move a file. */
  async rename(oldPath, newPath) {
    await this.app.vault.adapter.rename(oldPath, newPath);
  }
  /** Get file stats (mtime, size). */
  async stat(path16) {
    try {
      const stat = await this.app.vault.adapter.stat(path16);
      if (!stat) return null;
      return { mtime: stat.mtime, size: stat.size };
    } catch (e) {
      return null;
    }
  }
};

// src/core/storage/StorageService.ts
var COPILOT_PATH = ".copilot";
var DEFAULT_STATE = {
  activeConversationId: null
};
var StorageService = class {
  constructor(plugin) {
    /** Tail of the serialised data.json write chain; see updateState. */
    this.stateWrites = Promise.resolve();
    this.plugin = plugin;
    this.app = plugin.app;
    this.adapter = new VaultFileAdapter(this.app);
    this.settings = new SettingsStorage(this.adapter);
    this.commands = new SlashCommandStorage(this.adapter);
    this.sessions = new SessionStorage(this.adapter);
  }
  /** Initialize storage, running migration if needed. */
  async initialize() {
    await this.ensureDirectories();
    const settingsExist = await this.settings.exists();
    const legacyData = await this.loadLegacyData();
    if (legacyData && this.needsMigration(legacyData)) {
      console.log("[ObsidianCopilot] Migrating from legacy data.json to distributed storage...");
      const migrated = await this.runMigration(legacyData, { migrateSettings: !settingsExist });
      if (migrated) {
        console.log("[ObsidianCopilot] Migration complete.");
      } else {
        console.warn("[ObsidianCopilot] Migration incomplete; will retry on next launch.");
      }
    }
    const settings = await this.settings.load();
    const state = await this.loadState();
    return { settings, state };
  }
  /** Check if migration is needed. */
  needsMigration(legacyData) {
    if (!legacyData) return false;
    const hasConversations = legacyData.conversations && legacyData.conversations.length > 0;
    const hasSlashCommands = legacyData.slashCommands && legacyData.slashCommands.length > 0;
    const stateKeys = /* @__PURE__ */ new Set([
      "conversations",
      "slashCommands",
      "activeConversationId",
      "lastEnvHash",
      "migrationVersion"
    ]);
    const hasSettings = Object.keys(legacyData).some((key) => !stateKeys.has(key));
    return hasConversations || hasSlashCommands || hasSettings;
  }
  /** Run migration from legacy data.json to distributed storage. */
  async runMigration(legacyData, options = { migrateSettings: true }) {
    let hadErrors = false;
    if (options.migrateSettings) {
      try {
        await this.migrateSettings(legacyData);
      } catch (error) {
        hadErrors = true;
        console.error("[ObsidianCopilot] Failed to migrate settings:", error);
      }
    }
    if (await this.migrateSlashCommands(legacyData.slashCommands || [])) {
      hadErrors = true;
    }
    if (await this.migrateConversations(legacyData.conversations || [])) {
      hadErrors = true;
    }
    if (hadErrors) {
      return false;
    }
    await this.saveState({
      activeConversationId: legacyData.activeConversationId || null
    });
    return true;
  }
  /** Load legacy data from Obsidian's data.json. */
  async loadLegacyData() {
    try {
      const data = await this.plugin.loadData();
      return data || null;
    } catch (e) {
      return null;
    }
  }
  /** Load plugin state from data.json. */
  async loadState() {
    var _a, _b, _c;
    try {
      const data = await this.plugin.loadData();
      return {
        activeConversationId: (_a = data == null ? void 0 : data.activeConversationId) != null ? _a : DEFAULT_STATE.activeConversationId,
        providerConnections: (_b = data == null ? void 0 : data.providerConnections) != null ? _b : void 0,
        skillsAutoInstalled: (_c = data == null ? void 0 : data.skillsAutoInstalled) != null ? _c : void 0
      };
    } catch (e) {
      return { ...DEFAULT_STATE };
    }
  }
  /** Save plugin state to data.json. */
  async saveState(state) {
    await this.plugin.saveData(state);
  }
  /**
   * Update specific state fields in data.json.
   *
   * Serialised, because this is a read-modify-write and the settings tab now
   * checks four providers at once. Run in parallel, two updates both read the
   * state as it was before either wrote, and whichever saves last erases the
   * other one's verdict.
   */
  async updateState(updates) {
    const write = this.stateWrites.then(async () => {
      const current = await this.loadState();
      await this.saveState({ ...current, ...updates });
    });
    this.stateWrites = write.catch(() => void 0);
    return write;
  }
  /** Ensure all required directories exist. */
  async ensureDirectories() {
    await this.adapter.ensureFolder(COPILOT_PATH);
    await this.adapter.ensureFolder(COMMANDS_PATH);
    await this.adapter.ensureFolder(SESSIONS_PATH);
  }
  /** Migrate settings from legacy format. */
  async migrateSettings(legacyData) {
    const {
      slashCommands: _,
      conversations: __,
      activeConversationId: ___,
      lastEnvHash: ____,
      migrationVersion: _____,
      ...settingsFields
    } = legacyData;
    const settings = {
      ...this.getDefaultSettings(),
      ...settingsFields
    };
    await this.settings.save(settings);
  }
  /** Migrate slash commands to individual files. */
  async migrateSlashCommands(commands) {
    let hadErrors = false;
    for (const command of commands) {
      try {
        const filePath = this.commands.getFilePath(command);
        if (await this.adapter.exists(filePath)) {
          continue;
        }
        await this.commands.save(command);
      } catch (error) {
        hadErrors = true;
        console.error(`[ObsidianCopilot] Failed to migrate command ${command.name}:`, error);
      }
    }
    return hadErrors;
  }
  /** Migrate conversations to individual JSONL files. */
  async migrateConversations(conversations) {
    let hadErrors = false;
    for (const conversation of conversations) {
      try {
        const filePath = this.sessions.getFilePath(conversation.id);
        if (await this.adapter.exists(filePath)) {
          continue;
        }
        await this.sessions.saveConversation(conversation);
      } catch (error) {
        hadErrors = true;
        console.error(`[ObsidianCopilot] Failed to migrate conversation ${conversation.id}:`, error);
      }
    }
    return hadErrors;
  }
  /** Get default settings (excluding state fields and slashCommands). */
  getDefaultSettings() {
    const {
      slashCommands: _,
      lastEnvHash: __,
      ...defaults
    } = DEFAULT_SETTINGS;
    return defaults;
  }
  /** Get the vault file adapter for direct file operations. */
  getAdapter() {
    return this.adapter;
  }
};

// src/features/chat/ObsidianCopilotView.ts
var import_obsidian25 = require("obsidian");

// src/core/commands/SlashCommandManager.ts
var import_child_process4 = require("child_process");
init_env();
function isVaultFileCandidate(value) {
  return !!value && typeof value === "object" && "path" in value;
}
var SlashCommandManager = class {
  constructor(app, vaultPath, options = {}) {
    this.commands = /* @__PURE__ */ new Map();
    var _a;
    this.app = app;
    this.vaultPath = vaultPath;
    this.bashRunner = (_a = options.bashRunner) != null ? _a : defaultBashRunner;
  }
  /** Registers commands from settings. */
  setCommands(commands) {
    this.commands.clear();
    for (const cmd of commands) {
      this.commands.set(cmd.name.toLowerCase(), cmd);
    }
  }
  /** Gets all registered commands. */
  getCommands() {
    return Array.from(this.commands.values());
  }
  /** Gets a command by name. */
  getCommand(name) {
    return this.commands.get(name.toLowerCase());
  }
  /** Gets filtered commands matching a prefix. */
  getMatchingCommands(prefix) {
    const prefixLower = prefix.toLowerCase();
    return this.getCommands().filter(
      (cmd) => {
        var _a;
        return cmd.name.toLowerCase().includes(prefixLower) || ((_a = cmd.description) == null ? void 0 : _a.toLowerCase().includes(prefixLower));
      }
    ).slice(0, 10);
  }
  /**
   * Detects if input starts with a slash command.
   * Returns the command name and arguments if found.
   */
  detectCommand(input) {
    const trimmed = input.trimStart();
    if (!trimmed.startsWith("/")) return null;
    const match = trimmed.match(/^\/([a-zA-Z0-9_/-]+)(?:\s+([\s\S]*))?$/);
    if (!match) return null;
    const commandName = match[1];
    const args = (match[2] || "").trim();
    if (!this.commands.has(commandName.toLowerCase())) {
      return null;
    }
    return { commandName, args };
  }
  /**
   * Expands a command with arguments.
   * Processes frontmatter, placeholders, file references, and bash execution.
   */
  async expandCommand(command, args, options = {}) {
    const errors = [];
    const parsed = parseSlashCommandContent(command.content);
    let result = parsed.promptContent;
    result = this.replaceArgumentPlaceholders(result, args);
    try {
      const bashResult = await this.executeInlineBash(result, options.bash);
      result = bashResult.content;
      errors.push(...bashResult.errors);
    } catch (error) {
      errors.push(`Bash execution error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
    try {
      const fileResult = await this.resolveFileReferences(result);
      result = fileResult.content;
      errors.push(...fileResult.errors);
    } catch (error) {
      errors.push(`File reference error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
    return {
      expandedPrompt: result.trim(),
      allowedTools: command.allowedTools || parsed.allowedTools,
      model: command.model || parsed.model,
      errors
    };
  }
  /**
   * Replaces argument placeholders in content.
   * Handles $ARGUMENTS (all args) and $1, $2, etc. (positional).
   */
  replaceArgumentPlaceholders(content, args) {
    const argParts = this.parseArguments(args);
    const bashSentinel = "\uE000";
    const bashBlocks = [];
    const withoutBash = content.replace(/!`[^`]+`/g, (match) => {
      let block = match;
      block = block.replace(/\$ARGUMENTS/g, shellEscapeArgIfNeeded(args));
      for (let i = 0; i < argParts.length; i++) {
        const pattern = new RegExp(`\\$${i + 1}(?![0-9])`, "g");
        block = block.replace(pattern, shellEscapeArgIfNeeded(argParts[i]));
      }
      block = block.replace(/\$\d+/g, "");
      const idx = bashBlocks.length;
      bashBlocks.push(block);
      return `${bashSentinel}BASH${idx}${bashSentinel}`;
    });
    let result = withoutBash.replace(/\$ARGUMENTS/g, args);
    for (let i = 0; i < argParts.length; i++) {
      const pattern = new RegExp(`\\$${i + 1}(?![0-9])`, "g");
      result = result.replace(pattern, argParts[i]);
    }
    result = result.replace(/\$\d+/g, "");
    return result.replace(new RegExp(`${bashSentinel}BASH(\\d+)${bashSentinel}`, "g"), (_, idx) => bashBlocks[Number(idx)]);
  }
  /**
   * Parses arguments respecting quoted strings.
   * "arg with spaces" and 'single quotes' are treated as single args.
   */
  parseArguments(args) {
    var _a, _b;
    if (!args.trim()) return [];
    const parts = [];
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    let match = regex.exec(args);
    while (match !== null) {
      parts.push((_b = (_a = match[1]) != null ? _a : match[2]) != null ? _b : match[0]);
      match = regex.exec(args);
    }
    return parts;
  }
  /**
   * Resolves @file references in content.
   * Replaces @path/to/file.md with file contents.
   */
  async resolveFileReferences(content) {
    var _a;
    const pattern = /(^|[^\w])@(?:"([^"]+)"|'([^']+)'|([^\s]+\.\w+))/g;
    const errors = [];
    const matches = [];
    let match = pattern.exec(content);
    while (match !== null) {
      const prefix = (_a = match[1]) != null ? _a : "";
      const filePath = match[2] || match[3] || match[4];
      matches.push({ full: match[0], prefix, path: filePath, index: match.index });
      match = pattern.exec(content);
    }
    const resolved = await Promise.all(matches.map(async (m) => {
      try {
        const normalizedPath = m.path.replace(/\\/g, "/");
        const file = this.resolveVaultFile(normalizedPath);
        if (!isVaultFileCandidate(file)) {
          return {
            ...m,
            replacement: null,
            error: `File reference not found: ${normalizedPath}`
          };
        }
        const fileContent = await this.app.vault.read(file);
        return {
          ...m,
          replacement: `${m.prefix}${fileContent}`,
          error: null
        };
      } catch (error) {
        return {
          ...m,
          replacement: null,
          error: `File reference failed: ${m.path} (${error instanceof Error ? error.message : "Unknown error"})`
        };
      }
    }));
    let result = content;
    for (let i = resolved.length - 1; i >= 0; i--) {
      const item = resolved[i];
      if (item.error) {
        errors.push(item.error);
        continue;
      }
      if (item.replacement === null) {
        continue;
      }
      result = result.slice(0, item.index) + item.replacement + result.slice(item.index + item.full.length);
    }
    return { content: result, errors };
  }
  resolveVaultFile(rawPath) {
    const exact = this.app.vault.getAbstractFileByPath(rawPath);
    if (isVaultFileCandidate(exact)) {
      return exact;
    }
    const allFiles = this.app.vault.getMarkdownFiles();
    const normalizedNeedle = rawPath.toLowerCase();
    const basenameMatches = allFiles.filter((file) => file.name.toLowerCase() === normalizedNeedle);
    if (basenameMatches.length === 1) {
      return basenameMatches[0];
    }
    const suffixMatches = allFiles.filter((file) => file.path.toLowerCase().endsWith(`/${normalizedNeedle}`));
    if (suffixMatches.length === 1) {
      return suffixMatches[0];
    }
    return null;
  }
  /**
   * Executes inline bash commands.
   * Replaces !`command` with command output.
   */
  async executeInlineBash(content, bashOptions) {
    var _a;
    const pattern = /!`([^`]+)`/g;
    const errors = [];
    const matches = [];
    let match = pattern.exec(content);
    while (match !== null) {
      matches.push({ full: match[0], command: match[1], index: match.index });
      match = pattern.exec(content);
    }
    let result = content;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      try {
        if (!(bashOptions == null ? void 0 : bashOptions.enabled)) {
          errors.push(`Inline bash is disabled: ${m.command}`);
          result = result.slice(0, m.index) + `[Inline bash disabled]` + result.slice(m.index + m.full.length);
          continue;
        }
        if ((_a = bashOptions.shouldBlockCommand) == null ? void 0 : _a.call(bashOptions, m.command)) {
          errors.push(`Inline bash blocked by blocklist: ${m.command}`);
          result = result.slice(0, m.index) + `[Blocked]` + result.slice(m.index + m.full.length);
          continue;
        }
        if (bashOptions.requestApproval) {
          const approved = await bashOptions.requestApproval(m.command);
          if (!approved) {
            errors.push(`Inline bash denied by user: ${m.command}`);
            result = result.slice(0, m.index) + `[Denied]` + result.slice(m.index + m.full.length);
            continue;
          }
        }
        const output = await this.bashRunner(m.command, this.vaultPath);
        result = result.slice(0, m.index) + output.trim() + result.slice(m.index + m.full.length);
      } catch (error) {
        const errorMsg = `[Error: ${error instanceof Error ? error.message : "Command failed"}]`;
        errors.push(`Inline bash failed: ${m.command}`);
        result = result.slice(0, m.index) + errorMsg + result.slice(m.index + m.full.length);
      }
    }
    return { content: result, errors };
  }
};
function shellEscapeArgIfNeeded(arg) {
  if (/^[\w./:-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
function defaultBashRunner(command, cwd) {
  return new Promise((resolve6, reject) => {
    (0, import_child_process4.exec)(
      command,
      {
        cwd,
        timeout: 1e4,
        maxBuffer: 1024 * 1024,
        // Enhance PATH for GUI apps (Obsidian has minimal PATH)
        env: { ...process.env, PATH: getEnhancedPath() }
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve6(stdout);
        }
      }
    );
  });
}

// src/features/chat/ObsidianCopilotView.ts
init_providerRegistry();
init_providerConnection();

// src/ui/components/AskUserQuestionPanel.ts
function findInputElements(containerEl) {
  const inputContainer = containerEl.querySelector(".ocop-input-container");
  const inputWrapper = containerEl.querySelector(".ocop-input-wrapper");
  return { inputContainer, inputWrapper };
}
var AskUserQuestionPanel = class {
  constructor(app, options) {
    this.answers = /* @__PURE__ */ new Map();
    this.currentTabIndex = 0;
    this.currentOptionIndex = 0;
    this.isDestroyed = false;
    this.documentKeydownHandler = null;
    // DOM references
    this.tabsEl = null;
    this.questionContentEl = null;
    this.otherInputEl = null;
    // Input area references (for hiding/showing)
    this.inputContainer = null;
    this.inputWrapper = null;
    this.app = app;
    this.containerEl = options.containerEl;
    this.questions = options.input.questions;
    this.onSubmit = options.onSubmit;
    this.onCancel = options.onCancel;
    const { inputContainer, inputWrapper } = findInputElements(this.containerEl);
    this.inputContainer = inputContainer;
    this.inputWrapper = inputWrapper;
    if (this.inputWrapper) {
      this.inputWrapper.style.display = "none";
    }
    this.panelEl = this.createPanel();
    if (this.inputContainer) {
      this.inputContainer.appendChild(this.panelEl);
    } else {
      this.containerEl.appendChild(this.panelEl);
    }
    this.panelEl.focus();
    this.attachDocumentHandler();
  }
  /** Create the panel DOM structure. */
  createPanel() {
    const panel = document.createElement("div");
    panel.className = "ocop-ask-panel";
    panel.setAttribute("tabindex", "0");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Copilot is asking a question");
    panel.addEventListener("keydown", this.handleKeyDown.bind(this));
    this.tabsEl = this.createTabs(panel);
    this.questionContentEl = document.createElement("div");
    this.questionContentEl.className = "ocop-ask-panel-content";
    panel.appendChild(this.questionContentEl);
    const hintEl = document.createElement("div");
    hintEl.className = "ocop-ask-panel-hint";
    hintEl.textContent = "Enter to select \xB7 Tab/Arrow keys to navigate \xB7 Esc to cancel";
    panel.appendChild(hintEl);
    this.renderCurrentContent();
    return panel;
  }
  /** Create tab navigation row. */
  createTabs(parent) {
    const tabsContainer = document.createElement("div");
    tabsContainer.className = "ocop-ask-panel-tabs";
    const leftArrow = document.createElement("span");
    leftArrow.className = "ocop-ask-panel-nav";
    leftArrow.textContent = "\u2190";
    leftArrow.addEventListener("click", () => this.navigateTab(-1));
    tabsContainer.appendChild(leftArrow);
    this.questions.forEach((q, index) => {
      const tab = document.createElement("button");
      tab.className = "ocop-ask-panel-tab";
      tab.setAttribute("data-tab-index", String(index));
      const check = document.createElement("span");
      check.className = "ocop-ask-panel-tab-check";
      check.textContent = "\u25CB";
      tab.appendChild(check);
      const label = document.createTextNode(` ${q.header || `Q${index + 1}`}`);
      tab.appendChild(label);
      if (index === 0) {
        tab.classList.add("active");
      }
      tab.addEventListener("click", () => this.switchToTab(index));
      tabsContainer.appendChild(tab);
    });
    const submitTab = document.createElement("button");
    submitTab.className = "ocop-ask-panel-tab ocop-ask-panel-submit-tab";
    submitTab.setAttribute("data-tab-index", String(this.questions.length));
    const submitCheck = document.createElement("span");
    submitCheck.className = "ocop-ask-panel-tab-check";
    submitCheck.textContent = "\u2713";
    submitTab.appendChild(submitCheck);
    const submitLabel = document.createTextNode(" Submit");
    submitTab.appendChild(submitLabel);
    submitTab.addEventListener("click", () => this.switchToTab(this.questions.length));
    tabsContainer.appendChild(submitTab);
    const rightArrow = document.createElement("span");
    rightArrow.className = "ocop-ask-panel-nav";
    rightArrow.textContent = "\u2192";
    rightArrow.addEventListener("click", () => this.navigateTab(1));
    tabsContainer.appendChild(rightArrow);
    parent.appendChild(tabsContainer);
    return tabsContainer;
  }
  /** Navigate tabs by direction. */
  navigateTab(direction) {
    const newIndex = this.currentTabIndex + direction;
    if (newIndex >= 0 && newIndex <= this.questions.length) {
      this.switchToTab(newIndex);
    }
  }
  /** Check if currently on Submit tab. */
  isOnSubmitTab() {
    return this.currentTabIndex === this.questions.length;
  }
  /** Switch to a specific tab/question. */
  switchToTab(index) {
    if (index < 0 || index > this.questions.length) return;
    this.currentTabIndex = index;
    this.currentOptionIndex = 0;
    if (this.tabsEl) {
      const tabs = this.tabsEl.querySelectorAll(".ocop-ask-panel-tab");
      tabs.forEach((tab, i) => {
        tab.classList.toggle("active", i === index);
      });
    }
    this.renderCurrentContent();
  }
  /** Render current tab content. */
  renderCurrentContent() {
    if (this.isOnSubmitTab()) {
      this.renderSubmitReview();
    } else {
      this.renderCurrentQuestion();
    }
  }
  /** Render the current question. */
  renderCurrentQuestion() {
    if (!this.questionContentEl) return;
    this.questionContentEl.innerHTML = "";
    const question = this.questions[this.currentTabIndex];
    if (!question) return;
    const questionTextEl = document.createElement("div");
    questionTextEl.className = "ocop-ask-panel-question";
    questionTextEl.textContent = question.question;
    this.questionContentEl.appendChild(questionTextEl);
    const optionsEl = document.createElement("div");
    optionsEl.className = "ocop-ask-panel-options";
    optionsEl.setAttribute("role", question.multiSelect ? "group" : "radiogroup");
    question.options.forEach((option, index) => {
      const optionEl = this.createOptionElement(question, option, index);
      optionsEl.appendChild(optionEl);
    });
    const otherEl = this.createOtherOption(question);
    optionsEl.appendChild(otherEl);
    this.questionContentEl.appendChild(optionsEl);
    this.updateOptionFocus();
  }
  /** Render the Submit review panel. */
  renderSubmitReview() {
    if (!this.questionContentEl) return;
    this.questionContentEl.innerHTML = "";
    const titleEl = document.createElement("div");
    titleEl.className = "ocop-ask-panel-question";
    titleEl.textContent = "Review your answers";
    this.questionContentEl.appendChild(titleEl);
    const summaryEl = document.createElement("div");
    summaryEl.className = "ocop-ask-panel-summary";
    this.questions.forEach((q) => {
      const itemEl = document.createElement("div");
      itemEl.className = "ocop-ask-panel-summary-item";
      const questionEl = document.createElement("div");
      questionEl.className = "ocop-ask-panel-summary-question";
      questionEl.textContent = `\u25CF ${q.question}`;
      itemEl.appendChild(questionEl);
      const answerEl = document.createElement("div");
      answerEl.className = "ocop-ask-panel-summary-answer";
      const answer = this.answers.get(q.question);
      if (answer) {
        const answerText = Array.isArray(answer) ? answer.join(", ") : answer;
        answerEl.textContent = `  \u2192 ${answerText}`;
      } else {
        answerEl.textContent = "  \u2192 (not answered)";
        answerEl.classList.add("unanswered");
      }
      itemEl.appendChild(answerEl);
      summaryEl.appendChild(itemEl);
    });
    this.questionContentEl.appendChild(summaryEl);
    const promptEl = document.createElement("div");
    promptEl.className = "ocop-ask-panel-submit-prompt";
    promptEl.textContent = "Ready to submit your answers?";
    this.questionContentEl.appendChild(promptEl);
    const optionsEl = document.createElement("div");
    optionsEl.className = "ocop-ask-panel-options";
    const submitOptionEl = this.createSubmitOption("Submit answers", 0, () => this.submit());
    optionsEl.appendChild(submitOptionEl);
    const cancelOptionEl = this.createSubmitOption("Cancel", 1, () => this.cancel());
    optionsEl.appendChild(cancelOptionEl);
    this.questionContentEl.appendChild(optionsEl);
    this.updateSubmitOptionFocus();
  }
  /** Create an option for the submit review. */
  createSubmitOption(label, index, onClick) {
    const optionEl = document.createElement("div");
    optionEl.className = "ocop-ask-panel-option ocop-ask-panel-submit-option";
    optionEl.setAttribute("data-option-index", String(index));
    const caret = document.createElement("span");
    caret.className = "ocop-ask-panel-caret";
    caret.textContent = " ";
    optionEl.appendChild(caret);
    const indicator = document.createElement("span");
    indicator.className = "ocop-ask-panel-indicator";
    indicator.textContent = `${index + 1}.`;
    optionEl.appendChild(indicator);
    const labelEl = document.createElement("span");
    labelEl.className = "ocop-ask-panel-option-label";
    labelEl.textContent = label;
    optionEl.appendChild(labelEl);
    optionEl.addEventListener("click", () => {
      this.currentOptionIndex = index;
      this.updateSubmitOptionFocus();
      onClick();
    });
    return optionEl;
  }
  /** Update focus for submit options. */
  updateSubmitOptionFocus() {
    if (!this.questionContentEl) return;
    const options = this.questionContentEl.querySelectorAll(".ocop-ask-panel-submit-option");
    options.forEach((opt, i) => {
      const caret = opt.querySelector(".ocop-ask-panel-caret");
      const isFocused = i === this.currentOptionIndex;
      opt.classList.toggle("focused", isFocused);
      if (caret) {
        caret.textContent = isFocused ? ">" : " ";
      }
    });
  }
  /** Create an option element. */
  createOptionElement(question, option, index) {
    const optionEl = document.createElement("div");
    optionEl.className = "ocop-ask-panel-option";
    optionEl.setAttribute("data-option-index", String(index));
    const caret = document.createElement("span");
    caret.className = "ocop-ask-panel-caret";
    caret.textContent = " ";
    optionEl.appendChild(caret);
    const indicator = document.createElement("span");
    indicator.className = "ocop-ask-panel-indicator";
    if (question.multiSelect) {
      indicator.textContent = `${index + 1}. [ ]`;
    } else {
      indicator.textContent = `${index + 1}.`;
    }
    optionEl.appendChild(indicator);
    const textContainer = document.createElement("div");
    textContainer.className = "ocop-ask-panel-option-text";
    const labelRowEl = document.createElement("div");
    labelRowEl.className = "ocop-ask-panel-label-row";
    const labelEl = document.createElement("span");
    labelEl.className = "ocop-ask-panel-option-label";
    labelEl.textContent = option.label;
    labelRowEl.appendChild(labelEl);
    if (!question.multiSelect) {
      const checkmarkEl = document.createElement("span");
      checkmarkEl.className = "ocop-ask-panel-checkmark";
      checkmarkEl.textContent = "";
      labelRowEl.appendChild(checkmarkEl);
    }
    textContainer.appendChild(labelRowEl);
    if (option.description) {
      const descEl = document.createElement("div");
      descEl.className = "ocop-ask-panel-option-desc";
      descEl.textContent = option.description;
      textContainer.appendChild(descEl);
    }
    optionEl.appendChild(textContainer);
    optionEl.addEventListener("click", () => {
      this.currentOptionIndex = index;
      this.selectOption(index);
    });
    return optionEl;
  }
  /** Create the "Other" option with text input. */
  createOtherOption(question) {
    const otherIndex = question.options.length;
    const otherEl = document.createElement("div");
    otherEl.className = "ocop-ask-panel-option ocop-ask-panel-other";
    otherEl.setAttribute("data-option-index", String(otherIndex));
    const caret = document.createElement("span");
    caret.className = "ocop-ask-panel-caret";
    caret.textContent = " ";
    otherEl.appendChild(caret);
    const indicator = document.createElement("span");
    indicator.className = "ocop-ask-panel-indicator";
    if (question.multiSelect) {
      indicator.textContent = `${otherIndex + 1}. [ ]`;
    } else {
      indicator.textContent = `${otherIndex + 1}.`;
    }
    otherEl.appendChild(indicator);
    this.otherInputEl = document.createElement("input");
    this.otherInputEl.type = "text";
    this.otherInputEl.className = "ocop-ask-panel-other-input";
    this.otherInputEl.placeholder = "Type something.";
    this.otherInputEl.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.stopPropagation();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (this.otherInputEl && this.otherInputEl.value.trim()) {
          this.selectOther(this.otherInputEl.value.trim());
        }
      }
    });
    this.otherInputEl.addEventListener("focus", () => {
      this.currentOptionIndex = otherIndex;
      this.updateOptionFocus();
    });
    otherEl.appendChild(this.otherInputEl);
    otherEl.addEventListener("click", (e) => {
      var _a;
      if (e.target !== this.otherInputEl) {
        this.currentOptionIndex = otherIndex;
        this.updateOptionFocus();
        (_a = this.otherInputEl) == null ? void 0 : _a.focus();
      }
    });
    return otherEl;
  }
  /** Handle keyboard navigation. */
  handleKeyDown(e) {
    var _a;
    if (this.isDestroyed) return;
    if (this.isOnSubmitTab()) {
      this.handleSubmitTabKeyDown(e);
      return;
    }
    const question = this.questions[this.currentTabIndex];
    if (!question) return;
    const totalOptions = question.options.length + 1;
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        this.currentOptionIndex = (this.currentOptionIndex - 1 + totalOptions) % totalOptions;
        this.updateOptionFocus();
        break;
      case "ArrowDown":
        e.preventDefault();
        this.currentOptionIndex = (this.currentOptionIndex + 1) % totalOptions;
        this.updateOptionFocus();
        break;
      case "ArrowLeft":
        e.preventDefault();
        this.navigateTab(-1);
        break;
      case "ArrowRight":
        e.preventDefault();
        this.navigateTab(1);
        break;
      case "Tab":
        e.preventDefault();
        if (e.shiftKey) {
          this.navigateTab(-1);
        } else {
          this.navigateTab(1);
        }
        break;
      case "Enter":
        if (document.activeElement === this.otherInputEl) return;
        e.preventDefault();
        if (this.currentOptionIndex < question.options.length) {
          this.selectOption(this.currentOptionIndex);
        } else if (this.otherInputEl && this.otherInputEl.value.trim()) {
          this.selectOther(this.otherInputEl.value.trim());
        }
        break;
      case "Escape":
        e.preventDefault();
        this.cancel();
        break;
      // Number keys 1-9 for quick selection
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8":
      case "9":
        if (document.activeElement !== this.otherInputEl) {
          const num = parseInt(e.key, 10) - 1;
          if (num < question.options.length) {
            e.preventDefault();
            this.currentOptionIndex = num;
            this.selectOption(num);
          } else if (num === question.options.length) {
            e.preventDefault();
            this.currentOptionIndex = num;
            this.updateOptionFocus();
            (_a = this.otherInputEl) == null ? void 0 : _a.focus();
          }
        }
        break;
    }
  }
  /** Handle keyboard navigation for Submit tab. */
  handleSubmitTabKeyDown(e) {
    const totalOptions = 2;
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        this.currentOptionIndex = (this.currentOptionIndex - 1 + totalOptions) % totalOptions;
        this.updateSubmitOptionFocus();
        break;
      case "ArrowDown":
        e.preventDefault();
        this.currentOptionIndex = (this.currentOptionIndex + 1) % totalOptions;
        this.updateSubmitOptionFocus();
        break;
      case "ArrowLeft":
        e.preventDefault();
        this.navigateTab(-1);
        break;
      case "ArrowRight":
        break;
      case "Tab":
        e.preventDefault();
        if (e.shiftKey) {
          this.navigateTab(-1);
        }
        break;
      case "Enter":
        e.preventDefault();
        if (this.currentOptionIndex === 0) {
          this.submit();
        } else {
          this.cancel();
        }
        break;
      case "Escape":
        e.preventDefault();
        this.cancel();
        break;
      case "1":
        e.preventDefault();
        this.currentOptionIndex = 0;
        this.updateSubmitOptionFocus();
        this.submit();
        break;
      case "2":
        e.preventDefault();
        this.currentOptionIndex = 1;
        this.updateSubmitOptionFocus();
        this.cancel();
        break;
    }
  }
  attachDocumentHandler() {
    this.detachDocumentHandler();
    this.documentKeydownHandler = (e) => {
      if (this.isDestroyed) return;
      if (!this.isNavigationKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this.handleKeyDown(e);
    };
    document.addEventListener("keydown", this.documentKeydownHandler, true);
  }
  detachDocumentHandler() {
    if (this.documentKeydownHandler) {
      document.removeEventListener("keydown", this.documentKeydownHandler, true);
      this.documentKeydownHandler = null;
    }
  }
  isNavigationKey(e) {
    return e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Tab";
  }
  /** Update visual focus indicator. */
  updateOptionFocus() {
    var _a;
    if (!this.questionContentEl) return;
    const question = this.questions[this.currentTabIndex];
    if (!question) return;
    const questionKey = question.question;
    const answer = this.answers.get(questionKey);
    const answerArray = Array.isArray(answer) ? answer : answer ? [answer] : [];
    const options = this.questionContentEl.querySelectorAll(".ocop-ask-panel-option");
    options.forEach((opt, i) => {
      const caret = opt.querySelector(".ocop-ask-panel-caret");
      const indicator = opt.querySelector(".ocop-ask-panel-indicator");
      const isFocused = i === this.currentOptionIndex;
      let isSelected = false;
      if (i < question.options.length) {
        const optionLabel = question.options[i].label;
        isSelected = answerArray.includes(optionLabel);
      } else {
        isSelected = answerArray.some((v) => typeof v === "string" && !question.options.some((o) => o.label === v));
      }
      opt.classList.toggle("focused", isFocused);
      opt.classList.toggle("selected", isSelected);
      if (caret) {
        caret.textContent = isFocused ? ">" : " ";
      }
      if (indicator) {
        if (question.multiSelect) {
          const checkbox = isSelected ? "[\u2713]" : "[ ]";
          indicator.textContent = `${i + 1}. ${checkbox}`;
        } else {
          indicator.textContent = `${i + 1}.`;
        }
      }
      if (!question.multiSelect) {
        const checkmark = opt.querySelector(".ocop-ask-panel-checkmark");
        if (checkmark) {
          checkmark.textContent = isSelected ? " \u2713" : "";
        }
      }
    });
    if (this.currentOptionIndex === question.options.length) {
      (_a = this.otherInputEl) == null ? void 0 : _a.focus();
    } else {
      if (document.activeElement === this.otherInputEl) {
        this.panelEl.focus();
      }
    }
  }
  /** Select an option. */
  selectOption(optionIndex) {
    const question = this.questions[this.currentTabIndex];
    if (!question || optionIndex >= question.options.length) return;
    const option = question.options[optionIndex];
    const questionKey = question.question;
    if (question.multiSelect) {
      const current = this.answers.get(questionKey);
      const currentArray = Array.isArray(current) ? current : [];
      if (currentArray.includes(option.label)) {
        const filtered = currentArray.filter((v) => v !== option.label);
        if (filtered.length > 0) {
          this.answers.set(questionKey, filtered);
        } else {
          this.answers.delete(questionKey);
        }
      } else {
        this.answers.set(questionKey, [...currentArray, option.label]);
      }
      this.updateSelectionUI();
    } else {
      this.answers.set(questionKey, option.label);
      this.updateSelectionUI();
      this.autoAdvance();
    }
  }
  /** Select "Other" with custom text. */
  selectOther(text) {
    const question = this.questions[this.currentTabIndex];
    if (!question) return;
    const questionKey = question.question;
    if (question.multiSelect) {
      const current = this.answers.get(questionKey);
      const currentArray = Array.isArray(current) ? current : [];
      const filtered = currentArray.filter((v) => question.options.some((o) => o.label === v));
      this.answers.set(questionKey, [...filtered, text]);
      this.updateSelectionUI();
    } else {
      this.answers.set(questionKey, text);
      this.updateSelectionUI();
      this.autoAdvance();
    }
  }
  /** Update selection UI indicators. */
  updateSelectionUI() {
    this.updateOptionFocus();
    this.updateTabIndicators();
  }
  /** Update tab checkbox indicators. */
  updateTabIndicators() {
    if (!this.tabsEl) return;
    const tabs = this.tabsEl.querySelectorAll(".ocop-ask-panel-tab");
    this.questions.forEach((q, i) => {
      const hasAnswer = this.answers.has(q.question);
      const tab = tabs[i];
      if (tab) {
        tab.classList.toggle("answered", hasAnswer);
        const check = tab.querySelector(".ocop-ask-panel-tab-check");
        if (check) {
          check.textContent = hasAnswer ? "\u25CF" : "\u25CB";
        }
      }
    });
  }
  /** Auto-advance to next question or Submit tab. */
  autoAdvance() {
    this.switchToTab(this.currentTabIndex + 1);
  }
  /** Submit all answers. */
  submit() {
    if (this.isDestroyed) return;
    const answersRecord = {};
    this.answers.forEach((value, key) => {
      answersRecord[key] = value;
    });
    this.destroy();
    this.onSubmit(answersRecord);
  }
  /** Cancel and close panel. */
  cancel() {
    if (this.isDestroyed) return;
    this.destroy();
    this.onCancel();
  }
  /** Clean up and remove panel, restore input area. */
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.detachDocumentHandler();
    this.panelEl.remove();
    if (this.inputWrapper) {
      this.inputWrapper.style.display = "";
    }
  }
};
function showAskUserQuestionPanel(app, containerEl, input) {
  return new Promise((resolve6) => {
    new AskUserQuestionPanel(app, {
      containerEl,
      input,
      onSubmit: (answers) => resolve6(answers),
      onCancel: () => resolve6(null)
    });
  });
}

// src/ui/components/FileContext.ts
var import_obsidian3 = require("obsidian");
var path9 = __toESM(require("path"));
init_path();

// src/ui/components/file-context/mention/MentionDropdownController.ts
var import_obsidian = require("obsidian");

// src/utils/externalContext.ts
init_path();
function normalizePathForComparison2(p) {
  return normalizePathForComparison(p);
}
function normalizePathForDisplay(p) {
  if (!p) return "";
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}
function findConflictingPath(newPath, existingPaths) {
  const normalizedNew = normalizePathForComparison2(newPath);
  for (const existing of existingPaths) {
    const normalizedExisting = normalizePathForComparison2(existing);
    if (normalizedNew.startsWith(normalizedExisting + "/")) {
      return { path: existing, type: "parent" };
    }
    if (normalizedExisting.startsWith(normalizedNew + "/")) {
      return { path: existing, type: "child" };
    }
  }
  return null;
}
function getFolderName(p) {
  const normalized = normalizePathForDisplay(p);
  const segments = normalized.split("/");
  return segments[segments.length - 1] || normalized;
}

// src/utils/externalContextScanner.ts
var fs8 = __toESM(require("fs"));
var path8 = __toESM(require("path"));
init_path();
var CACHE_TTL_MS = 3e4;
var MAX_FILES_PER_PATH = 1e3;
var MAX_DEPTH = 10;
var SKIP_DIRECTORIES = /* @__PURE__ */ new Set([
  "node_modules",
  "__pycache__",
  "venv",
  ".venv",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "target",
  "vendor",
  "Pods"
]);
var ExternalContextScanner = class {
  constructor() {
    this.cache = /* @__PURE__ */ new Map();
  }
  isCacheFresh(expandedPath, now = Date.now()) {
    const cached = this.cache.get(expandedPath);
    return !!cached && now - cached.timestamp < CACHE_TTL_MS;
  }
  hasFreshCache(contextPath) {
    return this.isCacheFresh(normalizePathForFilesystem(contextPath));
  }
  getCachedFiles(contextPath) {
    const expandedPath = normalizePathForFilesystem(contextPath);
    const cached = this.cache.get(expandedPath);
    return cached && this.isCacheFresh(expandedPath) ? cached.files : [];
  }
  /**
   * Scans all external context paths and returns matching files.
   * Uses cached results when available.
   */
  scanPaths(externalContextPaths) {
    const allFiles = [];
    const now = Date.now();
    for (const contextPath of externalContextPaths) {
      const expandedPath = normalizePathForFilesystem(contextPath);
      const cached = this.cache.get(expandedPath);
      if (cached && now - cached.timestamp < CACHE_TTL_MS) {
        allFiles.push(...cached.files);
        continue;
      }
      const files = this.scanDirectory(expandedPath, expandedPath, 0);
      this.cache.set(expandedPath, { files, timestamp: now });
      allFiles.push(...files);
    }
    return allFiles;
  }
  async scanPathsAsync(externalContextPaths) {
    const allFiles = [];
    const now = Date.now();
    for (const contextPath of externalContextPaths) {
      const expandedPath = normalizePathForFilesystem(contextPath);
      const cached = this.cache.get(expandedPath);
      if (cached && now - cached.timestamp < CACHE_TTL_MS) {
        allFiles.push(...cached.files);
        continue;
      }
      const files = await this.scanDirectoryAsync(expandedPath, expandedPath, 0);
      this.cache.set(expandedPath, { files, timestamp: now });
      allFiles.push(...files);
    }
    return allFiles;
  }
  /**
   * Recursively scans a directory for files.
   */
  scanDirectory(dir, contextRoot, depth) {
    if (depth > MAX_DEPTH) return [];
    const files = [];
    try {
      if (!fs8.existsSync(dir)) return [];
      const stat = fs8.statSync(dir);
      if (!stat.isDirectory()) return [];
      const entries = fs8.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        if (entry.isSymbolicLink()) continue;
        const fullPath = path8.join(dir, entry.name);
        if (entry.isDirectory()) {
          const subFiles = this.scanDirectory(fullPath, contextRoot, depth + 1);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          try {
            const fileStat = fs8.statSync(fullPath);
            files.push({
              path: fullPath,
              name: entry.name,
              relativePath: path8.relative(contextRoot, fullPath),
              contextRoot,
              mtime: fileStat.mtimeMs
            });
          } catch (err) {
            console.debug(`Skipped file ${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (files.length >= MAX_FILES_PER_PATH) break;
      }
    } catch (err) {
      console.warn(`Failed to scan external context directory ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return files;
  }
  async scanDirectoryAsync(dir, contextRoot, depth) {
    if (depth > MAX_DEPTH) return [];
    const files = [];
    try {
      const stat = await fs8.promises.stat(dir).catch(() => null);
      if (!(stat == null ? void 0 : stat.isDirectory())) return [];
      const entries = await fs8.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        if (entry.isSymbolicLink()) continue;
        const fullPath = path8.join(dir, entry.name);
        if (entry.isDirectory()) {
          const subFiles = await this.scanDirectoryAsync(fullPath, contextRoot, depth + 1);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          try {
            const fileStat = await fs8.promises.stat(fullPath);
            files.push({
              path: fullPath,
              name: entry.name,
              relativePath: path8.relative(contextRoot, fullPath),
              contextRoot,
              mtime: fileStat.mtimeMs
            });
          } catch (err) {
            console.debug(`Skipped file ${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (files.length >= MAX_FILES_PER_PATH) break;
      }
    } catch (err) {
      console.warn(`Failed to scan external context directory ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return files;
  }
  /** Clears all cached results. */
  invalidateCache() {
    this.cache.clear();
  }
  /** Clears cached results for a specific external context path. */
  invalidatePath(contextPath) {
    const expandedPath = normalizePathForFilesystem(contextPath);
    this.cache.delete(expandedPath);
  }
};
var externalContextScanner = new ExternalContextScanner();

// src/utils/mentionDisplay.ts
function splitMentionPath(rawPath) {
  const normalized = rawPath.replace(/\\/g, "/").trim().replace(/\/+$/, "");
  if (!normalized) return { name: "", folder: "" };
  const cut = normalized.lastIndexOf("/");
  if (cut < 0) return { name: normalized, folder: "" };
  return { name: normalized.slice(cut + 1), folder: normalized.slice(0, cut) };
}
function folderLabelFor(folderPath) {
  return folderPath;
}
var MENTION = /(^|[^\w@])@(?:"([^"]+)"|'([^']+)'|([^\s"']+\.\w+))/g;
function findMentionRanges(text) {
  var _a, _b;
  const ranges = [];
  for (const match of text.matchAll(MENTION)) {
    const lead = (_a = match[1]) != null ? _a : "";
    const start = ((_b = match.index) != null ? _b : 0) + lead.length;
    ranges.push({ start, end: start + (match[0].length - lead.length) });
  }
  return ranges;
}
function buildMentionSegments(text) {
  if (!text) return [];
  const segments = [];
  let cursor = 0;
  for (const range of findMentionRanges(text)) {
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), isMention: false });
    }
    segments.push({ text: text.slice(range.start, range.end), isMention: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), isMention: false });
  return segments;
}
function markMentions(root) {
  var _a, _b;
  if (!root) return;
  const doc = root.ownerDocument;
  if (!doc) return;
  const walker = doc.createTreeWalker(
    root,
    4
    /* NodeFilter.SHOW_TEXT */
  );
  const targets = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node;
    if ((_a = text.parentElement) == null ? void 0 : _a.closest("code, pre, a, .ocop-mention-chip")) continue;
    if (findMentionRanges(text.data).length > 0) targets.push(text);
  }
  for (const text of targets) {
    const ranges = findMentionRanges(text.data);
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) fragment.appendChild(doc.createTextNode(text.data.slice(cursor, range.start)));
      const chip = doc.createElement("span");
      chip.className = "ocop-mention-chip";
      chip.textContent = text.data.slice(range.start, range.end);
      fragment.appendChild(chip);
      cursor = range.end;
    }
    if (cursor < text.data.length) fragment.appendChild(doc.createTextNode(text.data.slice(cursor)));
    (_b = text.parentNode) == null ? void 0 : _b.replaceChild(fragment, text);
  }
}

// src/ui/components/SelectableDropdown.ts
var SelectableDropdown = class {
  constructor(containerEl, options) {
    this.dropdownEl = null;
    this.items = [];
    this.itemEls = [];
    this.selectedIndex = 0;
    this.containerEl = containerEl;
    this.options = options;
  }
  isVisible() {
    var _a, _b;
    return (_b = (_a = this.dropdownEl) == null ? void 0 : _a.hasClass("visible")) != null ? _b : false;
  }
  getElement() {
    return this.dropdownEl;
  }
  getSelectedIndex() {
    return this.selectedIndex;
  }
  getSelectedItem() {
    var _a;
    return (_a = this.items[this.selectedIndex]) != null ? _a : null;
  }
  getItems() {
    return this.items;
  }
  hide() {
    if (this.dropdownEl) {
      this.dropdownEl.removeClass("visible");
    }
  }
  destroy() {
    if (this.dropdownEl) {
      this.dropdownEl.remove();
      this.dropdownEl = null;
    }
  }
  render(options) {
    var _a;
    this.items = options.items;
    this.selectedIndex = options.selectedIndex;
    if (!this.dropdownEl) {
      this.dropdownEl = this.createDropdownElement();
    }
    this.dropdownEl.empty();
    this.itemEls = [];
    if (options.items.length === 0) {
      const emptyEl = this.dropdownEl.createDiv({ cls: this.options.emptyClassName });
      emptyEl.setText(options.emptyText);
    } else {
      for (let i = 0; i < options.items.length; i++) {
        const item = options.items[i];
        const itemEl = this.dropdownEl.createDiv({ cls: this.options.itemClassName });
        const extraClass = (_a = options.getItemClass) == null ? void 0 : _a.call(options, item);
        if (Array.isArray(extraClass)) {
          extraClass.forEach((cls) => itemEl.addClass(cls));
        } else if (extraClass) {
          itemEl.addClass(extraClass);
        }
        if (i === this.selectedIndex) {
          itemEl.addClass("selected");
        }
        options.renderItem(item, itemEl);
        itemEl.addEventListener("click", () => {
          var _a2;
          this.selectedIndex = i;
          this.updateSelection();
          (_a2 = options.onItemClick) == null ? void 0 : _a2.call(options, item, i);
        });
        itemEl.addEventListener("mouseenter", () => {
          var _a2;
          this.selectedIndex = i;
          this.updateSelection();
          (_a2 = options.onItemHover) == null ? void 0 : _a2.call(options, item, i);
        });
        this.itemEls.push(itemEl);
      }
    }
    this.dropdownEl.addClass("visible");
  }
  updateSelection() {
    this.itemEls.forEach((itemEl, index) => {
      if (index === this.selectedIndex) {
        itemEl.addClass("selected");
        itemEl.scrollIntoView({ block: "nearest" });
      } else {
        itemEl.removeClass("selected");
      }
    });
  }
  moveSelection(delta) {
    const maxIndex = this.items.length - 1;
    this.selectedIndex = Math.max(0, Math.min(maxIndex, this.selectedIndex + delta));
    this.updateSelection();
  }
  createDropdownElement() {
    const className = this.options.fixed && this.options.fixedClassName ? `${this.options.listClassName} ${this.options.fixedClassName}` : this.options.listClassName;
    return this.containerEl.createDiv({ cls: className });
  }
};

// src/ui/components/file-context/mention/folderSearch.ts
function parseFolderQuery(rawQuery) {
  if (rawQuery.startsWith("/")) {
    return { text: rawQuery.slice(1).toLowerCase(), foldersOnly: true };
  }
  return { text: rawQuery.toLowerCase(), foldersOnly: false };
}
function folderNameOf(path16) {
  const cut = path16.lastIndexOf("/");
  return cut < 0 ? path16 : path16.slice(cut + 1);
}
function rankFoldersByProximity(folderPaths, currentFolder, query, limit) {
  if (limit <= 0) return [];
  const needle = query.toLowerCase();
  const matches = folderPaths.filter((path16) => {
    const lower = path16.toLowerCase();
    return lower.includes(needle) || folderNameOf(lower).includes(needle);
  });
  if (!currentFolder) {
    return matches.sort(byDepthThenName).slice(0, limit);
  }
  const here = currentFolder.split("/").filter(Boolean);
  return matches.map((path16) => {
    const segments = path16.split("/").filter(Boolean);
    let shared = 0;
    while (shared < segments.length && shared < here.length && segments[shared] === here[shared]) {
      shared += 1;
    }
    return {
      path: path16,
      // More shared segments means a closer branch.
      shared,
      // Within a branch, prefer the current folder, then what is under it.
      distance: Math.abs(segments.length - here.length) + (segments.length < here.length ? 1 : 0),
      depth: segments.length
    };
  }).sort((a, b) => b.shared - a.shared || a.distance - b.distance || a.depth - b.depth || a.path.localeCompare(b.path)).map((entry) => entry.path).slice(0, limit);
}
function byDepthThenName(a, b) {
  const depth = a.split("/").length - b.split("/").length;
  return depth !== 0 ? depth : a.localeCompare(b);
}

// src/ui/components/file-context/mention/types.ts
function createExternalContextEntry(contextRoot, folderName, displayName) {
  return {
    contextRoot,
    folderName,
    displayName,
    displayNameLower: displayName.toLowerCase()
  };
}

// src/ui/components/file-context/mention/MentionDropdownController.ts
var MentionDropdownController = class {
  constructor(containerEl, inputEl, callbacks, options = {}) {
    this.mentionStartIndex = -1;
    this.selectedMentionIndex = 0;
    this.filteredMentionItems = [];
    this.filteredContextFiles = [];
    this.activeContextFilter = null;
    this.externalContextLoading = false;
    this.lastSearchText = "";
    var _a;
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.fixed = (_a = options.fixed) != null ? _a : false;
    this.dropdown = new SelectableDropdown(this.containerEl, {
      listClassName: "ocop-mention-dropdown",
      itemClassName: "ocop-mention-item",
      emptyClassName: "ocop-mention-empty",
      fixed: this.fixed,
      fixedClassName: "ocop-mention-dropdown-fixed"
    });
  }
  preScanExternalContexts() {
    const externalContexts = this.callbacks.getExternalContexts() || [];
    if (externalContexts.length === 0) return;
    setTimeout(() => {
      externalContextScanner.scanPathsAsync(externalContexts).catch((err) => {
        console.warn(
          "Failed to pre-scan external contexts:",
          err instanceof Error ? err.message : String(err)
        );
      });
    }, 0);
  }
  isVisible() {
    return this.dropdown.isVisible();
  }
  hide() {
    this.dropdown.hide();
    this.mentionStartIndex = -1;
  }
  containsElement(el) {
    var _a, _b;
    return (_b = (_a = this.dropdown.getElement()) == null ? void 0 : _a.contains(el)) != null ? _b : false;
  }
  destroy() {
    this.dropdown.destroy();
  }
  handleInputChange() {
    const text = this.inputEl.value;
    const cursorPos = this.inputEl.selectionStart || 0;
    const textBeforeCursor = text.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");
    if (lastAtIndex === -1) {
      this.hide();
      return;
    }
    const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : " ";
    if (!/\s/.test(charBeforeAt) && lastAtIndex !== 0) {
      this.hide();
      return;
    }
    const searchText = textBeforeCursor.substring(lastAtIndex + 1);
    if (/\s/.test(searchText)) {
      this.hide();
      return;
    }
    this.mentionStartIndex = lastAtIndex;
    this.showMentionDropdown(searchText);
  }
  handleKeydown(e) {
    if (!this.dropdown.isVisible()) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.dropdown.moveSelection(1);
      this.selectedMentionIndex = this.dropdown.getSelectedIndex();
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      this.dropdown.moveSelection(-1);
      this.selectedMentionIndex = this.dropdown.getSelectedIndex();
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      this.selectMentionItem();
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      this.hide();
      return true;
    }
    return false;
  }
  buildExternalContextEntries(externalContexts) {
    var _a;
    const counts = /* @__PURE__ */ new Map();
    const normalizedPaths = /* @__PURE__ */ new Map();
    for (const contextPath of externalContexts) {
      const normalized = normalizePathForComparison2(contextPath);
      normalizedPaths.set(contextPath, normalized);
      const folderName = getFolderName(normalized);
      counts.set(folderName, ((_a = counts.get(folderName)) != null ? _a : 0) + 1);
    }
    return externalContexts.map((contextRoot) => {
      var _a2, _b;
      const normalized = (_a2 = normalizedPaths.get(contextRoot)) != null ? _a2 : normalizePathForComparison2(contextRoot);
      const folderName = getFolderName(contextRoot);
      const needsDisambiguation = ((_b = counts.get(folderName)) != null ? _b : 0) > 1;
      const displayName = this.getContextDisplayName(normalized, folderName, needsDisambiguation);
      return createExternalContextEntry(contextRoot, folderName, displayName);
    });
  }
  getContextDisplayName(normalizedPath, folderName, needsDisambiguation) {
    if (!needsDisambiguation) return folderName;
    const segments = normalizedPath.split("/").filter(Boolean);
    if (segments.length < 2) return folderName;
    const parent = segments[segments.length - 2];
    if (!parent) return folderName;
    return `${parent}/${folderName}`;
  }
  showMentionDropdown(searchText) {
    var _a, _b, _c, _d, _e, _f;
    this.lastSearchText = searchText;
    const searchLower = searchText.toLowerCase();
    this.filteredMentionItems = [];
    this.filteredContextFiles = [];
    const externalContexts = this.callbacks.getExternalContexts() || [];
    const contextEntries = this.buildExternalContextEntries(externalContexts);
    const isFilterSearch = searchText.includes("/");
    let fileSearchText = searchLower;
    if (isFilterSearch) {
      const matchingContext = contextEntries.filter((entry) => searchLower.startsWith(`${entry.displayNameLower}/`)).sort((a, b) => b.displayNameLower.length - a.displayNameLower.length)[0];
      if (matchingContext) {
        const prefixLength = matchingContext.displayName.length + 1;
        fileSearchText = searchText.substring(prefixLength).toLowerCase();
        this.activeContextFilter = {
          folderName: matchingContext.displayName,
          contextRoot: matchingContext.contextRoot
        };
      } else {
        this.activeContextFilter = null;
      }
    }
    if (this.activeContextFilter && isFilterSearch) {
      const contextRoot = this.activeContextFilter.contextRoot;
      if (!externalContextScanner.hasFreshCache(contextRoot)) {
        this.externalContextLoading = true;
        void externalContextScanner.scanPathsAsync([contextRoot]).then(() => {
          if (this.isVisible() && this.lastSearchText === searchText) {
            this.showMentionDropdown(searchText);
          }
        }).catch((err) => {
          console.warn(
            "Failed to scan filtered external context:",
            err instanceof Error ? err.message : String(err)
          );
          if (this.isVisible() && this.lastSearchText === searchText) {
            this.externalContextLoading = false;
            this.renderMentionDropdown();
          }
        });
        this.filteredContextFiles = [];
        this.filteredMentionItems = [];
        this.selectedMentionIndex = 0;
        this.renderMentionDropdown();
        return;
      }
      this.externalContextLoading = false;
      const contextFiles = externalContextScanner.getCachedFiles(contextRoot);
      this.filteredContextFiles = contextFiles.filter((file) => {
        const relativePath = file.relativePath.replace(/\\/g, "/");
        const pathLower = relativePath.toLowerCase();
        const nameLower = file.name.toLowerCase();
        return pathLower.includes(fileSearchText) || nameLower.includes(fileSearchText);
      }).sort((a, b) => {
        const aNameMatch = a.name.toLowerCase().startsWith(fileSearchText);
        const bNameMatch = b.name.toLowerCase().startsWith(fileSearchText);
        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;
        return b.mtime - a.mtime;
      }).slice(0, 10);
      for (const file of this.filteredContextFiles) {
        const relativePath = file.relativePath.replace(/\\/g, "/");
        this.filteredMentionItems.push({
          type: "context-file",
          name: relativePath,
          absolutePath: file.path,
          contextRoot: file.contextRoot,
          folderName: this.activeContextFilter.folderName
        });
      }
      this.selectedMentionIndex = 0;
      this.renderMentionDropdown();
      return;
    }
    this.activeContextFilter = null;
    this.externalContextLoading = false;
    if (contextEntries.length > 0) {
      const matchingFolders = /* @__PURE__ */ new Set();
      for (const entry of contextEntries) {
        if (entry.displayNameLower.includes(searchLower) && !matchingFolders.has(entry.displayName)) {
          matchingFolders.add(entry.displayName);
          this.filteredMentionItems.push({
            type: "context-folder",
            name: entry.displayName,
            contextRoot: entry.contextRoot,
            folderName: entry.displayName
          });
        }
      }
    }
    const folderQuery = parseFolderQuery(searchText);
    if (folderQuery.foldersOnly) {
      const vaultFolders = (_c = (_b = (_a = this.callbacks).getVaultFolders) == null ? void 0 : _b.call(_a)) != null ? _c : [];
      const currentFolder = splitMentionPath((_f = (_e = (_d = this.callbacks).getCurrentNotePath) == null ? void 0 : _e.call(_d)) != null ? _f : "").folder || null;
      for (const folderPath of rankFoldersByProximity(vaultFolders, currentFolder, folderQuery.text, 10)) {
        this.filteredMentionItems.push({ type: "vault-folder", name: folderPath, path: folderPath });
      }
      this.selectedMentionIndex = 0;
      this.renderMentionDropdown();
      return;
    }
    const firstVaultFileIndex = this.filteredMentionItems.length;
    const remainingSlots = 10 - this.filteredMentionItems.length;
    let vaultFiles = [];
    if (remainingSlots > 0) {
      const allFiles = this.callbacks.getCachedMarkdownFiles();
      vaultFiles = allFiles.filter((file) => {
        const pathLower = file.path.toLowerCase();
        const nameLower = file.name.toLowerCase();
        return pathLower.includes(searchLower) || nameLower.includes(searchLower);
      }).sort((a, b) => {
        const aNameMatch = a.name.toLowerCase().startsWith(searchLower);
        const bNameMatch = b.name.toLowerCase().startsWith(searchLower);
        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;
        return b.stat.mtime - a.stat.mtime;
      }).slice(0, remainingSlots);
      for (const file of vaultFiles) {
        this.filteredMentionItems.push({
          type: "file",
          name: file.name,
          path: file.path,
          file
        });
      }
    }
    if (vaultFiles.length > 0) {
      this.selectedMentionIndex = firstVaultFileIndex;
    } else {
      this.selectedMentionIndex = 0;
    }
    this.renderMentionDropdown();
  }
  renderMentionDropdown() {
    this.dropdown.render({
      items: this.filteredMentionItems,
      selectedIndex: this.selectedMentionIndex,
      emptyText: this.externalContextLoading ? "Scanning external context..." : "No matches",
      getItemClass: (item) => {
        if (item.type === "context-file") return "context-file";
        if (item.type === "context-folder") return "context-folder";
        if (item.type === "vault-folder") return "vault-folder";
        return void 0;
      },
      renderItem: (item, itemEl) => {
        const iconEl = itemEl.createSpan({ cls: "ocop-mention-icon" });
        if (item.type === "context-file") {
          (0, import_obsidian.setIcon)(iconEl, "folder-open");
        } else if (item.type === "context-folder") {
          (0, import_obsidian.setIcon)(iconEl, "folder");
        } else if (item.type === "vault-folder") {
          (0, import_obsidian.setIcon)(iconEl, "folder");
        } else {
          (0, import_obsidian.setIcon)(iconEl, "file-text");
        }
        const textEl = itemEl.createSpan({ cls: "ocop-mention-text" });
        if (item.type === "context-folder") {
          const nameEl = textEl.createSpan({
            cls: "ocop-mention-name ocop-mention-name-folder"
          });
          nameEl.setText(`@${item.name}/`);
        } else if (item.type === "context-file") {
          const nameEl = textEl.createSpan({
            cls: "ocop-mention-name ocop-mention-name-context"
          });
          nameEl.setText(item.name);
        } else {
          const fullPath = item.path || item.name;
          const { name, folder } = splitMentionPath(fullPath);
          textEl.createSpan({ cls: "ocop-mention-path", text: name || item.name });
          const label = folderLabelFor(folder);
          if (label) {
            const folderEl = textEl.createSpan({ cls: "ocop-mention-folder", text: label });
            folderEl.setAttribute("title", folder);
          }
        }
      },
      onItemClick: (_item, index) => {
        this.selectedMentionIndex = index;
        this.selectMentionItem();
      },
      onItemHover: (_item, index) => {
        this.selectedMentionIndex = index;
      }
    });
    if (this.fixed) {
      this.positionFixed();
    }
  }
  positionFixed() {
    const dropdownEl = this.dropdown.getElement();
    if (!dropdownEl) return;
    const inputRect = this.inputEl.getBoundingClientRect();
    dropdownEl.style.position = "fixed";
    dropdownEl.style.bottom = `${window.innerHeight - inputRect.top + 4}px`;
    dropdownEl.style.left = `${inputRect.left}px`;
    dropdownEl.style.right = "auto";
    dropdownEl.style.width = `${Math.max(inputRect.width, 280)}px`;
    dropdownEl.style.zIndex = "10001";
  }
  selectMentionItem() {
    if (this.filteredMentionItems.length === 0) return;
    const selectedIndex = this.dropdown.getSelectedIndex();
    this.selectedMentionIndex = selectedIndex;
    const selectedItem = this.filteredMentionItems[selectedIndex];
    if (!selectedItem) return;
    const text = this.inputEl.value;
    const beforeAt = text.substring(0, this.mentionStartIndex);
    const cursorPos = this.inputEl.selectionStart || 0;
    const afterCursor = text.substring(cursorPos);
    if (selectedItem.type === "context-folder") {
      const replacement = `@${selectedItem.name}/`;
      this.inputEl.value = beforeAt + replacement + afterCursor;
      this.inputEl.selectionStart = this.inputEl.selectionEnd = beforeAt.length + replacement.length;
      this.inputEl.focus();
      this.handleInputChange();
      return;
    } else if (selectedItem.type === "context-file") {
      const displayName = selectedItem.folderName ? `@${selectedItem.folderName}/${selectedItem.name}` : `@${selectedItem.name}`;
      if (selectedItem.absolutePath) {
        if (this.callbacks.onAttachContextFile) {
          this.callbacks.onAttachContextFile(displayName, selectedItem.absolutePath);
        } else {
          this.callbacks.onAttachFile(selectedItem.absolutePath);
        }
      }
      const replacement = `${displayName} `;
      this.inputEl.value = beforeAt + replacement + afterCursor;
      this.inputEl.selectionStart = this.inputEl.selectionEnd = beforeAt.length + replacement.length;
    } else if (selectedItem.type === "vault-folder") {
      const replacement = `@"${selectedItem.path}/" `;
      this.inputEl.value = beforeAt + replacement + afterCursor;
      this.inputEl.selectionStart = this.inputEl.selectionEnd = beforeAt.length + replacement.length;
      this.inputEl.focus();
      this.hide();
      return;
    } else {
      const file = selectedItem.file;
      if (file) {
        const normalizedPath = this.callbacks.normalizePathForVault(file.path);
        if (normalizedPath) {
          this.callbacks.onAttachFile(normalizedPath);
        }
      } else if (selectedItem.path) {
        const normalizedPath = this.callbacks.normalizePathForVault(selectedItem.path);
        if (normalizedPath) {
          this.callbacks.onAttachFile(normalizedPath);
        }
      }
      const replacement = `@${selectedItem.name} `;
      this.inputEl.value = beforeAt + replacement + afterCursor;
      this.inputEl.selectionStart = this.inputEl.selectionEnd = beforeAt.length + replacement.length;
    }
    this.hide();
    this.inputEl.focus();
  }
};

// src/ui/components/file-context/state/FileContextState.ts
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var FileContextState = class {
  constructor() {
    this.attachedFiles = /* @__PURE__ */ new Set();
    /** Files that are explicitly attached (via command or @-mention) and won't be replaced. */
    this.pinnedFiles = /* @__PURE__ */ new Set();
    this.sessionStarted = false;
    this.currentNoteSent = false;
    /** Maps display name (e.g., "@folder/file.ts") to absolute path for context files. */
    this.contextFileMap = /* @__PURE__ */ new Map();
  }
  getAttachedFiles() {
    return new Set(this.attachedFiles);
  }
  getPinnedFiles() {
    return new Set(this.pinnedFiles);
  }
  /** Check if there are any pinned files. */
  hasPinnedFiles() {
    return this.pinnedFiles.size > 0;
  }
  hasSentCurrentNote() {
    return this.currentNoteSent;
  }
  markCurrentNoteSent() {
    this.currentNoteSent = true;
  }
  isSessionStarted() {
    return this.sessionStarted;
  }
  startSession() {
    this.sessionStarted = true;
  }
  resetForNewConversation() {
    this.sessionStarted = false;
    this.currentNoteSent = false;
    this.attachedFiles.clear();
    this.pinnedFiles.clear();
    this.contextFileMap.clear();
  }
  resetForLoadedConversation(hasMessages) {
    this.currentNoteSent = hasMessages;
    this.attachedFiles.clear();
    this.pinnedFiles.clear();
    this.contextFileMap.clear();
    this.sessionStarted = hasMessages;
  }
  setAttachedFiles(files) {
    this.attachedFiles.clear();
    for (const file of files) {
      this.attachedFiles.add(file);
    }
  }
  attachFile(path16) {
    this.attachedFiles.add(path16);
  }
  /** Pin a file (explicitly attached, won't be auto-replaced). */
  pinFile(path16) {
    this.attachedFiles.add(path16);
    this.pinnedFiles.add(path16);
  }
  /** Check if a file is pinned. */
  isPinned(path16) {
    return this.pinnedFiles.has(path16);
  }
  /** Unpin a file (keeps it attached but allows auto-replacement). */
  unpinFile(path16) {
    this.pinnedFiles.delete(path16);
  }
  /** Attach a context file with display name to absolute path mapping. */
  attachContextFile(displayName, absolutePath) {
    this.attachedFiles.add(absolutePath);
    this.pinnedFiles.add(absolutePath);
    this.contextFileMap.set(displayName, absolutePath);
  }
  detachFile(path16) {
    this.attachedFiles.delete(path16);
    this.pinnedFiles.delete(path16);
  }
  clearAttachments() {
    this.attachedFiles.clear();
    this.contextFileMap.clear();
  }
  /** Clear only non-pinned attachments (for when opening new files). */
  clearNonPinnedAttachments() {
    const toRemove = [];
    for (const file of this.attachedFiles) {
      if (!this.pinnedFiles.has(file)) {
        toRemove.push(file);
      }
    }
    for (const file of toRemove) {
      this.attachedFiles.delete(file);
    }
  }
  /** Transform text by replacing context file display names with absolute paths. */
  transformContextMentions(text) {
    let result = text;
    for (const [displayName, absolutePath] of this.contextFileMap) {
      result = result.replace(new RegExp(escapeRegExp(displayName), "g"), absolutePath);
    }
    return result;
  }
};

// src/ui/components/file-context/state/MarkdownFileCache.ts
var MarkdownFileCache = class {
  constructor(app) {
    this.cachedFiles = [];
    this.dirty = true;
    this.app = app;
  }
  markDirty() {
    this.dirty = true;
  }
  getFiles() {
    if (this.dirty || this.cachedFiles.length === 0) {
      this.cachedFiles = this.app.vault.getMarkdownFiles();
      this.dirty = false;
    }
    return this.cachedFiles;
  }
};

// src/ui/components/file-context/view/FileChipsView.ts
var import_obsidian2 = require("obsidian");
var FileChipsView = class {
  constructor(containerEl, callbacks) {
    /** Current note path (shown first). */
    this.currentNotePath = null;
    /** Additional attached file paths (shown after current note). */
    this.attachedPaths = /* @__PURE__ */ new Set();
    /** Pinned file paths (won't be auto-replaced). */
    this.pinnedPaths = /* @__PURE__ */ new Set();
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    const firstChild = this.containerEl.firstChild;
    this.fileIndicatorEl = this.containerEl.createDiv({ cls: "ocop-file-indicator" });
    if (firstChild) {
      this.containerEl.insertBefore(this.fileIndicatorEl, firstChild);
    }
  }
  destroy() {
    this.fileIndicatorEl.remove();
  }
  /** Renders chip for the current/focus note only (legacy method). */
  renderCurrentNote(filePath) {
    this.currentNotePath = filePath;
    this.renderAllChips();
  }
  /** Updates the list of attached files (from @-mentions). */
  setAttachedFiles(paths) {
    this.attachedPaths = new Set(paths);
    this.renderAllChips();
  }
  /** Updates the list of pinned files. */
  setPinnedFiles(paths) {
    this.pinnedPaths = new Set(paths);
    this.renderAllChips();
  }
  /** Add a single attached file. */
  addAttachedFile(path16) {
    this.attachedPaths.add(path16);
    this.renderAllChips();
  }
  /** Remove a single attached file. */
  removeAttachedFile(path16) {
    this.attachedPaths.delete(path16);
    this.renderAllChips();
  }
  /** Clear all attached files. */
  clearAttachedFiles() {
    this.attachedPaths.clear();
    this.pinnedPaths.clear();
    this.renderAllChips();
  }
  /** Renders all file chips (current note + attached files). */
  renderAllChips() {
    this.fileIndicatorEl.empty();
    const pathsToShow = [];
    if (this.currentNotePath) {
      pathsToShow.push(this.currentNotePath);
    }
    for (const path16 of this.attachedPaths) {
      if (path16 !== this.currentNotePath) {
        pathsToShow.push(path16);
      }
    }
    if (pathsToShow.length === 0) {
      this.fileIndicatorEl.style.display = "none";
      return;
    }
    this.fileIndicatorEl.style.display = "flex";
    for (const filePath of pathsToShow) {
      const isCurrentNote = filePath === this.currentNotePath;
      const isPinned = this.pinnedPaths.has(filePath);
      this.renderFileChip(filePath, isCurrentNote, isPinned);
    }
  }
  renderFileChip(filePath, isCurrentNote, isPinned) {
    const chipEl = this.fileIndicatorEl.createDiv({ cls: "ocop-file-chip" });
    let badgeText = "ATTACHED";
    if (isPinned) {
      chipEl.addClass("ocop-file-chip-pinned");
      badgeText = "PINNED";
    } else if (isCurrentNote) {
      chipEl.addClass("ocop-file-chip-current");
      badgeText = "CURRENT";
    } else {
      chipEl.addClass("ocop-file-chip-attached");
    }
    const iconEl = chipEl.createSpan({ cls: "ocop-file-chip-icon" });
    (0, import_obsidian2.setIcon)(iconEl, "file-text");
    const normalizedPath = filePath.replace(/\\/g, "/");
    const filename = normalizedPath.split("/").pop() || filePath;
    chipEl.createSpan({ cls: "ocop-file-chip-badge", text: badgeText });
    const nameEl = chipEl.createSpan({ cls: "ocop-file-chip-name" });
    nameEl.setText(filename);
    nameEl.setAttribute("title", filePath);
    chipEl.addEventListener("click", (e) => {
      const target = e.target;
      if (!target.closest(".ocop-file-chip-pin") && !target.closest(".ocop-file-chip-remove")) {
        this.callbacks.onOpenFile(filePath);
      }
    });
    const pinEl = chipEl.createSpan({ cls: "ocop-file-chip-pin" });
    (0, import_obsidian2.setIcon)(pinEl, isPinned ? "pin-off" : "pin");
    pinEl.setAttribute("aria-label", isPinned ? "Unpin (allow auto-change)" : "Pin (keep attached)");
    pinEl.setAttribute("title", isPinned ? "\u{1F4CC} Pinned - Click to unpin" : "Click to pin this note");
    pinEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.callbacks.onTogglePin(filePath, !isPinned);
    });
    const removeEl = chipEl.createSpan({ cls: "ocop-file-chip-remove" });
    removeEl.setText("\xD7");
    removeEl.setAttribute("aria-label", "Remove");
    removeEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.callbacks.onRemoveAttachment(filePath);
    });
  }
};

// src/ui/components/FileContext.ts
function isVaultFileCandidate2(value) {
  return !!value && typeof value === "object" && "path" in value;
}
var FileContextManager = class {
  constructor(app, containerEl, inputEl, callbacks) {
    this.deleteEventRef = null;
    this.renameEventRef = null;
    // Current note (shown as chip)
    this.currentNotePath = null;
    this.app = app;
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.state = new FileContextState();
    this.fileCache = new MarkdownFileCache(this.app);
    this.chipsView = new FileChipsView(this.containerEl, {
      onRemoveAttachment: (filePath) => {
        if (filePath === this.currentNotePath) {
          this.currentNotePath = null;
        }
        this.state.detachFile(filePath);
        this.refreshAllChips();
      },
      onOpenFile: async (filePath) => {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof import_obsidian3.TFile)) {
          new import_obsidian3.Notice(`Could not open file: ${filePath}`);
          return;
        }
        try {
          await this.app.workspace.getLeaf().openFile(file);
        } catch (error) {
          new import_obsidian3.Notice(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      onTogglePin: (filePath, shouldPin) => {
        if (shouldPin) {
          this.state.pinFile(filePath);
          new import_obsidian3.Notice(`\u{1F4CC} Pinned: ${filePath.split("/").pop()}`);
        } else {
          this.state.unpinFile(filePath);
          new import_obsidian3.Notice(`Unpinned: ${filePath.split("/").pop()}`);
        }
        this.refreshAllChips();
      }
    });
    this.mentionDropdown = new MentionDropdownController(
      this.containerEl,
      this.inputEl,
      {
        onAttachFile: (filePath) => {
          this.state.attachFile(filePath);
          this.refreshAllChips();
        },
        onAttachContextFile: (displayName, absolutePath) => {
          this.state.attachContextFile(displayName, absolutePath);
          this.refreshAllChips();
        },
        getExternalContexts: () => {
          var _a, _b;
          return ((_b = (_a = this.callbacks).getExternalContexts) == null ? void 0 : _b.call(_a)) || [];
        },
        getCachedMarkdownFiles: () => this.fileCache.getFiles(),
        getVaultFolders: () => this.listVaultFolders(),
        // The note in front of the student, not the one already sent as
        // context — folder ranking should follow where they are looking.
        getCurrentNotePath: () => {
          var _a, _b;
          return (_b = (_a = this.app.workspace.getActiveFile()) == null ? void 0 : _a.path) != null ? _b : this.getCurrentNotePath();
        },
        normalizePathForVault: (rawPath) => this.normalizePathForVault(rawPath)
      }
    );
    this.deleteEventRef = this.app.vault.on("delete", (file) => {
      if (file instanceof import_obsidian3.TFile) this.handleFileDeleted(file.path);
    });
    this.renameEventRef = this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof import_obsidian3.TFile) this.handleFileRenamed(oldPath, file.path);
    });
  }
  /** Returns the current note path (shown as chip). */
  /**
   * Folder paths in the vault, root excluded. Read from the already-loaded file
   * list rather than walked, so opening the @ menu costs nothing extra.
   */
  listVaultFolders() {
    var _a, _b;
    const loaded = (_b = (_a = this.app.vault).getAllLoadedFiles) == null ? void 0 : _b.call(_a);
    if (!Array.isArray(loaded)) return [];
    const folders = /* @__PURE__ */ new Set();
    for (const entry of loaded) {
      const candidate = entry;
      const isFolder = Array.isArray(candidate.children) || candidate.stat === void 0;
      if (!isFolder || typeof candidate.path !== "string") continue;
      const path16 = candidate.path.replace(/\\/g, "/").replace(/\/+$/, "");
      if (path16 && path16 !== "/") folders.add(path16);
    }
    return [...folders];
  }
  getCurrentNotePath() {
    return this.currentNotePath;
  }
  /** Checks whether current note should be sent for this session. */
  shouldSendCurrentNote(notePath) {
    const resolvedPath = notePath != null ? notePath : this.currentNotePath;
    return !!resolvedPath && !this.state.hasSentCurrentNote();
  }
  /** Marks current note as sent (call after sending a message). */
  markCurrentNoteSent() {
    this.state.markCurrentNoteSent();
  }
  isSessionStarted() {
    return this.state.isSessionStarted();
  }
  startSession() {
    this.state.startSession();
  }
  /** Resets state for a new conversation. */
  resetForNewConversation() {
    this.currentNotePath = null;
    this.state.resetForNewConversation();
    this.refreshAllChips();
  }
  /** Resets state for loading an existing conversation. */
  resetForLoadedConversation(hasMessages) {
    this.currentNotePath = null;
    this.state.resetForLoadedConversation(hasMessages);
    this.refreshAllChips();
  }
  /** Sets current note (for restoring persisted state). */
  setCurrentNote(notePath) {
    this.currentNotePath = notePath;
    if (notePath) {
      this.state.attachFile(notePath);
    }
    this.refreshAllChips();
  }
  /** Auto-attaches the currently focused file (for new sessions). */
  autoAttachActiveFile() {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && !this.hasExcludedTag(activeFile)) {
      const normalizedPath = this.normalizePathForVault(activeFile.path);
      if (normalizedPath) {
        this.currentNotePath = normalizedPath;
        this.state.attachFile(normalizedPath);
        this.refreshAllChips();
      }
    }
  }
  /** Attaches a file from a command (e.g., "Attach current note to chat"). */
  attachFileFromCommand(filePath) {
    const normalizedPath = this.normalizePathForVault(filePath);
    if (!normalizedPath) return;
    if (this.state.getAttachedFiles().has(normalizedPath)) {
      return;
    }
    this.state.pinFile(normalizedPath);
    this.refreshAllChips();
  }
  /** Handles file open event. */
  handleFileOpen(file) {
    const normalizedPath = this.normalizePathForVault(file.path);
    if (!normalizedPath) return;
    if (this.state.hasPinnedFiles()) {
      return;
    }
    if (this.state.isSessionStarted()) {
      return;
    }
    this.state.clearNonPinnedAttachments();
    if (!this.hasExcludedTag(file)) {
      this.currentNotePath = normalizedPath;
      this.state.attachFile(normalizedPath);
    } else {
      this.currentNotePath = null;
    }
    this.refreshAllChips();
  }
  markFilesCacheDirty() {
    this.fileCache.markDirty();
  }
  /** Handles input changes to detect @ mentions. */
  handleInputChange() {
    this.mentionDropdown.handleInputChange();
  }
  /** Handles keyboard navigation in mention dropdown. Returns true if handled. */
  handleMentionKeydown(e) {
    return this.mentionDropdown.handleKeydown(e);
  }
  isMentionDropdownVisible() {
    return this.mentionDropdown.isVisible();
  }
  hideMentionDropdown() {
    this.mentionDropdown.hide();
  }
  containsElement(el) {
    return this.mentionDropdown.containsElement(el);
  }
  /** Transform context file mentions (e.g., @folder/file.ts) to absolute paths. */
  transformContextMentions(text) {
    return this.transformVaultMentions(this.state.transformContextMentions(text));
  }
  transformVaultMentions(text) {
    var _a;
    const pattern = /(^|[^\w])@(?:"([^"]+)"|'([^']+)'|([^\s]+\.\w+))/g;
    const matches = [];
    let match = pattern.exec(text);
    while (match !== null) {
      matches.push({
        full: match[0],
        prefix: (_a = match[1]) != null ? _a : "",
        rawPath: match[2] || match[3] || match[4],
        index: match.index
      });
      match = pattern.exec(text);
    }
    let result = text;
    for (let i = matches.length - 1; i >= 0; i--) {
      const entry = matches[i];
      const resolved = this.resolveVaultMentionPath(entry.rawPath);
      if (!resolved) {
        continue;
      }
      result = result.slice(0, entry.index) + entry.prefix + resolved + result.slice(entry.index + entry.full.length);
    }
    return result;
  }
  resolveVaultMentionPath(rawPath) {
    const normalizedRaw = rawPath.replace(/\\/g, "/");
    const exact = this.app.vault.getAbstractFileByPath(normalizedRaw);
    if (isVaultFileCandidate2(exact)) {
      return exact.path;
    }
    const allFiles = this.fileCache.getFiles();
    const needle = normalizedRaw.toLowerCase();
    const basenameMatches = allFiles.filter((file) => file.name.toLowerCase() === needle);
    if (basenameMatches.length === 1) {
      return basenameMatches[0].path;
    }
    const suffixMatches = allFiles.filter((file) => file.path.toLowerCase().endsWith(`/${needle}`));
    if (suffixMatches.length === 1) {
      return suffixMatches[0].path;
    }
    return null;
  }
  /**
   * Resolves a dropped reference to a vault path. Accepts a vault-relative path, a bare
   * note name, or an absolute path that happens to sit inside the vault; returns null when
   * nothing matches, so the caller can say so instead of dropping it on the floor.
   */
  resolveDroppedRef(rawRef) {
    const normalized = this.normalizePathForVault(rawRef);
    for (const candidate of [normalized, rawRef]) {
      if (!candidate) continue;
      const resolved = this.resolveVaultMentionPath(candidate);
      if (resolved) return resolved;
      if (!/\.[A-Za-z0-9]{1,8}$/.test(candidate)) {
        const withExtension = this.resolveVaultMentionPath(`${candidate}.md`);
        if (withExtension) return withExtension;
      }
    }
    return null;
  }
  /** Cleans up event listeners (call on view close). */
  destroy() {
    if (this.deleteEventRef) this.app.vault.offref(this.deleteEventRef);
    if (this.renameEventRef) this.app.vault.offref(this.renameEventRef);
    this.mentionDropdown.destroy();
    this.chipsView.destroy();
  }
  /** Normalizes a file path to be vault-relative with forward slashes. */
  normalizePathForVault(rawPath) {
    if (!rawPath) return null;
    const normalizedRaw = normalizePathForFilesystem(rawPath);
    const vaultPath = getVaultPath(this.app);
    if (vaultPath && isPathWithinVault(normalizedRaw, vaultPath)) {
      const absolute = path9.isAbsolute(normalizedRaw) ? normalizedRaw : path9.resolve(vaultPath, normalizedRaw);
      const relative5 = path9.relative(vaultPath, absolute);
      if (relative5) {
        return relative5.replace(/\\/g, "/");
      }
      return null;
    }
    return normalizedRaw.replace(/\\/g, "/");
  }
  /** Refreshes all file chips (current note + attached files + pinned status). */
  refreshAllChips() {
    var _a, _b;
    this.chipsView.renderCurrentNote(this.currentNotePath);
    this.chipsView.setAttachedFiles(this.state.getAttachedFiles());
    this.chipsView.setPinnedFiles(this.state.getPinnedFiles());
    (_b = (_a = this.callbacks).onChipsChanged) == null ? void 0 : _b.call(_a);
  }
  handleFileRenamed(oldPath, newPath) {
    const normalizedOld = this.normalizePathForVault(oldPath);
    const normalizedNew = this.normalizePathForVault(newPath);
    if (!normalizedOld) return;
    let needsUpdate = false;
    if (this.currentNotePath === normalizedOld) {
      this.currentNotePath = normalizedNew;
      needsUpdate = true;
    }
    if (this.state.getAttachedFiles().has(normalizedOld)) {
      this.state.detachFile(normalizedOld);
      if (normalizedNew) {
        this.state.attachFile(normalizedNew);
      }
      needsUpdate = true;
    }
    if (needsUpdate) {
      this.refreshAllChips();
    }
  }
  handleFileDeleted(deletedPath) {
    const normalized = this.normalizePathForVault(deletedPath);
    if (!normalized) return;
    let needsUpdate = false;
    if (this.currentNotePath === normalized) {
      this.currentNotePath = null;
      needsUpdate = true;
    }
    if (this.state.getAttachedFiles().has(normalized)) {
      this.state.detachFile(normalized);
      needsUpdate = true;
    }
    if (needsUpdate) {
      this.refreshAllChips();
    }
  }
  /**
   * Pre-scans external context paths in the background to warm the cache.
   * Should be called when external context paths are added/changed.
   */
  preScanExternalContexts() {
    this.mentionDropdown.preScanExternalContexts();
  }
  hasExcludedTag(file) {
    var _a;
    const excludedTags = this.callbacks.getExcludedTags();
    if (excludedTags.length === 0) return false;
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return false;
    const fileTags = [];
    if ((_a = cache.frontmatter) == null ? void 0 : _a.tags) {
      const fmTags = cache.frontmatter.tags;
      if (Array.isArray(fmTags)) {
        fileTags.push(...fmTags.map((t) => t.replace(/^#/, "")));
      } else if (typeof fmTags === "string") {
        fileTags.push(fmTags.replace(/^#/, ""));
      }
    }
    if (cache.tags) {
      fileTags.push(...cache.tags.map((t) => t.tag.replace(/^#/, "")));
    }
    return fileTags.some((tag) => excludedTags.includes(tag));
  }
};

// src/ui/components/ImageContext.ts
var import_obsidian4 = require("obsidian");
var path10 = __toESM(require("path"));

// src/utils/dropPayload.ts
var WIKILINK = /\[\[([^\]]+)\]\]/g;
var MARKDOWN_LINK = /\[[^\]]*\]\(([^)]+)\)/g;
var BARE_REFERENCE = /^[\w.\-가-힣][\w./\-\s가-힣]*$/;
function isImage(file) {
  var _a;
  if ((_a = file.type) == null ? void 0 : _a.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i.test(file.name);
}
function stripWikilinkDecoration(target) {
  return target.split("|")[0].split("#")[0].trim();
}
function fromObsidianUrl(line) {
  if (!line.startsWith("obsidian://")) return null;
  const file = /[?&]file=([^&]+)/.exec(line);
  if (!file) return null;
  try {
    return decodeURIComponent(file[1]);
  } catch (e) {
    return file[1];
  }
}
function dropCarriesAttachable(types) {
  if (!types) return false;
  return types.includes("Files") || types.includes("text/plain") || types.includes("text/uri-list");
}
function readDroppedVaultRefs(payload) {
  var _a, _b;
  if (!payload) return [];
  const refs = [];
  const push = (value) => {
    const trimmed = value == null ? void 0 : value.trim();
    if (trimmed && !refs.includes(trimmed)) refs.push(trimmed);
  };
  const files = payload.files;
  if (files && files.length > 0) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file || isImage(file)) continue;
      push(file.path || file.name);
    }
    return refs;
  }
  const text = (_b = (_a = payload.getData) == null ? void 0 : _a.call(payload, "text/plain")) != null ? _b : "";
  if (!text.trim()) return refs;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const url = fromObsidianUrl(trimmed);
    if (url) {
      push(url);
      continue;
    }
    let matched = false;
    for (const match of trimmed.matchAll(WIKILINK)) {
      push(stripWikilinkDecoration(match[1]));
      matched = true;
    }
    for (const match of trimmed.matchAll(MARKDOWN_LINK)) {
      push(match[1]);
      matched = true;
    }
    if (matched) continue;
    if (!BARE_REFERENCE.test(trimmed)) continue;
    if (trimmed.includes("/") || /\.[A-Za-z0-9]{1,8}$/.test(trimmed)) push(trimmed);
  }
  return refs;
}

// src/ui/components/ImageContext.ts
var MAX_IMAGE_SIZE = 5 * 1024 * 1024;
var IMAGE_EXTENSIONS = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp"
};
var ImageContextManager = class {
  constructor(app, containerEl, inputEl, callbacks) {
    this.dropOverlay = null;
    this.attachedImages = /* @__PURE__ */ new Map();
    this.app = app;
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    const fileIndicator = this.containerEl.querySelector(".ocop-file-indicator");
    this.imagePreviewEl = this.containerEl.createDiv({ cls: "ocop-image-preview" });
    if (fileIndicator) {
      this.containerEl.insertBefore(this.imagePreviewEl, fileIndicator);
    }
    this.setupDragAndDrop();
    this.setupPasteHandler();
  }
  getAttachedImages() {
    return Array.from(this.attachedImages.values());
  }
  hasImages() {
    return this.attachedImages.size > 0;
  }
  clearImages() {
    this.attachedImages.clear();
    this.updateImagePreview();
    this.callbacks.onImagesChanged();
  }
  /** Sets images directly (used for queued messages). */
  setImages(images) {
    this.attachedImages.clear();
    for (const image of images) {
      this.attachedImages.set(image.id, image);
    }
    this.updateImagePreview();
    this.callbacks.onImagesChanged();
  }
  setupDragAndDrop() {
    let inputWrapper = this.containerEl.querySelector(".ocop-input-wrapper");
    if (!inputWrapper) {
      const parent = this.containerEl.closest(".ocop-input-container");
      if (parent) {
        inputWrapper = parent.querySelector(".ocop-input-wrapper");
      }
    }
    if (!inputWrapper) {
      console.warn("[ImageContext] Input wrapper not found, drag and drop disabled");
      return;
    }
    this.dropOverlay = inputWrapper.createDiv({ cls: "ocop-drop-overlay" });
    const dropContent = this.dropOverlay.createDiv({ cls: "ocop-drop-content" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "32");
    svg.setAttribute("height", "32");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4");
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", "17 8 12 3 7 8");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "12");
    line.setAttribute("y1", "3");
    line.setAttribute("x2", "12");
    line.setAttribute("y2", "15");
    svg.appendChild(pathEl);
    svg.appendChild(polyline);
    svg.appendChild(line);
    dropContent.appendChild(svg);
    dropContent.createSpan({ text: "\uB178\uD2B8\uB098 \uC774\uBBF8\uC9C0\uB97C \uC5EC\uAE30\uC5D0 \uB193\uC73C\uC138\uC694" });
    const dropZone = inputWrapper;
    dropZone.addEventListener("dragenter", (e) => this.handleDragEnter(e));
    dropZone.addEventListener("dragover", (e) => this.handleDragOver(e));
    dropZone.addEventListener("dragleave", (e) => this.handleDragLeave(e));
    dropZone.addEventListener("drop", (e) => this.handleDrop(e));
  }
  handleDragEnter(e) {
    var _a, _b;
    e.preventDefault();
    e.stopPropagation();
    if (dropCarriesAttachable((_a = e.dataTransfer) == null ? void 0 : _a.types)) {
      (_b = this.dropOverlay) == null ? void 0 : _b.addClass("visible");
    }
  }
  handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  handleDragLeave(e) {
    var _a, _b;
    e.preventDefault();
    e.stopPropagation();
    const inputWrapper = this.containerEl.querySelector(".ocop-input-wrapper");
    if (!inputWrapper) {
      (_a = this.dropOverlay) == null ? void 0 : _a.removeClass("visible");
      return;
    }
    const rect = inputWrapper.getBoundingClientRect();
    if (e.clientX <= rect.left || e.clientX >= rect.right || e.clientY <= rect.top || e.clientY >= rect.bottom) {
      (_b = this.dropOverlay) == null ? void 0 : _b.removeClass("visible");
    }
  }
  async handleDrop(e) {
    var _a, _b, _c, _d;
    e.preventDefault();
    e.stopPropagation();
    (_a = this.dropOverlay) == null ? void 0 : _a.removeClass("visible");
    const files = (_b = e.dataTransfer) == null ? void 0 : _b.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (this.isImageFile(file)) {
          await this.addImageFromFile(file, "drop");
        }
      }
    }
    const refs = readDroppedVaultRefs(e.dataTransfer);
    if (refs.length > 0) (_d = (_c = this.callbacks).onVaultRefsDropped) == null ? void 0 : _d.call(_c, refs);
  }
  setupPasteHandler() {
    this.inputEl.addEventListener("paste", async (e) => {
      var _a;
      const items = (_a = e.clipboardData) == null ? void 0 : _a.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            await this.addImageFromFile(file, "paste");
          }
          return;
        }
      }
    });
  }
  isImageFile(file) {
    return file.type.startsWith("image/") && this.getMediaType(file.name) !== null;
  }
  getMediaType(filename) {
    const ext = path10.extname(filename).toLowerCase();
    return IMAGE_EXTENSIONS[ext] || null;
  }
  async addImageFromFile(file, source) {
    if (file.size > MAX_IMAGE_SIZE) {
      this.notifyImageError(`Image exceeds ${this.formatSize(MAX_IMAGE_SIZE)} limit.`);
      return false;
    }
    const mediaType = this.getMediaType(file.name) || file.type;
    if (!mediaType) {
      this.notifyImageError("Unsupported image type.");
      return false;
    }
    try {
      const { buffer, base64 } = await this.fileToBufferAndBase64(file);
      const cacheEntry = saveImageToCache(this.app, buffer, mediaType, file.name);
      if (!cacheEntry) {
        this.notifyImageError("Failed to save image to cache.");
        return false;
      }
      const attachment = {
        id: this.generateId(),
        name: file.name || `image-${Date.now()}.${mediaType.split("/")[1]}`,
        mediaType,
        data: base64,
        cachePath: cacheEntry.relPath,
        size: file.size,
        source
      };
      this.attachedImages.set(attachment.id, attachment);
      this.updateImagePreview();
      this.callbacks.onImagesChanged();
      return true;
    } catch (error) {
      this.notifyImageError("Failed to attach image.", error);
      return false;
    }
  }
  async fileToBufferAndBase64(file) {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return {
      buffer,
      base64: buffer.toString("base64")
    };
  }
  // ============================================
  // Private: Image Preview
  // ============================================
  updateImagePreview() {
    this.imagePreviewEl.empty();
    if (this.attachedImages.size === 0) {
      this.imagePreviewEl.style.display = "none";
      return;
    }
    this.imagePreviewEl.style.display = "flex";
    for (const [id, image] of this.attachedImages) {
      this.renderImagePreview(id, image);
    }
  }
  renderImagePreview(id, image) {
    const previewEl = this.imagePreviewEl.createDiv({ cls: "ocop-image-chip" });
    const thumbEl = previewEl.createDiv({ cls: "ocop-image-thumb" });
    thumbEl.createEl("img", {
      attr: {
        src: `data:${image.mediaType};base64,${image.data}`,
        alt: image.name
      }
    });
    const infoEl = previewEl.createDiv({ cls: "ocop-image-info" });
    const nameEl = infoEl.createSpan({ cls: "ocop-image-name" });
    nameEl.setText(this.truncateName(image.name, 20));
    nameEl.setAttribute("title", image.name);
    const sizeEl = infoEl.createSpan({ cls: "ocop-image-size" });
    sizeEl.setText(this.formatSize(image.size));
    const removeEl = previewEl.createSpan({ cls: "ocop-image-remove" });
    removeEl.setText("\xD7");
    removeEl.setAttribute("aria-label", "Remove image");
    removeEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.attachedImages.delete(id);
      this.updateImagePreview();
      this.callbacks.onImagesChanged();
    });
    thumbEl.addEventListener("click", () => {
      this.showFullImage(image);
    });
  }
  showFullImage(image) {
    const overlay = document.body.createDiv({ cls: "ocop-image-modal-overlay" });
    const modal = overlay.createDiv({ cls: "ocop-image-modal" });
    modal.createEl("img", {
      attr: {
        src: `data:${image.mediaType};base64,${image.data}`,
        alt: image.name
      }
    });
    const closeBtn = modal.createDiv({ cls: "ocop-image-modal-close" });
    closeBtn.setText("\xD7");
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        close();
      }
    };
    const close = () => {
      document.removeEventListener("keydown", handleEsc);
      overlay.remove();
    };
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", handleEsc);
  }
  generateId() {
    return `img-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
  truncateName(name, maxLen) {
    if (name.length <= maxLen) return name;
    const ext = path10.extname(name);
    const base = name.slice(0, name.length - ext.length);
    const truncatedBase = base.slice(0, maxLen - ext.length - 3);
    return `${truncatedBase}...${ext}`;
  }
  formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  notifyImageError(message, error) {
    if (error) {
      console.error(message, error);
    } else {
      console.warn(message);
    }
    let userMessage = message;
    if (error instanceof Error) {
      if (error.message.includes("ENOENT") || error.message.includes("no such file")) {
        userMessage = `${message} (File not found)`;
      } else if (error.message.includes("EACCES") || error.message.includes("permission denied")) {
        userMessage = `${message} (Permission denied)`;
      }
    }
    new import_obsidian4.Notice(userMessage);
  }
};

// src/ui/components/InputToolbar.ts
var import_obsidian5 = require("obsidian");
var os4 = __toESM(require("os"));
init_providerRegistry();

// src/utils/folderDialog.ts
function readDialog(candidate) {
  const dialog = candidate == null ? void 0 : candidate.dialog;
  const hasPicker = typeof (dialog == null ? void 0 : dialog.showOpenDialog) === "function";
  return hasPicker ? dialog : null;
}
function resolveFolderDialog(moduleRequire) {
  if (typeof moduleRequire !== "function") return null;
  for (const attempt of [
    () => readDialog(moduleRequire("@electron/remote")),
    () => {
      var _a;
      return readDialog((_a = moduleRequire("electron")) == null ? void 0 : _a.remote);
    }
  ]) {
    try {
      const dialog = attempt();
      if (dialog) return dialog;
    } catch (e) {
    }
  }
  return null;
}

// src/ui/components/InputToolbar.ts
function toToolbarSettings(settings) {
  return {
    model: settings.model,
    selectedProvider: settings.selectedProvider,
    thinkingBudget: settings.thinkingBudget,
    permissionMode: settings.permissionMode,
    lastNonPlanPermissionMode: settings.lastNonPlanPermissionMode,
    providerModels: settings.providerModels,
    providerEfforts: settings.providerEfforts,
    blanketWriteAcknowledged: settings.blanketWriteAcknowledged
  };
}
function getProviderGroup(model) {
  if (model === "auto") return "recommended";
  if (model.startsWith("gpt-")) return "openai";
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gemini-")) return "google";
  if (model.startsWith("raptor-")) return "github";
  return "other";
}
function getCostOrder(costLabel) {
  var _a;
  const order = {
    best: 0,
    "0x": 1,
    "0.33x": 2,
    "1x": 3,
    "3x": 4
  };
  return (_a = order[costLabel]) != null ? _a : 99;
}
function getProviderOrder(provider) {
  var _a;
  const order = {
    recommended: 0,
    openai: 1,
    anthropic: 2,
    google: 3,
    github: 4,
    other: 5
  };
  return (_a = order[provider]) != null ? _a : 99;
}
function getProviderLabel(provider) {
  var _a;
  const labels = {
    recommended: "recommended",
    openai: "openai",
    anthropic: "anthropic",
    google: "google",
    github: "github",
    other: "other"
  };
  return (_a = labels[provider]) != null ? _a : provider;
}
function getModelSelectorLabel(provider, model, providerModels) {
  var _a, _b, _c;
  if (provider !== "copilot") return ((_a = providerModels == null ? void 0 : providerModels[provider]) == null ? void 0 : _a.trim()) || "\uBAA8\uB378 \uC120\uD0DD";
  return (_c = (_b = COPILOT_MODELS.find((option) => option.value === model)) == null ? void 0 : _b.label) != null ? _c : COPILOT_MODELS[0].label;
}
var ModelSelector = class {
  constructor(parentEl, callbacks) {
    this.buttonEl = null;
    this.dropdownEl = null;
    this.nativeModels = /* @__PURE__ */ new Map();
    /** Providers whose CLI we actually asked. Absent != empty: the dropdown opens on hover
     *  but discovery runs on click, so without this an un-asked CLI reads as a failed one. */
    this.nativeModelsAttempted = /* @__PURE__ */ new Set();
    this.nativeModelsLoading = false;
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: "ocop-model-selector" });
    this.render();
  }
  getAvailableModels() {
    return [...COPILOT_MODELS];
  }
  isCopilotSelected() {
    return this.callbacks.getSettings().selectedProvider === "copilot";
  }
  render() {
    this.container.empty();
    this.buttonEl = this.container.createDiv({ cls: "ocop-model-btn" });
    this.buttonEl.setAttribute("role", "button");
    this.buttonEl.setAttribute("tabindex", "0");
    this.buttonEl.setAttribute("aria-haspopup", "listbox");
    this.buttonEl.setAttribute("aria-expanded", "false");
    this.buttonEl.addEventListener("click", (event) => {
      var _a, _b;
      event.stopPropagation();
      const isOpen = ((_a = this.buttonEl) == null ? void 0 : _a.getAttribute("aria-expanded")) === "true";
      (_b = this.buttonEl) == null ? void 0 : _b.setAttribute("aria-expanded", String(!isOpen));
      this.container.toggleClass("is-open", !isOpen);
      this.container.removeClass("is-dismissed");
      if (!isOpen) void this.loadNativeModelsIfNeeded();
    });
    this.buttonEl.addEventListener("keydown", (event) => {
      var _a;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      (_a = this.buttonEl) == null ? void 0 : _a.click();
    });
    this.updateDisplay();
    this.dropdownEl = this.container.createDiv({ cls: "ocop-model-dropdown" });
    this.container.addEventListener("mouseleave", () => this.container.removeClass("is-dismissed"));
    this.renderOptions();
  }
  /**
   * Closes the dropdown after a choice. `is-dismissed` outranks the `:hover` rule so the menu
   * stays shut while the pointer travels across it toward the message box; leaving the
   * selector clears it, so hover-to-open still works the next time.
   */
  dismiss() {
    var _a;
    this.container.removeClass("is-open");
    this.container.addClass("is-dismissed");
    (_a = this.buttonEl) == null ? void 0 : _a.setAttribute("aria-expanded", "false");
  }
  async loadNativeModelsIfNeeded() {
    const provider = this.callbacks.getSettings().selectedProvider;
    if (provider === "copilot" || this.nativeModels.has(provider) || this.nativeModelsLoading) return;
    const staticModels = getStaticProviderModels(provider);
    if (staticModels.length > 0) {
      this.nativeModelsAttempted.add(provider);
      this.nativeModels.set(provider, [...staticModels]);
      this.renderOptions();
      return;
    }
    if (!this.callbacks.getNativeProviderModels) return;
    this.nativeModelsLoading = true;
    this.renderOptions();
    try {
      this.nativeModels.set(provider, await this.callbacks.getNativeProviderModels(provider));
    } catch (e) {
      this.nativeModels.set(provider, []);
    } finally {
      this.nativeModelsAttempted.add(provider);
      this.nativeModelsLoading = false;
      this.renderOptions();
    }
  }
  updateDisplay() {
    var _a;
    if (!this.buttonEl) return;
    if (!this.isCopilotSelected()) {
      const settings = this.callbacks.getSettings();
      const provider = settings.selectedProvider;
      this.container.style.display = "";
      this.buttonEl.empty();
      this.buttonEl.createSpan({ cls: "ocop-model-label", text: getModelSelectorLabel(provider, settings.model, settings.providerModels) });
      const effort = this.getActiveEffort(provider);
      if (effort) this.buttonEl.createSpan({ cls: "ocop-model-effort-badge", text: effort });
      this.buttonEl.setAttribute("aria-label", `${provider} \uBAA8\uB378 \uC120\uD0DD`);
      this.buttonEl.removeAttribute("title");
      this.buttonEl.setAttribute("role", "button");
      this.buttonEl.setAttribute("tabindex", "0");
      this.buttonEl.setAttribute("aria-haspopup", "listbox");
      return;
    }
    this.container.style.display = "";
    this.buttonEl.setAttribute("aria-label", "\uBAA8\uB378 \uC120\uD0DD");
    this.buttonEl.removeAttribute("title");
    const currentModel = this.callbacks.getSettings().model;
    const models = this.getAvailableModels();
    const modelInfo = (_a = models.find((model) => model.value === currentModel)) != null ? _a : models[0];
    this.buttonEl.empty();
    this.buttonEl.createSpan({ cls: "ocop-model-label", text: (modelInfo == null ? void 0 : modelInfo.label) || "Unknown" });
    if (modelInfo == null ? void 0 : modelInfo.costLabel) {
      this.buttonEl.createSpan({ cls: "ocop-model-cost", text: modelInfo.costLabel });
    }
  }
  renderOptions() {
    var _a;
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();
    if (!this.isCopilotSelected()) {
      this.dropdownEl.removeAttribute("aria-hidden");
      const provider = this.callbacks.getSettings().selectedProvider;
      const models2 = (_a = this.nativeModels.get(provider)) != null ? _a : getStaticProviderModels(provider);
      if (this.nativeModelsLoading) {
        this.dropdownEl.createDiv({ cls: "ocop-model-native-status", text: "\uC124\uCE58\uB41C CLI\uC5D0\uC11C \uBAA8\uB378\uC744 \uD655\uC778\uD558\uB294 \uC911..." });
      } else if (!this.nativeModelsAttempted.has(provider)) {
        this.dropdownEl.createDiv({ cls: "ocop-model-native-status", text: `\uD074\uB9AD\uD558\uBA74 ${provider} CLI\uC5D0\uC11C \uC0AC\uC6A9 \uAC00\uB2A5\uD55C \uBAA8\uB378\uC744 \uBD88\uB7EC\uC635\uB2C8\uB2E4.` });
      } else if (models2.length === 0) {
        this.dropdownEl.createDiv({ cls: "ocop-model-native-status", text: `${provider} CLI\uC5D0\uC11C \uBAA8\uB378 \uBAA9\uB85D\uC744 \uBC1B\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC544\uB798\uC5D0 \uBAA8\uB378 ID\uB97C \uC9C1\uC811 \uC785\uB825\uD558\uC138\uC694.` });
      } else {
        for (const model of models2) this.addNativeModelOption(provider, model);
      }
      this.addNativeModelEntry(provider);
      this.addEffortRow(provider, models2);
      return;
    }
    this.dropdownEl.removeAttribute("aria-hidden");
    const currentModel = this.callbacks.getSettings().model;
    const models = [...this.getAvailableModels()].sort((a, b) => {
      const costDiff = getCostOrder(a.costLabel) - getCostOrder(b.costLabel);
      if (costDiff !== 0) return costDiff;
      const providerDiff = getProviderOrder(getProviderGroup(a.value)) - getProviderOrder(getProviderGroup(b.value));
      if (providerDiff !== 0) return providerDiff;
      return a.label.localeCompare(b.label);
    });
    let lastCostLabel = null;
    let lastProvider = null;
    for (const model of models) {
      const provider = getProviderGroup(model.value);
      if (model.costLabel !== lastCostLabel) {
        this.dropdownEl.createDiv({ cls: "ocop-model-section-label", text: model.costLabel });
        lastCostLabel = model.costLabel;
        lastProvider = null;
      }
      if (provider !== lastProvider) {
        this.dropdownEl.createDiv({ cls: "ocop-model-provider-label", text: getProviderLabel(provider) });
        lastProvider = provider;
      }
      const option = this.dropdownEl.createDiv({ cls: "ocop-model-option" });
      if (model.value === currentModel) {
        option.addClass("selected");
      }
      const textEl = option.createDiv({ cls: "ocop-model-option-text" });
      textEl.createSpan({ cls: "ocop-model-option-label", text: model.label });
      if (model.description) {
        option.setAttribute("title", model.description);
        textEl.createSpan({ cls: "ocop-model-desc", text: model.description });
      }
      option.createSpan({ cls: "ocop-model-option-cost", text: model.costLabel });
      option.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this.callbacks.onModelChange(model.value);
        this.dismiss();
        this.updateDisplay();
        this.renderOptions();
      });
    }
  }
  getActiveEffort(provider) {
    var _a, _b;
    const stored = ((_b = (_a = this.callbacks.getSettings().providerEfforts) == null ? void 0 : _a[provider]) == null ? void 0 : _b.trim()) || "";
    return getProviderEffortLevels(provider).includes(stored) ? stored : "";
  }
  addNativeModelOption(provider, model) {
    var _a, _b;
    const selected = (((_b = (_a = this.callbacks.getSettings().providerModels) == null ? void 0 : _a[provider]) == null ? void 0 : _b.trim()) || "") === model.id;
    const option = this.dropdownEl.createEl("button", { cls: "ocop-model-option is-native", attr: { type: "button", "aria-pressed": String(selected) } });
    if (selected) option.addClass("selected");
    option.createSpan({ cls: "ocop-model-option-label", text: model.id });
    if (model.label && model.label !== model.id) option.createSpan({ cls: "ocop-model-option-note", text: model.label });
    option.addEventListener("click", async (event) => {
      var _a2, _b2, _c, _d;
      event.stopPropagation();
      await ((_b2 = (_a2 = this.callbacks).onProviderModelChange) == null ? void 0 : _b2.call(_a2, provider, model.id));
      const carried = this.getActiveEffort(provider);
      const incompatible = !allowsEffortWithModel(provider) || !model.efforts.includes(carried);
      if (carried && incompatible) {
        await ((_d = (_c = this.callbacks).onProviderEffortChange) == null ? void 0 : _d.call(_c, provider, ""));
      }
      this.dismiss();
      this.updateDisplay();
      this.renderOptions();
    });
  }
  /**
   * Renders effort only when the installed CLI validated the levels AND the chosen model
   * advertises them. Nothing chosen yet, or an id typed by hand, gets no effort row: we do
   * not know that model's levels, so any chip drawn would be a guess.
   */
  addEffortRow(provider, models) {
    var _a, _b;
    if (!supportsEffortSelection(provider)) return;
    const selectedId = ((_b = (_a = this.callbacks.getSettings().providerModels) == null ? void 0 : _a[provider]) == null ? void 0 : _b.trim()) || "";
    if (!allowsEffortWithModel(provider)) {
      if (selectedId) {
        this.dropdownEl.createDiv({ cls: "ocop-model-native-status", text: `${provider}\uB294 \uBAA8\uB378 \uC774\uB984\uC5D0 \uCD94\uB860 \uAC15\uB3C4\uAC00 \uD3EC\uD568\uB429\uB2C8\uB2E4. \uBAA8\uB378\uC744 \uC120\uD0DD \uD574\uC81C\uD558\uBA74 \uAC15\uB3C4\uB97C \uB530\uB85C \uC9C0\uC815\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.` });
        return;
      }
      this.renderEffortChips(provider, getProviderEffortLevels(provider));
      return;
    }
    const known = models.find((model) => model.id === selectedId);
    if (!known) {
      if (selectedId) this.dropdownEl.createDiv({ cls: "ocop-model-native-status", text: "\uCD94\uB860 \uAC15\uB3C4\uB294 \uC704 \uBAA9\uB85D\uC5D0\uC11C \uBAA8\uB378\uC744 \uACE0\uB974\uBA74 \uD45C\uC2DC\uB429\uB2C8\uB2E4." });
      return;
    }
    const levels = known.efforts.filter((level) => getProviderEffortLevels(provider).includes(level));
    if (levels.length === 0) return;
    this.renderEffortChips(provider, levels);
  }
  renderEffortChips(provider, levels) {
    if (levels.length === 0) return;
    const row = this.dropdownEl.createDiv({ cls: "ocop-model-effort-row" });
    row.createSpan({ cls: "ocop-model-effort-label", text: "\uCD94\uB860 \uAC15\uB3C4" });
    const group = row.createDiv({ cls: "ocop-model-effort-group", attr: { role: "group", "aria-label": "\uCD94\uB860 \uAC15\uB3C4" } });
    const active = this.getActiveEffort(provider);
    const choices = [{ value: "", text: "CLI \uAE30\uBCF8" }, ...levels.map((level) => ({ value: level, text: level }))];
    for (const choice of choices) {
      const isActive = choice.value === active;
      const chip = group.createEl("button", { cls: "ocop-model-effort-chip", attr: { type: "button", "aria-pressed": String(isActive) }, text: choice.text });
      if (isActive) chip.addClass("selected");
      chip.addEventListener("click", async (event) => {
        var _a, _b;
        event.stopPropagation();
        await ((_b = (_a = this.callbacks).onProviderEffortChange) == null ? void 0 : _b.call(_a, provider, choice.value));
        this.dismiss();
        this.updateDisplay();
        this.renderOptions();
      });
    }
  }
  addNativeModelEntry(provider) {
    const input = this.dropdownEl.createEl("input", { cls: "ocop-model-direct-input", attr: { type: "text", placeholder: "\uBAA8\uB378 ID \uC9C1\uC811 \uC785\uB825", "aria-label": "\uBAA8\uB378 ID \uC9C1\uC811 \uC785\uB825" } });
    input.addEventListener("keydown", async (event) => {
      var _a, _b;
      if (event.key !== "Enter") return;
      event.stopPropagation();
      const model = input.value.trim();
      if (!model) return;
      await ((_b = (_a = this.callbacks).onProviderModelChange) == null ? void 0 : _b.call(_a, provider, model));
      this.dismiss();
      this.updateDisplay();
      this.renderOptions();
    });
  }
};
var ThinkingBudgetSelector = class {
  constructor(parentEl, callbacks) {
    this.gearsEl = null;
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: "ocop-thinking-selector" });
    this.render();
  }
  isEnabled() {
    var _a, _b;
    if (this.callbacks.getSettings().selectedProvider !== "copilot") return false;
    const currentModel = this.callbacks.getSettings().model;
    return (_b = (_a = COPILOT_MODELS.find((m) => m.value === currentModel)) == null ? void 0 : _a.supportsReasoning) != null ? _b : false;
  }
  render() {
    this.container.empty();
    this.container.createSpan({ cls: "ocop-thinking-label-text", text: "Thinking:" });
    this.gearsEl = this.container.createDiv({ cls: "ocop-thinking-gears" });
    this.updateDisplay();
    this.container.addEventListener("click", () => {
      void this.cycleThinkingBudget();
    });
  }
  async cycleThinkingBudget() {
    if (!this.isEnabled()) return;
    const levels = ["off", "low", "medium", "high"];
    const current = this.callbacks.getSettings().thinkingBudget;
    const currentIndex = levels.indexOf(current);
    const next = levels[(currentIndex + 1) % levels.length];
    await this.callbacks.onThinkingBudgetChange(next);
    this.updateDisplay();
  }
  updateDisplay() {
    if (!this.gearsEl) return;
    this.gearsEl.empty();
    const isCopilot = this.callbacks.getSettings().selectedProvider === "copilot";
    this.container.style.display = isCopilot ? "" : "none";
    if (!isCopilot) return;
    if (this.isEnabled()) {
      this.container.removeClass("is-disabled");
    } else {
      this.container.addClass("is-disabled");
    }
    const currentBudget = this.callbacks.getSettings().thinkingBudget;
    const currentBudgetInfo = THINKING_BUDGETS.find((b) => b.value === currentBudget);
    const label = (currentBudgetInfo == null ? void 0 : currentBudgetInfo.label) || "off";
    const cls = currentBudget === "off" ? "ocop-thinking-current ocop-thinking-disabled" : "ocop-thinking-current ocop-thinking-active";
    this.gearsEl.createDiv({ cls, text: label });
    this.gearsEl.setAttribute("title", this.isEnabled() ? "Click to change thinking level" : "Thinking not available for this model");
  }
};
var PermissionToggle = class {
  constructor(parentEl, callbacks) {
    this.toggleEl = null;
    this.labelEl = null;
    this.onPlanModeToggle = null;
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: "ocop-permission-toggle" });
    this.render();
  }
  render() {
    this.container.empty();
    this.labelEl = this.container.createSpan({ cls: "ocop-permission-label" });
    this.toggleEl = this.container.createDiv({ cls: "ocop-toggle-switch" });
    this.updateDisplay();
    this.container.addEventListener("click", () => {
      void this.toggle();
    });
  }
  setOnPlanModeToggle(callback) {
    this.onPlanModeToggle = callback;
  }
  setPlanModeActive(_active) {
    this.updateDisplay();
  }
  isPlanModeActive() {
    return this.isPlanModeLocked() || this.isPlanModeRequested();
  }
  isPlanModeLocked() {
    return this.callbacks.getSettings().permissionMode === "plan";
  }
  isPlanModeRequested() {
    var _a, _b, _c;
    return (_c = (_b = (_a = this.callbacks).isPlanModeRequested) == null ? void 0 : _b.call(_a)) != null ? _c : false;
  }
  updateDisplay() {
    if (!this.toggleEl || !this.labelEl) return;
    this.container.removeClass("plan-mode");
    this.container.removeClass("is-unavailable");
    this.labelEl.empty();
    if (!supportsReadOnlyMode(this.callbacks.getSettings().selectedProvider)) {
      this.container.addClass("is-unavailable");
      this.toggleEl.addClass("active");
      this.labelEl.setText("Agent");
      this.container.setAttribute("aria-disabled", "true");
      this.container.setAttribute("title", "\uC774 CLI\uB294 \uC77D\uAE30 \uC804\uC6A9\uC744 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC77D\uAE30\uB9CC \uC2DC\uD0A4\uB824\uBA74 \uB2E4\uB978 provider\uB97C \uACE0\uB974\uC138\uC694.");
      return;
    }
    this.container.removeAttribute("aria-disabled");
    const provider = this.callbacks.getSettings().selectedProvider;
    const blocked = this.needsBlanketWriteConsent(provider);
    if (provider === "agy") {
      this.container.setAttribute("title", "Agent\uB85C \uB450\uBA74 Antigravity\uAC00 \uAE08\uACE0 \uC548\uC5D0\uC11C \uBAA8\uB4E0 \uB3C4\uAD6C\uB97C \uD655\uC778 \uC5C6\uC774 \uC0AC\uC6A9\uD569\uB2C8\uB2E4. Ask\uBA74 \uC544\uBB34\uAC83\uB3C4 \uACE0\uCE58\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    } else {
      this.container.removeAttribute("title");
    }
    const mode = blocked ? "ask" : this.callbacks.getSettings().permissionMode;
    if (mode === "agent") {
      this.toggleEl.addClass("active");
      this.labelEl.setText("Agent");
    } else {
      this.toggleEl.removeClass("active");
      this.labelEl.setText("Ask");
    }
  }
  async toggle() {
    var _a, _b;
    const settings = this.callbacks.getSettings();
    const provider = settings.selectedProvider;
    if (!supportsReadOnlyMode(provider)) {
      new import_obsidian5.Notice("\uC774 CLI\uB294 \uC77D\uAE30 \uC804\uC6A9\uC744 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC77D\uAE30\uB9CC \uC2DC\uD0A4\uB824\uBA74 \uB2E4\uB978 provider\uB97C \uACE0\uB974\uC138\uC694.");
      return;
    }
    const shown = this.needsBlanketWriteConsent(provider) ? "ask" : settings.permissionMode;
    const next = shown === "agent" ? "ask" : "agent";
    if (next === "agent" && this.needsBlanketWriteConsent(provider)) {
      const accepted = await ((_b = (_a = this.callbacks).confirmBlanketWrite) == null ? void 0 : _b.call(_a, provider));
      if (!accepted) {
        this.updateDisplay();
        return;
      }
    }
    await this.callbacks.onPermissionModeChange(next);
    this.updateDisplay();
  }
  needsBlanketWriteConsent(provider) {
    if (!writesWithoutAsking(provider)) return false;
    const acknowledged = this.callbacks.getSettings().blanketWriteAcknowledged;
    return !(Array.isArray(acknowledged) && acknowledged.includes(provider));
  }
  async togglePlanMode() {
    var _a;
    if (this.isPlanModeLocked()) {
      new import_obsidian5.Notice("Plan mode is active until the plan is approved.");
      return;
    }
    (_a = this.onPlanModeToggle) == null ? void 0 : _a.call(this, !this.isPlanModeRequested());
    this.updateDisplay();
  }
};
var QuizLauncherButton = class {
  constructor(parentEl, callbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: "ocop-quiz-launcher" });
    this.render();
  }
  render() {
    this.container.empty();
    const button = this.container.createEl("button", {
      cls: "ocop-quiz-launcher-btn",
      text: "\u{1F4DD} \uD034\uC988",
      attr: { "aria-label": "Open guided quiz setup" }
    });
    button.type = "button";
    button.addEventListener("click", async () => {
      var _a, _b;
      await ((_b = (_a = this.callbacks).onOpenQuiz) == null ? void 0 : _b.call(_a));
    });
  }
};
var SocraticLauncherButton = class {
  constructor(parentEl, callbacks) {
    this.buttonEl = null;
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: "ocop-socratic-launcher" });
    this.render();
  }
  render() {
    this.container.empty();
    const button = this.container.createEl("button", {
      cls: "ocop-socratic-launcher-btn",
      text: "\u{1F9E0} \uD559\uC2B5 \uBAA8\uB4DC",
      attr: { "aria-label": "\uC18C\uD06C\uB77C\uD14C\uC2A4 \uB300\uD654 \uC2DC\uC791", title: "\uC9C8\uBB38 \uC911\uC2EC \uD559\uC2B5 \uB300\uD654\uB85C \uC804\uD658" }
    });
    button.type = "button";
    button.addEventListener("click", async () => {
      var _a, _b;
      button.disabled = true;
      try {
        await ((_b = (_a = this.callbacks).onOpenSocratic) == null ? void 0 : _b.call(_a));
      } finally {
        button.disabled = false;
      }
    });
    this.buttonEl = button;
  }
  setActive(active) {
    if (!this.buttonEl) return;
    this.buttonEl.classList.toggle("is-active", active);
    this.buttonEl.textContent = active ? "\u{1F9E0} \uD559\uC2B5 \uC911" : "\u{1F9E0} \uD559\uC2B5 \uBAA8\uB4DC";
  }
};
var ExternalContextSelector = class {
  constructor(parentEl) {
    this.iconEl = null;
    this.badgeEl = null;
    this.dropdownEl = null;
    this.externalContextPaths = [];
    this.onChangeCallback = null;
    this.container = parentEl.createDiv({ cls: "ocop-external-context-selector" });
    this.render();
  }
  setOnChange(callback) {
    this.onChangeCallback = callback;
  }
  getExternalContexts() {
    return [...this.externalContextPaths];
  }
  setExternalContexts(paths) {
    this.externalContextPaths = [...paths];
    this.updateDisplay();
    this.renderDropdown();
  }
  clearExternalContexts() {
    this.externalContextPaths = [];
    this.updateDisplay();
    this.renderDropdown();
  }
  render() {
    this.container.empty();
    const iconWrapper = this.container.createDiv({ cls: "ocop-external-context-icon-wrapper" });
    this.iconEl = iconWrapper.createDiv({ cls: "ocop-external-context-icon" });
    (0, import_obsidian5.setIcon)(this.iconEl, "folder");
    iconWrapper.setAttribute("aria-label", "\uBCF4\uAD00\uD568 \uBC16 \uD3F4\uB354\uB97C \uCEE8\uD14D\uC2A4\uD2B8\uB85C \uCD94\uAC00");
    iconWrapper.setAttribute("title", "\uBCF4\uAD00\uD568 \uBC16 \uD3F4\uB354\uB97C \uCEE8\uD14D\uC2A4\uD2B8\uB85C \uCD94\uAC00");
    iconWrapper.createSpan({ cls: "ocop-external-context-caption", text: "\uD3F4\uB354" });
    this.badgeEl = iconWrapper.createDiv({ cls: "ocop-external-context-badge" });
    this.updateDisplay();
    iconWrapper.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.openFolderPicker();
    });
    this.dropdownEl = this.container.createDiv({ cls: "ocop-external-context-dropdown" });
    this.renderDropdown();
  }
  async openFolderPicker() {
    var _a;
    const dialog = resolveFolderDialog(window.require);
    if (!dialog) {
      new import_obsidian5.Notice("\uC774 Obsidian \uBE4C\uB4DC\uC5D0\uC11C\uB294 \uD3F4\uB354 \uC120\uD0DD\uCC3D\uC744 \uC5F4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.", 5e3);
      return;
    }
    try {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Select External Context"
      });
      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        if (this.externalContextPaths.includes(selectedPath)) {
          return;
        }
        const conflict = findConflictingPath(selectedPath, this.externalContextPaths);
        if (conflict) {
          this.showConflictNotice(selectedPath, conflict);
          return;
        }
        this.externalContextPaths = [...this.externalContextPaths, selectedPath];
        (_a = this.onChangeCallback) == null ? void 0 : _a.call(this, this.externalContextPaths);
        this.updateDisplay();
        this.renderDropdown();
      }
    } catch (error) {
      console.error("Failed to open folder picker:", error);
      new import_obsidian5.Notice("\uD3F4\uB354\uB97C \uC5EC\uB294 \uC911 \uBB38\uC81C\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.", 5e3);
    }
  }
  showConflictNotice(newPath, conflict) {
    const shortNew = this.shortenPath(newPath);
    const shortExisting = this.shortenPath(conflict.path);
    const message = conflict.type === "parent" ? `Cannot add "${shortNew}" - it's inside existing path "${shortExisting}"` : `Cannot add "${shortNew}" - it contains existing path "${shortExisting}"`;
    new import_obsidian5.Notice(message, 5e3);
  }
  renderDropdown() {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();
    this.dropdownEl.createDiv({ cls: "ocop-external-context-header", text: "External Contexts" });
    const listEl = this.dropdownEl.createDiv({ cls: "ocop-external-context-list" });
    if (this.externalContextPaths.length === 0) {
      listEl.createDiv({ cls: "ocop-external-context-empty", text: "Click folder icon to add" });
      return;
    }
    for (const pathStr of this.externalContextPaths) {
      const itemEl = listEl.createDiv({ cls: "ocop-external-context-item" });
      const pathTextEl = itemEl.createSpan({ cls: "ocop-external-context-text" });
      pathTextEl.setText(this.shortenPath(pathStr));
      pathTextEl.setAttribute("title", pathStr);
      const removeBtn = itemEl.createSpan({ cls: "ocop-external-context-remove" });
      (0, import_obsidian5.setIcon)(removeBtn, "x");
      removeBtn.setAttribute("title", "Remove path");
      removeBtn.addEventListener("click", (event) => {
        var _a;
        event.stopPropagation();
        this.externalContextPaths = this.externalContextPaths.filter((entry) => entry !== pathStr);
        (_a = this.onChangeCallback) == null ? void 0 : _a.call(this, this.externalContextPaths);
        this.updateDisplay();
        this.renderDropdown();
      });
    }
  }
  shortenPath(fullPath) {
    try {
      const homeDir = os4.homedir();
      const normalize2 = (value) => value.replace(/\\/g, "/");
      const normalizedFull = normalize2(fullPath);
      const normalizedHome = normalize2(homeDir);
      const compareFull = process.platform === "win32" ? normalizedFull.toLowerCase() : normalizedFull;
      const compareHome = process.platform === "win32" ? normalizedHome.toLowerCase() : normalizedHome;
      if (compareFull.startsWith(compareHome)) {
        return "~" + fullPath.slice(homeDir.length);
      }
    } catch (e) {
    }
    return fullPath;
  }
  updateDisplay() {
    if (!this.iconEl || !this.badgeEl) return;
    const count = this.externalContextPaths.length;
    if (count > 0) {
      this.iconEl.addClass("active");
      this.iconEl.setAttribute("title", `${count} external context${count > 1 ? "s" : ""} (click to add more)`);
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass("visible");
      } else {
        this.badgeEl.removeClass("visible");
      }
      return;
    }
    this.iconEl.removeClass("active");
    this.iconEl.setAttribute("title", "Add external contexts (click)");
    this.badgeEl.removeClass("visible");
  }
};
var ContextUsageMeter = class {
  constructor(parentEl) {
    this.fillPath = null;
    this.percentEl = null;
    this.circumference = 0;
    this.container = parentEl.createDiv({ cls: "ocop-context-meter" });
    this.render();
    this.container.style.display = "none";
  }
  render() {
    const size = 16;
    const strokeWidth = 2;
    const radius = (size - strokeWidth) / 2;
    const cx = size / 2;
    const cy = size / 2;
    const startAngle = 150;
    const endAngle = 390;
    const arcDegrees = endAngle - startAngle;
    const arcRadians = arcDegrees * Math.PI / 180;
    this.circumference = radius * arcRadians;
    const startRad = startAngle * Math.PI / 180;
    const endRad = endAngle * Math.PI / 180;
    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);
    const gaugeEl = this.container.createDiv({ cls: "ocop-context-meter-gauge" });
    gaugeEl.innerHTML = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <path class="ocop-meter-bg"
          d="M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2}"
          fill="none" stroke-width="${strokeWidth}" stroke-linecap="round"/>
        <path class="ocop-meter-fill"
          d="M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2}"
          fill="none" stroke-width="${strokeWidth}" stroke-linecap="round"
          stroke-dasharray="${this.circumference}" stroke-dashoffset="${this.circumference}"/>
      </svg>
    `;
    this.fillPath = gaugeEl.querySelector(".ocop-meter-fill");
    this.percentEl = this.container.createSpan({ cls: "ocop-context-meter-percent" });
  }
  update(usage) {
    var _a;
    if (!usage) {
      this.container.style.display = "none";
      return;
    }
    const premiumRequests = (_a = usage.premiumRequests) != null ? _a : 0;
    if (usage.contextWindow <= 0) {
      if (premiumRequests <= 0) {
        this.container.style.display = "none";
        return;
      }
      this.container.style.display = "flex";
      if (this.fillPath) {
        this.fillPath.style.strokeDashoffset = String(this.circumference);
      }
      if (this.percentEl) {
        this.percentEl.setText(`P ${this.formatPremiumRequests(premiumRequests)}`);
      }
      this.container.removeClass("warning");
      this.container.setAttribute(
        "data-tooltip",
        `Local CLI observed premium usage: ${this.formatPremiumRequests(premiumRequests)} request${premiumRequests === 1 ? "" : "s"}`
      );
      return;
    }
    this.container.style.display = "flex";
    const fillLength = usage.percentage / 100 * this.circumference;
    if (this.fillPath) {
      this.fillPath.style.strokeDashoffset = String(this.circumference - fillLength);
    }
    if (this.percentEl) {
      this.percentEl.setText(`${usage.percentage}%`);
    }
    if (usage.percentage > 80) {
      this.container.addClass("warning");
    } else {
      this.container.removeClass("warning");
    }
    const tooltip = `Local CLI observed context: ${this.formatTokens(usage.contextTokens)} / ${this.formatTokens(usage.contextWindow)} tokens` + (premiumRequests > 0 ? ` \u2022 premium usage: ${this.formatPremiumRequests(premiumRequests)} request${premiumRequests === 1 ? "" : "s"}` : "");
    this.container.setAttribute("data-tooltip", tooltip);
  }
  formatTokens(tokens) {
    if (tokens >= 1e3) {
      return `${Math.round(tokens / 1e3)}k`;
    }
    return String(tokens);
  }
  formatPremiumRequests(requests) {
    if (Number.isInteger(requests)) {
      return String(requests);
    }
    return requests.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }
};
var WebSearchToggle = class {
  constructor(parentEl) {
    this.enabled = false;
    this.valueEl = null;
    this.container = parentEl.createDiv({ cls: "ocop-websearch-toggle" });
    this.render();
  }
  render() {
    this.container.empty();
    this.container.createSpan({ cls: "ocop-thinking-label-text", text: "Web:" });
    this.valueEl = this.container.createDiv({ cls: "ocop-thinking-gears" });
    this.updateDisplay();
    this.container.addEventListener("click", () => {
      this.enabled = !this.enabled;
      this.updateDisplay();
    });
  }
  isEnabled() {
    return this.enabled;
  }
  setEnabled(value) {
    this.enabled = value;
    this.updateDisplay();
  }
  updateDisplay() {
    if (!this.valueEl) return;
    this.valueEl.empty();
    const cls = this.enabled ? "ocop-thinking-current ocop-thinking-active" : "ocop-thinking-current ocop-thinking-disabled";
    this.valueEl.createDiv({ cls, text: this.enabled ? "on" : "off" });
    this.container.setAttribute("title", this.enabled ? "Web search on (click to disable)" : "Web search off (click to enable)");
  }
};
function createInputToolbar(parentEl, learningGroupEl, callbacks) {
  const primaryToolbarEl = parentEl.createDiv({ cls: "ocop-toolbar-primary" });
  const secondaryToolbarEl = parentEl.createDiv({ cls: "ocop-toolbar-secondary" });
  const modelSelector = new ModelSelector(primaryToolbarEl, callbacks);
  const thinkingBudgetSelector = new ThinkingBudgetSelector(secondaryToolbarEl, callbacks);
  const contextUsageMeter = new ContextUsageMeter(secondaryToolbarEl);
  const externalContextSelector = new ExternalContextSelector(secondaryToolbarEl);
  const webSearchToggle = new WebSearchToggle(secondaryToolbarEl);
  const permissionToggle = new PermissionToggle(secondaryToolbarEl, callbacks);
  const quizLauncherButton = new QuizLauncherButton(learningGroupEl, callbacks);
  const socraticLauncherButton = new SocraticLauncherButton(learningGroupEl, callbacks);
  return {
    modelSelector,
    primaryToolbarEl,
    thinkingBudgetSelector,
    contextUsageMeter,
    externalContextSelector,
    webSearchToggle,
    permissionToggle,
    quizLauncherButton,
    socraticLauncherButton
  };
}

// src/ui/components/InstructionModeManager.ts
var INSTRUCTION_MODE_PLACEHOLDER = "# Save in custom system prompt";
var InstructionModeManager = class {
  constructor(inputEl, callbacks) {
    this.state = { active: false, rawInstruction: "" };
    this.isSubmitting = false;
    this.originalPlaceholder = "";
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.originalPlaceholder = inputEl.placeholder;
  }
  /**
   * Handles keydown to detect # trigger.
   * Returns true if the event was consumed (should prevent default).
   */
  handleTriggerKey(e) {
    if (!this.state.active && this.inputEl.value === "" && e.key === "#") {
      if (this.enterMode()) {
        e.preventDefault();
        return true;
      }
    }
    return false;
  }
  /** Handles input changes to track instruction text. */
  handleInputChange() {
    if (!this.state.active) return;
    const text = this.inputEl.value;
    if (text === "") {
      this.exitMode();
    } else {
      this.state.rawInstruction = text;
    }
  }
  /**
   * Enters instruction mode.
   * Only enters if the indicator can be successfully shown.
   * Returns true if mode was entered, false otherwise.
   */
  enterMode() {
    const wrapper = this.callbacks.getInputWrapper();
    if (!wrapper) return false;
    wrapper.addClass("ocop-input-instruction-mode");
    this.state = { active: true, rawInstruction: "" };
    this.inputEl.placeholder = INSTRUCTION_MODE_PLACEHOLDER;
    return true;
  }
  /** Exits instruction mode, restoring original state. */
  exitMode() {
    const wrapper = this.callbacks.getInputWrapper();
    if (wrapper) {
      wrapper.removeClass("ocop-input-instruction-mode");
    }
    this.state = { active: false, rawInstruction: "" };
    this.inputEl.placeholder = this.originalPlaceholder;
  }
  /** Handles keydown events. Returns true if handled. */
  handleKeydown(e) {
    if (!this.state.active) return false;
    if (e.key === "Enter" && !e.shiftKey) {
      if (!this.state.rawInstruction.trim()) {
        return false;
      }
      e.preventDefault();
      this.submit();
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      this.cancel();
      return true;
    }
    return false;
  }
  /** Checks if instruction mode is active. */
  isActive() {
    return this.state.active;
  }
  /** Gets the current raw instruction text. */
  getRawInstruction() {
    return this.state.rawInstruction;
  }
  /** Submits the instruction for refinement. */
  async submit() {
    if (this.isSubmitting) return;
    const rawInstruction = this.state.rawInstruction.trim();
    if (!rawInstruction) return;
    this.isSubmitting = true;
    try {
      await this.callbacks.onSubmit(rawInstruction);
    } finally {
      this.isSubmitting = false;
    }
  }
  /** Cancels instruction mode and clears input. */
  cancel() {
    this.inputEl.value = "";
    this.exitMode();
  }
  /** Clears the input and resets state (called after successful submission). */
  clear() {
    this.inputEl.value = "";
    this.exitMode();
  }
  /** Cleans up event listeners. */
  destroy() {
    const wrapper = this.callbacks.getInputWrapper();
    if (wrapper) {
      wrapper.removeClass("ocop-input-instruction-mode");
    }
    this.inputEl.placeholder = this.originalPlaceholder;
  }
};

// src/ui/components/PlanApprovalPanel.ts
function findInputElements2(containerEl) {
  const inputContainer = containerEl.querySelector(".ocop-input-container");
  const inputWrapper = containerEl.querySelector(".ocop-input-wrapper");
  return { inputContainer, inputWrapper };
}
var APPROVAL_OPTIONS = [
  { label: "Approve", isRevise: false },
  { label: "Approve && New Session", isRevise: false },
  { label: "Type here to tell Copilot what to change", isRevise: true }
];
var PlanApprovalPanel = class {
  constructor(_app, options) {
    this.isDestroyed = false;
    this.reviseInputEl = null;
    this.currentOptionIndex = 0;
    this.optionsEl = null;
    // Input area references (for hiding/showing)
    this.inputContainer = null;
    this.inputWrapper = null;
    this.containerEl = options.containerEl;
    this.onApprove = options.onApprove;
    this.onApproveNewSession = options.onApproveNewSession;
    this.onRevise = options.onRevise;
    this.onCancel = options.onCancel;
    const { inputContainer, inputWrapper } = findInputElements2(this.containerEl);
    this.inputContainer = inputContainer;
    this.inputWrapper = inputWrapper;
    if (this.inputWrapper) {
      this.inputWrapper.style.display = "none";
    }
    this.panelEl = this.createPanel();
    if (this.inputContainer) {
      this.inputContainer.appendChild(this.panelEl);
    } else {
      this.containerEl.appendChild(this.panelEl);
    }
    this.panelEl.focus();
  }
  /** Create the panel DOM structure. */
  createPanel() {
    const panel = document.createElement("div");
    panel.className = "ocop-plan-approval-panel";
    panel.setAttribute("tabindex", "0");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Review implementation plan");
    panel.addEventListener("keydown", this.handleKeyDown.bind(this));
    const headerEl = document.createElement("div");
    headerEl.className = "ocop-plan-approval-header";
    headerEl.textContent = "Would you like to proceed?";
    panel.appendChild(headerEl);
    this.optionsEl = document.createElement("div");
    this.optionsEl.className = "ocop-plan-approval-options";
    this.renderOptions();
    panel.appendChild(this.optionsEl);
    return panel;
  }
  /** Render the option rows. */
  renderOptions() {
    if (!this.optionsEl) return;
    this.optionsEl.innerHTML = "";
    APPROVAL_OPTIONS.forEach((option, index) => {
      const optionEl = document.createElement("div");
      optionEl.className = "ocop-plan-approval-option";
      optionEl.setAttribute("data-option-index", String(index));
      const caretEl = document.createElement("span");
      caretEl.className = "ocop-plan-approval-caret";
      caretEl.textContent = index === this.currentOptionIndex ? ">" : " ";
      optionEl.appendChild(caretEl);
      const numberEl = document.createElement("span");
      numberEl.className = "ocop-plan-approval-number";
      numberEl.textContent = `${index + 1}.`;
      optionEl.appendChild(numberEl);
      if (option.isRevise) {
        this.reviseInputEl = document.createElement("input");
        this.reviseInputEl.type = "text";
        this.reviseInputEl.className = "ocop-plan-approval-revise-inline";
        this.reviseInputEl.placeholder = option.label;
        this.reviseInputEl.addEventListener("click", (e) => {
          e.stopPropagation();
          this.currentOptionIndex = index;
          this.updateOptionFocus();
        });
        this.reviseInputEl.addEventListener("keydown", (e) => {
          var _a;
          if (e.key === "Enter") {
            e.preventDefault();
            this.handleReviseSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            if ((_a = this.reviseInputEl) == null ? void 0 : _a.value) {
              this.reviseInputEl.value = "";
            } else {
              this.handleCancel();
            }
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            this.currentOptionIndex = Math.max(0, this.currentOptionIndex - 1);
            this.updateOptionFocus();
            this.panelEl.focus();
          }
          e.stopPropagation();
        });
        this.reviseInputEl.addEventListener("focus", () => {
          this.currentOptionIndex = index;
          this.updateOptionFocus();
        });
        optionEl.appendChild(this.reviseInputEl);
      } else {
        const labelEl = document.createElement("span");
        labelEl.className = "ocop-plan-approval-option-label";
        labelEl.textContent = option.label;
        optionEl.appendChild(labelEl);
      }
      optionEl.addEventListener("click", () => {
        var _a;
        this.currentOptionIndex = index;
        this.updateOptionFocus();
        if (!option.isRevise) {
          this.selectCurrentOption();
        } else {
          (_a = this.reviseInputEl) == null ? void 0 : _a.focus();
        }
      });
      optionEl.addEventListener("mouseenter", () => {
        this.currentOptionIndex = index;
        this.updateOptionFocus();
      });
      if (index === this.currentOptionIndex) {
        optionEl.classList.add("focused");
      }
      this.optionsEl.appendChild(optionEl);
    });
  }
  /** Update the visual focus indicator on options. */
  updateOptionFocus() {
    if (!this.optionsEl) return;
    const options = this.optionsEl.querySelectorAll(".ocop-plan-approval-option");
    options.forEach((opt, i) => {
      const caret = opt.querySelector(".ocop-plan-approval-caret");
      const isFocused = i === this.currentOptionIndex;
      opt.classList.toggle("focused", isFocused);
      if (caret) {
        caret.textContent = isFocused ? ">" : " ";
      }
    });
    if (this.currentOptionIndex !== 2 && this.reviseInputEl && document.activeElement === this.reviseInputEl) {
      this.reviseInputEl.blur();
      this.panelEl.focus();
    }
    if (this.currentOptionIndex === 2 && this.reviseInputEl) {
      this.reviseInputEl.focus();
    }
  }
  /** Select the currently focused option. */
  selectCurrentOption() {
    var _a;
    switch (this.currentOptionIndex) {
      case 0:
        this.handleApprove();
        break;
      case 1:
        this.handleApproveNewSession();
        break;
      case 2:
        (_a = this.reviseInputEl) == null ? void 0 : _a.focus();
        break;
    }
  }
  /** Handle keyboard events. */
  handleKeyDown(e) {
    var _a;
    if (this.isDestroyed) return;
    if (document.activeElement === this.reviseInputEl) {
      return;
    }
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        this.currentOptionIndex = Math.max(0, this.currentOptionIndex - 1);
        this.updateOptionFocus();
        break;
      case "ArrowDown":
        e.preventDefault();
        this.currentOptionIndex = Math.min(APPROVAL_OPTIONS.length - 1, this.currentOptionIndex + 1);
        this.updateOptionFocus();
        break;
      case "Enter":
        e.preventDefault();
        this.selectCurrentOption();
        break;
      case "Escape":
        e.preventDefault();
        this.handleCancel();
        break;
      case "1":
        e.preventDefault();
        this.currentOptionIndex = 0;
        this.updateOptionFocus();
        this.selectCurrentOption();
        break;
      case "2":
        e.preventDefault();
        this.currentOptionIndex = 1;
        this.updateOptionFocus();
        this.selectCurrentOption();
        break;
      case "3":
        e.preventDefault();
        this.currentOptionIndex = 2;
        this.updateOptionFocus();
        (_a = this.reviseInputEl) == null ? void 0 : _a.focus();
        break;
      default:
        if (this.currentOptionIndex === 2 && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          if (this.reviseInputEl) {
            this.reviseInputEl.focus();
            this.reviseInputEl.value = e.key;
            this.reviseInputEl.setSelectionRange(1, 1);
          }
        }
        break;
    }
  }
  /** Handle approve action. */
  handleApprove() {
    if (this.isDestroyed) return;
    this.destroy();
    this.onApprove();
  }
  /** Handle approve with new session action. */
  handleApproveNewSession() {
    if (this.isDestroyed) return;
    this.destroy();
    this.onApproveNewSession();
  }
  /** Handle cancel action (Esc). */
  handleCancel() {
    if (this.isDestroyed) return;
    this.destroy();
    this.onCancel();
  }
  /** Handle revise submission. */
  handleReviseSubmit() {
    var _a;
    if (this.isDestroyed) return;
    const feedback = (_a = this.reviseInputEl) == null ? void 0 : _a.value.trim();
    if (!feedback) return;
    this.destroy();
    this.onRevise(feedback);
  }
  /** Destroy the panel and restore input area. */
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.panelEl.remove();
    if (this.inputWrapper) {
      this.inputWrapper.style.display = "";
    }
  }
};
function showPlanApprovalPanel(app, containerEl, planContent, component) {
  return new Promise((resolve6) => {
    new PlanApprovalPanel(app, {
      containerEl,
      planContent,
      component,
      onApprove: () => resolve6({ decision: "approve" }),
      onApproveNewSession: () => resolve6({ decision: "approve_new_session" }),
      onRevise: (feedback) => resolve6({ decision: "revise", feedback }),
      onCancel: () => resolve6({ decision: "cancel" })
    });
  });
}

// src/ui/components/PlanBanner.ts
var import_obsidian6 = require("obsidian");
var PlanBanner = class {
  constructor(options) {
    this.containerEl = null;
    this.bannerEl = null;
    this.contentEl = null;
    this.isExpanded = false;
    this.planContent = "";
    this.app = options.app;
    this.component = options.component;
  }
  /**
   * Mount the banner into the container.
   * Should be called after the container is created, inserts between header and messages.
   */
  mount(containerEl) {
    this.containerEl = containerEl;
  }
  /**
   * Show the banner with the given plan content.
   */
  async show(planContent) {
    if (!this.containerEl) return;
    if (this.bannerEl) {
      this.bannerEl.remove();
      this.bannerEl = null;
      this.contentEl = null;
    }
    this.planContent = planContent;
    this.isExpanded = false;
    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "ocop-plan-banner";
    const headerEl = document.createElement("div");
    headerEl.className = "ocop-plan-banner-header";
    headerEl.addEventListener("click", () => this.toggle());
    const chevronEl = document.createElement("span");
    chevronEl.className = "ocop-plan-banner-chevron";
    chevronEl.textContent = "\u25B6";
    headerEl.appendChild(chevronEl);
    const titleEl = document.createElement("span");
    titleEl.className = "ocop-plan-banner-title";
    titleEl.textContent = "Approved Plan";
    headerEl.appendChild(titleEl);
    this.bannerEl.appendChild(headerEl);
    this.contentEl = document.createElement("div");
    this.contentEl.className = "ocop-plan-banner-content";
    this.contentEl.style.display = "none";
    await this.renderContent();
    this.bannerEl.appendChild(this.contentEl);
    const messagesEl = this.containerEl.querySelector(".ocop-messages");
    if (messagesEl) {
      this.containerEl.insertBefore(this.bannerEl, messagesEl);
    } else {
      this.containerEl.appendChild(this.bannerEl);
    }
  }
  /**
   * Hide and remove the banner.
   */
  hide() {
    if (this.bannerEl) {
      this.bannerEl.remove();
      this.bannerEl = null;
      this.contentEl = null;
    }
    this.isExpanded = false;
    this.planContent = "";
  }
  /**
   * Toggle the banner's expanded/collapsed state.
   */
  toggle() {
    this.isExpanded = !this.isExpanded;
    this.updateDisplay();
  }
  /**
   * Update the display based on expanded state.
   */
  updateDisplay() {
    if (!this.bannerEl || !this.contentEl) return;
    const chevron = this.bannerEl.querySelector(".ocop-plan-banner-chevron");
    if (chevron) {
      chevron.textContent = this.isExpanded ? "\u25BC" : "\u25B6";
    }
    this.contentEl.style.display = this.isExpanded ? "block" : "none";
    this.bannerEl.classList.toggle("expanded", this.isExpanded);
  }
  /**
   * Render the plan content as markdown.
   */
  async renderContent() {
    if (!this.contentEl) return;
    try {
      await import_obsidian6.MarkdownRenderer.render(
        this.app,
        this.planContent,
        this.contentEl,
        "",
        this.component
      );
    } catch (e) {
      this.contentEl.textContent = this.planContent;
    }
  }
  /**
   * Check if the banner is currently visible.
   */
  isVisible() {
    return this.bannerEl !== null;
  }
  /**
   * Get the current plan content.
   */
  getPlanContent() {
    return this.planContent;
  }
};

// src/ui/components/QuizAnswerPanel.ts
var QUIZ_PANEL_DISMISS_KEY = "__ocopDismissQuizAnswerPanel__";
var QUIZ_STUCK_ANSWER = "\uBAA8\uB974\uACA0\uC5B4\uC694. \uC815\uB2F5\uACFC \uD575\uC2EC \uAC1C\uB150\uC744 \uC54C\uB824\uC8FC\uC138\uC694.";
function findInputElements3(containerEl) {
  const inputContainer = containerEl.querySelector(".ocop-input-container");
  const inputWrapper = containerEl.querySelector(".ocop-input-wrapper");
  return { inputContainer, inputWrapper };
}
var QuizAnswerPanel = class {
  constructor(options) {
    this.isDestroyed = false;
    this.currentOptionIndex = 0;
    this.optionsEl = null;
    this.selected = /* @__PURE__ */ new Set();
    // Input area references
    this.inputWrapper = null;
    this.inputContainer = null;
    this.quizQuestion = options.quizQuestion;
    this.onAnswer = options.onAnswer;
    this.onCancel = options.onCancel;
    this.onHint = options.onHint;
    const { inputContainer, inputWrapper } = findInputElements3(options.containerEl);
    this.inputContainer = inputContainer;
    this.inputWrapper = inputWrapper;
    if (this.inputWrapper) {
      this.inputWrapper.style.display = "none";
    }
    this.panelEl = this.createPanel();
    this.panelEl[QUIZ_PANEL_DISMISS_KEY] = () => this.handleCancel();
    if (this.inputContainer) {
      this.inputContainer.appendChild(this.panelEl);
    } else {
      options.containerEl.appendChild(this.panelEl);
    }
    this.panelEl.focus();
  }
  createPanel() {
    const panel = document.createElement("div");
    panel.className = "ocop-quiz-answer-panel";
    panel.setAttribute("tabindex", "0");
    panel.setAttribute("role", "listbox");
    panel.setAttribute("aria-label", "Quiz answer selection");
    panel.addEventListener("keydown", this.handleKeyDown.bind(this));
    const headerEl = document.createElement("div");
    headerEl.className = "ocop-quiz-answer-header";
    const progressWrapper = document.createElement("div");
    progressWrapper.className = "ocop-quiz-progress-wrapper";
    const progressEl = document.createElement("div");
    progressEl.className = "ocop-quiz-progress";
    const fillPct = Math.round(this.quizQuestion.current / this.quizQuestion.total * 100);
    const fillEl = document.createElement("div");
    fillEl.className = "ocop-quiz-progress-fill";
    fillEl.style.width = `${fillPct}%`;
    progressEl.appendChild(fillEl);
    progressWrapper.appendChild(progressEl);
    const labelEl = document.createElement("span");
    labelEl.className = "ocop-quiz-progress-label";
    labelEl.textContent = `${this.quizQuestion.current} / ${this.quizQuestion.total}\uBC88`;
    progressWrapper.appendChild(labelEl);
    headerEl.appendChild(progressWrapper);
    panel.appendChild(headerEl);
    if (this.quizQuestion.freeText) {
      this.renderFreeTextInput(panel);
    } else {
      this.optionsEl = document.createElement("div");
      this.optionsEl.className = "ocop-quiz-answer-options";
      this.renderOptions();
      panel.appendChild(this.optionsEl);
    }
    panel.appendChild(this.createQuickActions());
    return panel;
  }
  /** Renders the 힌트 / 모르겠어요 shortcut row (PRD §8.2). */
  createQuickActions() {
    const rowEl = document.createElement("div");
    rowEl.className = "ocop-quiz-quick-actions";
    const stopActivationBubble = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.stopPropagation();
      }
    };
    if (this.onHint) {
      const hintBtn = document.createElement("button");
      hintBtn.type = "button";
      hintBtn.className = "ocop-quiz-quick-action-btn";
      hintBtn.textContent = "\u{1F4A1} \uD78C\uD2B8";
      hintBtn.addEventListener("keydown", stopActivationBubble);
      hintBtn.addEventListener("click", () => {
        var _a;
        return (_a = this.onHint) == null ? void 0 : _a.call(this);
      });
      rowEl.appendChild(hintBtn);
    }
    const stuckBtn = document.createElement("button");
    stuckBtn.type = "button";
    stuckBtn.className = "ocop-quiz-quick-action-btn";
    stuckBtn.textContent = "\u{1F635} \uBAA8\uB974\uACA0\uC5B4\uC694";
    stuckBtn.addEventListener("keydown", stopActivationBubble);
    stuckBtn.addEventListener("click", () => this.submitAnswer(QUIZ_STUCK_ANSWER));
    rowEl.appendChild(stuckBtn);
    return rowEl;
  }
  renderFreeTextInput(panel) {
    const wrapper = document.createElement("div");
    wrapper.className = "ocop-quiz-answer-freetext";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ocop-quiz-answer-freetext-input";
    input.placeholder = "\uB2F5\uBCC0\uC744 \uC785\uB825\uD558\uC138\uC694";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const value = input.value.trim();
        if (value) {
          this.submitAnswer(value);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.handleCancel();
      }
    });
    wrapper.appendChild(input);
    const submitBtn = document.createElement("button");
    submitBtn.className = "ocop-quiz-answer-submit-btn";
    submitBtn.textContent = "\uC81C\uCD9C (Enter)";
    submitBtn.addEventListener("click", () => {
      const value = input.value.trim();
      if (value) {
        this.submitAnswer(value);
      }
    });
    wrapper.appendChild(submitBtn);
    panel.appendChild(wrapper);
    setTimeout(() => input.focus(), 50);
  }
  renderOptions() {
    if (!this.optionsEl) return;
    this.optionsEl.innerHTML = "";
    const { options, multiSelect } = this.quizQuestion;
    options.forEach((option, index) => {
      const optionEl = document.createElement("div");
      optionEl.className = "ocop-quiz-answer-option";
      optionEl.setAttribute("role", "option");
      optionEl.setAttribute("data-option-index", String(index));
      const caretEl = document.createElement("span");
      caretEl.className = "ocop-quiz-answer-caret";
      caretEl.textContent = index === this.currentOptionIndex ? ">" : " ";
      optionEl.appendChild(caretEl);
      if (multiSelect) {
        const checkEl = document.createElement("span");
        checkEl.className = "ocop-quiz-answer-check";
        checkEl.textContent = this.selected.has(option.label) ? "[x]" : "[ ]";
        optionEl.appendChild(checkEl);
      }
      const labelEl = document.createElement("span");
      labelEl.className = "ocop-quiz-answer-label";
      labelEl.textContent = `${option.label}. ${option.text}`;
      optionEl.appendChild(labelEl);
      optionEl.addEventListener("click", () => {
        this.currentOptionIndex = index;
        this.updateOptionFocus();
        if (multiSelect) {
          this.toggleOption(option.label);
        } else {
          this.submitAnswer(option.label);
        }
      });
      optionEl.addEventListener("mouseenter", () => {
        this.currentOptionIndex = index;
        this.updateOptionFocus();
      });
      if (index === this.currentOptionIndex) {
        optionEl.classList.add("focused");
      }
      this.optionsEl.appendChild(optionEl);
    });
    if (multiSelect) {
      const submitEl = document.createElement("div");
      submitEl.className = "ocop-quiz-answer-submit";
      const submitBtn = document.createElement("button");
      submitBtn.className = "ocop-quiz-answer-submit-btn";
      submitBtn.textContent = "\uC120\uD0DD \uC81C\uCD9C (Enter)";
      submitBtn.disabled = this.selected.size === 0;
      submitBtn.addEventListener("click", () => this.submitMultiAnswer());
      submitEl.appendChild(submitBtn);
      this.optionsEl.appendChild(submitEl);
    }
  }
  updateOptionFocus() {
    if (!this.optionsEl) return;
    const options = this.optionsEl.querySelectorAll(".ocop-quiz-answer-option");
    options.forEach((opt, i) => {
      const caret = opt.querySelector(".ocop-quiz-answer-caret");
      const isFocused = i === this.currentOptionIndex;
      opt.classList.toggle("focused", isFocused);
      if (caret) {
        caret.textContent = isFocused ? ">" : " ";
      }
    });
  }
  toggleOption(label) {
    if (this.selected.has(label)) {
      this.selected.delete(label);
    } else {
      this.selected.add(label);
    }
    this.renderOptions();
    this.updateOptionFocus();
  }
  submitAnswer(label) {
    if (this.isDestroyed) return;
    this.destroy();
    this.onAnswer(label);
  }
  submitMultiAnswer() {
    if (this.isDestroyed || this.selected.size === 0) return;
    this.destroy();
    this.onAnswer(Array.from(this.selected).sort().join(","));
  }
  handleKeyDown(e) {
    if (this.isDestroyed) return;
    const { options, multiSelect } = this.quizQuestion;
    const maxIndex = options.length - 1;
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        this.currentOptionIndex = Math.max(0, this.currentOptionIndex - 1);
        this.updateOptionFocus();
        break;
      case "ArrowDown":
        e.preventDefault();
        this.currentOptionIndex = Math.min(maxIndex, this.currentOptionIndex + 1);
        this.updateOptionFocus();
        break;
      case "Enter":
        e.preventDefault();
        if (multiSelect) {
          this.submitMultiAnswer();
        } else {
          this.submitAnswer(options[this.currentOptionIndex].label);
        }
        break;
      case " ":
        if (multiSelect) {
          e.preventDefault();
          this.toggleOption(options[this.currentOptionIndex].label);
        }
        break;
      case "Escape":
        e.preventDefault();
        this.handleCancel();
        break;
      default: {
        const upper = e.key.toUpperCase();
        const byLabel = options.findIndex((o) => o.label.toUpperCase() === upper);
        if (byLabel >= 0) {
          e.preventDefault();
          this.currentOptionIndex = byLabel;
          this.updateOptionFocus();
          if (!multiSelect) {
            this.submitAnswer(options[byLabel].label);
          } else {
            this.toggleOption(options[byLabel].label);
          }
          break;
        }
        const byNumber = parseInt(e.key, 10);
        if (byNumber >= 1 && byNumber <= options.length) {
          e.preventDefault();
          const idx = byNumber - 1;
          this.currentOptionIndex = idx;
          this.updateOptionFocus();
          if (!multiSelect) {
            this.submitAnswer(options[idx].label);
          } else {
            this.toggleOption(options[idx].label);
          }
        }
        break;
      }
    }
  }
  handleCancel() {
    if (this.isDestroyed) return;
    this.destroy();
    this.onCancel();
  }
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    delete this.panelEl[QUIZ_PANEL_DISMISS_KEY];
    this.panelEl.remove();
    if (this.inputWrapper) {
      this.inputWrapper.style.display = "";
    }
  }
};
function showQuizAnswerPanel(containerEl, quizQuestion, onHint) {
  return new Promise((resolve6) => {
    new QuizAnswerPanel({
      containerEl,
      quizQuestion,
      onAnswer: (answer) => resolve6({ answer }),
      onCancel: () => resolve6({ cancelled: true }),
      onHint
    });
  });
}
function dismissQuizAnswerPanel(containerEl) {
  const panelEl = containerEl.querySelector(".ocop-quiz-answer-panel");
  if (!panelEl) {
    return false;
  }
  const dismiss = panelEl[QUIZ_PANEL_DISMISS_KEY];
  if (typeof dismiss === "function") {
    dismiss();
    return true;
  }
  panelEl.remove();
  const inputWrapper = containerEl.querySelector(".ocop-input-wrapper");
  if (inputWrapper) {
    inputWrapper.style.display = "";
  }
  return true;
}

// src/ui/components/SelectionHighlight.ts
var import_state = require("@codemirror/state");
var import_view = require("@codemirror/view");
function createSelectionHighlighter() {
  const showHighlight = import_state.StateEffect.define();
  const hideHighlight = import_state.StateEffect.define();
  const selectionHighlightField = import_state.StateField.define({
    create: () => import_view.Decoration.none,
    update: (deco, tr) => {
      for (const e of tr.effects) {
        if (e.is(showHighlight)) {
          const builder = new import_state.RangeSetBuilder();
          builder.add(e.value.from, e.value.to, import_view.Decoration.mark({
            class: "ocop-selection-highlight"
          }));
          return builder.finish();
        } else if (e.is(hideHighlight)) {
          return import_view.Decoration.none;
        }
      }
      return deco.map(tr.changes);
    },
    provide: (f) => import_view.EditorView.decorations.from(f)
  });
  const installedEditors2 = /* @__PURE__ */ new WeakSet();
  function ensureHighlightField(editorView) {
    if (!installedEditors2.has(editorView)) {
      editorView.dispatch({
        effects: import_state.StateEffect.appendConfig.of(selectionHighlightField)
      });
      installedEditors2.add(editorView);
    }
  }
  function show(editorView, from, to) {
    ensureHighlightField(editorView);
    editorView.dispatch({
      effects: showHighlight.of({ from, to })
    });
  }
  function hide(editorView) {
    if (installedEditors2.has(editorView)) {
      editorView.dispatch({
        effects: hideHighlight.of(null)
      });
    }
  }
  return { show, hide };
}
var defaultHighlighter = createSelectionHighlighter();
function showSelectionHighlight(editorView, from, to) {
  defaultHighlighter.show(editorView, from, to);
}
function hideSelectionHighlight(editorView) {
  defaultHighlighter.hide(editorView);
}

// src/ui/components/SlashCommandDropdown.ts
var SlashCommandDropdown = class {
  constructor(containerEl, inputEl, callbacks, options = {}) {
    this.dropdownEl = null;
    this.slashStartIndex = -1;
    this.selectedIndex = 0;
    this.filteredCommands = [];
    var _a;
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.isFixed = (_a = options.fixed) != null ? _a : false;
    this.onInput = () => this.handleInputChange();
    this.inputEl.addEventListener("input", this.onInput);
  }
  /** Handles input changes to detect / trigger. */
  handleInputChange() {
    const text = this.getInputValue();
    const cursorPos = this.getCursorPosition();
    const textBeforeCursor = text.substring(0, cursorPos);
    const lastSlashIndex = textBeforeCursor.lastIndexOf("/");
    if (lastSlashIndex === -1) {
      this.hide();
      return;
    }
    const charBeforeSlash = lastSlashIndex > 0 ? textBeforeCursor[lastSlashIndex - 1] : " ";
    if (!/\s/.test(charBeforeSlash) && lastSlashIndex !== 0) {
      this.hide();
      return;
    }
    const searchText = textBeforeCursor.substring(lastSlashIndex + 1);
    if (/\s/.test(searchText)) {
      this.hide();
      return;
    }
    this.slashStartIndex = lastSlashIndex;
    this.showDropdown(searchText);
  }
  /** Handles keyboard navigation. Returns true if handled. */
  handleKeydown(e) {
    if (!this.isVisible()) return false;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this.navigate(1);
        return true;
      case "ArrowUp":
        e.preventDefault();
        this.navigate(-1);
        return true;
      case "Enter":
      case "Tab":
        if (this.filteredCommands.length > 0) {
          e.preventDefault();
          this.selectItem();
          return true;
        }
        return false;
      case "Escape":
        e.preventDefault();
        this.hide();
        return true;
    }
    return false;
  }
  /** Checks if dropdown is currently visible. */
  isVisible() {
    var _a, _b;
    return (_b = (_a = this.dropdownEl) == null ? void 0 : _a.hasClass("visible")) != null ? _b : false;
  }
  /** Hides the dropdown. */
  hide() {
    if (this.dropdownEl) {
      this.dropdownEl.removeClass("visible");
    }
    this.slashStartIndex = -1;
    this.callbacks.onHide();
  }
  /** Destroys the dropdown and cleans up. */
  destroy() {
    this.inputEl.removeEventListener("input", this.onInput);
    if (this.dropdownEl) {
      this.dropdownEl.remove();
      this.dropdownEl = null;
    }
  }
  getInputValue() {
    return this.inputEl.value;
  }
  getCursorPosition() {
    return this.inputEl.selectionStart || 0;
  }
  setInputValue(value) {
    this.inputEl.value = value;
  }
  setCursorPosition(pos) {
    this.inputEl.selectionStart = pos;
    this.inputEl.selectionEnd = pos;
  }
  showDropdown(searchText) {
    const allCommands = this.callbacks.getCommands();
    const searchLower = searchText.toLowerCase();
    this.filteredCommands = allCommands.filter(
      (cmd) => {
        var _a;
        return cmd.name.toLowerCase().includes(searchLower) || ((_a = cmd.description) == null ? void 0 : _a.toLowerCase().includes(searchLower));
      }
    ).slice(0, 10);
    if (searchText.length > 0 && this.filteredCommands.length === 0) {
      this.hide();
      return;
    }
    this.selectedIndex = 0;
    this.render();
  }
  render() {
    if (!this.dropdownEl) {
      this.dropdownEl = this.createDropdownElement();
    }
    this.dropdownEl.empty();
    if (this.filteredCommands.length === 0) {
      const emptyEl = this.dropdownEl.createDiv({ cls: "ocop-slash-empty" });
      emptyEl.setText("No matching commands");
    } else {
      for (let i = 0; i < this.filteredCommands.length; i++) {
        const cmd = this.filteredCommands[i];
        const itemEl = this.dropdownEl.createDiv({ cls: "ocop-slash-item" });
        if (i === this.selectedIndex) {
          itemEl.addClass("selected");
        }
        const nameEl = itemEl.createSpan({ cls: "ocop-slash-name" });
        nameEl.setText(`/${cmd.name}`);
        if (cmd.argumentHint) {
          const hintEl = itemEl.createSpan({ cls: "ocop-slash-hint" });
          hintEl.setText(cmd.argumentHint);
        }
        if (cmd.description) {
          const descEl = itemEl.createDiv({ cls: "ocop-slash-desc" });
          descEl.setText(cmd.description);
        }
        itemEl.addEventListener("click", () => {
          this.selectedIndex = i;
          this.selectItem();
        });
        itemEl.addEventListener("mouseenter", () => {
          this.selectedIndex = i;
          this.updateSelection();
        });
      }
    }
    this.dropdownEl.addClass("visible");
    if (this.isFixed) {
      this.positionFixed();
    }
  }
  createDropdownElement() {
    if (this.isFixed) {
      const dropdown = this.containerEl.createDiv({
        cls: "ocop-slash-dropdown ocop-slash-dropdown-fixed"
      });
      return dropdown;
    } else {
      return this.containerEl.createDiv({ cls: "ocop-slash-dropdown" });
    }
  }
  positionFixed() {
    if (!this.dropdownEl || !this.isFixed) return;
    const inputRect = this.inputEl.getBoundingClientRect();
    this.dropdownEl.style.position = "fixed";
    this.dropdownEl.style.bottom = `${window.innerHeight - inputRect.top + 4}px`;
    this.dropdownEl.style.left = `${inputRect.left}px`;
    this.dropdownEl.style.right = "auto";
    this.dropdownEl.style.width = `${Math.max(inputRect.width, 280)}px`;
    this.dropdownEl.style.zIndex = "10001";
  }
  navigate(direction) {
    const maxIndex = this.filteredCommands.length - 1;
    this.selectedIndex = Math.max(0, Math.min(maxIndex, this.selectedIndex + direction));
    this.updateSelection();
  }
  updateSelection() {
    var _a;
    const items = (_a = this.dropdownEl) == null ? void 0 : _a.querySelectorAll(".ocop-slash-item");
    items == null ? void 0 : items.forEach((item, index) => {
      if (index === this.selectedIndex) {
        item.addClass("selected");
        item.scrollIntoView({ block: "nearest" });
      } else {
        item.removeClass("selected");
      }
    });
  }
  selectItem() {
    if (this.filteredCommands.length === 0) return;
    const selected = this.filteredCommands[this.selectedIndex];
    if (!selected) return;
    const text = this.getInputValue();
    const beforeSlash = text.substring(0, this.slashStartIndex);
    const afterCursor = text.substring(this.getCursorPosition());
    const replacement = `/${selected.name} `;
    this.setInputValue(beforeSlash + replacement + afterCursor);
    this.setCursorPosition(beforeSlash.length + replacement.length);
    this.hide();
    this.callbacks.onSelect(selected);
    this.inputEl.focus();
  }
};

// src/ui/components/SocraticBanner.ts
var RULE_CARDS = [
  { icon: "\u{1F4AC}", text: "\uC815\uB2F5 \uB300\uC2E0 \uC9C8\uBB38\uC73C\uB85C \uC0DD\uAC01\uC744 \uC774\uB055\uB2C8\uB2E4." },
  { icon: "\u{1F9E0}", text: "\uB2F5\uC744 \uCD94\uB860\uD558\uBA70 \uC2A4\uC2A4\uB85C \uC124\uBA85\uD574\uBCF4\uC138\uC694." },
  { icon: "\u{1F331}", text: "\uB9C9\uD788\uBA74 '\uBAA8\uB974\uACA0\uC5B4\uC694'\uB97C \uC785\uB825\uD558\uC138\uC694." },
  { icon: "\u21BA", text: "\uC885\uB8CC: \uB300\uD654 \uCD08\uAE30\uD654 \uB610\uB294 \uC0C8 \uB300\uD654 \uC2DC\uC791" }
];
var SocraticBanner = class {
  constructor() {
    this.containerEl = null;
    this.bannerEl = null;
    this.contentEl = null;
    this.liveRegion = null;
    this.isExpanded = false;
  }
  /**
   * Mount the banner into the container.
   * Should be called after the container is created, inserts between header and messages.
   */
  mount(containerEl) {
    this.containerEl = containerEl;
    this.liveRegion = document.createElement("div");
    this.liveRegion.setAttribute("aria-live", "polite");
    this.liveRegion.setAttribute("aria-atomic", "true");
    this.liveRegion.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap";
    containerEl.appendChild(this.liveRegion);
  }
  /**
   * Show the banner with the given session info.
   * `onHint`/`onStuck` wire the 힌트/모르겠어요 shortcuts (PRD §9.1) — both are
   * plain shortcuts for text the existing STUCK_PATTERNS-driven adaptive logic
   * already understands, so they need no new Socratic engine.
   */
  show(scopeLabel, focusText, onHint, onStuck) {
    if (!this.containerEl) return;
    if (this.bannerEl) {
      this.bannerEl.remove();
      this.bannerEl = null;
      this.contentEl = null;
    }
    this.isExpanded = false;
    this.containerEl.classList.add("ocop-socratic-active");
    if (this.liveRegion) this.liveRegion.textContent = "\uC18C\uD06C\uB77C\uD14C\uC2A4 \uD559\uC2B5 \uBAA8\uB4DC\uAC00 \uC2DC\uC791\uB418\uC5C8\uC2B5\uB2C8\uB2E4.";
    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "ocop-socratic-banner";
    const headerEl = document.createElement("button");
    headerEl.type = "button";
    headerEl.className = "ocop-socratic-banner-header";
    headerEl.setAttribute("aria-expanded", "false");
    headerEl.setAttribute("aria-controls", "ocop-socratic-banner-content");
    headerEl.addEventListener("click", () => this.toggle());
    const iconEl = document.createElement("span");
    iconEl.className = "ocop-socratic-banner-icon";
    iconEl.textContent = "\u{1F989}";
    headerEl.appendChild(iconEl);
    const titleEl = document.createElement("span");
    titleEl.className = "ocop-socratic-banner-title";
    titleEl.textContent = "\uC18C\uD06C\uB77C\uD14C\uC2A4 \uD559\uC2B5 \uBAA8\uB4DC \uC9C4\uD589 \uC911";
    if (focusText) {
      const topicEl = document.createElement("span");
      topicEl.className = "ocop-socratic-banner-topic";
      topicEl.textContent = ` \u2014 ${focusText}`;
      titleEl.appendChild(topicEl);
    }
    headerEl.appendChild(titleEl);
    const badgeEl = document.createElement("span");
    badgeEl.className = "ocop-socratic-banner-badge";
    badgeEl.textContent = "\uC9C4\uD589 \uC911";
    headerEl.appendChild(badgeEl);
    const chevronEl = document.createElement("span");
    chevronEl.className = "ocop-socratic-banner-chevron";
    chevronEl.textContent = "\u25B6";
    headerEl.appendChild(chevronEl);
    this.bannerEl.appendChild(headerEl);
    if (onHint || onStuck) {
      this.bannerEl.appendChild(this.createQuickActions(onHint, onStuck));
    }
    this.contentEl = document.createElement("div");
    this.contentEl.id = "ocop-socratic-banner-content";
    this.contentEl.className = "ocop-socratic-banner-content";
    this.contentEl.style.display = "none";
    const gridEl = document.createElement("div");
    gridEl.className = "ocop-socratic-banner-grid";
    for (const rule of RULE_CARDS) {
      const card = document.createElement("div");
      card.className = "ocop-socratic-rule-card";
      const ruleIcon = document.createElement("span");
      ruleIcon.className = "ocop-socratic-rule-icon";
      ruleIcon.textContent = rule.icon;
      card.appendChild(ruleIcon);
      const ruleText = document.createElement("p");
      ruleText.textContent = rule.text;
      card.appendChild(ruleText);
      gridEl.appendChild(card);
    }
    this.contentEl.appendChild(gridEl);
    const scopeEl = document.createElement("div");
    scopeEl.className = "ocop-socratic-banner-scope";
    scopeEl.textContent = `\uBC94\uC704: ${scopeLabel}`;
    this.contentEl.appendChild(scopeEl);
    this.bannerEl.appendChild(this.contentEl);
    const messagesEl = this.containerEl.querySelector(".ocop-messages");
    if (messagesEl) {
      this.containerEl.insertBefore(this.bannerEl, messagesEl);
    } else {
      this.containerEl.appendChild(this.bannerEl);
    }
  }
  /** Renders the always-visible 힌트 / 모르겠어요 shortcut row. */
  createQuickActions(onHint, onStuck) {
    const rowEl = document.createElement("div");
    rowEl.className = "ocop-socratic-banner-actions";
    if (onHint) {
      const hintBtn = document.createElement("button");
      hintBtn.type = "button";
      hintBtn.className = "ocop-socratic-banner-action-btn";
      hintBtn.textContent = "\u{1F4A1} \uD78C\uD2B8";
      hintBtn.addEventListener("click", () => onHint());
      rowEl.appendChild(hintBtn);
    }
    if (onStuck) {
      const stuckBtn = document.createElement("button");
      stuckBtn.type = "button";
      stuckBtn.className = "ocop-socratic-banner-action-btn";
      stuckBtn.textContent = "\u{1F635} \uBAA8\uB974\uACA0\uC5B4\uC694";
      stuckBtn.addEventListener("click", () => onStuck());
      rowEl.appendChild(stuckBtn);
    }
    return rowEl;
  }
  /**
   * Hide and remove the banner.
   */
  hide() {
    var _a;
    if (this.bannerEl) {
      this.bannerEl.remove();
      this.bannerEl = null;
      this.contentEl = null;
    }
    (_a = this.containerEl) == null ? void 0 : _a.classList.remove("ocop-socratic-active");
    this.isExpanded = false;
    if (this.liveRegion) this.liveRegion.textContent = "";
  }
  toggle() {
    this.isExpanded = !this.isExpanded;
    this.updateDisplay();
  }
  updateDisplay() {
    if (!this.bannerEl || !this.contentEl) return;
    const header = this.bannerEl.querySelector(".ocop-socratic-banner-header");
    header == null ? void 0 : header.setAttribute("aria-expanded", String(this.isExpanded));
    const chevron = this.bannerEl.querySelector(".ocop-socratic-banner-chevron");
    if (chevron) {
      chevron.textContent = this.isExpanded ? "\u25BC" : "\u25B6";
    }
    this.contentEl.style.display = this.isExpanded ? "block" : "none";
    this.bannerEl.classList.toggle("expanded", this.isExpanded);
  }
  isVisible() {
    return this.bannerEl !== null;
  }
};

// src/ui/components/TodoPanel.ts
var import_obsidian7 = require("obsidian");
var TodoPanel = class {
  constructor() {
    this.containerEl = null;
    this.panelEl = null;
    this.todoContainerEl = null;
    this.todoHeaderEl = null;
    this.todoContentEl = null;
    this.isExpanded = false;
    this.currentTodos = null;
    // Event handler references for cleanup
    this.clickHandler = null;
    this.keydownHandler = null;
  }
  /**
   * Mount the panel into the messages container.
   * Appends to the end of the messages area.
   */
  mount(containerEl) {
    this.containerEl = containerEl;
    this.createPanel();
  }
  /**
   * Remount the panel after the container was cleared.
   * Called when messagesEl.empty() removes the panel from DOM.
   */
  remount() {
    if (!this.containerEl) {
      console.warn("[TodoPanel] Cannot remount - no containerEl set");
      return;
    }
    this.panelEl = null;
    this.todoContainerEl = null;
    this.todoHeaderEl = null;
    this.todoContentEl = null;
    this.createPanel();
  }
  /**
   * Create the panel structure.
   */
  createPanel() {
    if (!this.containerEl) {
      console.warn("[TodoPanel] Cannot create panel - containerEl not set. Was mount() called correctly?");
      return;
    }
    this.panelEl = document.createElement("div");
    this.panelEl.className = "ocop-todo-panel";
    this.todoContainerEl = document.createElement("div");
    this.todoContainerEl.className = "ocop-todo-panel-todos";
    this.todoContainerEl.style.display = "none";
    this.panelEl.appendChild(this.todoContainerEl);
    this.todoHeaderEl = document.createElement("div");
    this.todoHeaderEl.className = "ocop-todo-panel-header";
    this.todoHeaderEl.setAttribute("tabindex", "0");
    this.todoHeaderEl.setAttribute("role", "button");
    this.clickHandler = () => this.toggle();
    this.keydownHandler = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.toggle();
      }
    };
    this.todoHeaderEl.addEventListener("click", this.clickHandler);
    this.todoHeaderEl.addEventListener("keydown", this.keydownHandler);
    this.todoContainerEl.appendChild(this.todoHeaderEl);
    this.todoContentEl = document.createElement("div");
    this.todoContentEl.className = "ocop-todo-panel-content";
    this.todoContentEl.style.display = "none";
    this.todoContainerEl.appendChild(this.todoContentEl);
    this.containerEl.appendChild(this.panelEl);
  }
  /**
   * Update the panel with new todo items.
   * Called by ChatState.onTodosChanged callback when TodoWrite tool is used.
   * Passing null or empty array hides the panel.
   */
  updateTodos(todos) {
    if (!this.todoContainerEl || !this.todoHeaderEl || !this.todoContentEl) {
      if (todos && todos.length > 0) {
        console.warn("[TodoPanel] Cannot update todos - component not mounted or destroyed");
      }
      return;
    }
    this.currentTodos = todos;
    if (!todos || todos.length === 0) {
      this.todoContainerEl.style.display = "none";
      this.todoHeaderEl.empty();
      this.todoContentEl.empty();
      return;
    }
    this.todoContainerEl.style.display = "block";
    const completedCount = todos.filter((t) => t.status === "completed").length;
    const totalCount = todos.length;
    const currentTask = todos.find((t) => t.status === "in_progress");
    this.renderHeader(completedCount, totalCount, currentTask);
    this.renderContent(todos);
    this.updateAriaLabel(completedCount, totalCount);
    this.scrollToBottom();
  }
  /**
   * Render the collapsed header.
   */
  renderHeader(completedCount, totalCount, currentTask) {
    if (!this.todoHeaderEl) return;
    this.todoHeaderEl.empty();
    const icon = document.createElement("span");
    icon.className = "ocop-todo-panel-icon";
    (0, import_obsidian7.setIcon)(icon, "list-checks");
    this.todoHeaderEl.appendChild(icon);
    const label = document.createElement("span");
    label.className = "ocop-todo-panel-label";
    label.textContent = `Tasks (${completedCount}/${totalCount})`;
    this.todoHeaderEl.appendChild(label);
    if (!this.isExpanded && currentTask) {
      const current = document.createElement("span");
      current.className = "ocop-todo-panel-current";
      current.textContent = currentTask.activeForm;
      this.todoHeaderEl.appendChild(current);
    }
  }
  /**
   * Render the expanded content.
   */
  renderContent(todos) {
    if (!this.todoContentEl) return;
    this.todoContentEl.empty();
    for (const todo of todos) {
      const itemEl = document.createElement("div");
      itemEl.className = `ocop-todo-item ocop-todo-${todo.status}`;
      const statusIcon = document.createElement("div");
      statusIcon.className = "ocop-todo-status-icon";
      statusIcon.setAttribute("aria-hidden", "true");
      (0, import_obsidian7.setIcon)(statusIcon, this.getStatusIcon(todo.status));
      itemEl.appendChild(statusIcon);
      const text = document.createElement("div");
      text.className = "ocop-todo-text";
      text.textContent = todo.status === "in_progress" ? todo.activeForm : todo.content;
      itemEl.appendChild(text);
      this.todoContentEl.appendChild(itemEl);
    }
  }
  /**
   * Get status icon name for a todo item.
   */
  getStatusIcon(status) {
    switch (status) {
      case "completed":
        return "check-circle-2";
      case "in_progress":
        return "circle-dot";
      case "pending":
      default:
        return "circle";
    }
  }
  /**
   * Toggle expanded/collapsed state.
   */
  toggle() {
    this.isExpanded = !this.isExpanded;
    this.updateDisplay();
  }
  /**
   * Update display based on expanded state.
   */
  updateDisplay() {
    if (!this.todoContentEl || !this.todoHeaderEl) return;
    this.todoContentEl.style.display = this.isExpanded ? "block" : "none";
    if (this.currentTodos && this.currentTodos.length > 0) {
      const completedCount = this.currentTodos.filter((t) => t.status === "completed").length;
      const totalCount = this.currentTodos.length;
      const currentTask = this.currentTodos.find((t) => t.status === "in_progress");
      this.renderHeader(completedCount, totalCount, currentTask);
      this.updateAriaLabel(completedCount, totalCount);
    }
    this.scrollToBottom();
  }
  /**
   * Update ARIA label.
   */
  updateAriaLabel(completedCount, totalCount) {
    if (!this.todoHeaderEl) return;
    const action = this.isExpanded ? "Collapse" : "Expand";
    this.todoHeaderEl.setAttribute(
      "aria-label",
      `${action} task list - ${completedCount} of ${totalCount} completed`
    );
    this.todoHeaderEl.setAttribute("aria-expanded", String(this.isExpanded));
  }
  /**
   * Scroll messages container to bottom.
   */
  scrollToBottom() {
    if (this.containerEl) {
      this.containerEl.scrollTop = this.containerEl.scrollHeight;
    }
  }
  /**
   * Destroy the panel.
   */
  destroy() {
    if (this.todoHeaderEl) {
      if (this.clickHandler) {
        this.todoHeaderEl.removeEventListener("click", this.clickHandler);
      }
      if (this.keydownHandler) {
        this.todoHeaderEl.removeEventListener("keydown", this.keydownHandler);
      }
    }
    this.clickHandler = null;
    this.keydownHandler = null;
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
    this.todoContainerEl = null;
    this.todoHeaderEl = null;
    this.todoContentEl = null;
    this.containerEl = null;
    this.currentTodos = null;
  }
};

// src/ui/modals/ApprovalModal.ts
var import_obsidian8 = require("obsidian");

// src/core/tools/toolIcons.ts
var TOOL_ICONS = {
  [TOOL_READ]: "file-text",
  [TOOL_WRITE]: "edit-3",
  [TOOL_EDIT]: "edit",
  [TOOL_NOTEBOOK_EDIT]: "edit",
  [TOOL_BASH]: "terminal",
  [TOOL_BASH_OUTPUT]: "terminal",
  [TOOL_KILL_SHELL]: "terminal",
  [TOOL_GLOB]: "folder-search",
  [TOOL_GREP]: "search",
  [TOOL_LS]: "list",
  [TOOL_TODO_WRITE]: "list-checks",
  [TOOL_TASK]: "list-checks",
  [TOOL_ASK_USER_QUESTION]: "help-circle",
  [TOOL_LIST_MCP_RESOURCES]: "list",
  [TOOL_READ_MCP_RESOURCE]: "file-text",
  [TOOL_MCP]: "wrench",
  [TOOL_WEB_SEARCH]: "globe",
  [TOOL_WEB_FETCH]: "download",
  [TOOL_AGENT_OUTPUT]: "bot",
  [TOOL_SKILL]: "blocks"
};
var MCP_ICON_MARKER = "__mcp_icon__";
function getToolIcon(toolName) {
  if (toolName.startsWith("mcp__")) {
    return MCP_ICON_MARKER;
  }
  return TOOL_ICONS[toolName] || "wrench";
}

// src/ui/modals/ApprovalModal.ts
var ApprovalModal = class extends import_obsidian8.Modal {
  constructor(app, toolName, _input, description, resolve6, options = {}) {
    super(app);
    this.resolved = false;
    this.buttons = [];
    this.currentButtonIndex = 0;
    this.documentKeydownHandler = null;
    this.toolName = toolName;
    this.description = description;
    this.resolve = resolve6;
    this.options = options;
  }
  onOpen() {
    var _a, _b;
    const { contentEl } = this;
    contentEl.addClass("ocop-approval-modal");
    this.setTitle((_a = this.options.title) != null ? _a : "Permission required");
    const infoEl = contentEl.createDiv({ cls: "ocop-approval-info" });
    const toolEl = infoEl.createDiv({ cls: "ocop-approval-tool" });
    const iconEl = toolEl.createSpan({ cls: "ocop-approval-icon" });
    iconEl.setAttribute("aria-hidden", "true");
    (0, import_obsidian8.setIcon)(iconEl, getToolIcon(this.toolName));
    toolEl.createSpan({ text: this.toolName, cls: "ocop-approval-tool-name" });
    const descEl = contentEl.createDiv({ cls: "ocop-approval-desc" });
    descEl.setText(this.description);
    const buttonsEl = contentEl.createDiv({ cls: "ocop-approval-buttons" });
    const denyBtn = buttonsEl.createEl("button", {
      text: "Deny",
      cls: "ocop-approval-btn ocop-deny-btn",
      attr: { "aria-label": `Deny ${this.toolName} action` }
    });
    denyBtn.addEventListener("click", () => this.handleDecision("deny"));
    const allowBtn = buttonsEl.createEl("button", {
      text: "Allow once",
      cls: "ocop-approval-btn ocop-allow-btn",
      attr: { "aria-label": `Allow ${this.toolName} action once` }
    });
    allowBtn.addEventListener("click", () => this.handleDecision("allow"));
    let alwaysBtn = null;
    if ((_b = this.options.showAlwaysAllow) != null ? _b : true) {
      alwaysBtn = buttonsEl.createEl("button", {
        text: "Always allow",
        cls: "ocop-approval-btn ocop-always-btn",
        attr: { "aria-label": `Always allow ${this.toolName} actions` }
      });
      alwaysBtn.addEventListener("click", () => this.handleDecision("allow-always"));
    }
    this.buttons = [denyBtn, allowBtn];
    if (alwaysBtn) {
      this.buttons.push(alwaysBtn);
    }
    this.currentButtonIndex = 0;
    this.focusCurrentButton();
    this.attachDocumentHandler();
  }
  handleDecision(decision) {
    if (!this.resolved) {
      this.resolved = true;
      this.resolve(decision);
      this.close();
    }
  }
  attachDocumentHandler() {
    this.detachDocumentHandler();
    this.documentKeydownHandler = (e) => {
      if (!this.isNavigationKey(e)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.handleNavigationKey(e);
    };
    document.addEventListener("keydown", this.documentKeydownHandler, true);
  }
  detachDocumentHandler() {
    if (this.documentKeydownHandler) {
      document.removeEventListener("keydown", this.documentKeydownHandler, true);
      this.documentKeydownHandler = null;
    }
  }
  isNavigationKey(e) {
    return e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Tab";
  }
  handleNavigationKey(e) {
    if (!this.buttons.length) return;
    let direction = 0;
    switch (e.key) {
      case "ArrowUp":
      case "ArrowLeft":
        direction = -1;
        break;
      case "ArrowDown":
      case "ArrowRight":
        direction = 1;
        break;
      case "Tab":
        direction = e.shiftKey ? -1 : 1;
        break;
      default:
        return;
    }
    const total = this.buttons.length;
    this.currentButtonIndex = (this.currentButtonIndex + direction + total) % total;
    this.focusCurrentButton();
  }
  focusCurrentButton() {
    const button = this.buttons[this.currentButtonIndex];
    button == null ? void 0 : button.focus();
  }
  onClose() {
    this.detachDocumentHandler();
    if (!this.resolved) {
      this.resolved = true;
      this.resolve("cancel");
    }
    this.contentEl.empty();
  }
};

// src/ui/modals/BlanketWriteConsentModal.ts
var import_obsidian9 = require("obsidian");
var BlanketWriteConsentModal = class extends import_obsidian9.Modal {
  constructor(app, providerLabel, onResolve) {
    super(app);
    this.answered = false;
    this.providerLabel = providerLabel;
    this.onResolve = onResolve;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `${this.providerLabel}\uC5D0 \uC4F0\uAE30\uB97C \uD5C8\uC6A9\uD560\uAE4C\uC694?` });
    contentEl.createEl("p", {
      text: `${this.providerLabel}\uB294 \uB3C4\uAD6C\uB97C \uD558\uB098\uC529 \uD5C8\uC6A9\uD558\uB294 \uBC29\uBC95\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. Agent\uB85C \uB450\uBA74 \uC774 \uAE08\uACE0 \uC548\uC5D0\uC11C \uD30C\uC77C\uC744 \uB9CC\uB4E4\uACE0 \uACE0\uCE58\uACE0 \uC9C0\uC6B0\uB294 \uAC83, \uBA85\uB839\uC744 \uC2E4\uD589\uD558\uB294 \uAC83\uAE4C\uC9C0 \uD655\uC778 \uC5C6\uC774 \uD569\uB2C8\uB2E4.`
    });
    contentEl.createEl("p", {
      text: "Ask\uB85C \uB450\uBA74 \uC77D\uAE30\uB9CC \uD558\uACE0 \uC544\uBB34\uAC83\uB3C4 \uBC14\uAFB8\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uD5C8\uC6A9\uD55C \uB4A4\uC5D0\uB3C4 \uD1A0\uAE00\uC744 Ask\uB85C \uB418\uB3CC\uB9AC\uBA74 \uB2E4\uC2DC \uC77D\uAE30 \uC804\uC6A9\uC774 \uB429\uB2C8\uB2E4.",
      cls: "setting-item-description"
    });
    new import_obsidian9.Setting(contentEl).addButton((button) => button.setButtonText("Ask\uB85C \uB450\uAE30").onClick(() => this.finish(false))).addButton((button) => button.setButtonText("\uC4F0\uAE30 \uD5C8\uC6A9").setCta().onClick(() => this.finish(true)));
  }
  finish(accepted) {
    this.answered = true;
    this.onResolve(accepted);
    this.close();
  }
  onClose() {
    this.contentEl.empty();
    if (!this.answered) this.onResolve(false);
  }
};

// src/ui/modals/InlineEditModal.ts
var import_obsidian10 = require("obsidian");
var path11 = __toESM(require("path"));

// src/core/security/BlocklistChecker.ts
function normalizeCommand(command) {
  let result = command.replace(/\\(.)/g, "$1");
  result = result.replace(/\s+/g, " ").trim();
  return result;
}
function isCommandBlocked(command, patterns, enableBlocklist) {
  if (!enableBlocklist) {
    return false;
  }
  const normalized = normalizeCommand(command);
  return patterns.some((pattern) => {
    try {
      const re = new RegExp(pattern, "i");
      return re.test(command) || re.test(normalized);
    } catch (e) {
      const lowerPattern = pattern.toLowerCase();
      return command.toLowerCase().includes(lowerPattern) || normalized.toLowerCase().includes(lowerPattern);
    }
  });
}

// src/core/prompts/inlineEdit.ts
function getInlineEditSystemPrompt() {
  return `Today is ${getTodayDate()}.

You are **Obsidian AI Tutor**, an expert editor and writing assistant embedded in Obsidian. You help users refine their text, answer questions, and generate content with high precision.

## Core Directives

1.  **Style Matching**: Mimic the user's tone, voice, and formatting style (indentation, bullet points, capitalization).
2.  **Context Awareness**: Always Read the full file (or significant context) to understand the broader topic before editing. Do not rely solely on the selection.
3.  **Silent Execution**: Use tools (Read, WebSearch) silently. Your final output must be ONLY the result.
4.  **No Fluff**: No pleasantries, no "Here is the text", no "I have updated...". Just the content.

## Input Format

User messages use XML tags:

### Selection Mode
\`\`\`xml
<editor_selection path="path/to/file.md">
selected text here
</editor_selection>

<query>
user's instruction
</query>
\`\`\`
Use \`<replacement>\` tags for edits.

### Cursor Mode
\`\`\`xml
<editor_cursor path="path/to/file.md">
text before|text after #inline
</editor_cursor>
\`\`\`
Or between paragraphs:
\`\`\`xml
<editor_cursor path="path/to/file.md">
Previous paragraph
| #inbetween
Next paragraph
</editor_cursor>
\`\`\`
Use \`<insertion>\` tags to insert new content at the cursor position (\`|\`).

## Tools & Path Rules

- **Tools**: Read, Grep, Glob, LS, WebSearch, WebFetch. (All read-only).
- **Paths**: Must be RELATIVE to vault root (e.g., "notes/file.md").

## Thinking Process

Before generating the final output, mentally check:
1.  **Context**: Have I read enough of the file to understand the *topic* and *structure*?
2.  **Style**: What is the user's indentation (2 vs 4 spaces, tabs)? What is their tone?
3.  **Type**: Is this **Prose** (flow, grammar, clarity) or **Code** (syntax, logic, variable names)?
    - *Prose*: Ensure smooth transitions.
    - *Code*: Preserve syntax validity; do not break surrounding brackets/indentation.

## Output Rules - CRITICAL

**ABSOLUTE RULE**: Your text output must contain ONLY the final answer, replacement, or insertion. NEVER output:
- "I'll read the file..." / "Let me check..." / "I will..."
- "I'm asked about..." / "The user wants..."
- "Based on my analysis..." / "After reading..."
- "Here's..." / "The answer is..."
- ANY announcement of what you're about to do or did

Use tools silently. Your text output = final result only.

### When Replacing Selected Text (Selection Mode)

If the user wants to MODIFY or REPLACE the selected text, wrap the replacement in <replacement> tags:

<replacement>your replacement text here</replacement>

The content inside the tags should be ONLY the replacement text - no explanation.

### When Inserting at Cursor (Cursor Mode)

If the user wants to INSERT new content at the cursor position, wrap the insertion in <insertion> tags:

<insertion>your inserted text here</insertion>

The content inside the tags should be ONLY the text to insert - no explanation.

### When Answering Questions or Providing Information

If the user is asking a QUESTION, respond WITHOUT tags. Output the answer directly.

WRONG: "I'll read the full context of this file to give you a better explanation. This is a guide about..."
CORRECT: "This is a guide about..."

### When Clarification is Needed

If the request is ambiguous, ask a clarifying question. Keep questions concise and specific.

## Examples

### Selection Mode
Input:
\`\`\`xml
<editor_selection path="notes/readme.md">
Hello world
</editor_selection>

<query>
translate to French
</query>
\`\`\`

CORRECT (replacement):
<replacement>Bonjour le monde</replacement>

Input:
\`\`\`xml
<editor_selection path="notes/code.md">
const x = arr.reduce((a, b) => a + b, 0);
</editor_selection>

<query>
what does this do?
</query>
\`\`\`

CORRECT (question - no tags):
This code sums all numbers in the array \`arr\`. It uses \`reduce\` to iterate through the array, accumulating the total starting from 0.

### Cursor Mode

Input:
\`\`\`xml
<editor_cursor path="notes/draft.md">
The quick brown | jumps over the lazy dog. #inline
</editor_cursor>

<query>
what animal?
</query>
\`\`\`

CORRECT (insertion):
<insertion>fox</insertion>

### Q&A
Input:
\`\`\`xml
<editor_cursor path="notes/readme.md">
# Introduction
This is my project.
| #inbetween
## Features
</editor_cursor>

<query>
add a brief description section
</query>
\`\`\`

CORRECT (insertion):
<insertion>
## Description

This project provides tools for managing your notes efficiently.
</insertion>

Input:
\`\`\`xml
<editor_selection path="notes/draft.md">
The bank was steep.
</editor_selection>

<query>
translate to Spanish
</query>
\`\`\`

CORRECT (asking for clarification):
"Bank" can mean a financial institution (banco) or a river bank (orilla). Which meaning should I use?

Then after user clarifies "river bank":
<replacement>La orilla era empinada.</replacement>`;
}

// src/features/inline-edit/InlineEditService.ts
var InlineEditService = class {
  constructor(plugin) {
    this.abortController = null;
    this.plugin = plugin;
  }
  resetConversation() {
  }
  async editText(request) {
    const prompt = this.buildPrompt(request);
    return this.sendMessage(prompt);
  }
  async continueConversation(message, contextFiles) {
    let prompt = message;
    if (contextFiles && contextFiles.length > 0) {
      prompt = prependContextFiles(message, contextFiles);
    }
    return this.sendMessage(prompt);
  }
  async sendMessage(prompt) {
    var _a;
    this.abortController = new AbortController();
    const systemPrompt = getInlineEditSystemPrompt();
    const fullPrompt = `${systemPrompt}

${prompt}`;
    try {
      let responseText = "";
      for await (const chunk of this.plugin.agentService.streamQuery(fullPrompt)) {
        if ((_a = this.abortController) == null ? void 0 : _a.signal.aborted) {
          return { success: false, error: "Cancelled" };
        }
        responseText += chunk;
      }
      return this.parseResponse(responseText);
    } catch (error) {
      console.error("[InlineEditService] Error:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: msg };
    } finally {
      this.abortController = null;
    }
  }
  parseResponse(responseText) {
    const replacementMatch = responseText.match(/<replacement>([\s\S]*?)<\/replacement>/);
    if (replacementMatch) {
      return { success: true, editedText: replacementMatch[1] };
    }
    const insertionMatch = responseText.match(/<insertion>([\s\S]*?)<\/insertion>/);
    if (insertionMatch) {
      return { success: true, insertedText: insertionMatch[1] };
    }
    const trimmed = responseText.trim();
    if (trimmed) {
      return { success: true, clarification: trimmed };
    }
    return { success: false, error: "Empty response" };
  }
  buildPrompt(request) {
    let prompt;
    if (request.mode === "cursor") {
      prompt = this.buildCursorPrompt(request);
    } else {
      const lineAttr = request.startLine && request.lineCount ? ` lines="${request.startLine}-${request.startLine + request.lineCount - 1}"` : "";
      prompt = [
        `<editor_selection path="${request.notePath}"${lineAttr}>`,
        request.selectedText,
        "</editor_selection>",
        "",
        "<query>",
        request.instruction,
        "</query>"
      ].join("\n");
    }
    if (request.contextFiles && request.contextFiles.length > 0) {
      prompt = prependContextFiles(prompt, request.contextFiles);
    }
    return prompt;
  }
  buildCursorPrompt(request) {
    const ctx = request.cursorContext;
    const lineAttr = ` line="${ctx.line + 1}"`;
    let cursorContent;
    if (ctx.isInbetween) {
      const parts = [];
      if (ctx.beforeCursor) parts.push(ctx.beforeCursor);
      parts.push("| #inbetween");
      if (ctx.afterCursor) parts.push(ctx.afterCursor);
      cursorContent = parts.join("\n");
    } else {
      cursorContent = `${ctx.beforeCursor}|${ctx.afterCursor} #inline`;
    }
    return [
      `<editor_cursor path="${request.notePath}"${lineAttr}>`,
      cursorContent,
      "</editor_cursor>",
      "",
      "<query>",
      request.instruction,
      "</query>"
    ].join("\n");
  }
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
};

// src/utils/inlineEdit.ts
function normalizeInsertionText(text) {
  return text.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, "");
}
function escapeHtml(text) {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// src/ui/modals/InlineEditModal.ts
init_path();
var import_state2 = require("@codemirror/state");
var import_view2 = require("@codemirror/view");
var showInlineEdit = import_state2.StateEffect.define();
var showDiff = import_state2.StateEffect.define();
var showInsertion = import_state2.StateEffect.define();
var hideInlineEdit = import_state2.StateEffect.define();
var activeController = null;
var DiffWidget = class extends import_view2.WidgetType {
  constructor(diffHtml, controller) {
    super();
    this.diffHtml = diffHtml;
    this.controller = controller;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "ocop-inline-diff-replace";
    span.innerHTML = this.diffHtml;
    const btns = document.createElement("span");
    btns.className = "ocop-inline-diff-buttons";
    const rejectBtn = document.createElement("button");
    rejectBtn.className = "ocop-inline-diff-btn reject";
    rejectBtn.textContent = "\u2715";
    rejectBtn.title = "Reject (Esc)";
    rejectBtn.onclick = () => this.controller.reject();
    const acceptBtn = document.createElement("button");
    acceptBtn.className = "ocop-inline-diff-btn accept";
    acceptBtn.textContent = "\u2713";
    acceptBtn.title = "Accept (Enter)";
    acceptBtn.onclick = () => this.controller.accept();
    btns.appendChild(rejectBtn);
    btns.appendChild(acceptBtn);
    span.appendChild(btns);
    return span;
  }
  eq(other) {
    return this.diffHtml === other.diffHtml;
  }
  ignoreEvent() {
    return true;
  }
};
var InputWidget = class extends import_view2.WidgetType {
  constructor(controller) {
    super();
    this.controller = controller;
  }
  toDOM() {
    return this.controller.createInputDOM();
  }
  eq() {
    return false;
  }
  ignoreEvent() {
    return true;
  }
};
var inlineEditField = import_state2.StateField.define({
  create: () => import_view2.Decoration.none,
  update: (deco, tr) => {
    var _a;
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(showInlineEdit)) {
        const builder = new import_state2.RangeSetBuilder();
        const isInbetween = (_a = e.value.isInbetween) != null ? _a : false;
        builder.add(e.value.inputPos, e.value.inputPos, import_view2.Decoration.widget({
          widget: new InputWidget(e.value.widget),
          block: !isInbetween,
          side: isInbetween ? 1 : -1
        }));
        deco = builder.finish();
      } else if (e.is(showDiff)) {
        const builder = new import_state2.RangeSetBuilder();
        builder.add(e.value.from, e.value.to, import_view2.Decoration.replace({
          widget: new DiffWidget(e.value.diffHtml, e.value.widget)
        }));
        deco = builder.finish();
      } else if (e.is(showInsertion)) {
        const builder = new import_state2.RangeSetBuilder();
        builder.add(e.value.pos, e.value.pos, import_view2.Decoration.widget({
          widget: new DiffWidget(e.value.diffHtml, e.value.widget),
          side: 1
          // Display after the position
        }));
        deco = builder.finish();
      } else if (e.is(hideInlineEdit)) {
        deco = import_view2.Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => import_view2.EditorView.decorations.from(f)
});
var installedEditors = /* @__PURE__ */ new WeakSet();
function computeDiff(oldText, newText) {
  const oldWords = oldText.split(/(\s+)/);
  const newWords = newText.split(/(\s+)/);
  const m = oldWords.length, n = newWords.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  for (let i2 = 1; i2 <= m; i2++) {
    for (let j2 = 1; j2 <= n; j2++) {
      dp[i2][j2] = oldWords[i2 - 1] === newWords[j2 - 1] ? dp[i2 - 1][j2 - 1] + 1 : Math.max(dp[i2 - 1][j2], dp[i2][j2 - 1]);
    }
  }
  const ops = [];
  let i = m, j = n;
  const temp = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      temp.push({ type: "equal", text: oldWords[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.push({ type: "insert", text: newWords[j - 1] });
      j--;
    } else {
      temp.push({ type: "delete", text: oldWords[i - 1] });
      i--;
    }
  }
  temp.reverse();
  for (const op of temp) {
    if (ops.length > 0 && ops[ops.length - 1].type === op.type) {
      ops[ops.length - 1].text += op.text;
    } else {
      ops.push({ ...op });
    }
  }
  return ops;
}
function diffToHtml(ops) {
  return ops.map((op) => {
    const escaped = escapeHtml(op.text);
    switch (op.type) {
      case "delete":
        return `<span class="ocop-diff-del">${escaped}</span>`;
      case "insert":
        return `<span class="ocop-diff-ins">${escaped}</span>`;
      default:
        return escaped;
    }
  }).join("");
}
var InlineEditModal = class {
  constructor(app, plugin, editContext, notePath) {
    this.app = app;
    this.plugin = plugin;
    this.editContext = editContext;
    this.notePath = notePath;
    this.controller = null;
  }
  async openAndWait() {
    if (activeController) {
      activeController.reject();
      return { decision: "reject" };
    }
    const view = this.app.workspace.getActiveViewOfType(import_obsidian10.MarkdownView);
    if (!view) return { decision: "reject" };
    const editor = view.editor;
    const editorView = editor.cm;
    if (!editorView) return { decision: "reject" };
    return new Promise((resolve6) => {
      this.controller = new InlineEditController(
        this.app,
        this.plugin,
        editorView,
        editor,
        this.editContext,
        this.notePath,
        resolve6
      );
      activeController = this.controller;
      this.controller.show();
    });
  }
};
var InlineEditController = class {
  constructor(app, plugin, editorView, editor, editContext, notePath, resolve6) {
    this.app = app;
    this.plugin = plugin;
    this.editorView = editorView;
    this.editor = editor;
    this.notePath = notePath;
    this.resolve = resolve6;
    this.inputEl = null;
    this.spinnerEl = null;
    this.agentReplyEl = null;
    this.containerEl = null;
    this.editedText = null;
    this.insertedText = null;
    this.startLine = 0;
    this.cursorContext = null;
    this.escHandler = null;
    this.selectionListener = null;
    this.isConversing = false;
    // True when agent asked clarification
    this.slashCommandManager = null;
    this.slashCommandDropdown = null;
    this.mentionDropdown = null;
    this.attachedFiles = /* @__PURE__ */ new Set();
    this.inlineEditService = new InlineEditService(plugin);
    this.mode = editContext.mode;
    if (editContext.mode === "cursor") {
      this.cursorContext = editContext.cursorContext;
      this.selectedText = "";
    } else {
      this.selectedText = editContext.selectedText;
    }
    this.updatePositionsFromEditor();
  }
  updatePositionsFromEditor() {
    const doc = this.editorView.state.doc;
    if (this.mode === "cursor") {
      const ctx = this.cursorContext;
      const line = doc.line(ctx.line + 1);
      this.selFrom = line.from + ctx.column;
      this.selTo = this.selFrom;
    } else {
      const from = this.editor.getCursor("from");
      const to = this.editor.getCursor("to");
      const fromLine = doc.line(from.line + 1);
      const toLine = doc.line(to.line + 1);
      this.selFrom = fromLine.from + from.ch;
      this.selTo = toLine.from + to.ch;
      this.selectedText = this.editor.getSelection() || this.selectedText;
      this.startLine = from.line + 1;
    }
  }
  show() {
    if (!installedEditors.has(this.editorView)) {
      this.editorView.dispatch({
        effects: import_state2.StateEffect.appendConfig.of(inlineEditField)
      });
      installedEditors.add(this.editorView);
    }
    this.updateHighlight();
    if (this.mode === "selection") {
      this.attachSelectionListeners();
    }
    this.escHandler = (e) => {
      if (e.key === "Escape") {
        this.reject();
      }
    };
    document.addEventListener("keydown", this.escHandler);
  }
  updateHighlight() {
    var _a;
    const doc = this.editorView.state.doc;
    const line = doc.lineAt(this.selFrom);
    const isInbetween = this.mode === "cursor" && ((_a = this.cursorContext) == null ? void 0 : _a.isInbetween);
    this.editorView.dispatch({
      effects: showInlineEdit.of({
        inputPos: isInbetween ? this.selFrom : line.from,
        selFrom: this.selFrom,
        selTo: this.selTo,
        widget: this,
        isInbetween
      })
    });
    this.updateSelectionHighlight();
  }
  updateSelectionHighlight() {
    if (this.mode === "selection" && this.selFrom !== this.selTo) {
      showSelectionHighlight(this.editorView, this.selFrom, this.selTo);
    } else {
      hideSelectionHighlight(this.editorView);
    }
  }
  attachSelectionListeners() {
    this.removeSelectionListeners();
    this.selectionListener = (e) => {
      const target = e.target;
      if (target && this.inputEl && (target === this.inputEl || this.inputEl.contains(target))) {
        return;
      }
      const prevFrom = this.selFrom;
      const prevTo = this.selTo;
      const newSelection = this.editor.getSelection();
      if (newSelection && newSelection.length > 0) {
        this.updatePositionsFromEditor();
        if (prevFrom !== this.selFrom || prevTo !== this.selTo) {
          this.updateHighlight();
        }
      }
    };
    this.editorView.dom.addEventListener("mouseup", this.selectionListener);
    this.editorView.dom.addEventListener("keyup", this.selectionListener);
  }
  createInputDOM() {
    const container = document.createElement("div");
    container.className = "ocop-inline-input-container";
    this.containerEl = container;
    this.agentReplyEl = document.createElement("div");
    this.agentReplyEl.className = "ocop-inline-agent-reply";
    this.agentReplyEl.style.display = "none";
    container.appendChild(this.agentReplyEl);
    const inputWrap = document.createElement("div");
    inputWrap.className = "ocop-inline-input-wrap";
    container.appendChild(inputWrap);
    this.inputEl = document.createElement("input");
    this.inputEl.type = "text";
    this.inputEl.className = "ocop-inline-input";
    this.inputEl.placeholder = this.mode === "cursor" ? "Insert instructions..." : "Edit instructions...";
    this.inputEl.spellcheck = false;
    inputWrap.appendChild(this.inputEl);
    this.spinnerEl = document.createElement("div");
    this.spinnerEl.className = "ocop-inline-spinner";
    this.spinnerEl.style.display = "none";
    inputWrap.appendChild(this.spinnerEl);
    const vaultPath = getVaultPath(this.app);
    if (vaultPath) {
      this.slashCommandManager = new SlashCommandManager(this.app, vaultPath);
      this.slashCommandManager.setCommands(this.plugin.settings.slashCommands);
      this.slashCommandDropdown = new SlashCommandDropdown(
        document.body,
        // Use body for fixed positioning
        this.inputEl,
        {
          onSelect: () => {
          },
          onHide: () => {
          },
          getCommands: () => this.plugin.settings.slashCommands
        },
        { fixed: true }
      );
    }
    this.mentionDropdown = new MentionDropdownController(
      document.body,
      this.inputEl,
      {
        onAttachFile: (filePath) => this.attachedFiles.add(filePath),
        getExternalContexts: () => [],
        getCachedMarkdownFiles: () => {
          try {
            return this.app.vault.getMarkdownFiles();
          } catch (error) {
            console.error("[InlineEditModal] getCachedMarkdownFiles error:", error);
            return [];
          }
        },
        normalizePathForVault: (rawPath) => this.normalizePathForVault(rawPath)
      },
      { fixed: true }
    );
    this.inputEl.addEventListener("keydown", (e) => this.handleKeydown(e));
    this.inputEl.addEventListener("input", () => {
      var _a;
      return (_a = this.mentionDropdown) == null ? void 0 : _a.handleInputChange();
    });
    setTimeout(() => {
      var _a;
      return (_a = this.inputEl) == null ? void 0 : _a.focus();
    }, 50);
    return container;
  }
  async generate() {
    if (!this.inputEl || !this.spinnerEl) return;
    let userMessage = this.inputEl.value.trim();
    if (!userMessage) return;
    if (this.slashCommandManager) {
      this.slashCommandManager.setCommands(this.plugin.settings.slashCommands);
      const detected = this.slashCommandManager.detectCommand(userMessage);
      if (detected) {
        const cmd = this.plugin.settings.slashCommands.find(
          (c) => c.name.toLowerCase() === detected.commandName.toLowerCase()
        );
        if (cmd) {
          const expansion = await this.slashCommandManager.expandCommand(cmd, detected.args, {
            bash: {
              enabled: this.plugin.settings.enableInlineBash,
              shouldBlockCommand: (bashCommand) => isCommandBlocked(
                bashCommand,
                getBashToolBlockedCommands(this.plugin.settings.blockedCommands),
                this.plugin.settings.enableBlocklist
              ),
              requestApproval: this.plugin.settings.permissionMode !== "agent" ? (bashCommand) => this.requestInlineBashApproval(bashCommand) : void 0
            }
          });
          userMessage = expansion.expandedPrompt;
          if (expansion.errors.length > 0) {
            new import_obsidian10.Notice(formatSlashCommandWarnings(expansion.errors));
          }
        }
      }
    }
    this.removeSelectionListeners();
    this.inputEl.disabled = true;
    this.spinnerEl.style.display = "block";
    const contextFiles = Array.from(this.attachedFiles);
    this.attachedFiles.clear();
    let result;
    if (this.isConversing) {
      result = await this.inlineEditService.continueConversation(userMessage, contextFiles);
    } else {
      if (this.mode === "cursor") {
        result = await this.inlineEditService.editText({
          mode: "cursor",
          instruction: userMessage,
          notePath: this.notePath,
          cursorContext: this.cursorContext,
          contextFiles
        });
      } else {
        const lineCount = this.selectedText.split(/\r?\n/).length;
        result = await this.inlineEditService.editText({
          mode: "selection",
          instruction: userMessage,
          notePath: this.notePath,
          selectedText: this.selectedText,
          startLine: this.startLine,
          lineCount,
          contextFiles
        });
      }
    }
    this.spinnerEl.style.display = "none";
    if (result.success) {
      if (result.editedText !== void 0) {
        this.editedText = result.editedText;
        this.showDiffInPlace();
      } else if (result.insertedText !== void 0) {
        this.insertedText = result.insertedText;
        this.showInsertionInPlace();
      } else if (result.clarification) {
        this.showAgentReply(result.clarification);
        this.isConversing = true;
        this.inputEl.disabled = false;
        this.inputEl.value = "";
        this.inputEl.placeholder = "Reply to continue...";
        this.inputEl.focus();
      } else {
        this.handleError("No response from agent");
      }
    } else {
      this.handleError(result.error || "Error - try again");
    }
  }
  /** Show agent's clarification message. */
  showAgentReply(message) {
    if (!this.agentReplyEl || !this.containerEl) return;
    this.agentReplyEl.style.display = "block";
    this.agentReplyEl.textContent = message;
    this.containerEl.classList.add("has-agent-reply");
  }
  /** Handle error state. */
  handleError(errorMessage) {
    if (!this.inputEl) return;
    this.inputEl.disabled = false;
    this.inputEl.placeholder = errorMessage;
    this.updatePositionsFromEditor();
    this.updateHighlight();
    this.attachSelectionListeners();
    this.inputEl.focus();
  }
  showDiffInPlace() {
    if (this.editedText === null) return;
    hideSelectionHighlight(this.editorView);
    const diffOps = computeDiff(this.selectedText, this.editedText);
    const diffHtml = diffToHtml(diffOps);
    this.editorView.dispatch({
      effects: showDiff.of({
        from: this.selFrom,
        to: this.selTo,
        diffHtml,
        widget: this
      })
    });
    if (this.escHandler) {
      document.removeEventListener("keydown", this.escHandler);
    }
    this.escHandler = (e) => {
      if (e.key === "Escape") {
        this.reject();
      } else if (e.key === "Enter") {
        this.accept();
      }
    };
    document.addEventListener("keydown", this.escHandler);
  }
  /** Show insertion preview (all green, no deletions) for cursor mode. */
  showInsertionInPlace() {
    if (this.insertedText === null) return;
    hideSelectionHighlight(this.editorView);
    const trimmedText = normalizeInsertionText(this.insertedText);
    this.insertedText = trimmedText;
    const escaped = escapeHtml(trimmedText);
    const diffHtml = `<span class="ocop-diff-ins">${escaped}</span>`;
    this.editorView.dispatch({
      effects: showInsertion.of({
        pos: this.selFrom,
        diffHtml,
        widget: this
      })
    });
    if (this.escHandler) {
      document.removeEventListener("keydown", this.escHandler);
    }
    this.escHandler = (e) => {
      if (e.key === "Escape") {
        this.reject();
      } else if (e.key === "Enter") {
        this.accept();
      }
    };
    document.addEventListener("keydown", this.escHandler);
  }
  accept() {
    var _a;
    const textToInsert = (_a = this.editedText) != null ? _a : this.insertedText;
    if (textToInsert !== null) {
      const doc = this.editorView.state.doc;
      const fromLine = doc.lineAt(this.selFrom);
      const toLine = doc.lineAt(this.selTo);
      const from = { line: fromLine.number - 1, ch: this.selFrom - fromLine.from };
      const to = { line: toLine.number - 1, ch: this.selTo - toLine.from };
      this.cleanup();
      this.editor.replaceRange(textToInsert, from, to);
      this.resolve({ decision: "accept", editedText: textToInsert });
    } else {
      this.cleanup();
      this.resolve({ decision: "reject" });
    }
  }
  reject() {
    this.cleanup({ keepSelectionHighlight: true });
    this.restoreSelectionHighlight();
    this.resolve({ decision: "reject" });
  }
  removeSelectionListeners() {
    if (this.selectionListener) {
      this.editorView.dom.removeEventListener("mouseup", this.selectionListener);
      this.editorView.dom.removeEventListener("keyup", this.selectionListener);
      this.selectionListener = null;
    }
  }
  cleanup(options) {
    var _a, _b;
    this.inlineEditService.cancel();
    this.inlineEditService.resetConversation();
    this.isConversing = false;
    this.removeSelectionListeners();
    if (this.escHandler) {
      document.removeEventListener("keydown", this.escHandler);
    }
    (_a = this.slashCommandDropdown) == null ? void 0 : _a.destroy();
    this.slashCommandDropdown = null;
    this.slashCommandManager = null;
    (_b = this.mentionDropdown) == null ? void 0 : _b.destroy();
    this.mentionDropdown = null;
    this.attachedFiles.clear();
    if (activeController === this) {
      activeController = null;
    }
    this.editorView.dispatch({
      effects: hideInlineEdit.of(null)
    });
    if (!(options == null ? void 0 : options.keepSelectionHighlight)) {
      hideSelectionHighlight(this.editorView);
    }
  }
  restoreSelectionHighlight() {
    if (this.mode !== "selection" || this.selFrom === this.selTo) {
      return;
    }
    showSelectionHighlight(this.editorView, this.selFrom, this.selTo);
  }
  handleKeydown(e) {
    var _a, _b;
    if ((_a = this.mentionDropdown) == null ? void 0 : _a.handleKeydown(e)) {
      return;
    }
    if ((_b = this.slashCommandDropdown) == null ? void 0 : _b.handleKeydown(e)) {
      return;
    }
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      this.generate();
    }
  }
  normalizePathForVault(rawPath) {
    if (!rawPath) return null;
    try {
      const normalizedRaw = normalizePathForFilesystem(rawPath);
      const vaultPath = getVaultPath(this.app);
      if (vaultPath && isPathWithinVault(normalizedRaw, vaultPath)) {
        const absolute = path11.isAbsolute(normalizedRaw) ? normalizedRaw : path11.resolve(vaultPath, normalizedRaw);
        const relative5 = path11.relative(vaultPath, absolute);
        return relative5 ? relative5.replace(/\\/g, "/") : null;
      }
      return normalizedRaw.replace(/\\/g, "/");
    } catch (error) {
      console.error("[InlineEditModal] normalizePathForVault error:", error);
      new import_obsidian10.Notice("Failed to attach file: invalid path");
      return null;
    }
  }
  async requestInlineBashApproval(command) {
    const description = `Execute inline bash command:
${command}`;
    return new Promise((resolve6) => {
      const modal = new ApprovalModal(
        this.app,
        TOOL_BASH,
        { command },
        description,
        (decision) => resolve6(decision === "allow" || decision === "allow-always"),
        { showAlwaysAllow: false, title: "Inline bash execution" }
      );
      modal.open();
    });
  }
};

// src/ui/modals/InstructionConfirmModal.ts
var import_obsidian11 = require("obsidian");
var InstructionModal = class extends import_obsidian11.Modal {
  constructor(app, rawInstruction, callbacks) {
    super(app);
    this.state = "loading";
    this.resolved = false;
    // UI elements
    this.contentSectionEl = null;
    this.loadingEl = null;
    this.clarificationEl = null;
    this.confirmationEl = null;
    this.buttonsEl = null;
    // Clarification state
    this.clarificationTextEl = null;
    this.responseTextarea = null;
    this.isSubmitting = false;
    // Confirmation state
    this.refinedInstruction = "";
    this.editTextarea = null;
    this.isEditing = false;
    this.refinedDisplayEl = null;
    this.editContainerEl = null;
    this.editBtnEl = null;
    this.rawInstruction = rawInstruction;
    this.callbacks = callbacks;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ocop-instruction-modal");
    this.setTitle("Add Custom Instruction");
    const inputSection = contentEl.createDiv({ cls: "ocop-instruction-section" });
    const inputLabel = inputSection.createDiv({ cls: "ocop-instruction-label" });
    inputLabel.setText("Your input:");
    const inputText = inputSection.createDiv({ cls: "ocop-instruction-original" });
    inputText.setText(this.rawInstruction);
    this.contentSectionEl = contentEl.createDiv({ cls: "ocop-instruction-content-section" });
    this.loadingEl = this.contentSectionEl.createDiv({ cls: "ocop-instruction-loading" });
    this.loadingEl.createDiv({ cls: "ocop-instruction-spinner" });
    this.loadingEl.createSpan({ text: "Processing your instruction..." });
    this.clarificationEl = this.contentSectionEl.createDiv({ cls: "ocop-instruction-clarification-section" });
    this.clarificationEl.style.display = "none";
    this.clarificationTextEl = this.clarificationEl.createDiv({ cls: "ocop-instruction-clarification" });
    const responseSection = this.clarificationEl.createDiv({ cls: "ocop-instruction-section" });
    const responseLabel = responseSection.createDiv({ cls: "ocop-instruction-label" });
    responseLabel.setText("Your response:");
    this.responseTextarea = new import_obsidian11.TextAreaComponent(responseSection);
    this.responseTextarea.inputEl.addClass("ocop-instruction-response-textarea");
    this.responseTextarea.inputEl.rows = 3;
    this.responseTextarea.inputEl.placeholder = "Provide more details...";
    this.responseTextarea.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !this.isSubmitting) {
        e.preventDefault();
        this.submitClarification();
      }
    });
    this.confirmationEl = this.contentSectionEl.createDiv({ cls: "ocop-instruction-confirmation-section" });
    this.confirmationEl.style.display = "none";
    const refinedSection = this.confirmationEl.createDiv({ cls: "ocop-instruction-section" });
    const refinedLabel = refinedSection.createDiv({ cls: "ocop-instruction-label" });
    refinedLabel.setText("Refined snippet:");
    this.refinedDisplayEl = refinedSection.createDiv({ cls: "ocop-instruction-refined" });
    this.editContainerEl = refinedSection.createDiv({ cls: "ocop-instruction-edit-container" });
    this.editContainerEl.style.display = "none";
    this.editTextarea = new import_obsidian11.TextAreaComponent(this.editContainerEl);
    this.editTextarea.inputEl.addClass("ocop-instruction-edit-textarea");
    this.editTextarea.inputEl.rows = 4;
    this.buttonsEl = contentEl.createDiv({ cls: "ocop-instruction-buttons" });
    this.updateButtons();
    this.showState("loading");
  }
  /** Shows clarification question from agent. */
  showClarification(clarification) {
    var _a;
    if (this.clarificationTextEl) {
      this.clarificationTextEl.setText(clarification);
    }
    if (this.responseTextarea) {
      this.responseTextarea.setValue("");
    }
    this.isSubmitting = false;
    this.showState("clarification");
    (_a = this.responseTextarea) == null ? void 0 : _a.inputEl.focus();
  }
  /** Shows confirmation with refined instruction. */
  showConfirmation(refinedInstruction) {
    this.refinedInstruction = refinedInstruction;
    if (this.refinedDisplayEl) {
      this.refinedDisplayEl.setText(refinedInstruction);
    }
    if (this.editTextarea) {
      this.editTextarea.setValue(refinedInstruction);
    }
    this.showState("confirmation");
  }
  /** Shows error and closes modal. */
  showError(error) {
    this.resolved = true;
    this.close();
  }
  /** Updates the modal to show loading state during clarification submit. */
  showClarificationLoading() {
    this.isSubmitting = true;
    if (this.loadingEl) {
      this.loadingEl.querySelector(".ocop-instruction-spinner");
      const text = this.loadingEl.querySelector("span");
      if (text) text.textContent = "Processing...";
    }
    this.showState("loading");
  }
  showState(state) {
    this.state = state;
    if (this.loadingEl) {
      this.loadingEl.style.display = state === "loading" ? "flex" : "none";
    }
    if (this.clarificationEl) {
      this.clarificationEl.style.display = state === "clarification" ? "block" : "none";
    }
    if (this.confirmationEl) {
      this.confirmationEl.style.display = state === "confirmation" ? "block" : "none";
    }
    this.updateButtons();
  }
  updateButtons() {
    if (!this.buttonsEl) return;
    this.buttonsEl.empty();
    const cancelBtn = this.buttonsEl.createEl("button", {
      text: "Cancel",
      cls: "ocop-instruction-btn ocop-instruction-reject-btn",
      attr: { "aria-label": "Cancel" }
    });
    cancelBtn.addEventListener("click", () => this.handleReject());
    if (this.state === "clarification") {
      const submitBtn = this.buttonsEl.createEl("button", {
        text: "Submit",
        cls: "ocop-instruction-btn ocop-instruction-accept-btn",
        attr: { "aria-label": "Submit response" }
      });
      submitBtn.addEventListener("click", () => this.submitClarification());
    } else if (this.state === "confirmation") {
      this.editBtnEl = this.buttonsEl.createEl("button", {
        text: "Edit",
        cls: "ocop-instruction-btn ocop-instruction-edit-btn",
        attr: { "aria-label": "Edit instruction" }
      });
      this.editBtnEl.addEventListener("click", () => this.toggleEdit());
      const acceptBtn = this.buttonsEl.createEl("button", {
        text: "Accept",
        cls: "ocop-instruction-btn ocop-instruction-accept-btn",
        attr: { "aria-label": "Accept instruction" }
      });
      acceptBtn.addEventListener("click", () => this.handleAccept());
      acceptBtn.focus();
    }
  }
  async submitClarification() {
    var _a;
    const response = (_a = this.responseTextarea) == null ? void 0 : _a.getValue().trim();
    if (!response || this.isSubmitting) return;
    this.showClarificationLoading();
    try {
      await this.callbacks.onClarificationSubmit(response);
    } catch (e) {
      this.isSubmitting = false;
      this.showState("clarification");
    }
  }
  toggleEdit() {
    var _a, _b;
    this.isEditing = !this.isEditing;
    if (this.isEditing) {
      if (this.refinedDisplayEl) this.refinedDisplayEl.style.display = "none";
      if (this.editContainerEl) this.editContainerEl.style.display = "block";
      if (this.editBtnEl) this.editBtnEl.setText("Preview");
      (_a = this.editTextarea) == null ? void 0 : _a.inputEl.focus();
    } else {
      const edited = ((_b = this.editTextarea) == null ? void 0 : _b.getValue()) || this.refinedInstruction;
      this.refinedInstruction = edited;
      if (this.refinedDisplayEl) {
        this.refinedDisplayEl.setText(edited);
        this.refinedDisplayEl.style.display = "block";
      }
      if (this.editContainerEl) this.editContainerEl.style.display = "none";
      if (this.editBtnEl) this.editBtnEl.setText("Edit");
    }
  }
  handleAccept() {
    var _a;
    if (this.resolved) return;
    this.resolved = true;
    const finalInstruction = this.isEditing ? ((_a = this.editTextarea) == null ? void 0 : _a.getValue()) || this.refinedInstruction : this.refinedInstruction;
    this.callbacks.onAccept(finalInstruction);
    this.close();
  }
  handleReject() {
    if (this.resolved) return;
    this.resolved = true;
    this.callbacks.onReject();
    this.close();
  }
  onClose() {
    if (!this.resolved) {
      this.resolved = true;
      this.callbacks.onReject();
    }
    this.contentEl.empty();
  }
};

// src/ui/modals/QuizSetupModal.ts
var import_obsidian12 = require("obsidian");

// src/core/learning/parsing.ts
function parseSocraticMeta(content) {
  if (!/^\s*##SOCRATIC_SUMMARY##/m.test(content)) return void 0;
  return { isSummary: true };
}
function parseQuizQuestionMeta(content) {
  const headerMatch = content.match(/^##\s*(\d+)\s*\/\s*(\d+)번 문제/im);
  if (!headerMatch) {
    return void 0;
  }
  const options = Array.from(content.matchAll(/^([A-Z])\.\s+(.+)$/gm)).map((match) => ({
    label: match[1],
    text: match[2].trim()
  }));
  const freeText = options.length === 0 && /\(자유 서술\)|답안 형식:\s*(?:자유 서술|단답|서술|직접 입력)/i.test(content);
  if (options.length === 0 && !freeText) {
    return void 0;
  }
  const multiSelect = /\(복수 선택 가능\)|복수 선택 가능|답안 형식:\s*[A-Z](?:\s*,\s*[A-Z])+/i.test(content);
  return {
    current: Number(headerMatch[1]),
    total: Number(headerMatch[2]),
    multiSelect,
    freeText,
    options
  };
}
function normalizeQuizMarkdown(content) {
  var _a;
  const normalized = content.replace(/\r\n/g, "\n").replace(/\n+\(정답을 입력해 주세요[^\n]*\)/g, "");
  const lines = normalized.split("\n");
  const headerIndex = lines.findIndex((line) => /^##\s*\d+\s*\/\s*\d+번 문제$/i.test(line.trim()));
  if (headerIndex === -1) {
    return normalized;
  }
  let cursor = headerIndex + 1;
  while (cursor < lines.length && lines[cursor].trim() === "") {
    cursor += 1;
  }
  while (cursor < lines.length && (/^####\s*문제$/i.test(lines[cursor].trim()) || lines[cursor].trim() === "\uBB38\uC81C")) {
    cursor += 1;
  }
  while (cursor < lines.length && lines[cursor].trim() === "") {
    cursor += 1;
  }
  const questionLine = (_a = lines[cursor]) != null ? _a : "";
  let questionHeading;
  if (questionLine.startsWith("#")) {
    questionHeading = questionLine;
    cursor += 1;
  } else if (questionLine.trim()) {
    questionHeading = `#### ${questionLine.trim()}`;
    cursor += 1;
  } else {
    questionHeading = "";
  }
  const rebuilt = [
    ...lines.slice(0, headerIndex + 1),
    "",
    questionHeading,
    ...lines.slice(cursor)
  ];
  return rebuilt.join("\n");
}

// src/core/learning/persona.ts
var STUCK_PATTERNS = [
  "\uBAA8\uB974\uACA0",
  "\uBAB0\uB77C",
  "\uC5B4\uB824",
  "\uB9C9\uD614",
  "\uD78C\uD2B8",
  "\uC815\uB2F5",
  "\uB2F5 \uC54C\uB824",
  "tell me",
  "don't know",
  "not sure"
];
var STRONG_ANSWER_MIN_LENGTH = 80;
function inferSocraticSupportLevel(currentLevel, studentReply) {
  const normalized = studentReply.trim().toLowerCase();
  const level = currentLevel != null ? currentLevel : 1;
  if (!normalized || STUCK_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return Math.min(3, level + 1);
  }
  if (normalized.length >= STRONG_ANSWER_MIN_LENGTH) {
    return Math.max(0, level - 1);
  }
  return level;
}
function getSocraticModeInstruction(supportLevel) {
  const level = supportLevel != null ? supportLevel : 1;
  if (level <= 0) {
    return "Current mode: challenge. The learner is showing strong understanding. Acknowledge the insight, then raise difficulty with a transfer question, boundary case, counterexample, or comparison that still depends on the selected notes.";
  }
  if (level === 1) {
    return "Current mode: coach. The learner is partly on track. Give specific acknowledgment, one useful hint or nudge, and one probing question.";
  }
  if (level === 2) {
    return "Current mode: rescue. The learner may be stuck. Provide a concise fact, analogy, or worked mini-step from the selected notes before asking one easier next-step question.";
  }
  return "Current mode: rescue. The learner is likely frustrated or directly asking for the answer. Do not run a twenty-questions game. Give enough factual scaffold or a partial worked example to restart thinking, then ask one small answerable question.";
}
function getSocraticPersonaInstructions() {
  return [
    "You are Mark's digital teaching twin: a Korean AI \uC870\uAD50 who personalizes learning from the selected Obsidian notes.",
    "Your job is not to hide facts or play twenty questions. Preserve productive student thinking while providing the right amount of fact, nudge, hint, example, analogy, or challenge.",
    "Use this adaptive protocol every turn: diagnose the learner state, choose challenge/coach/rescue/consolidate, respond in warm Korean \uD574\uC694\uCCB4, then ask at most one next-step question.",
    "For strong answers, increase difficulty with transfer, boundary cases, counterexamples, or comparisons.",
    "For confused or low-confidence answers, explain more kindly in smaller steps and include a concrete example or analogy before asking again.",
    "If the learner is stuck for 2+ turns or asks for the answer directly, provide a concise scaffold or worked mini-step instead of only asking another question.",
    "When an insight is reached, consolidate with a teach-back prompt or one-sentence summary request."
  ];
}

// src/core/learning/quiz.ts
var DIFFICULTY_INSTRUCTIONS = {
  "\uD558": "Ask simple recall/definition questions. Keep choices straightforward. Do not use any knowledge outside the selected ground truth notes/folder. If the selected material does not support a claim, do not invent it.",
  "\uC911": "Do not use any knowledge outside the selected ground truth notes/folder. If the selected material does not support a claim, do not invent it.",
  "\uC0C1": 'Create application-level questions that apply the core concepts to novel real-world scenarios (e.g., applying "data science project" concepts to "AI development project"). You may use web search to find related official documentation and supplement the questions. Do not be strictly bounded by the notes.'
};
function shouldEnableQuizExternalTools(difficulty) {
  return difficulty === "\uC0C1";
}
function buildQuizDisplayContent(input) {
  return ["/quiz", input.displayScope, `${input.questionCount}\uBB38\uC81C`, input.difficulty, input.focusText || "\uC804\uCCB4 \uBC94\uC704"].filter(Boolean).join(" \xB7 ");
}
function parseQuizDisplayContent(displayContent) {
  if (!displayContent) return null;
  const parts = displayContent.split(" \xB7 ");
  if (parts[0] !== "/quiz") return null;
  const countIndex = parts.findIndex((part) => /^\d+문제$/.test(part));
  if (countIndex === -1) return null;
  const totalQuestions = Number(parts[countIndex].replace("\uBB38\uC81C", ""));
  const difficulty = parts[countIndex + 1];
  if (!Number.isFinite(totalQuestions) || !isQuizDifficulty(difficulty)) {
    return null;
  }
  const focusLabel = parts.slice(countIndex + 2).join(" \xB7 ").trim();
  return {
    totalQuestions,
    difficulty,
    focusText: focusLabel && focusLabel !== "\uC804\uCCB4 \uBC94\uC704" ? focusLabel : void 0
  };
}
function buildQuizPrompt(input) {
  const difficultyInstruction = DIFFICULTY_INSTRUCTIONS[input.difficulty];
  const questionCount = String(input.questionCount);
  return [
    `Create a ${questionCount}-question quiz in Korean.`,
    input.scopeInstruction,
    difficultyInstruction,
    input.focusText ? `Focus especially on this topic: ${input.focusText}.` : "",
    "Use a deliberate mix of question formats: multiple-choice, short-answer, true/false, and multi-select.",
    "Ask exactly one question at a time.",
    "After the student answers, immediately tell them whether they are correct, explain why in Korean, and then move to the next question.",
    "Format each question in clean markdown.",
    "CRITICAL RULE: When a question mentions any specific code, function, variable, regex, or command from the source material, you MUST embed the relevant code snippet as a fenced code block (```) INSIDE the question body, between the #### heading and the answer choices. The student cannot see the original note \u2014 if you mention code without showing it, the question is unanswerable.",
    'Use this EXACT structure for each question \u2014 copy it precisely: Line 1: "## {N}/{T}\uBC88 \uBB38\uC81C". Line 2: blank. Line 3: "#### {question text}" \u2014 the question sentence IS the #### heading, nothing else. NEVER write "#### \uBB38\uC81C" or any other fixed label on line 3. Line 4: blank. Lines 5+: (if referencing code) fenced code block, then blank line, then answer choices. Do NOT include an "\uB2F5\uC548 \uD615\uC2DD" hint line \u2014 the UI renders answer buttons automatically. For free-text questions with no choices, add "(\uC790\uC720 \uC11C\uC220)" on its own line after the question.',
    `Format examples (use the one that fits):

Example 1 \u2014 conceptual question (no code):

## 1/5\uBC88 \uBB38\uC81C

#### \uB2E4\uC74C \uC911 SQL\uC758 SELECT \uBB38\uC5D0 \uB300\uD55C \uC124\uBA85\uC73C\uB85C \uC633\uC9C0 \uC54A\uC740 \uAC83\uC740 \uBB34\uC5C7\uC785\uB2C8\uAE4C?

A. SELECT \uBB38\uC740 \uB370\uC774\uD130\uB97C \uC870\uD68C\uD560 \uB54C \uC0AC\uC6A9\uB41C\uB2E4.
B. SELECT \uBB38\uC5D0\uC11C FROM \uC808\uC740 \uB370\uC774\uD130\uB97C \uAC00\uC838\uC62C \uD14C\uC774\uBE14\uC744 \uC9C0\uC815\uD55C\uB2E4.
C. SELECT \uBB38\uC740 \uB370\uC774\uD130\uB97C \uC0AD\uC81C\uD558\uB294 \uB370 \uC0AC\uC6A9\uB41C\uB2E4.
D. SELECT \uBB38\uC5D0\uC11C \uCEEC\uB7FC\uBA85\uC744 \uC9C0\uC815\uD560 \uC218 \uC788\uB2E4.

Example 2 \u2014 code-referencing question (MUST include snippet):

## 2/5\uBC88 \uBB38\uC81C

#### \uB2E4\uC74C \uD568\uC218\uC5D0\uC11C \uC815\uADDC\uC2DD\uC774 \uD558\uB294 \uC5ED\uD560\uB85C \uC62C\uBC14\uB978 \uAC83\uC740?

\`\`\`python
# (relevant code snippet from source material)
\`\`\`

A. ... B. ... C. ... D. ...`,
    "Do not wrap the question in code fences or quote blocks.",
    'IMPORTANT: When answer choices differ only by whitespace, escaping, or subtle string differences, render each choice as an inline code span (backticks) or use explicit markers like "\xB7" for spaces so the student can visually distinguish them. Markdown collapses consecutive spaces \u2014 never rely on multiple spaces to differentiate choices.',
    'Do NOT include "\uB2F5\uC548 \uD615\uC2DD: ..." lines. For free-text/short-answer questions, write "(\uC790\uC720 \uC11C\uC220)" on its own line. For multi-select questions, write "(\uBCF5\uC218 \uC120\uD0DD \uAC00\uB2A5)" on its own line.',
    "For multiple-choice and multi-select questions, accept answers case-insensitively (for example b or B) and also accept the selected choice text when it is unambiguous.",
    'After the student answers, respond in markdown with this exact structure: "### \uC815\uB2F5 \uD655\uC778", then bullet lines for "\uC815\uC624", "\uC815\uB2F5", "\uD574\uC124", "\uC624\uAC1C\uB150 \uC9C4\uB2E8", "\uD575\uC2EC \uD3EC\uC778\uD2B8", and "\uB2E4\uC74C \uD68C\uBCF5 \uC9C8\uBB38". The recovery question should be short, source-grounded, and designed to repair the misconception without starting an unrelated topic.',
    "After the feedback block, add a horizontal rule (---) and then continue with the next question.",
    "Never dump or quote raw source material, pasted notes, markdown headings, XML tags, or long excerpts from the source. Only show the quiz question, the student feedback, the correct answer, and the explanation."
  ].filter(Boolean).join(" ");
}
function buildQuizContinuationPrompt(input) {
  var _a, _b;
  const {
    currentQuestion,
    totalQuestions,
    difficulty,
    sourceInstruction,
    focusText,
    questionContext
  } = input;
  const questionToGrade = (_a = questionContext == null ? void 0 : questionContext.questionNumber) != null ? _a : currentQuestion;
  const quizTotal = (_b = questionContext == null ? void 0 : questionContext.totalQuestions) != null ? _b : totalQuestions;
  const isFinalQuestion = questionToGrade >= quizTotal;
  const nextQuestionNumber = Math.min(questionToGrade + 1, quizTotal);
  const difficultyInstruction = difficulty ? DIFFICULTY_INSTRUCTIONS[difficulty] : "";
  const questionContextInstruction = questionContext ? [
    "Grade this exact quiz question from the previous assistant turn before creating any next question:",
    "<quiz_question_to_grade>",
    questionContext.questionText,
    "</quiz_question_to_grade>",
    "The student answer is in the <query> block below. Use <quiz_question_to_grade> as the grading target and the selected source notes only as the answer key/ground truth."
  ].join("\n") : "";
  const groundingInstructions = [
    questionContextInstruction,
    sourceInstruction,
    difficultyInstruction,
    focusText ? `Continue focusing on this topic: ${focusText}.` : "",
    "Continue the SAME quiz scope. Do not switch to unrelated general knowledge topics.",
    "If the source material is referenced with @ note paths, use those same notes as the only ground truth before creating the next question.",
    'Use this EXACT structure for the next question: Line 1: "## {N}/{T}\uBC88 \uBB38\uC81C". Line 2: blank. Line 3: "#### {question text}". Line 4: blank. Lines 5+: answer choices or "(\uC790\uC720 \uC11C\uC220)".'
  ].filter(Boolean).join(" ");
  if (!isFinalQuestion) {
    return `You are continuing an active quiz. The student is answering question ${questionToGrade} of ${quizTotal}. Evaluate the student's answer in Korean, then ask exactly question ${nextQuestionNumber} of ${quizTotal} in Korean. ${groundingInstructions} All output must be in Korean.`;
  }
  return `[SYSTEM INSTRUCTION \u2014 MANDATORY]
This is the FINAL question (${questionToGrade}/${quizTotal}). You MUST complete ALL three steps below in order. Do NOT stop after step 1.

Source and scope constraints for this quiz:
${groundingInstructions}

Step 1: Evaluate the student's answer in Korean (### \uC815\uB2F5 \uD655\uC778 format, same as before).

Step 2: Show overall score:
### \uD034\uC988 \uACB0\uACFC: N/${quizTotal} \uC815\uB2F5 (N%)
Count ALL correct answers from questions 1-${quizTotal} in this conversation.

Step 3: Provide wrong-answer review as \uC870\uAD50 (teaching assistant):
### \uC624\uB2F5 \uBCF5\uC2B5 \uC815\uB9AC
For EACH wrong answer, write:
**N\uBC88 \uBB38\uC81C \u2014 (topic keyword)**
- **\uD559\uC0DD \uB2F5:** (student's choice)
- **\uC815\uB2F5:** (correct answer)
- **\uC65C \uD2C0\uB838\uB098:** 1-2 sentence misconception explanation
- **\uC624\uAC1C\uB150 \uC9C4\uB2E8:** name the misconception or missing distinction
- **\uD575\uC2EC \uC815\uB9AC:** correct concept summary with code snippet if relevant
- **\uB2E4\uC74C \uD68C\uBCF5 \uC9C8\uBB38:** one short source-grounded question that helps repair the misconception

End with: \u{1F4A1} \uC870\uAD50 \uD55C\uB9C8\uB514: encouragement + study tip based on error patterns.
If ALL correct: congratulate and highlight the most important concept.

All output must be in Korean. Do NOT ask another question. Do NOT skip steps 2 and 3.`;
}
function buildQuizHintPrompt(input) {
  const questionContextInstruction = input.questionContext ? [
    "Give a hint for this exact quiz question only, from the previous assistant turn:",
    "<quiz_question_to_grade>",
    input.questionContext.questionText,
    "</quiz_question_to_grade>"
  ].join("\n") : "";
  return [
    "[QUIZ HINT REQUEST \u2014 MANDATORY]",
    "The student is stuck on the current question and pressed the hint button.",
    "Give exactly ONE source-grounded hint. Do NOT reveal the correct answer and do NOT eliminate any answer choices.",
    'Do NOT grade the student, do NOT show a score, and do NOT output a "## {N}/{T}\uBC88 \uBB38\uC81C" header \u2014 the current question stays active and unanswered.',
    questionContextInstruction,
    input.sourceInstruction,
    input.focusText ? `Stay focused on this topic: ${input.focusText}.` : "",
    "Keep the hint to 1-2 short sentences in Korean."
  ].filter(Boolean).join("\n");
}
function isQuizDifficulty(value) {
  return value === "\uD558" || value === "\uC911" || value === "\uC0C1";
}

// src/core/learning/scope.ts
function getBasename(path16) {
  const normalized = path16.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}
function summarizeSelectedNotes(paths) {
  if (paths.length === 0) return "\uB178\uD2B8 0\uAC1C";
  const names = paths.map(getBasename);
  if (names.length === 1) return `\uB178\uD2B8 \xB7 ${names[0]}`;
  if (names.length === 2) return `\uB178\uD2B8 2\uAC1C \xB7 ${names[0]}, ${names[1]}`;
  return `\uB178\uD2B8 ${names.length}\uAC1C \xB7 ${names[0]}, ${names[1]} \uC678 ${names.length - 2}\uAC1C`;
}
function summarizeFolder(path16) {
  const normalized = path16.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || normalized;
}
function getSubjectRoot(activeFilePath) {
  if (!activeFilePath || !activeFilePath.includes("/")) {
    return null;
  }
  const segments = activeFilePath.split("/").slice(0, -1);
  const subjectSegments = segments.slice(0, Math.min(3, segments.length));
  return subjectSegments.length > 0 ? subjectSegments.join("/") : null;
}
function getFolderNotePaths(notePaths, selectedFolders) {
  return notePaths.filter((notePath) => selectedFolders.some((folder) => notePath.startsWith(`${folder}/`))).sort();
}

// src/core/learning/socratic.ts
function buildSocraticDisplayContent(input) {
  return ["/socratic", input.displayScope, input.focusText || "\uC804\uCCB4 \uBC94\uC704"].filter(Boolean).join(" \xB7 ");
}
function buildSocraticPrompt(input) {
  return [
    ...getSocraticPersonaInstructions(),
    getSocraticModeInstruction(input.supportLevel),
    "Based on the SOURCE MATERIAL below, silently identify the academic domain (e.g., \uB370\uC774\uD130\uBCA0\uC774\uC2A4, \uC54C\uACE0\uB9AC\uC998, \uBBF8\uC801\uBD84\uD559, \uACBD\uC81C\uD559, \uC6B4\uC601\uCCB4\uC81C etc.) and naturally adopt the voice of an approachable, knowledgeable \uC870\uAD50 in that field.",
    `TONE: Write in warm, conversational Korean (\uD574\uC694\uCCB4). From the SECOND response onward, open each response with a brief, genuine acknowledgment of the student's effort or thinking \u2014 e.g. "\uC624, \uD765\uBBF8\uB85C\uC6B4 \uC0DD\uAC01\uC774\uB124\uC694!", "\uC88B\uC740 \uAD00\uC810\uC774\uC5D0\uC694~", "\uADF8 \uBD80\uBD84\uC744 \uBA3C\uC800 \uC0DD\uAC01\uD588\uAD70\uC694!" \u2014 before redirecting with a probing question. Never sound clinical, robotic, or overly formal.`,
    "RESPONSE PATTERN \u2014 follow this after the student has answered:",
    '1. ACKNOWLEDGE: \uD559\uC0DD \uB2F5\uBCC0\uC5D0\uC11C \uB9DE\uAC70\uB098 \uC88B\uC740 \uBD80\uBD84\uC744 \uAD6C\uCCB4\uC801\uC73C\uB85C \uC9DA\uC5B4\uC918\uC694. ("\uB9DE\uC544\uC694, X\uB294 \uC815\uD655\uD574\uC694!", "\uADF8 \uBD80\uBD84\uC744 \uC798 \uC9DA\uC5C8\uC5B4\uC694~")',
    "2. GUIDE: \uBD80\uC871\uD558\uAC70\uB098 \uD2C0\uB9B0 \uBD80\uBD84\uC774 \uC788\uC73C\uBA74 \uD78C\uD2B8, \uC0AC\uC2E4, \uC608\uC2DC, \uBE44\uC720, worked mini-step \uC911 \uD544\uC694\uD55C \uB9CC\uD07C \uC81C\uACF5\uD574 \uBC29\uD5A5\uC744 \uC7A1\uC544\uC918\uC694.",
    "3. PROBE: \uB2E4\uC74C \uB2E8\uACC4\uB85C \uB098\uC544\uAC00\uB294 \uC9C8\uBB38\uC744 \uD558\uB098\uB9CC \uB358\uC838\uC694. \uC9C8\uBB38\uC774 \uC544\uB2C8\uB77C \uC124\uBA85\uC774 \uB354 \uD544\uC694\uD55C \uC21C\uAC04\uC774\uBA74 \uBA3C\uC800 \uC9E7\uAC8C \uC124\uBA85\uD558\uC138\uC694.",
    "ADAPTATION: \uD559\uC0DD\uC774 \uC798 \uB530\uB77C\uC624\uBA74 \uAC04\uB2E8 \uC778\uC815 \u2192 \uB354 \uC5B4\uB824\uC6B4 \uC804\uC774/\uBC18\uB840/\uACBD\uACC4\uC870\uAC74 \uC9C8\uBB38. \uD559\uC0DD\uC774 \uD5E4\uB9E4\uBA74 \uC0C1\uC138 \uD53C\uB4DC\uBC31 \u2192 \uC608\uC2DC/\uBE44\uC720 \uC81C\uACF5 \u2192 \uC26C\uC6B4 \uC9C8\uBB38\uC73C\uB85C \uB418\uB3CC\uC544\uAC10. \uBCF5\uC7A1\uD55C \uAC1C\uB150\uC740 \uD558\uC704 \uB2E8\uACC4\uB85C \uB098\uB220\uC11C \uD558\uB098\uC529 \uC9C4\uD589.",
    'BOUNDARIES: \uC815\uB2F5\uC744 \uD1B5\uC9F8\uB85C \uB358\uC838\uC8FC\uC9C0\uB294 \uC54A\uB418, \uC9C8\uBB38\uB9CC \uBC18\uBCF5\uD558\uC9C0\uB3C4 \uB9C8\uC138\uC694. \uD559\uC0DD\uC774 "\uBAA8\uB974\uACA0\uC5B4\uC694" \uB610\uB294 "\uC815\uB2F5 \uC54C\uB824\uC918"\uB77C\uACE0 \uD558\uBA74 \uD575\uC2EC \uC0AC\uC2E4\uC774\uB098 \uBD80\uBD84 \uD480\uC774\uB97C \uC81C\uACF5\uD55C \uB4A4 \uD559\uC0DD\uC774 \uC774\uC5B4\uAC08 \uC791\uC740 \uB2E8\uACC4\uB97C \uB0A8\uAE30\uC138\uC694.',
    `SOURCE MATERIAL: ${input.scopeInstruction}`,
    "SOURCE BOUNDARY: The selected notes are the ground truth for this Socratic session. Do not drift into unrelated general knowledge or a different subject.",
    input.focusText ? `Focus the dialogue on this topic: ${input.focusText}.` : "",
    'DIALOGUE STRUCTURE: Continue the dialogue until the student has arrived at a clear insight through their own reasoning. When that moment comes, ask one final synthesizing question (e.g. "\uC9C0\uAE08\uAE4C\uC9C0\uC758 \uB300\uD654\uB97C \uBC14\uD0D5\uC73C\uB85C, \uD575\uC2EC \uAC1C\uB150\uC744 \uD55C \uBB38\uC7A5\uC73C\uB85C \uC815\uB9AC\uD55C\uB2E4\uBA74?"). After the student replies to that final question, output the session summary:',
    "  ##SOCRATIC_SUMMARY##",
    "  ### \uBC1C\uACAC\uC758 \uC5EC\uC815 \uC694\uC57D",
    "  In Korean: summarize the key insights the student arrived at THEMSELVES \u2014 quote their own words where possible. Acknowledge what they still need to explore. End with one open question for further reflection.",
    "All output must be in Korean.",
    'START: Begin with a warm, brief greeting (e.g. "\uC548\uB155\uD558\uC138\uC694! \uBC18\uAC00\uC6CC\uC694 \u{1F60A}"). Then ask the student which part of the material they want to explore or what they find curious/confusing. Do NOT jump into a specific topic question yet \u2014 let the student choose the starting point. Keep it to 2-3 sentences max.'
  ].filter(Boolean).join("\n");
}
function buildSocraticContinuationPrompt(input) {
  const options = typeof input === "boolean" ? { isSummaryPhase: input } : input;
  const groundingInstructions = [
    ...getSocraticPersonaInstructions(),
    getSocraticModeInstruction(options.supportLevel),
    options.sourceInstruction ? `SOURCE MATERIAL: ${options.sourceInstruction}` : "",
    options.focusText ? `Focus the dialogue on this topic: ${options.focusText}.` : "",
    "SOURCE BOUNDARY: Continue the SAME selected-note scope. Do not switch to unrelated general knowledge topics.",
    "Do not run a twenty-questions game. If the learner seems stuck, provide a concise fact, example, analogy, or worked mini-step before asking again."
  ].filter(Boolean).join("\n");
  if (options.isSummaryPhase) {
    return `[SOCRATIC SESSION \u2014 SUMMARY REQUIRED]
The student has responded to the final synthesizing question.
You MUST now output the ##SOCRATIC_SUMMARY## marker followed by ### \uBC1C\uACAC\uC758 \uC5EC\uC815 \uC694\uC57D.
Do NOT ask any more questions. Close the session.
${groundingInstructions}
All output must be in Korean.`;
  }
  return `[SOCRATIC SESSION \u2014 MANDATORY]
Follow the Acknowledge \u2192 Guide \u2192 Probe pattern.
Acknowledge what's right, guide what's missing with hints/examples, then ask one probing question.
If stuck 2+ turns: provide a concrete example or analogy to unblock, then resume questioning.
${groundingInstructions}
All output must be in Korean.`;
}

// src/ui/modals/QuizSetupModal.ts
var QuizSetupModal = class extends import_obsidian12.Modal {
  constructor(app, activeFilePath, initialFocusText = "") {
    super(app);
    this.activeFilePath = activeFilePath;
    this.resolvePromise = null;
    this.quizScope = "current-note";
    this.selectedNotePaths = /* @__PURE__ */ new Set();
    this.selectedFolderPaths = /* @__PURE__ */ new Set();
    this.questionCount = "5";
    this.difficulty = "\uC911";
    this.focusText = "";
    this.useFullVault = false;
    this.focusText = initialFocusText.trim();
    if (!activeFilePath) {
      this.quizScope = "note";
    }
  }
  onOpen() {
    this.setTitle("Create quiz");
    this.modalEl.addClass("ocop-slash-modal");
    this.renderContent();
  }
  renderContent() {
    this.contentEl.empty();
    const allNotes = this.app.vault.getMarkdownFiles().map((file) => file.path).sort();
    const subjectRoot = getSubjectRoot(this.activeFilePath);
    const scopedNotes = subjectRoot ? allNotes.filter((notePath) => notePath === subjectRoot || notePath.startsWith(`${subjectRoot}/`)) : allNotes;
    const candidateNotes = this.useFullVault ? allNotes : scopedNotes;
    const allFolders = Array.from(new Set(candidateNotes.map((notePath) => notePath.includes("/") ? notePath.split("/").slice(0, -1).join("/") : "").filter(Boolean))).sort();
    if (this.selectedNotePaths.size === 0 && this.activeFilePath) {
      this.selectedNotePaths.add(this.activeFilePath);
    } else if (this.selectedNotePaths.size === 0 && candidateNotes.length > 0) {
      this.selectedNotePaths.add(candidateNotes[0]);
    }
    if (this.selectedFolderPaths.size === 0 && allFolders.length > 0) {
      this.selectedFolderPaths.add(allFolders[0]);
    }
    const detailsEl = this.contentEl.createDiv();
    const renderDetails = () => {
      detailsEl.empty();
      if (subjectRoot) {
        new import_obsidian12.Setting(detailsEl).setName("Scope source").setDesc(this.useFullVault ? "Showing the full vault." : `Showing notes under ${subjectRoot}`).addToggle((toggle) => {
          toggle.setValue(this.useFullVault).onChange((value) => {
            this.useFullVault = value;
            this.selectedNotePaths.clear();
            this.selectedFolderPaths.clear();
            this.renderContent();
          });
        });
      }
      if (this.quizScope === "note") {
        detailsEl.createDiv({
          cls: "setting-item-description",
          text: "Choose one or more notes."
        });
        const noteListEl = detailsEl.createDiv({ cls: "ocop-quiz-note-list" });
        for (const notePath of candidateNotes) {
          const noteItem = noteListEl.createDiv({ cls: "ocop-quiz-note-item" });
          const checkbox = noteItem.createEl("input", { attr: { type: "checkbox" } });
          checkbox.checked = this.selectedNotePaths.has(notePath);
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
              this.selectedNotePaths.add(notePath);
            } else if (this.selectedNotePaths.size > 1) {
              this.selectedNotePaths.delete(notePath);
            } else {
              checkbox.checked = true;
            }
          });
          noteItem.createSpan({ text: notePath });
        }
        detailsEl.createDiv({
          cls: "setting-item-description",
          text: `\uD604\uC7AC \uC120\uD0DD: ${this.selectedNotePaths.size}\uAC1C \uB178\uD2B8`
        });
      }
      if (this.quizScope === "folder") {
        detailsEl.createDiv({
          cls: "setting-item-description",
          text: "Choose one or more folders."
        });
        const folderListEl = detailsEl.createDiv({ cls: "ocop-quiz-note-list" });
        for (const folderPath of allFolders) {
          const folderItem = folderListEl.createDiv({ cls: "ocop-quiz-note-item" });
          const checkbox = folderItem.createEl("input", { attr: { type: "checkbox" } });
          checkbox.checked = this.selectedFolderPaths.has(folderPath);
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
              this.selectedFolderPaths.add(folderPath);
            } else if (this.selectedFolderPaths.size > 1) {
              this.selectedFolderPaths.delete(folderPath);
            } else {
              checkbox.checked = true;
            }
            renderDetails();
          });
          folderItem.createSpan({ text: folderPath });
        }
        const folderNoteCount = candidateNotes.filter(
          (notePath) => Array.from(this.selectedFolderPaths).some((folderPath) => notePath.startsWith(`${folderPath}/`) || notePath === folderPath)
        ).length;
        detailsEl.createDiv({
          cls: "setting-item-description",
          text: `\uD604\uC7AC \uC120\uD0DD: \uD3F4\uB354 ${this.selectedFolderPaths.size}\uAC1C \xB7 \uD3EC\uD568 \uB178\uD2B8 ${folderNoteCount}\uAC1C`
        });
      }
    };
    new import_obsidian12.Setting(this.contentEl).setName("Scope").setDesc("Choose what the quiz should be based on.").addDropdown((dropdown) => {
      if (this.activeFilePath) {
        dropdown.addOption("current-note", "Current note");
      }
      dropdown.addOption("note", "Choose multiple notes");
      dropdown.addOption("folder", "Choose folder");
      dropdown.setValue(this.quizScope).onChange((value) => {
        this.quizScope = value;
        renderDetails();
      });
    });
    renderDetails();
    new import_obsidian12.Setting(this.contentEl).setName("Question count").addDropdown((dropdown) => {
      for (const count of ["3", "4", "5", "6", "7", "8", "9", "10"]) {
        dropdown.addOption(count, `${count} questions`);
      }
      dropdown.setValue(this.questionCount).onChange((value) => {
        this.questionCount = value;
      });
    });
    new import_obsidian12.Setting(this.contentEl).setName("Difficulty").addDropdown((dropdown) => {
      dropdown.addOption("\uD558", "\uD558 \u2014 \uAE30\uBCF8 \uC554\uAE30/\uC774\uD574 \uD655\uC778");
      dropdown.addOption("\uC911", "\uC911 \u2014 \uC885\uD569 \uC774\uD574 (\uAE30\uBCF8\uAC12)");
      dropdown.addOption("\uC0C1", "\uC0C1 \u2014 \uC2EC\uD654 (\uC6F9 \uAC80\uC0C9 \uC790\uB3D9 \uD65C\uC131\uD654)");
      dropdown.setValue(this.difficulty).onChange((value) => {
        this.difficulty = value;
      });
    });
    new import_obsidian12.Setting(this.contentEl).setName("Focus topic (optional)").setDesc("Example: PK, \uC815\uADDC\uD654, \uD2B8\uB79C\uC7AD\uC158").addText((text) => {
      text.setPlaceholder("Leave empty to cover the full selected scope").setValue(this.focusText).onChange((value) => {
        this.focusText = value.trim();
      });
    });
    const buttonsEl = this.contentEl.createDiv({ cls: "ocop-setup-modal-buttons" });
    const cancelBtn = buttonsEl.createEl("button", { text: "Cancel", cls: "ocop-cancel-btn" });
    cancelBtn.addEventListener("click", () => this.finish(null));
    const createBtn = buttonsEl.createEl("button", { text: "Create quiz", cls: "ocop-save-btn mod-cta" });
    createBtn.addEventListener("click", () => this.finish(this.buildResult()));
  }
  onClose() {
    this.contentEl.empty();
    if (this.resolvePromise) {
      this.resolvePromise(null);
      this.resolvePromise = null;
    }
  }
  openAndWait() {
    this.open();
    return new Promise((resolve6) => {
      this.resolvePromise = resolve6;
    });
  }
  buildResult() {
    let scopeInstruction = "";
    let displayScope = "\uD604\uC7AC \uB178\uD2B8";
    if (this.quizScope === "current-note" && this.activeFilePath) {
      scopeInstruction = `Use only the current note as ground truth source material: @${this.activeFilePath}`;
      displayScope = `\uD604\uC7AC \uB178\uD2B8 \xB7 ${getBasename(this.activeFilePath)}`;
    } else if (this.quizScope === "note") {
      const selectedPaths = Array.from(this.selectedNotePaths);
      scopeInstruction = `Use only these selected notes as ground truth source material: ${selectedPaths.map((path16) => `@${path16}`).join(", ")}`;
      displayScope = summarizeSelectedNotes(selectedPaths);
    } else {
      const selectedFolders = Array.from(this.selectedFolderPaths);
      const folderNotes = getFolderNotePaths(
        this.app.vault.getMarkdownFiles().map((file) => file.path),
        selectedFolders
      );
      scopeInstruction = folderNotes.length > 0 ? `Use only these selected notes as ground truth source material: ${folderNotes.map((p) => `@${p}`).join(", ")}` : `No markdown files found in selected folders: ${selectedFolders.join(", ")}. Please inform the user.`;
      displayScope = selectedFolders.length === 1 ? `\uD3F4\uB354 \xB7 ${summarizeFolder(selectedFolders[0])}` : `\uD3F4\uB354 ${selectedFolders.length}\uAC1C`;
    }
    const focusText = this.focusText || void 0;
    return {
      displayContent: buildQuizDisplayContent({
        displayScope,
        questionCount: this.questionCount,
        difficulty: this.difficulty,
        focusText
      }),
      totalQuestions: Number(this.questionCount),
      difficulty: this.difficulty,
      sourceInstruction: scopeInstruction,
      focusText,
      enableExternalTools: shouldEnableQuizExternalTools(this.difficulty),
      prompt: buildQuizPrompt({
        questionCount: this.questionCount,
        difficulty: this.difficulty,
        scopeInstruction,
        focusText
      })
    };
  }
  finish(result) {
    const resolve6 = this.resolvePromise;
    this.resolvePromise = null;
    this.close();
    resolve6 == null ? void 0 : resolve6(result);
  }
};

// src/ui/modals/SocraticSetupModal.ts
var import_obsidian13 = require("obsidian");
var SocraticSetupModal = class extends import_obsidian13.Modal {
  constructor(app, activeFilePath, initialFocusText = "") {
    super(app);
    this.activeFilePath = activeFilePath;
    this.resolvePromise = null;
    this.socraticScope = "current-note";
    this.selectedNotePaths = /* @__PURE__ */ new Set();
    this.selectedFolderPaths = /* @__PURE__ */ new Set();
    this.focusText = "";
    this.useFullVault = false;
    this.focusText = initialFocusText.trim();
    if (!activeFilePath) {
      this.socraticScope = "note";
    }
  }
  onOpen() {
    this.setTitle("Start Socratic dialogue");
    this.modalEl.addClass("ocop-slash-modal");
    this.renderContent();
  }
  renderContent() {
    this.contentEl.empty();
    const allNotes = this.app.vault.getMarkdownFiles().map((file) => file.path).sort();
    const subjectRoot = getSubjectRoot(this.activeFilePath);
    const scopedNotes = subjectRoot ? allNotes.filter((notePath) => notePath === subjectRoot || notePath.startsWith(`${subjectRoot}/`)) : allNotes;
    const candidateNotes = this.useFullVault ? allNotes : scopedNotes;
    const allFolders = Array.from(new Set(candidateNotes.map((notePath) => notePath.includes("/") ? notePath.split("/").slice(0, -1).join("/") : "").filter(Boolean))).sort();
    if (this.selectedNotePaths.size === 0 && this.activeFilePath) {
      this.selectedNotePaths.add(this.activeFilePath);
    } else if (this.selectedNotePaths.size === 0 && candidateNotes.length > 0) {
      this.selectedNotePaths.add(candidateNotes[0]);
    }
    if (this.selectedFolderPaths.size === 0 && allFolders.length > 0) {
      this.selectedFolderPaths.add(allFolders[0]);
    }
    const detailsEl = this.contentEl.createDiv();
    const renderDetails = () => {
      detailsEl.empty();
      if (subjectRoot) {
        new import_obsidian13.Setting(detailsEl).setName("Scope source").setDesc(this.useFullVault ? "Showing the full vault." : `Showing notes under ${subjectRoot}`).addToggle((toggle) => {
          toggle.setValue(this.useFullVault).onChange((value) => {
            this.useFullVault = value;
            this.selectedNotePaths.clear();
            this.selectedFolderPaths.clear();
            this.renderContent();
          });
        });
      }
      if (this.socraticScope === "note") {
        detailsEl.createDiv({
          cls: "setting-item-description",
          text: "Choose one or more notes."
        });
        const noteListEl = detailsEl.createDiv({ cls: "ocop-quiz-note-list" });
        for (const notePath of candidateNotes) {
          const noteItem = noteListEl.createDiv({ cls: "ocop-quiz-note-item" });
          const checkbox = noteItem.createEl("input", { attr: { type: "checkbox" } });
          checkbox.checked = this.selectedNotePaths.has(notePath);
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
              this.selectedNotePaths.add(notePath);
            } else if (this.selectedNotePaths.size > 1) {
              this.selectedNotePaths.delete(notePath);
            } else {
              checkbox.checked = true;
            }
          });
          noteItem.createSpan({ text: notePath });
        }
        detailsEl.createDiv({
          cls: "setting-item-description",
          text: `\uD604\uC7AC \uC120\uD0DD: ${this.selectedNotePaths.size}\uAC1C \uB178\uD2B8`
        });
      }
      if (this.socraticScope === "folder") {
        detailsEl.createDiv({
          cls: "setting-item-description",
          text: "Choose one or more folders."
        });
        const folderListEl = detailsEl.createDiv({ cls: "ocop-quiz-note-list" });
        for (const folderPath of allFolders) {
          const folderItem = folderListEl.createDiv({ cls: "ocop-quiz-note-item" });
          const checkbox = folderItem.createEl("input", { attr: { type: "checkbox" } });
          checkbox.checked = this.selectedFolderPaths.has(folderPath);
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
              this.selectedFolderPaths.add(folderPath);
            } else if (this.selectedFolderPaths.size > 1) {
              this.selectedFolderPaths.delete(folderPath);
            } else {
              checkbox.checked = true;
            }
            renderDetails();
          });
          folderItem.createSpan({ text: folderPath });
        }
        const folderNoteCount = candidateNotes.filter(
          (notePath) => Array.from(this.selectedFolderPaths).some((folderPath) => notePath.startsWith(`${folderPath}/`) || notePath === folderPath)
        ).length;
        detailsEl.createDiv({
          cls: "setting-item-description",
          text: `\uD604\uC7AC \uC120\uD0DD: \uD3F4\uB354 ${this.selectedFolderPaths.size}\uAC1C \xB7 \uD3EC\uD568 \uB178\uD2B8 ${folderNoteCount}\uAC1C`
        });
      }
    };
    new import_obsidian13.Setting(this.contentEl).setName("Scope").setDesc("Choose what the dialogue should be based on.").addDropdown((dropdown) => {
      if (this.activeFilePath) {
        dropdown.addOption("current-note", "Current note");
      }
      dropdown.addOption("note", "Choose multiple notes");
      dropdown.addOption("folder", "Choose folder");
      dropdown.setValue(this.socraticScope).onChange((value) => {
        this.socraticScope = value;
        renderDetails();
      });
    });
    renderDetails();
    new import_obsidian13.Setting(this.contentEl).setName("Focus topic (optional)").setDesc("Example: \uC815\uADDC\uD654, \uD2B8\uB79C\uC7AD\uC158, \uC7AC\uADC0\uD568\uC218").addText((text) => {
      text.setPlaceholder("Leave empty to cover the full selected scope").setValue(this.focusText).onChange((value) => {
        this.focusText = value.trim();
      });
    });
    const buttonsEl = this.contentEl.createDiv({ cls: "ocop-setup-modal-buttons" });
    const cancelBtn = buttonsEl.createEl("button", { text: "Cancel", cls: "ocop-cancel-btn" });
    cancelBtn.addEventListener("click", () => this.finish(null));
    const startBtn = buttonsEl.createEl("button", { text: "Start dialogue", cls: "ocop-save-btn mod-cta" });
    startBtn.addEventListener("click", () => this.finish(this.buildResult()));
  }
  onClose() {
    this.contentEl.empty();
    if (this.resolvePromise) {
      this.resolvePromise(null);
      this.resolvePromise = null;
    }
  }
  openAndWait() {
    this.open();
    return new Promise((resolve6) => {
      this.resolvePromise = resolve6;
    });
  }
  buildResult() {
    let scopeInstruction = "";
    let displayScope = "\uD604\uC7AC \uB178\uD2B8";
    if (this.socraticScope === "current-note" && this.activeFilePath) {
      scopeInstruction = `The following note is the source material for the dialogue: @${this.activeFilePath}`;
      displayScope = `\uD604\uC7AC \uB178\uD2B8 \xB7 ${getBasename(this.activeFilePath)}`;
    } else if (this.socraticScope === "note") {
      const selectedPaths = Array.from(this.selectedNotePaths);
      scopeInstruction = `The following notes are the source material for the dialogue: ${selectedPaths.map((path16) => `@${path16}`).join(", ")}`;
      displayScope = summarizeSelectedNotes(selectedPaths);
    } else {
      const selectedFolders = Array.from(this.selectedFolderPaths);
      const folderNotes = getFolderNotePaths(
        this.app.vault.getMarkdownFiles().map((file) => file.path),
        selectedFolders
      );
      scopeInstruction = folderNotes.length > 0 ? `The following notes are the source material for the dialogue: ${folderNotes.map((p) => `@${p}`).join(", ")}` : `No markdown files found in selected folders: ${selectedFolders.join(", ")}. Please inform the user.`;
      displayScope = selectedFolders.length === 1 ? `\uD3F4\uB354 \xB7 ${summarizeFolder(selectedFolders[0])}` : `\uD3F4\uB354 ${selectedFolders.length}\uAC1C`;
    }
    const focusText = this.focusText || void 0;
    return {
      displayContent: buildSocraticDisplayContent({ displayScope, focusText }),
      sourceInstruction: scopeInstruction,
      focusText,
      prompt: buildSocraticPrompt({ scopeInstruction, focusText, supportLevel: 1 })
    };
  }
  finish(result) {
    const resolve6 = this.resolvePromise;
    this.resolvePromise = null;
    this.close();
    resolve6 == null ? void 0 : resolve6(result);
  }
};

// src/ui/renderers/AskUserQuestionRenderer.ts
var import_obsidian14 = require("obsidian");
function parseAskUserQuestionInput(input) {
  if (!input || typeof input !== "object") return null;
  const questions = input.questions;
  if (!Array.isArray(questions)) return null;
  return {
    questions,
    answers: input.answers
  };
}
function formatAnswer(answer) {
  if (Array.isArray(answer)) {
    return answer.join(", ");
  }
  return answer;
}
function renderTreeQA(containerEl, questions, answers) {
  const listEl = containerEl.createDiv({ cls: "ocop-ask-question-list" });
  const treeEl = listEl.createSpan({ cls: "ocop-ask-question-tree" });
  treeEl.setText("\u23BF ");
  const alignedEl = listEl.createDiv({ cls: "ocop-ask-question-aligned" });
  questions.forEach((question) => {
    const answer = answers[question.question];
    if (answer === void 0) return;
    const itemEl = alignedEl.createDiv({ cls: "ocop-ask-question-item" });
    const qEl = itemEl.createDiv({ cls: "ocop-ask-question-q" });
    qEl.setText(`Q: ${question.question}`);
    const aEl = itemEl.createDiv({ cls: "ocop-ask-question-a" });
    aEl.setText(`A: ${formatAnswer(answer)}`);
  });
}
function createAskUserQuestionBlock(parentEl, toolCall) {
  const wrapperEl = parentEl.createDiv({ cls: "ocop-ask-question-block ocop-ask-question-pending" });
  wrapperEl.dataset.toolId = toolCall.id;
  wrapperEl.style.display = "none";
  const headerEl = wrapperEl.createDiv({ cls: "ocop-ask-question-header" });
  const contentEl = wrapperEl.createDiv({ cls: "ocop-ask-question-content" });
  return {
    wrapperEl,
    contentEl,
    headerEl,
    toolId: toolCall.id
  };
}
function finalizeAskUserQuestionBlock(state, answers, isError, questions) {
  const questionList = questions || [];
  const questionCount = questionList.length;
  state.wrapperEl.style.display = "";
  state.wrapperEl.removeClass("ocop-ask-question-pending");
  if (isError) {
    state.wrapperEl.addClass("error");
  } else {
    state.wrapperEl.addClass("done");
  }
  state.headerEl.empty();
  state.headerEl.setAttribute("tabindex", "0");
  state.headerEl.setAttribute("role", "button");
  state.headerEl.setAttribute("aria-expanded", "false");
  const iconEl = state.headerEl.createDiv({ cls: "ocop-ask-question-icon" });
  iconEl.setAttribute("aria-hidden", "true");
  (0, import_obsidian14.setIcon)(iconEl, "help-circle");
  const labelEl = state.headerEl.createDiv({ cls: "ocop-ask-question-label" });
  labelEl.setText("Clarification");
  const countEl = state.headerEl.createDiv({ cls: "ocop-ask-question-count" });
  countEl.setText(questionCount === 1 ? "1 question" : `${questionCount} questions`);
  const statusEl = state.headerEl.createDiv({ cls: `ocop-ask-question-status status-${isError ? "error" : "completed"}` });
  if (isError) {
    (0, import_obsidian14.setIcon)(statusEl, "x");
  } else {
    (0, import_obsidian14.setIcon)(statusEl, "check");
  }
  state.contentEl.empty();
  state.contentEl.style.display = "none";
  if (isError || !answers) {
    const errorEl = state.contentEl.createDiv({ cls: "ocop-ask-question-error" });
    errorEl.setText(isError ? "Failed to get response" : "No response received");
  } else {
    renderTreeQA(state.contentEl, questionList, answers);
  }
  const toggleExpand = () => {
    const expanded = state.wrapperEl.hasClass("expanded");
    if (expanded) {
      state.wrapperEl.removeClass("expanded");
      state.contentEl.style.display = "none";
      state.headerEl.setAttribute("aria-expanded", "false");
    } else {
      state.wrapperEl.addClass("expanded");
      state.contentEl.style.display = "block";
      state.headerEl.setAttribute("aria-expanded", "true");
    }
  };
  state.headerEl.addEventListener("click", toggleExpand);
  state.headerEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleExpand();
    }
  });
}
function renderStoredAskUserQuestion(parentEl, toolCall) {
  const parsed = parseAskUserQuestionInput(toolCall.input);
  const questions = (parsed == null ? void 0 : parsed.questions) || [];
  const answers = parsed == null ? void 0 : parsed.answers;
  const questionCount = questions.length;
  const isError = toolCall.status === "error" || toolCall.status === "blocked";
  const isCompleted = toolCall.status === "completed";
  const wrapperEl = parentEl.createDiv({ cls: "ocop-ask-question-block" });
  wrapperEl.dataset.toolId = toolCall.id;
  if (isCompleted) {
    wrapperEl.addClass("done");
  } else if (isError) {
    wrapperEl.addClass("error");
  }
  const headerEl = wrapperEl.createDiv({ cls: "ocop-ask-question-header" });
  headerEl.setAttribute("tabindex", "0");
  headerEl.setAttribute("role", "button");
  headerEl.setAttribute("aria-expanded", "false");
  headerEl.setAttribute("aria-label", `Clarification - ${toolCall.status}`);
  const iconEl = headerEl.createDiv({ cls: "ocop-ask-question-icon" });
  iconEl.setAttribute("aria-hidden", "true");
  (0, import_obsidian14.setIcon)(iconEl, "help-circle");
  const labelEl = headerEl.createDiv({ cls: "ocop-ask-question-label" });
  labelEl.setText("Clarification");
  const countEl = headerEl.createDiv({ cls: "ocop-ask-question-count" });
  countEl.setText(questionCount === 1 ? "1 question" : `${questionCount} questions`);
  const statusEl = headerEl.createDiv({ cls: `ocop-ask-question-status status-${toolCall.status}` });
  statusEl.setAttribute("aria-label", `Status: ${toolCall.status}`);
  if (isCompleted) {
    (0, import_obsidian14.setIcon)(statusEl, "check");
  } else if (isError) {
    (0, import_obsidian14.setIcon)(statusEl, "x");
  }
  const contentEl = wrapperEl.createDiv({ cls: "ocop-ask-question-content" });
  contentEl.style.display = "none";
  if (answers && Object.keys(answers).length > 0) {
    renderTreeQA(contentEl, questions, answers);
  } else if (isError) {
    const errorEl = contentEl.createDiv({ cls: "ocop-ask-question-error" });
    errorEl.setText("Failed to get response");
  } else {
    const noAnswerEl = contentEl.createDiv({ cls: "ocop-ask-question-error" });
    noAnswerEl.setText("No response recorded");
  }
  const toggleExpand = () => {
    const expanded = wrapperEl.hasClass("expanded");
    if (expanded) {
      wrapperEl.removeClass("expanded");
      contentEl.style.display = "none";
      headerEl.setAttribute("aria-expanded", "false");
    } else {
      wrapperEl.addClass("expanded");
      contentEl.style.display = "block";
      headerEl.setAttribute("aria-expanded", "true");
    }
  };
  headerEl.addEventListener("click", toggleExpand);
  headerEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleExpand();
    }
  });
  return wrapperEl;
}

// src/ui/renderers/DiffRenderer.ts
var MAX_DIFF_LINE_COMPARISONS = 2e5;
function countLines(text) {
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") count++;
  }
  return count;
}
function shouldSkipLineDiff(oldText, newText, maxComparisons = MAX_DIFF_LINE_COMPARISONS) {
  return countLines(oldText) * countLines(newText) > maxComparisons;
}
function computeLineDiff(oldText, newText) {
  const oldLines = oldText.replace(/\r\n/g, "\n").split("\n");
  const newLines = newText.replace(/\r\n/g, "\n").split("\n");
  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  for (let i2 = 1; i2 <= m; i2++) {
    for (let j2 = 1; j2 <= n; j2++) {
      dp[i2][j2] = oldLines[i2 - 1] === newLines[j2 - 1] ? dp[i2 - 1][j2 - 1] + 1 : Math.max(dp[i2 - 1][j2], dp[i2][j2 - 1]);
    }
  }
  const result = [];
  let i = m, j = n;
  const temp = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      temp.push({ type: "equal", text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.push({ type: "insert", text: newLines[j - 1] });
      j--;
    } else {
      temp.push({ type: "delete", text: oldLines[i - 1] });
      i--;
    }
  }
  temp.reverse();
  let oldLineNum = 1;
  let newLineNum = 1;
  for (const line of temp) {
    if (line.type === "equal") {
      result.push({ ...line, oldLineNum: oldLineNum++, newLineNum: newLineNum++ });
    } else if (line.type === "delete") {
      result.push({ ...line, oldLineNum: oldLineNum++ });
    } else {
      result.push({ ...line, newLineNum: newLineNum++ });
    }
  }
  return result;
}
function countLineChanges(diffLines) {
  let added = 0;
  let removed = 0;
  for (const line of diffLines) {
    if (line.type === "insert") added++;
    else if (line.type === "delete") removed++;
  }
  return { added, removed };
}
function splitIntoHunks(diffLines, contextLines = 3) {
  if (diffLines.length === 0) return [];
  const changedIndices = [];
  for (let i = 0; i < diffLines.length; i++) {
    if (diffLines[i].type !== "equal") {
      changedIndices.push(i);
    }
  }
  if (changedIndices.length === 0) return [];
  const ranges = [];
  for (const idx of changedIndices) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(diffLines.length - 1, idx + contextLines);
    if (ranges.length > 0 && start <= ranges[ranges.length - 1].end + 1) {
      ranges[ranges.length - 1].end = end;
    } else {
      ranges.push({ start, end });
    }
  }
  const hunks = [];
  for (const range of ranges) {
    const lines = diffLines.slice(range.start, range.end + 1);
    let oldStart = 1;
    let newStart = 1;
    for (let i = 0; i < range.start; i++) {
      const line = diffLines[i];
      if (line.type === "equal" || line.type === "delete") oldStart++;
      if (line.type === "equal" || line.type === "insert") newStart++;
    }
    hunks.push({ lines, oldStart, newStart });
  }
  return hunks;
}
function renderDiffContent(containerEl, diffLines, contextLines = 3) {
  containerEl.empty();
  const hunks = splitIntoHunks(diffLines, contextLines);
  if (hunks.length === 0) {
    const noChanges = containerEl.createDiv({ cls: "ocop-diff-no-changes" });
    noChanges.setText("No changes");
    return;
  }
  hunks.forEach((hunk, hunkIndex) => {
    if (hunkIndex > 0) {
      const separator = containerEl.createDiv({ cls: "ocop-diff-separator" });
      separator.setText("...");
    }
    const hunkEl = containerEl.createDiv({ cls: "ocop-diff-hunk" });
    for (const line of hunk.lines) {
      const lineEl = hunkEl.createDiv({ cls: `ocop-diff-line ocop-diff-${line.type}` });
      const prefix = line.type === "insert" ? "+" : line.type === "delete" ? "-" : " ";
      const prefixEl = lineEl.createSpan({ cls: "ocop-diff-prefix" });
      prefixEl.setText(prefix);
      const contentEl = lineEl.createSpan({ cls: "ocop-diff-text" });
      contentEl.setText(line.text || " ");
    }
  });
}
function isBinaryContent(content) {
  const nonPrintable = content.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g);
  if (nonPrintable && nonPrintable.length > content.length * 0.1) {
    return true;
  }
  return content.includes("\0");
}

// src/ui/renderers/SubagentRenderer.ts
var import_obsidian16 = require("obsidian");

// src/ui/utils/collapsible.ts
function setupCollapsible(wrapperEl, headerEl, contentEl, state, options = {}) {
  const { initiallyExpanded = false, onToggle, baseAriaLabel } = options;
  const updateAriaLabel = (isExpanded) => {
    if (baseAriaLabel) {
      const action = isExpanded ? "click to collapse" : "click to expand";
      headerEl.setAttribute("aria-label", `${baseAriaLabel} - ${action}`);
    }
  };
  state.isExpanded = initiallyExpanded;
  if (initiallyExpanded) {
    wrapperEl.addClass("expanded");
    contentEl.style.display = "block";
    headerEl.setAttribute("aria-expanded", "true");
  } else {
    contentEl.style.display = "none";
    headerEl.setAttribute("aria-expanded", "false");
  }
  updateAriaLabel(initiallyExpanded);
  const toggleExpand = () => {
    state.isExpanded = !state.isExpanded;
    if (state.isExpanded) {
      wrapperEl.addClass("expanded");
      contentEl.style.display = "block";
      headerEl.setAttribute("aria-expanded", "true");
    } else {
      wrapperEl.removeClass("expanded");
      contentEl.style.display = "none";
      headerEl.setAttribute("aria-expanded", "false");
    }
    updateAriaLabel(state.isExpanded);
    onToggle == null ? void 0 : onToggle(state.isExpanded);
  };
  headerEl.addEventListener("click", toggleExpand);
  headerEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleExpand();
    }
  });
}
function collapseElement(wrapperEl, headerEl, contentEl, state) {
  state.isExpanded = false;
  wrapperEl.removeClass("expanded");
  contentEl.style.display = "none";
  headerEl.setAttribute("aria-expanded", "false");
}

// src/ui/renderers/ToolCallRenderer.ts
var import_obsidian15 = require("obsidian");

// src/features/chat/constants.ts
var MCP_ICON_SVG = `<svg fill="currentColor" fill-rule="evenodd" height="1em" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><title>MCP</title><path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z"></path><path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z"></path></svg>`;
var LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 100 100" role="img" aria-label="Obsidian AI Tutor"><path fill="#7c3aed" d="M50 5 62 29l26 7-18 20 3 27-23-11-23 11 3-27-18-20 26-7z"/><path fill="#fff" d="m50 20 6 25 25 5-25 6-6 25-6-25-25-6 25-5z"/><path fill="#a78bfa" d="m50 31 3 16 16 3-16 3-3 16-3-16-16-3 16-3z"/></svg>`;
var PROVIDER_MARKS = {
  copilot: '<svg aria-hidden="true" fill="currentColor" fill-rule="evenodd" height="1em" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M19.245 5.364c1.322 1.36 1.877 3.216 2.11 5.817.622 0 1.2.135 1.592.654l.73.964c.21.278.323.61.323.955v2.62c0 .339-.173.669-.453.868C20.239 19.602 16.157 21.5 12 21.5c-4.6 0-9.205-2.583-11.547-4.258-.28-.2-.452-.53-.453-.868v-2.62c0-.345.113-.679.321-.956l.73-.963c.392-.517.974-.654 1.593-.654l.029-.297c.25-2.446.81-4.213 2.082-5.52 2.461-2.54 5.71-2.851 7.146-2.864h.198c1.436.013 4.685.323 7.146 2.864zm-7.244 4.328c-.284 0-.613.016-.962.05-.123.447-.305.85-.57 1.108-1.05 1.023-2.316 1.18-2.994 1.18-.638 0-1.306-.13-1.851-.464-.516.165-1.012.403-1.044.996a65.882 65.882 0 00-.063 2.884l-.002.48c-.002.563-.005 1.126-.013 1.69.002.326.204.63.51.765 2.482 1.102 4.83 1.657 6.99 1.657 2.156 0 4.504-.555 6.985-1.657a.854.854 0 00.51-.766c.03-1.682.006-3.372-.076-5.053-.031-.596-.528-.83-1.046-.996-.546.333-1.212.464-1.85.464-.677 0-1.942-.157-2.993-1.18-.266-.258-.447-.661-.57-1.108-.32-.032-.64-.049-.96-.05zm-2.525 4.013c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 01-.976-.95v-1.752c0-.525.437-.951.976-.951zm5 0c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 01-.976-.95v-1.752c0-.525.437-.951.976-.951zM7.635 5.087c-1.05.102-1.935.438-2.385.906-.975 1.037-.765 3.668-.21 4.224.405.394 1.17.657 1.995.657h.09c.649-.013 1.785-.176 2.73-1.11.435-.41.705-1.433.675-2.47-.03-.834-.27-1.52-.63-1.813-.39-.336-1.275-.482-2.265-.394zm6.465.394c-.36.292-.6.98-.63 1.813-.03 1.037.24 2.06.675 2.47.968.957 2.136 1.104 2.776 1.11h.044c.825 0 1.59-.263 1.995-.657.555-.556.765-3.187-.21-4.224-.45-.468-1.335-.804-2.385-.906-.99-.088-1.875.058-2.265.394zM12 7.615c-.24 0-.525.015-.84.044.03.16.045.336.06.526l-.001.159a2.94 2.94 0 01-.014.25c.225-.022.425-.027.612-.028h.366c.187 0 .387.006.612.028-.015-.146-.015-.277-.015-.409.015-.19.03-.365.06-.526a9.29 9.29 0 00-.84-.044z"></path></svg>',
  claude: '<svg aria-hidden="true" fill="currentColor" fill-rule="evenodd" height="1em" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><path clip-rule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"></path></svg>',
  codex: '<svg aria-hidden="true" fill="currentColor" fill-rule="evenodd" height="1em" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"></path></svg>',
  agy: '<svg aria-hidden="true" fill="currentColor" fill-rule="evenodd" height="1em" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z"></path></svg>'
};

// src/ui/renderers/ToolCallRenderer.ts
function setToolIcon(el, name) {
  const icon = getToolIcon(name);
  if (icon === MCP_ICON_MARKER) {
    el.innerHTML = MCP_ICON_SVG;
  } else {
    (0, import_obsidian15.setIcon)(el, icon);
  }
}
function parseMcpToolName(name) {
  if (!name.startsWith("mcp__")) return null;
  const parts = name.split("__");
  const server = parts[1] || "MCP";
  const tool = parts.slice(2).join("__") || "tool";
  return { server, tool };
}
function getToolLabel(name, input) {
  const mcp = parseMcpToolName(name);
  if (mcp) {
    return mcp.tool.replace(/[-_]/g, " ");
  }
  switch (name) {
    case "Read":
      return `Read: ${shortenPath(input.file_path) || "file"}`;
    case "Write":
      return `Write: ${shortenPath(input.file_path) || "file"}`;
    case "Edit":
      return `Edit: ${shortenPath(input.file_path) || "file"}`;
    case "Bash": {
      const cmd = input.command || "command";
      return `Bash: ${cmd.length > 40 ? cmd.substring(0, 40) + "..." : cmd}`;
    }
    case "Glob":
      return `Glob: ${input.pattern || "files"}`;
    case "Grep":
      return `Grep: ${input.pattern || "pattern"}`;
    case "WebSearch": {
      const query = input.query || "search";
      return `WebSearch: ${query.length > 40 ? query.substring(0, 40) + "..." : query}`;
    }
    case "WebFetch": {
      const url = input.url || "url";
      return `WebFetch: ${url.length > 40 ? url.substring(0, 40) + "..." : url}`;
    }
    case "LS":
      return `LS: ${shortenPath(input.path) || "."}`;
    case "TodoWrite": {
      const todos = input.todos;
      if (todos && Array.isArray(todos)) {
        const completed = todos.filter((t) => t.status === "completed").length;
        return `Tasks (${completed}/${todos.length})`;
      }
      return "Tasks";
    }
    case "Skill": {
      const args = input.args || "";
      return args.length > 40 ? args.substring(0, 40) + "..." : args || "running";
    }
    default:
      return name;
  }
}
function shortenPath(filePath) {
  if (!filePath) return "";
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length <= 3) return normalized;
  return ".../" + parts.slice(-2).join("/");
}
var DEFAULT_RESULT_PREVIEW_MAX_LENGTH = 2e3;
function getResultPreview(result, maxLines, maxLength) {
  const truncatedByLength = result.length > maxLength;
  const cappedResult = truncatedByLength ? result.substring(0, maxLength) : result;
  const lines = cappedResult.split(/\r?\n/);
  return {
    lines: lines.slice(0, maxLines),
    hasMore: truncatedByLength || lines.length > maxLines,
    moreLines: !truncatedByLength && lines.length > maxLines ? lines.length - maxLines : void 0,
    truncatedByLength
  };
}
function countNonEmptyLines(text) {
  let count = 0;
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      let lineEnd = i;
      if (lineEnd > lineStart && text[lineEnd - 1] === "\r") {
        lineEnd--;
      }
      if (text.slice(lineStart, lineEnd).trim() !== "") {
        count++;
      }
      lineStart = i + 1;
    }
  }
  return count;
}
function parseWebSearchResult(result) {
  const linksMatch = result.match(/Links:\s*(\[[\s\S]*\])/);
  if (!linksMatch) return null;
  try {
    const links = JSON.parse(linksMatch[1]);
    if (!Array.isArray(links) || links.length === 0) return null;
    return links;
  } catch (e) {
    return null;
  }
}
function renderWebSearchResult(container, result, maxItems = 3) {
  const links = parseWebSearchResult(result);
  if (!links) return false;
  container.empty();
  const displayItems = links.slice(0, maxItems);
  displayItems.forEach((link) => {
    const item = container.createSpan({ cls: "ocop-tool-result-bullet" });
    item.setText(`\u2022 ${link.title}`);
  });
  if (links.length > maxItems) {
    const more = container.createSpan({ cls: "ocop-tool-result-item" });
    more.setText(`${links.length - maxItems} more results`);
  }
  return true;
}
function renderReadResult(container, result) {
  container.empty();
  const item = container.createSpan({ cls: "ocop-tool-result-item" });
  item.setText(`${countNonEmptyLines(result)} lines read`);
}
function renderResultLines(container, result, maxLines = 3, maxLength = DEFAULT_RESULT_PREVIEW_MAX_LENGTH) {
  var _a;
  container.empty();
  const preview = getResultPreview(result, maxLines, maxLength);
  preview.lines.forEach((line) => {
    const stripped = line.replace(/^\s*\d+→/, "");
    const item = container.createSpan({ cls: "ocop-tool-result-item" });
    item.setText(stripped);
  });
  if (preview.hasMore) {
    const more = container.createSpan({ cls: "ocop-tool-result-item" });
    more.setText(
      preview.truncatedByLength ? "Result preview truncated" : `${(_a = preview.moreLines) != null ? _a : 0} more lines`
    );
  }
}
function isBlockedToolResult(content, isError) {
  const lower = content.toLowerCase();
  if (lower.includes("blocked by blocklist")) return true;
  if (lower.includes("outside the vault")) return true;
  if (lower.includes("access denied")) return true;
  if (lower.includes("user denied")) return true;
  if (lower.includes("approval")) return true;
  if (isError && lower.includes("deny")) return true;
  return false;
}
function renderToolResultContent(el, name, result) {
  if (name === "WebSearch") {
    if (!renderWebSearchResult(el, result, 3)) {
      renderResultLines(el, result, 3);
    }
  } else if (name === "Read") {
    renderReadResult(el, result);
  } else {
    renderResultLines(el, result, 3);
  }
}
function createToolCallDOM(parentEl, toolCall) {
  const isMcp = toolCall.name.startsWith("mcp__");
  const isSkill = toolCall.name === "Skill";
  const badgeType = isMcp ? " is-mcp" : isSkill ? " is-skill" : "";
  const toolEl = parentEl.createDiv({ cls: `ocop-tool-call${badgeType}` });
  const header = toolEl.createDiv({ cls: "ocop-tool-header" });
  header.setAttribute("tabindex", "0");
  header.setAttribute("role", "button");
  const iconEl = header.createSpan({ cls: "ocop-tool-icon" });
  iconEl.setAttribute("aria-hidden", "true");
  setToolIcon(iconEl, toolCall.name);
  if (isMcp) {
    const mcpInfo = parseMcpToolName(toolCall.name);
    if (mcpInfo) {
      header.createSpan({ cls: "ocop-tool-mcp-badge", text: mcpInfo.server });
    }
  }
  if (isSkill) {
    const skillName = toolCall.input.skill || "skill";
    header.createSpan({ cls: "ocop-tool-skill-badge", text: skillName });
  }
  const labelEl = header.createSpan({ cls: "ocop-tool-label" });
  labelEl.setText(getToolLabel(toolCall.name, toolCall.input));
  const statusEl = header.createSpan({ cls: "ocop-tool-status" });
  statusEl.addClass(`status-${toolCall.status}`);
  statusEl.setAttribute("aria-label", `Status: ${toolCall.status}`);
  const content = toolEl.createDiv({ cls: "ocop-tool-content" });
  const resultRow = content.createDiv({ cls: "ocop-tool-result-row" });
  const branch = resultRow.createSpan({ cls: "ocop-tool-branch" });
  branch.setText("\u2514\u2500");
  const resultText = resultRow.createSpan({ cls: "ocop-tool-result-text" });
  return { toolEl, header, statusEl, content, resultText };
}
function setStatusIcon(statusEl, status) {
  if (status === "completed") {
    (0, import_obsidian15.setIcon)(statusEl, "check");
  } else if (status === "error") {
    (0, import_obsidian15.setIcon)(statusEl, "x");
  } else if (status === "blocked") {
    (0, import_obsidian15.setIcon)(statusEl, "shield-off");
  }
}
function renderToolCall(parentEl, toolCall, toolCallElements) {
  const { toolEl, header, statusEl, content, resultText } = createToolCallDOM(parentEl, toolCall);
  toolEl.dataset.toolId = toolCall.id;
  toolCallElements.set(toolCall.id, toolEl);
  if (toolCall.status === "running") {
    statusEl.createSpan({ cls: "ocop-spinner" });
  }
  resultText.setText("Running...");
  const state = { isExpanded: false };
  toolCall.isExpanded = false;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    onToggle: (expanded) => {
      toolCall.isExpanded = expanded;
    },
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });
  return toolEl;
}
function updateToolCallResult(toolId, toolCall, toolCallElements) {
  const toolEl = toolCallElements.get(toolId);
  if (!toolEl) return;
  const statusEl = toolEl.querySelector(".ocop-tool-status");
  if (statusEl) {
    statusEl.className = "ocop-tool-status";
    statusEl.addClass(`status-${toolCall.status}`);
    statusEl.empty();
    setStatusIcon(statusEl, toolCall.status);
  }
  const resultText = toolEl.querySelector(".ocop-tool-result-text");
  if (resultText && toolCall.result) {
    renderToolResultContent(resultText, toolCall.name, toolCall.result);
  }
}
function renderStoredToolCall(parentEl, toolCall) {
  const { toolEl, header, statusEl, content, resultText } = createToolCallDOM(parentEl, toolCall);
  setStatusIcon(statusEl, toolCall.status);
  if (toolCall.result) {
    renderToolResultContent(resultText, toolCall.name, toolCall.result);
  } else {
    resultText.setText("No result");
  }
  const state = { isExpanded: false };
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });
  return toolEl;
}

// src/ui/renderers/SubagentRenderer.ts
function extractTaskDescription(input) {
  return input.description || "Subagent task";
}
function truncateDescription(description, maxLength = 40) {
  if (description.length <= maxLength) return description;
  return description.substring(0, maxLength) + "...";
}
function truncateResult(result) {
  const lines = result.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length <= 2) {
    return lines.join("\n");
  }
  return lines.slice(0, 2).join("\n") + "...";
}
function createSubagentBlock(parentEl, taskToolId, taskInput) {
  const description = extractTaskDescription(taskInput);
  const info = {
    id: taskToolId,
    description,
    status: "running",
    toolCalls: [],
    isExpanded: false
    // Collapsed by default
  };
  const wrapperEl = parentEl.createDiv({ cls: "ocop-subagent-list" });
  wrapperEl.dataset.subagentId = taskToolId;
  const headerEl = wrapperEl.createDiv({ cls: "ocop-subagent-header" });
  headerEl.setAttribute("tabindex", "0");
  headerEl.setAttribute("role", "button");
  headerEl.setAttribute("aria-expanded", "false");
  headerEl.setAttribute("aria-label", `Subagent task: ${truncateDescription(description)} - click to expand`);
  const iconEl = headerEl.createDiv({ cls: "ocop-subagent-icon" });
  iconEl.setAttribute("aria-hidden", "true");
  (0, import_obsidian16.setIcon)(iconEl, "bot");
  const labelEl = headerEl.createDiv({ cls: "ocop-subagent-label" });
  labelEl.setText(truncateDescription(description));
  const countEl = headerEl.createDiv({ cls: "ocop-subagent-count" });
  countEl.setText("0 tool uses");
  const statusEl = headerEl.createDiv({ cls: "ocop-subagent-status status-running" });
  statusEl.setAttribute("aria-label", "Status: running");
  const contentEl = wrapperEl.createDiv({ cls: "ocop-subagent-content" });
  setupCollapsible(wrapperEl, headerEl, contentEl, info);
  return {
    wrapperEl,
    contentEl,
    headerEl,
    labelEl,
    countEl,
    statusEl,
    info,
    currentToolEl: null,
    currentResultEl: null
  };
}
function addSubagentToolCall(state, toolCall) {
  state.info.toolCalls.push(toolCall);
  const toolCount = state.info.toolCalls.length;
  state.countEl.setText(`${toolCount} tool uses`);
  state.contentEl.empty();
  state.currentResultEl = null;
  const itemEl = state.contentEl.createDiv({
    cls: `ocop-subagent-tool-item ocop-subagent-tool-${toolCall.status}`
  });
  itemEl.dataset.toolId = toolCall.id;
  state.currentToolEl = itemEl;
  const toolRowEl = itemEl.createDiv({ cls: "ocop-subagent-tool-row" });
  const branchEl = toolRowEl.createDiv({ cls: "ocop-subagent-branch" });
  branchEl.setText("\u2514\u2500");
  const labelEl = toolRowEl.createDiv({ cls: "ocop-subagent-tool-text" });
  labelEl.setText(getToolLabel(toolCall.name, toolCall.input));
}
function updateSubagentToolResult(state, toolId, toolCall) {
  const idx = state.info.toolCalls.findIndex((tc) => tc.id === toolId);
  if (idx !== -1) {
    state.info.toolCalls[idx] = toolCall;
  }
  if (state.currentToolEl && state.currentToolEl.dataset.toolId === toolId) {
    state.currentToolEl.className = `ocop-subagent-tool-item ocop-subagent-tool-${toolCall.status}`;
    if (toolCall.result) {
      if (!state.currentResultEl) {
        state.currentResultEl = state.currentToolEl.createDiv({ cls: "ocop-subagent-tool-result" });
        const branchEl = state.currentResultEl.createDiv({ cls: "ocop-subagent-branch" });
        branchEl.setText("\u2514\u2500");
        const textEl = state.currentResultEl.createDiv({ cls: "ocop-subagent-result-text" });
        textEl.setText(truncateResult(toolCall.result));
      } else {
        const textEl = state.currentResultEl.querySelector(".ocop-subagent-result-text");
        if (textEl) {
          textEl.setText(truncateResult(toolCall.result));
        }
      }
    }
  }
}
function finalizeSubagentBlock(state, result, isError) {
  state.info.status = isError ? "error" : "completed";
  state.info.result = result;
  state.labelEl.setText(truncateDescription(state.info.description));
  const toolCount = state.info.toolCalls.length;
  state.countEl.setText(`${toolCount} tool uses`);
  state.statusEl.className = "ocop-subagent-status";
  state.statusEl.addClass(`status-${state.info.status}`);
  state.statusEl.empty();
  if (state.info.status === "completed") {
    (0, import_obsidian16.setIcon)(state.statusEl, "check");
  } else {
    (0, import_obsidian16.setIcon)(state.statusEl, "x");
  }
  if (state.info.status === "completed") {
    state.wrapperEl.addClass("done");
  } else if (state.info.status === "error") {
    state.wrapperEl.addClass("error");
  }
  state.contentEl.empty();
  state.currentToolEl = null;
  state.currentResultEl = null;
  const doneEl = state.contentEl.createDiv({ cls: "ocop-subagent-done" });
  const branchEl = doneEl.createDiv({ cls: "ocop-subagent-branch" });
  branchEl.setText("\u2514\u2500");
  const textEl = doneEl.createDiv({ cls: "ocop-subagent-done-text" });
  textEl.setText(isError ? "ERROR" : "DONE");
}
function renderStoredSubagent(parentEl, subagent) {
  const wrapperEl = parentEl.createDiv({ cls: "ocop-subagent-list" });
  if (subagent.status === "completed") {
    wrapperEl.addClass("done");
  } else if (subagent.status === "error") {
    wrapperEl.addClass("error");
  }
  wrapperEl.dataset.subagentId = subagent.id;
  const toolCount = subagent.toolCalls.length;
  const headerEl = wrapperEl.createDiv({ cls: "ocop-subagent-header" });
  headerEl.setAttribute("tabindex", "0");
  headerEl.setAttribute("role", "button");
  headerEl.setAttribute("aria-label", `Subagent task: ${truncateDescription(subagent.description)} - ${toolCount} tool uses - Status: ${subagent.status}`);
  const iconEl = headerEl.createDiv({ cls: "ocop-subagent-icon" });
  iconEl.setAttribute("aria-hidden", "true");
  (0, import_obsidian16.setIcon)(iconEl, "bot");
  const labelEl = headerEl.createDiv({ cls: "ocop-subagent-label" });
  labelEl.setText(truncateDescription(subagent.description));
  const countEl = headerEl.createDiv({ cls: "ocop-subagent-count" });
  countEl.setText(`${toolCount} tool uses`);
  const statusEl = headerEl.createDiv({ cls: `ocop-subagent-status status-${subagent.status}` });
  statusEl.setAttribute("aria-label", `Status: ${subagent.status}`);
  if (subagent.status === "completed") {
    (0, import_obsidian16.setIcon)(statusEl, "check");
  } else if (subagent.status === "error") {
    (0, import_obsidian16.setIcon)(statusEl, "x");
  } else {
    statusEl.createSpan({ cls: "ocop-spinner" });
  }
  const contentEl = wrapperEl.createDiv({ cls: "ocop-subagent-content" });
  if (subagent.status === "completed" || subagent.status === "error") {
    const doneEl = contentEl.createDiv({ cls: "ocop-subagent-done" });
    const branchEl = doneEl.createDiv({ cls: "ocop-subagent-branch" });
    branchEl.setText("\u2514\u2500");
    const textEl = doneEl.createDiv({ cls: "ocop-subagent-done-text" });
    textEl.setText(subagent.status === "error" ? "ERROR" : "DONE");
  } else {
    const lastTool = subagent.toolCalls[subagent.toolCalls.length - 1];
    if (lastTool) {
      const itemEl = contentEl.createDiv({
        cls: `ocop-subagent-tool-item ocop-subagent-tool-${lastTool.status}`
      });
      const toolRowEl = itemEl.createDiv({ cls: "ocop-subagent-tool-row" });
      const branchEl = toolRowEl.createDiv({ cls: "ocop-subagent-branch" });
      branchEl.setText("\u2514\u2500");
      const toolLabelEl = toolRowEl.createDiv({ cls: "ocop-subagent-tool-text" });
      toolLabelEl.setText(getToolLabel(lastTool.name, lastTool.input));
      if (lastTool.result) {
        const resultEl = itemEl.createDiv({ cls: "ocop-subagent-tool-result" });
        const resultBranchEl = resultEl.createDiv({ cls: "ocop-subagent-branch" });
        resultBranchEl.setText("\u2514\u2500");
        const textEl = resultEl.createDiv({ cls: "ocop-subagent-result-text" });
        textEl.setText(truncateResult(lastTool.result));
      }
    }
  }
  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, headerEl, contentEl, state);
  return wrapperEl;
}
function setAsyncWrapperStatus(wrapperEl, status) {
  const classes = ["pending", "running", "awaiting", "completed", "error", "orphaned", "async"];
  classes.forEach((cls) => wrapperEl.removeClass(cls));
  wrapperEl.addClass("async");
  wrapperEl.addClass(status);
}
function getAsyncDisplayStatus(asyncStatus) {
  if (asyncStatus === "completed") return "completed";
  if (asyncStatus === "error") return "error";
  if (asyncStatus === "orphaned") return "orphaned";
  return "running";
}
function getAsyncStatusText(asyncStatus) {
  const display = getAsyncDisplayStatus(asyncStatus);
  if (display === "completed") return "Completed";
  if (display === "error") return "Error";
  if (display === "orphaned") return "Orphaned";
  return "\uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5 \uC911";
}
function updateAsyncLabel(state, _displayStatus) {
  state.labelEl.setText(truncateDescription(state.info.description));
}
function createAsyncSubagentBlock(parentEl, taskToolId, taskInput) {
  const description = taskInput.description || "Background task";
  const info = {
    id: taskToolId,
    description,
    mode: "async",
    status: "running",
    toolCalls: [],
    isExpanded: false,
    // Collapsed by default for async
    asyncStatus: "pending"
  };
  const wrapperEl = parentEl.createDiv({ cls: "ocop-subagent-list" });
  setAsyncWrapperStatus(wrapperEl, "pending");
  wrapperEl.dataset.asyncSubagentId = taskToolId;
  const headerEl = wrapperEl.createDiv({ cls: "ocop-subagent-header" });
  headerEl.setAttribute("tabindex", "0");
  headerEl.setAttribute("role", "button");
  headerEl.setAttribute("aria-expanded", "false");
  headerEl.setAttribute("aria-label", `Background task: ${description} - Status: \uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5 \uC911`);
  const iconEl = headerEl.createDiv({ cls: "ocop-subagent-icon" });
  iconEl.setAttribute("aria-hidden", "true");
  (0, import_obsidian16.setIcon)(iconEl, "bot");
  const labelEl = headerEl.createDiv({ cls: "ocop-subagent-label" });
  labelEl.setText(truncateDescription(description));
  const statusTextEl = headerEl.createDiv({ cls: "ocop-subagent-status-text" });
  statusTextEl.setText("\uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5 \uC911");
  const statusEl = headerEl.createDiv({ cls: "ocop-subagent-status status-running" });
  statusEl.setAttribute("aria-label", "Status: \uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5 \uC911");
  const contentEl = wrapperEl.createDiv({ cls: "ocop-subagent-content" });
  const statusRow = contentEl.createDiv({ cls: "ocop-subagent-done" });
  const branchEl = statusRow.createDiv({ cls: "ocop-subagent-branch" });
  branchEl.setText("\u2514\u2500");
  const textEl = statusRow.createDiv({ cls: "ocop-subagent-done-text" });
  textEl.setText("\uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5 \uC911");
  setupCollapsible(wrapperEl, headerEl, contentEl, info);
  return {
    wrapperEl,
    contentEl,
    headerEl,
    labelEl,
    statusTextEl,
    statusEl,
    info
  };
}
function updateAsyncSubagentRunning(state, agentId) {
  state.info.asyncStatus = "running";
  state.info.agentId = agentId;
  setAsyncWrapperStatus(state.wrapperEl, "running");
  updateAsyncLabel(state, "running");
  state.statusTextEl.setText("\uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5 \uC911");
  state.contentEl.empty();
  const statusRow = state.contentEl.createDiv({ cls: "ocop-subagent-done" });
  const branchEl = statusRow.createDiv({ cls: "ocop-subagent-branch" });
  branchEl.setText("\u2514\u2500");
  const textEl = statusRow.createDiv({ cls: "ocop-subagent-done-text ocop-async-agent-id" });
  const shortId = agentId.length > 12 ? agentId.substring(0, 12) + "..." : agentId;
  textEl.setText(`\uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5 \uC911 (${shortId})`);
}
function finalizeAsyncSubagent(state, result, isError) {
  state.info.asyncStatus = isError ? "error" : "completed";
  state.info.status = isError ? "error" : "completed";
  state.info.result = result;
  setAsyncWrapperStatus(state.wrapperEl, isError ? "error" : "completed");
  updateAsyncLabel(state, isError ? "error" : "completed");
  state.statusTextEl.setText(isError ? "Error" : "Completed");
  state.statusEl.className = "ocop-subagent-status";
  state.statusEl.addClass(`status-${isError ? "error" : "completed"}`);
  state.statusEl.empty();
  if (isError) {
    (0, import_obsidian16.setIcon)(state.statusEl, "x");
  } else {
    (0, import_obsidian16.setIcon)(state.statusEl, "check");
  }
  if (isError) {
    state.wrapperEl.addClass("error");
  } else {
    state.wrapperEl.addClass("done");
  }
  state.contentEl.empty();
  const resultEl = state.contentEl.createDiv({ cls: "ocop-subagent-done" });
  const branchEl = resultEl.createDiv({ cls: "ocop-subagent-branch" });
  branchEl.setText("\u2514\u2500");
  const textEl = resultEl.createDiv({ cls: "ocop-subagent-done-text" });
  if (isError && result) {
    const truncated = result.length > 80 ? result.substring(0, 80) + "..." : result;
    textEl.setText(`ERROR: ${truncated}`);
  } else {
    textEl.setText(isError ? "ERROR" : "DONE");
  }
}
function markAsyncSubagentOrphaned(state) {
  state.info.asyncStatus = "orphaned";
  state.info.status = "error";
  state.info.result = "Conversation ended before task completed";
  setAsyncWrapperStatus(state.wrapperEl, "orphaned");
  updateAsyncLabel(state, "orphaned");
  state.statusTextEl.setText("Orphaned");
  state.statusEl.className = "ocop-subagent-status status-error";
  state.statusEl.empty();
  (0, import_obsidian16.setIcon)(state.statusEl, "alert-circle");
  state.wrapperEl.addClass("error");
  state.wrapperEl.addClass("orphaned");
  state.contentEl.empty();
  const orphanEl = state.contentEl.createDiv({ cls: "ocop-subagent-done ocop-async-orphaned" });
  const branchEl = orphanEl.createDiv({ cls: "ocop-subagent-branch" });
  branchEl.setText("\u2514\u2500");
  const textEl = orphanEl.createDiv({ cls: "ocop-subagent-done-text" });
  textEl.setText("\u26A0\uFE0F Task orphaned");
}
function renderStoredAsyncSubagent(parentEl, subagent) {
  const wrapperEl = parentEl.createDiv({ cls: "ocop-subagent-list" });
  const statusClass = getAsyncDisplayStatus(subagent.asyncStatus);
  setAsyncWrapperStatus(wrapperEl, statusClass);
  if (subagent.asyncStatus === "completed") {
    wrapperEl.addClass("done");
  } else if (subagent.asyncStatus === "error" || subagent.asyncStatus === "orphaned") {
    wrapperEl.addClass("error");
  }
  wrapperEl.dataset.asyncSubagentId = subagent.id;
  const displayStatus = getAsyncDisplayStatus(subagent.asyncStatus);
  const statusText = getAsyncStatusText(subagent.asyncStatus);
  const headerEl = wrapperEl.createDiv({ cls: "ocop-subagent-header" });
  headerEl.setAttribute("tabindex", "0");
  headerEl.setAttribute("role", "button");
  headerEl.setAttribute("aria-label", `Background task: ${subagent.description} - Status: ${statusText}`);
  const iconEl = headerEl.createDiv({ cls: "ocop-subagent-icon" });
  iconEl.setAttribute("aria-hidden", "true");
  (0, import_obsidian16.setIcon)(iconEl, "bot");
  const labelEl = headerEl.createDiv({ cls: "ocop-subagent-label" });
  labelEl.setText(truncateDescription(subagent.description));
  const statusTextEl = headerEl.createDiv({ cls: "ocop-subagent-status-text" });
  statusTextEl.setText(statusText);
  const statusIconClass = displayStatus === "error" || displayStatus === "orphaned" ? "status-error" : displayStatus === "completed" ? "status-completed" : "status-running";
  const statusEl = headerEl.createDiv({ cls: `ocop-subagent-status ${statusIconClass}` });
  statusEl.setAttribute("aria-label", `Status: ${statusText}`);
  if (subagent.asyncStatus === "completed") {
    (0, import_obsidian16.setIcon)(statusEl, "check");
  } else if (subagent.asyncStatus === "error" || subagent.asyncStatus === "orphaned") {
    (0, import_obsidian16.setIcon)(statusEl, subagent.asyncStatus === "orphaned" ? "alert-circle" : "x");
  }
  const contentEl = wrapperEl.createDiv({ cls: "ocop-subagent-content" });
  const statusRow = contentEl.createDiv({ cls: "ocop-subagent-done" });
  const branchEl = statusRow.createDiv({ cls: "ocop-subagent-branch" });
  branchEl.setText("\u2514\u2500");
  const textEl = statusRow.createDiv({ cls: "ocop-subagent-done-text" });
  if (subagent.asyncStatus === "completed") {
    textEl.setText("DONE");
  } else if (subagent.asyncStatus === "error") {
    textEl.setText("ERROR");
  } else if (subagent.asyncStatus === "orphaned") {
    textEl.setText("\u26A0\uFE0F Task orphaned");
  } else if (subagent.agentId) {
    const shortId = subagent.agentId.length > 12 ? subagent.agentId.substring(0, 12) + "..." : subagent.agentId;
    textEl.setText(`\uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5 \uC911 (${shortId})`);
  } else {
    textEl.setText("\uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5 \uC911");
  }
  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, headerEl, contentEl, state);
  return wrapperEl;
}

// src/ui/renderers/ThinkingBlockRenderer.ts
function createThinkingBlock(parentEl, renderContent) {
  const wrapperEl = parentEl.createDiv({ cls: "ocop-thinking-block" });
  const header = wrapperEl.createDiv({ cls: "ocop-thinking-header" });
  header.setAttribute("tabindex", "0");
  header.setAttribute("role", "button");
  header.setAttribute("aria-expanded", "false");
  header.setAttribute("aria-label", "Extended thinking - click to expand");
  const labelEl = header.createSpan({ cls: "ocop-thinking-label" });
  const startTime = Date.now();
  labelEl.setText("Thinking 0s...");
  const timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1e3);
    labelEl.setText(`Thinking ${elapsed}s...`);
  }, 1e3);
  const contentEl = wrapperEl.createDiv({ cls: "ocop-thinking-content" });
  const state = {
    wrapperEl,
    contentEl,
    labelEl,
    content: "",
    startTime,
    timerInterval,
    isExpanded: false
  };
  setupCollapsible(wrapperEl, header, contentEl, state);
  return state;
}
async function appendThinkingContent(state, content, renderContent) {
  state.content += content;
  await renderContent(state.contentEl, state.content);
}
function finalizeThinkingBlock(state) {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  const durationSeconds = Math.floor((Date.now() - state.startTime) / 1e3);
  state.labelEl.setText(`Thought for ${durationSeconds}s`);
  const header = state.wrapperEl.querySelector(".ocop-thinking-header");
  if (header) {
    collapseElement(state.wrapperEl, header, state.contentEl, state);
  }
  return durationSeconds;
}
function cleanupThinkingBlock(state) {
  if (state == null ? void 0 : state.timerInterval) {
    clearInterval(state.timerInterval);
  }
}
function renderStoredThinkingBlock(parentEl, content, durationSeconds, renderContent) {
  const wrapperEl = parentEl.createDiv({ cls: "ocop-thinking-block" });
  const header = wrapperEl.createDiv({ cls: "ocop-thinking-header" });
  header.setAttribute("tabindex", "0");
  header.setAttribute("role", "button");
  header.setAttribute("aria-label", "Extended thinking - click to expand");
  const labelEl = header.createSpan({ cls: "ocop-thinking-label" });
  const labelText = durationSeconds !== void 0 ? `Thought for ${durationSeconds}s` : "Thinking";
  labelEl.setText(labelText);
  const contentEl = wrapperEl.createDiv({ cls: "ocop-thinking-content" });
  renderContent(contentEl, content);
  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, header, contentEl, state);
  return wrapperEl;
}

// src/ui/renderers/TodoListRenderer.ts
function isValidTodoItem(item) {
  if (typeof item !== "object" || item === null) return false;
  const record = item;
  return typeof record.content === "string" && record.content.length > 0 && typeof record.activeForm === "string" && record.activeForm.length > 0 && typeof record.status === "string" && ["pending", "in_progress", "completed"].includes(record.status);
}
function parseTodoInput(input) {
  if (!input.todos || !Array.isArray(input.todos)) {
    return null;
  }
  const validTodos = [];
  const invalidItems = [];
  for (const item of input.todos) {
    if (isValidTodoItem(item)) {
      validTodos.push(item);
    } else {
      invalidItems.push(item);
    }
  }
  if (invalidItems.length > 0) {
    console.warn("[TodoListRenderer] Dropped invalid todo items:", {
      dropped: invalidItems.length,
      total: input.todos.length,
      sample: invalidItems.slice(0, 3)
    });
  }
  return validTodos.length > 0 ? validTodos : null;
}
function extractLastTodosFromMessages(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && msg.toolCalls) {
      for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
        const toolCall = msg.toolCalls[j];
        if (toolCall.name === TOOL_TODO_WRITE) {
          const todos = parseTodoInput(toolCall.input);
          if (!todos) {
            console.warn("[TodoListRenderer] Failed to parse TodoWrite from saved conversation", {
              messageIndex: i,
              toolCallIndex: j,
              inputKeys: Object.keys(toolCall.input)
            });
          }
          return todos;
        }
      }
    }
  }
  return null;
}

// src/ui/renderers/WriteEditRenderer.ts
var import_obsidian17 = require("obsidian");
function shortenPath2(filePath, maxLength = 40) {
  if (!filePath) return "file";
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.length <= maxLength) return normalized;
  const parts = normalized.split("/");
  if (parts.length <= 2) {
    return "..." + normalized.slice(-maxLength + 3);
  }
  const filename = parts[parts.length - 1];
  const firstDir = parts[0];
  const available = maxLength - firstDir.length - filename.length - 5;
  if (available < 0) {
    return "..." + filename.slice(-maxLength + 3);
  }
  return `${firstDir}/.../${filename}`;
}
function renderSkippedDiff(row, text) {
  const skipEl = row.createDiv({ cls: "ocop-write-edit-binary" });
  skipEl.setText(text);
}
function renderSkippedDiffContent(contentEl, text) {
  const row = contentEl.createDiv({ cls: "ocop-write-edit-diff-row" });
  renderSkippedDiff(row, text);
}
function createWriteEditBlock(parentEl, toolCall) {
  const filePath = toolCall.input.file_path || "file";
  const toolName = toolCall.name;
  const wrapperEl = parentEl.createDiv({ cls: "ocop-write-edit-block" });
  wrapperEl.dataset.toolId = toolCall.id;
  const headerEl = wrapperEl.createDiv({ cls: "ocop-write-edit-header" });
  headerEl.setAttribute("tabindex", "0");
  headerEl.setAttribute("role", "button");
  headerEl.setAttribute("aria-label", `${toolName}: ${shortenPath2(filePath)} - click to expand`);
  const iconEl = headerEl.createDiv({ cls: "ocop-write-edit-icon" });
  iconEl.setAttribute("aria-hidden", "true");
  (0, import_obsidian17.setIcon)(iconEl, toolName === TOOL_EDIT ? "file-pen" : "file-plus");
  const labelEl = headerEl.createDiv({ cls: "ocop-write-edit-label" });
  labelEl.setText(`${toolName}: ${shortenPath2(filePath)}`);
  const statsEl = headerEl.createDiv({ cls: "ocop-write-edit-stats" });
  const statusEl = headerEl.createDiv({ cls: "ocop-write-edit-status status-running" });
  statusEl.setAttribute("aria-label", "Status: running");
  statusEl.createSpan({ cls: "ocop-spinner" });
  const contentEl = wrapperEl.createDiv({ cls: "ocop-write-edit-content" });
  const loadingRow = contentEl.createDiv({ cls: "ocop-write-edit-diff-row" });
  const loadingEl = loadingRow.createDiv({ cls: "ocop-write-edit-loading" });
  loadingEl.setText("Writing...");
  const state = {
    wrapperEl,
    contentEl,
    headerEl,
    labelEl,
    statsEl,
    statusEl,
    toolCall,
    isExpanded: false
  };
  setupCollapsible(wrapperEl, headerEl, contentEl, state);
  return state;
}
function updateWriteEditWithDiff(state, diffData) {
  state.statsEl.empty();
  state.contentEl.empty();
  if (diffData.skippedReason === "too_large") {
    renderSkippedDiffContent(state.contentEl, "Diff skipped: file too large");
    return;
  }
  if (diffData.skippedReason === "unavailable" || diffData.originalContent === void 0 || diffData.newContent === void 0) {
    renderSkippedDiffContent(state.contentEl, "Diff unavailable");
    return;
  }
  const { originalContent, newContent } = diffData;
  if (isBinaryContent(originalContent) || isBinaryContent(newContent)) {
    const row2 = state.contentEl.createDiv({ cls: "ocop-write-edit-diff-row" });
    renderSkippedDiff(row2, "Binary file");
    return;
  }
  if (shouldSkipLineDiff(originalContent, newContent)) {
    renderSkippedDiffContent(state.contentEl, "Diff skipped: file too large");
    return;
  }
  const diffLines = computeLineDiff(originalContent, newContent);
  state.diffLines = diffLines;
  const stats = countLineChanges(diffLines);
  if (stats.added > 0) {
    const addedEl = state.statsEl.createSpan({ cls: "added" });
    addedEl.setText(`+${stats.added}`);
  }
  if (stats.removed > 0) {
    if (stats.added > 0) {
      state.statsEl.createSpan({ text: " " });
    }
    const removedEl = state.statsEl.createSpan({ cls: "removed" });
    removedEl.setText(`-${stats.removed}`);
  }
  const row = state.contentEl.createDiv({ cls: "ocop-write-edit-diff-row" });
  const diffEl = row.createDiv({ cls: "ocop-write-edit-diff" });
  renderDiffContent(diffEl, diffLines);
}
function finalizeWriteEditBlock(state, isError) {
  state.statusEl.className = "ocop-write-edit-status";
  state.statusEl.empty();
  if (isError) {
    state.statusEl.addClass("status-error");
    (0, import_obsidian17.setIcon)(state.statusEl, "x");
    state.statusEl.setAttribute("aria-label", "Status: error");
    if (!state.diffLines) {
      state.contentEl.empty();
      const row = state.contentEl.createDiv({ cls: "ocop-write-edit-diff-row" });
      const errorEl = row.createDiv({ cls: "ocop-write-edit-error" });
      errorEl.setText(state.toolCall.result || "Error");
    }
  }
  if (isError) {
    state.wrapperEl.addClass("error");
  } else {
    state.wrapperEl.addClass("done");
  }
}
function renderStoredWriteEdit(parentEl, toolCall) {
  const filePath = toolCall.input.file_path || "file";
  const toolName = toolCall.name;
  const isError = toolCall.status === "error" || toolCall.status === "blocked";
  const wrapperEl = parentEl.createDiv({ cls: "ocop-write-edit-block" });
  if (isError) {
    wrapperEl.addClass("error");
  } else if (toolCall.status === "completed") {
    wrapperEl.addClass("done");
  }
  wrapperEl.dataset.toolId = toolCall.id;
  const headerEl = wrapperEl.createDiv({ cls: "ocop-write-edit-header" });
  headerEl.setAttribute("tabindex", "0");
  headerEl.setAttribute("role", "button");
  const iconEl = headerEl.createDiv({ cls: "ocop-write-edit-icon" });
  iconEl.setAttribute("aria-hidden", "true");
  (0, import_obsidian17.setIcon)(iconEl, toolName === TOOL_EDIT ? "file-pen" : "file-plus");
  const labelEl = headerEl.createDiv({ cls: "ocop-write-edit-label" });
  labelEl.setText(`${toolName}: ${shortenPath2(filePath)}`);
  const statsEl = headerEl.createDiv({ cls: "ocop-write-edit-stats" });
  if (toolCall.diffData && !toolCall.diffData.skippedReason && toolCall.diffData.originalContent !== void 0 && toolCall.diffData.newContent !== void 0 && !shouldSkipLineDiff(toolCall.diffData.originalContent, toolCall.diffData.newContent)) {
    const diffLines = computeLineDiff(toolCall.diffData.originalContent, toolCall.diffData.newContent);
    const stats = countLineChanges(diffLines);
    if (stats.added > 0) {
      const addedEl = statsEl.createSpan({ cls: "added" });
      addedEl.setText(`+${stats.added}`);
    }
    if (stats.removed > 0) {
      if (stats.added > 0) {
        statsEl.createSpan({ text: " " });
      }
      const removedEl = statsEl.createSpan({ cls: "removed" });
      removedEl.setText(`-${stats.removed}`);
    }
  }
  const statusEl = headerEl.createDiv({ cls: "ocop-write-edit-status" });
  if (isError) {
    statusEl.addClass("status-error");
    (0, import_obsidian17.setIcon)(statusEl, "x");
  }
  const contentEl = wrapperEl.createDiv({ cls: "ocop-write-edit-content" });
  const row = contentEl.createDiv({ cls: "ocop-write-edit-diff-row" });
  if (toolCall.diffData) {
    if (toolCall.diffData.skippedReason === "too_large") {
      renderSkippedDiff(row, "Diff skipped: file too large");
    } else if (toolCall.diffData.skippedReason === "unavailable" || toolCall.diffData.originalContent === void 0 || toolCall.diffData.newContent === void 0) {
      renderSkippedDiff(row, "Diff unavailable");
    } else if (shouldSkipLineDiff(toolCall.diffData.originalContent, toolCall.diffData.newContent)) {
      renderSkippedDiff(row, "Diff skipped: file too large");
    } else {
      const diffEl = row.createDiv({ cls: "ocop-write-edit-diff" });
      const diffLines = computeLineDiff(toolCall.diffData.originalContent, toolCall.diffData.newContent);
      renderDiffContent(diffEl, diffLines);
    }
  } else if (isError && toolCall.result) {
    const errorEl = row.createDiv({ cls: "ocop-write-edit-error" });
    errorEl.setText(toolCall.result);
  } else {
    const doneEl = row.createDiv({ cls: "ocop-write-edit-done-text" });
    doneEl.setText(isError ? "ERROR" : "DONE");
  }
  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, headerEl, contentEl, state);
  return wrapperEl;
}

// src/ui/settings/EnvSnippetManager.ts
var import_obsidian18 = require("obsidian");
var EnvSnippetModal = class extends import_obsidian18.Modal {
  constructor(app, plugin, snippet, onSave) {
    super(app);
    this.plugin = plugin;
    this.snippet = snippet;
    this.onSave = onSave;
  }
  onOpen() {
    const { contentEl } = this;
    this.setTitle(this.snippet ? "Edit snippet" : "Save snippet");
    this.modalEl.addClass("ocop-env-snippet-modal");
    let nameEl;
    let descEl;
    let envVarsEl;
    const handleKeyDown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveSnippet();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    };
    const saveSnippet = () => {
      var _a;
      const name = nameEl.value.trim();
      if (!name) {
        new import_obsidian18.Notice("Please enter a name for the snippet");
        return;
      }
      const snippet = {
        id: ((_a = this.snippet) == null ? void 0 : _a.id) || `snippet-${Date.now()}`,
        name,
        description: descEl.value.trim(),
        envVars: envVarsEl.value
      };
      this.onSave(snippet);
      this.close();
    };
    new import_obsidian18.Setting(contentEl).setName("Name").setDesc("A descriptive name for this environment configuration").addText((text) => {
      var _a;
      nameEl = text.inputEl;
      text.setValue(((_a = this.snippet) == null ? void 0 : _a.name) || "");
      text.inputEl.addEventListener("keydown", handleKeyDown);
    });
    new import_obsidian18.Setting(contentEl).setName("Description").setDesc("Optional description").addText((text) => {
      var _a;
      descEl = text.inputEl;
      text.setValue(((_a = this.snippet) == null ? void 0 : _a.description) || "");
      text.inputEl.addEventListener("keydown", handleKeyDown);
    });
    const envVarsSetting = new import_obsidian18.Setting(contentEl).setName("Environment variables").setDesc("KEY=VALUE format, one per line").addTextArea((text) => {
      var _a, _b;
      envVarsEl = text.inputEl;
      const envVarsToShow = (_b = (_a = this.snippet) == null ? void 0 : _a.envVars) != null ? _b : this.plugin.settings.environmentVariables;
      text.setValue(envVarsToShow);
      text.inputEl.rows = 8;
    });
    envVarsSetting.settingEl.addClass("ocop-env-snippet-setting");
    envVarsSetting.controlEl.addClass("ocop-env-snippet-control");
    const buttonContainer = contentEl.createDiv({ cls: "ocop-snippet-buttons" });
    const cancelBtn = buttonContainer.createEl("button", {
      text: "Cancel",
      cls: "ocop-cancel-btn"
    });
    cancelBtn.addEventListener("click", () => this.close());
    const saveBtn = buttonContainer.createEl("button", {
      text: this.snippet ? "Update" : "Save",
      cls: "ocop-save-btn"
    });
    saveBtn.addEventListener("click", () => saveSnippet());
    setTimeout(() => nameEl == null ? void 0 : nameEl.focus(), 50);
  }
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
};
var EnvSnippetManager = class {
  constructor(containerEl, plugin) {
    this.containerEl = containerEl;
    this.plugin = plugin;
    this.render();
  }
  render() {
    this.containerEl.empty();
    const headerEl = this.containerEl.createDiv({ cls: "ocop-snippet-header" });
    headerEl.createSpan({ text: "Snippets", cls: "ocop-snippet-label" });
    const saveBtn = headerEl.createEl("button", {
      cls: "ocop-settings-action-btn",
      attr: { "aria-label": "Save current" }
    });
    (0, import_obsidian18.setIcon)(saveBtn, "plus");
    saveBtn.addEventListener("click", () => this.saveCurrentEnv());
    const snippets = this.plugin.settings.envSnippets;
    if (snippets.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: "ocop-snippet-empty" });
      emptyEl.setText('No saved environment snippets yet. Click "Save Current" to save your current environment configuration.');
      return;
    }
    const sortedSnippets = snippets;
    const listEl = this.containerEl.createDiv({ cls: "ocop-snippet-list" });
    for (const snippet of sortedSnippets) {
      const itemEl = listEl.createDiv({ cls: "ocop-snippet-item" });
      const infoEl = itemEl.createDiv({ cls: "ocop-snippet-info" });
      const nameEl = infoEl.createDiv({ cls: "ocop-snippet-name" });
      nameEl.setText(snippet.name);
      if (snippet.description) {
        const descEl = infoEl.createDiv({ cls: "ocop-snippet-description" });
        descEl.setText(snippet.description);
      }
      const actionsEl = itemEl.createDiv({ cls: "ocop-snippet-actions" });
      const restoreBtn = actionsEl.createEl("button", {
        cls: "ocop-settings-action-btn",
        attr: { "aria-label": "Insert" }
      });
      (0, import_obsidian18.setIcon)(restoreBtn, "clipboard-paste");
      restoreBtn.addEventListener("click", async () => {
        await this.insertSnippet(snippet);
      });
      const editBtn = actionsEl.createEl("button", {
        cls: "ocop-settings-action-btn",
        attr: { "aria-label": "Edit" }
      });
      (0, import_obsidian18.setIcon)(editBtn, "pencil");
      editBtn.addEventListener("click", () => {
        this.editSnippet(snippet);
      });
      const deleteBtn = actionsEl.createEl("button", {
        cls: "ocop-settings-action-btn ocop-settings-delete-btn",
        attr: { "aria-label": "Delete" }
      });
      (0, import_obsidian18.setIcon)(deleteBtn, "trash-2");
      deleteBtn.addEventListener("click", async () => {
        if (confirm(`Delete environment snippet "${snippet.name}"?`)) {
          await this.deleteSnippet(snippet);
        }
      });
    }
  }
  async saveCurrentEnv() {
    const modal = new EnvSnippetModal(
      this.plugin.app,
      this.plugin,
      null,
      async (snippet) => {
        this.plugin.settings.envSnippets.push(snippet);
        await this.plugin.saveSettings();
        this.render();
        new import_obsidian18.Notice(`Environment snippet "${snippet.name}" saved`);
      }
    );
    modal.open();
  }
  async insertSnippet(snippet) {
    var _a, _b;
    const envTextarea = document.querySelector(".ocop-settings-env-textarea");
    if (envTextarea) {
      const snippetContent = snippet.envVars.trim();
      envTextarea.value = snippetContent;
      await this.plugin.applyEnvironmentVariables(snippetContent);
      const view = (_a = this.plugin.app.workspace.getLeavesOfType("ocop-view")[0]) == null ? void 0 : _a.view;
      if (view == null ? void 0 : view.modelSelector) {
        view.modelSelector.updateDisplay();
        view.modelSelector.renderOptions();
      }
    } else {
      await this.plugin.applyEnvironmentVariables(snippet.envVars);
      this.render();
      const view = (_b = this.plugin.app.workspace.getLeavesOfType("ocop-view")[0]) == null ? void 0 : _b.view;
      if (view == null ? void 0 : view.modelSelector) {
        view.modelSelector.updateDisplay();
        view.modelSelector.renderOptions();
      }
    }
  }
  editSnippet(snippet) {
    const modal = new EnvSnippetModal(
      this.plugin.app,
      this.plugin,
      snippet,
      async (updatedSnippet) => {
        const index = this.plugin.settings.envSnippets.findIndex((s) => s.id === snippet.id);
        if (index !== -1) {
          this.plugin.settings.envSnippets[index] = updatedSnippet;
          await this.plugin.saveSettings();
          this.render();
          new import_obsidian18.Notice(`Environment snippet "${updatedSnippet.name}" updated`);
        }
      }
    );
    modal.open();
  }
  async deleteSnippet(snippet) {
    this.plugin.settings.envSnippets = this.plugin.settings.envSnippets.filter((s) => s.id !== snippet.id);
    await this.plugin.saveSettings();
    this.render();
    new import_obsidian18.Notice(`Environment snippet "${snippet.name}" deleted`);
  }
  refresh() {
    this.render();
  }
};

// src/ui/settings/SlashCommandSettings.ts
var import_obsidian19 = require("obsidian");
var SlashCommandModal = class extends import_obsidian19.Modal {
  constructor(app, plugin, existingCmd, onSave) {
    super(app);
    this.plugin = plugin;
    this.existingCmd = existingCmd;
    this.onSave = onSave;
  }
  onOpen() {
    this.setTitle(this.existingCmd ? "Edit Slash Command" : "Add Slash Command");
    this.modalEl.addClass("ocop-slash-modal");
    const { contentEl } = this;
    let nameInput;
    let descInput;
    let hintInput;
    let modelInput;
    let toolsInput;
    new import_obsidian19.Setting(contentEl).setName("Command name").setDesc('The name used after / (e.g., "review" for /review)').addText((text) => {
      var _a;
      nameInput = text.inputEl;
      text.setValue(((_a = this.existingCmd) == null ? void 0 : _a.name) || "").setPlaceholder("review-code");
    });
    new import_obsidian19.Setting(contentEl).setName("Description").setDesc("Optional description shown in dropdown").addText((text) => {
      var _a;
      descInput = text.inputEl;
      text.setValue(((_a = this.existingCmd) == null ? void 0 : _a.description) || "");
    });
    new import_obsidian19.Setting(contentEl).setName("Argument hint").setDesc('Placeholder text for arguments (e.g., "[file] [focus]")').addText((text) => {
      var _a;
      hintInput = text.inputEl;
      text.setValue(((_a = this.existingCmd) == null ? void 0 : _a.argumentHint) || "");
    });
    new import_obsidian19.Setting(contentEl).setName("Model override").setDesc("Optional model to use for this command").addText((text) => {
      var _a;
      modelInput = text.inputEl;
      text.setValue(((_a = this.existingCmd) == null ? void 0 : _a.model) || "").setPlaceholder("claude-sonnet-4-5");
    });
    new import_obsidian19.Setting(contentEl).setName("Allowed tools").setDesc("Comma-separated list of tools to allow (empty = all)").addText((text) => {
      var _a, _b;
      toolsInput = text.inputEl;
      text.setValue(((_b = (_a = this.existingCmd) == null ? void 0 : _a.allowedTools) == null ? void 0 : _b.join(", ")) || "");
    });
    new import_obsidian19.Setting(contentEl).setName("Prompt template").setDesc("Use $ARGUMENTS, $1, $2, @file, !`bash`");
    const contentArea = contentEl.createEl("textarea", {
      cls: "ocop-slash-content-area",
      attr: {
        rows: "10",
        placeholder: "Review this code for:\n$ARGUMENTS\n\n@$1"
      }
    });
    const initialContent = this.existingCmd ? parseSlashCommandContent(this.existingCmd.content).promptContent : "";
    contentArea.value = initialContent;
    const buttonContainer = contentEl.createDiv({ cls: "ocop-slash-modal-buttons" });
    const cancelBtn = buttonContainer.createEl("button", {
      text: "Cancel",
      cls: "ocop-cancel-btn"
    });
    cancelBtn.addEventListener("click", () => this.close());
    const saveBtn = buttonContainer.createEl("button", {
      text: "Save",
      cls: "ocop-save-btn"
    });
    saveBtn.addEventListener("click", async () => {
      var _a;
      const name = nameInput.value.trim();
      if (!name) {
        new import_obsidian19.Notice("Command name is required");
        return;
      }
      const content = contentArea.value;
      if (!content.trim()) {
        new import_obsidian19.Notice("Prompt template is required");
        return;
      }
      if (!/^[a-zA-Z0-9_/-]+$/.test(name)) {
        new import_obsidian19.Notice("Command name can only contain letters, numbers, hyphens, underscores, and slashes");
        return;
      }
      const existing = this.plugin.settings.slashCommands.find(
        (c) => {
          var _a2;
          return c.name.toLowerCase() === name.toLowerCase() && c.id !== ((_a2 = this.existingCmd) == null ? void 0 : _a2.id);
        }
      );
      if (existing) {
        new import_obsidian19.Notice(`A command named "/${name}" already exists`);
        return;
      }
      const parsed = parseSlashCommandContent(content);
      const promptContent = parsed.promptContent;
      const cmd = {
        id: ((_a = this.existingCmd) == null ? void 0 : _a.id) || `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        name,
        description: descInput.value.trim() || parsed.description || void 0,
        argumentHint: hintInput.value.trim() || parsed.argumentHint || void 0,
        model: modelInput.value.trim() || parsed.model || void 0,
        allowedTools: toolsInput.value.trim() ? toolsInput.value.split(",").map((s) => s.trim()).filter(Boolean) : parsed.allowedTools && parsed.allowedTools.length > 0 ? parsed.allowedTools : void 0,
        content: promptContent
      };
      this.onSave(cmd);
      this.close();
    });
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    };
    contentEl.addEventListener("keydown", handleKeyDown);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var SlashCommandSettings = class {
  constructor(containerEl, plugin) {
    this.containerEl = containerEl;
    this.plugin = plugin;
    this.render();
  }
  render() {
    this.containerEl.empty();
    const headerEl = this.containerEl.createDiv({ cls: "ocop-slash-header" });
    headerEl.createSpan({ text: "Slash Commands / Workflows", cls: "ocop-slash-label" });
    const actionsEl = headerEl.createDiv({ cls: "ocop-slash-header-actions" });
    const importBtn = actionsEl.createEl("button", {
      cls: "ocop-settings-action-btn",
      attr: { "aria-label": "Import" }
    });
    (0, import_obsidian19.setIcon)(importBtn, "download");
    importBtn.addEventListener("click", () => this.importCommands());
    const exportBtn = actionsEl.createEl("button", {
      cls: "ocop-settings-action-btn",
      attr: { "aria-label": "Export" }
    });
    (0, import_obsidian19.setIcon)(exportBtn, "upload");
    exportBtn.addEventListener("click", () => this.exportCommands());
    const addBtn = actionsEl.createEl("button", {
      cls: "ocop-settings-action-btn",
      attr: { "aria-label": "Add" }
    });
    (0, import_obsidian19.setIcon)(addBtn, "plus");
    addBtn.addEventListener("click", () => this.openCommandModal(null));
    const commands = this.plugin.settings.slashCommands;
    if (commands.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: "ocop-slash-empty-state" });
      emptyEl.setText('No workflow presets configured. Click "Add" to create one.');
      return;
    }
    const listEl = this.containerEl.createDiv({ cls: "ocop-slash-list" });
    for (const cmd of commands) {
      this.renderCommandItem(listEl, cmd);
    }
  }
  renderCommandItem(listEl, cmd) {
    const itemEl = listEl.createDiv({ cls: "ocop-slash-item-settings" });
    const infoEl = itemEl.createDiv({ cls: "ocop-slash-info" });
    const headerRow = infoEl.createDiv({ cls: "ocop-slash-item-header" });
    const nameEl = headerRow.createSpan({ cls: "ocop-slash-item-name" });
    nameEl.setText(`/${cmd.name}`);
    if (cmd.argumentHint) {
      const hintEl = headerRow.createSpan({ cls: "ocop-slash-item-hint" });
      hintEl.setText(cmd.argumentHint);
    }
    if (cmd.description) {
      const descEl = infoEl.createDiv({ cls: "ocop-slash-item-desc" });
      descEl.setText(cmd.description);
    }
    const actionsEl = itemEl.createDiv({ cls: "ocop-slash-item-actions" });
    const editBtn = actionsEl.createEl("button", {
      cls: "ocop-settings-action-btn",
      attr: { "aria-label": "Edit" }
    });
    (0, import_obsidian19.setIcon)(editBtn, "pencil");
    editBtn.addEventListener("click", () => this.openCommandModal(cmd));
    const deleteBtn = actionsEl.createEl("button", {
      cls: "ocop-settings-action-btn ocop-settings-delete-btn",
      attr: { "aria-label": "Delete" }
    });
    (0, import_obsidian19.setIcon)(deleteBtn, "trash-2");
    deleteBtn.addEventListener("click", async () => {
      await this.deleteCommand(cmd);
    });
  }
  openCommandModal(existingCmd) {
    const modal = new SlashCommandModal(
      this.plugin.app,
      this.plugin,
      existingCmd,
      async (cmd) => {
        await this.saveCommand(cmd, existingCmd);
      }
    );
    modal.open();
  }
  async saveCommand(cmd, existing) {
    await this.plugin.storage.commands.save(cmd);
    if (existing && existing.name !== cmd.name) {
      await this.plugin.storage.commands.delete(existing.id);
    }
    await this.reloadCommands();
    this.render();
    new import_obsidian19.Notice(`Slash command "/${cmd.name}" ${existing ? "updated" : "created"}`);
  }
  async deleteCommand(cmd) {
    await this.plugin.storage.commands.delete(cmd.id);
    await this.reloadCommands();
    this.render();
    new import_obsidian19.Notice(`Slash command "/${cmd.name}" deleted`);
  }
  /** Reload commands from storage and update in-memory settings. */
  async reloadCommands() {
    const commands = await this.plugin.storage.commands.loadAll();
    this.plugin.settings.slashCommands = commands;
  }
  exportCommands() {
    const commands = this.plugin.settings.slashCommands;
    if (commands.length === 0) {
      new import_obsidian19.Notice("No slash commands to export");
      return;
    }
    const json = JSON.stringify(commands, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ocop-slash-commands.json";
    a.click();
    URL.revokeObjectURL(url);
    new import_obsidian19.Notice(`Exported ${commands.length} slash command(s)`);
  }
  importCommands() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.addEventListener("change", async (e) => {
      var _a;
      const file = (_a = e.target.files) == null ? void 0 : _a[0];
      if (!file) return;
      try {
        const text = await file.text();
        const commands = JSON.parse(text);
        if (!Array.isArray(commands)) {
          throw new Error("Invalid format: expected an array");
        }
        const existingCommands = await this.plugin.storage.commands.loadAll();
        const existingNames = new Set(existingCommands.map((c) => c.name.toLowerCase()));
        let imported = 0;
        for (const cmd of commands) {
          if (!cmd.name || !cmd.content) {
            continue;
          }
          if (typeof cmd.name !== "string" || typeof cmd.content !== "string") {
            continue;
          }
          if (!/^[a-zA-Z0-9_/-]+$/.test(cmd.name)) {
            continue;
          }
          cmd.id = `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
          if (cmd.allowedTools && !Array.isArray(cmd.allowedTools)) {
            cmd.allowedTools = void 0;
          }
          if (Array.isArray(cmd.allowedTools)) {
            cmd.allowedTools = cmd.allowedTools.filter((t) => typeof t === "string" && t.trim().length > 0);
            if (cmd.allowedTools.length === 0) {
              cmd.allowedTools = void 0;
            }
          }
          if (cmd.description && typeof cmd.description !== "string") {
            cmd.description = void 0;
          }
          if (cmd.argumentHint && typeof cmd.argumentHint !== "string") {
            cmd.argumentHint = void 0;
          }
          if (cmd.model && typeof cmd.model !== "string") {
            cmd.model = void 0;
          }
          const parsed = parseSlashCommandContent(cmd.content);
          cmd.description = cmd.description || parsed.description;
          cmd.argumentHint = cmd.argumentHint || parsed.argumentHint;
          cmd.model = cmd.model || parsed.model;
          cmd.allowedTools = cmd.allowedTools || parsed.allowedTools;
          cmd.content = parsed.promptContent;
          if (existingNames.has(cmd.name.toLowerCase())) {
            continue;
          }
          await this.plugin.storage.commands.save(cmd);
          existingNames.add(cmd.name.toLowerCase());
          imported++;
        }
        await this.reloadCommands();
        this.render();
        new import_obsidian19.Notice(`Imported ${imported} slash command(s)`);
      } catch (e2) {
        new import_obsidian19.Notice("Failed to import slash commands. Check file format.");
      }
    });
    input.click();
  }
  refresh() {
    this.render();
  }
};

// src/ui/components/MentionHighlighter.ts
var MentionHighlighter = class {
  constructor(wrapper, input) {
    this.wrapper = wrapper;
    this.input = input;
    this.onInput = () => this.refresh();
    this.onScroll = () => this.syncScroll();
    this.valuePatched = false;
    this.backdrop = wrapper.createDiv({ cls: "ocop-mention-backdrop" });
    wrapper.insertBefore(this.backdrop, input);
    input.addClass("ocop-input-highlighted");
    input.addEventListener("input", this.onInput);
    input.addEventListener("scroll", this.onScroll);
    this.watchProgrammaticWrites();
    this.refresh();
  }
  /**
   * Setting `.value` in code fires no 'input' event, and roughly a dozen call
   * sites do exactly that — sending, clearing, restoring a draft, accepting a
   * mention from the dropdown. Rather than asking every one of them to
   * remember a refresh, the instance's own accessor is wrapped so the backdrop
   * follows the value wherever it is set from.
   */
  watchProgrammaticWrites() {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(this.input),
      "value"
    );
    if (!(descriptor == null ? void 0 : descriptor.get) || !(descriptor == null ? void 0 : descriptor.set)) return;
    const { get, set } = descriptor;
    Object.defineProperty(this.input, "value", {
      configurable: true,
      enumerable: true,
      get: () => get.call(this.input),
      set: (next) => {
        set.call(this.input, next);
        this.refresh();
      }
    });
    this.valuePatched = true;
  }
  /** Rebuild the backdrop. Call after setting `input.value` in code. */
  refresh() {
    this.backdrop.empty();
    for (const segment of buildMentionSegments(this.input.value)) {
      if (segment.isMention) {
        this.backdrop.createSpan({ cls: "ocop-mention-inline", text: segment.text });
      } else {
        this.backdrop.createSpan({ text: segment.text });
      }
    }
    this.syncScroll();
  }
  syncScroll() {
    this.backdrop.scrollTop = this.input.scrollTop;
    this.backdrop.scrollLeft = this.input.scrollLeft;
  }
  destroy() {
    this.input.removeEventListener("input", this.onInput);
    this.input.removeEventListener("scroll", this.onScroll);
    if (this.valuePatched) delete this.input.value;
    this.backdrop.remove();
  }
};

// src/features/chat/ObsidianCopilotView.ts
init_path();

// src/features/chat/controllers/ConversationController.ts
var import_obsidian20 = require("obsidian");
var ConversationController = class {
  constructor(deps, callbacks = {}) {
    this.deps = deps;
    this.callbacks = callbacks;
  }
  dismissActiveQuizAnswerPanel() {
    const container = this.deps.getMessagesEl().parentElement;
    if (container) {
      dismissQuizAnswerPanel(container);
    }
  }
  // ============================================
  // Conversation Lifecycle
  // ============================================
  /** Creates a new conversation, or switches to an existing empty one. */
  async createNew() {
    var _a, _b, _c, _d, _e, _f;
    const { plugin, state, asyncSubagentManager } = this.deps;
    if (state.isStreaming) return;
    if (state.messages.length > 0) {
      await this.save();
    }
    asyncSubagentManager.orphanAllActive();
    state.asyncSubagentStates.clear();
    const emptyConv = plugin.findEmptyConversation();
    const conversation = emptyConv ? (_a = await plugin.switchConversation(emptyConv.id)) != null ? _a : await plugin.createConversation() : await plugin.createConversation();
    if (!conversation) {
      console.error("[ObsidianCopilot] Failed to create or switch conversation");
      return;
    }
    state.currentConversationId = conversation.id;
    state.clearMessages();
    state.usage = null;
    state.currentTodos = null;
    this.deps.setApprovedPlan(null);
    this.deps.hidePlanBanner();
    state.pendingPlanContent = null;
    this.restorePlanModeState();
    const messagesEl = this.deps.getMessagesEl();
    messagesEl.empty();
    (_b = this.deps.getTodoPanel()) == null ? void 0 : _b.remount();
    const rendererWithWelcome = this.deps.renderer;
    const welcomeEl = typeof rendererWithWelcome.createWelcomeElement === "function" ? rendererWithWelcome.createWelcomeElement(this.getGreeting()) : messagesEl.createDiv({ cls: "ocop-welcome" });
    if (!welcomeEl.querySelector(".ocop-welcome-greeting")) {
      welcomeEl.createDiv({ cls: "ocop-welcome-greeting", text: this.getGreeting() });
    }
    this.deps.setWelcomeEl(welcomeEl);
    this.deps.getInputEl().value = "";
    const fileCtx = this.deps.getFileContextManager();
    fileCtx == null ? void 0 : fileCtx.resetForNewConversation();
    fileCtx == null ? void 0 : fileCtx.autoAttachActiveFile();
    (_c = this.deps.getImageContextManager()) == null ? void 0 : _c.clearImages();
    (_d = this.deps.getExternalContextSelector()) == null ? void 0 : _d.clearExternalContexts();
    this.deps.clearQueuedMessage();
    state.quizSession = null;
    state.socraticSession = null;
    this.dismissActiveQuizAnswerPanel();
    (_f = (_e = this.callbacks).onNewConversation) == null ? void 0 : _f.call(_e);
  }
  /** Loads the active conversation or creates a new one. */
  async loadActive() {
    var _a, _b, _c, _d, _e, _f;
    const { plugin, state, renderer } = this.deps;
    let conversation = plugin.getActiveConversation();
    const isNewConversation = !conversation;
    if (!conversation) {
      conversation = await plugin.createConversation();
    }
    state.currentConversationId = conversation.id;
    state.messages = [...conversation.messages];
    state.usage = (_a = conversation.usage) != null ? _a : null;
    plugin.agentService.setSessionId(conversation.sessionId);
    if (conversation.approvedPlan) {
      this.deps.setApprovedPlan(conversation.approvedPlan);
      this.deps.showPlanBanner(conversation.approvedPlan);
    } else {
      this.deps.setApprovedPlan(null);
      this.deps.hidePlanBanner();
    }
    state.pendingPlanContent = (_b = conversation.pendingPlanContent) != null ? _b : null;
    this.restorePlanModeState();
    state.quizSession = (_c = conversation.quizSession) != null ? _c : null;
    state.socraticSession = (_d = conversation.socraticSession) != null ? _d : null;
    this.dismissActiveQuizAnswerPanel();
    const hasMessages = state.messages.length > 0;
    const fileCtx = this.deps.getFileContextManager();
    fileCtx == null ? void 0 : fileCtx.resetForLoadedConversation(hasMessages);
    if (conversation.currentNote) {
      fileCtx == null ? void 0 : fileCtx.setCurrentNote(conversation.currentNote);
    } else if (isNewConversation || !hasMessages) {
      fileCtx == null ? void 0 : fileCtx.autoAttachActiveFile();
    }
    const externalContextSelector = this.deps.getExternalContextSelector();
    if (conversation.externalContextPaths && conversation.externalContextPaths.length > 0) {
      externalContextSelector == null ? void 0 : externalContextSelector.setExternalContexts(conversation.externalContextPaths);
    } else {
      externalContextSelector == null ? void 0 : externalContextSelector.clearExternalContexts();
    }
    const welcomeEl = renderer.renderMessages(
      state.messages,
      () => this.getGreeting()
    );
    this.deps.setWelcomeEl(welcomeEl);
    this.updateWelcomeVisibility();
    state.currentTodos = extractLastTodosFromMessages(state.messages);
    (_f = (_e = this.callbacks).onConversationLoaded) == null ? void 0 : _f.call(_e);
    if (conversation.pendingPlanContent && !conversation.approvedPlan) {
      this.deps.triggerPendingPlanApproval(conversation.pendingPlanContent);
    }
  }
  /** Switches to a different conversation. */
  async switchTo(id) {
    var _a, _b, _c, _d, _e, _f, _g;
    const { plugin, state, renderer, asyncSubagentManager } = this.deps;
    if (id === state.currentConversationId) return;
    if (state.isStreaming) return;
    await this.save();
    asyncSubagentManager.orphanAllActive();
    state.asyncSubagentStates.clear();
    const conversation = await plugin.switchConversation(id);
    if (!conversation) return;
    state.currentConversationId = conversation.id;
    state.messages = [...conversation.messages];
    state.usage = (_a = conversation.usage) != null ? _a : null;
    if (conversation.approvedPlan) {
      this.deps.setApprovedPlan(conversation.approvedPlan);
      this.deps.showPlanBanner(conversation.approvedPlan);
    } else {
      this.deps.setApprovedPlan(null);
      this.deps.hidePlanBanner();
    }
    state.pendingPlanContent = (_b = conversation.pendingPlanContent) != null ? _b : null;
    this.restorePlanModeState();
    state.quizSession = (_c = conversation.quizSession) != null ? _c : null;
    state.socraticSession = (_d = conversation.socraticSession) != null ? _d : null;
    this.dismissActiveQuizAnswerPanel();
    this.deps.getInputEl().value = "";
    this.deps.clearQueuedMessage();
    const fileCtx = this.deps.getFileContextManager();
    fileCtx == null ? void 0 : fileCtx.resetForLoadedConversation(state.messages.length > 0);
    if (conversation.currentNote) {
      fileCtx == null ? void 0 : fileCtx.setCurrentNote(conversation.currentNote);
    }
    const externalContextSelector = this.deps.getExternalContextSelector();
    if (conversation.externalContextPaths && conversation.externalContextPaths.length > 0) {
      externalContextSelector == null ? void 0 : externalContextSelector.setExternalContexts(conversation.externalContextPaths);
    } else {
      externalContextSelector == null ? void 0 : externalContextSelector.clearExternalContexts();
    }
    const welcomeEl = renderer.renderMessages(
      state.messages,
      () => this.getGreeting()
    );
    this.deps.setWelcomeEl(welcomeEl);
    state.currentTodos = extractLastTodosFromMessages(state.messages);
    (_e = this.deps.getHistoryDropdown()) == null ? void 0 : _e.removeClass("visible");
    this.updateWelcomeVisibility();
    (_g = (_f = this.callbacks).onConversationSwitched) == null ? void 0 : _g.call(_f);
    if (conversation.pendingPlanContent && !conversation.approvedPlan) {
      this.deps.triggerPendingPlanApproval(conversation.pendingPlanContent);
    }
  }
  /** Saves the current conversation. */
  async save(updateLastResponse = false) {
    var _a, _b, _c, _d, _e, _f, _g;
    const { plugin, state } = this.deps;
    if (!state.currentConversationId) return;
    const sessionId = plugin.agentService.getSessionId();
    const fileCtx = this.deps.getFileContextManager();
    const currentNote = (fileCtx == null ? void 0 : fileCtx.getCurrentNotePath()) || void 0;
    const externalContextSelector = this.deps.getExternalContextSelector();
    const externalContextPaths = (_a = externalContextSelector == null ? void 0 : externalContextSelector.getExternalContexts()) != null ? _a : [];
    const approvedPlan = this.deps.getApprovedPlan();
    const updates = {
      messages: state.getPersistedMessages(),
      sessionId,
      currentNote,
      externalContextPaths: externalContextPaths.length > 0 ? externalContextPaths : void 0,
      usage: (_b = state.usage) != null ? _b : void 0,
      approvedPlan: approvedPlan != null ? approvedPlan : void 0,
      pendingPlanContent: (_c = state.pendingPlanContent) != null ? _c : void 0,
      isInPlanMode: (_e = (_d = state.planModeState) == null ? void 0 : _d.isActive) != null ? _e : void 0,
      quizSession: (_f = state.quizSession) != null ? _f : void 0,
      socraticSession: (_g = state.socraticSession) != null ? _g : void 0
    };
    if (updateLastResponse) {
      updates.lastResponseAt = Date.now();
    }
    await plugin.updateConversation(state.currentConversationId, updates);
  }
  /**
   * Restores plan mode state based on current permission mode.
   * Resets transient flags and sets up planModeState appropriately.
   */
  restorePlanModeState() {
    var _a, _b;
    const { plugin, state } = this.deps;
    state.planModeRequested = false;
    state.planModeActivationPending = false;
    const isPlanMode = plugin.settings.permissionMode === "plan";
    if (isPlanMode) {
      const wasAgentInitiated = (_b = (_a = state.planModeState) == null ? void 0 : _a.agentInitiated) != null ? _b : false;
      state.planModeState = {
        isActive: true,
        planFilePath: null,
        planContent: null,
        originalQuery: null,
        agentInitiated: wasAgentInitiated
      };
    } else {
      state.resetPlanModeState();
    }
    this.deps.setPlanModeActive(isPlanMode);
  }
  // ============================================
  // History Dropdown
  // ============================================
  /** Toggles the history dropdown visibility. */
  toggleHistoryDropdown() {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;
    const isVisible = dropdown.hasClass("visible");
    if (isVisible) {
      dropdown.removeClass("visible");
    } else {
      this.updateHistoryDropdown();
      dropdown.addClass("visible");
    }
  }
  /** Updates the history dropdown content. */
  updateHistoryDropdown() {
    var _a;
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;
    const { plugin, state } = this.deps;
    dropdown.empty();
    const dropdownHeader = dropdown.createDiv({ cls: "ocop-history-header" });
    dropdownHeader.createSpan({ text: "Conversations" });
    const list = dropdown.createDiv({ cls: "ocop-history-list" });
    const allConversations = plugin.getConversationList();
    if (allConversations.length === 0) {
      list.createDiv({ cls: "ocop-history-empty", text: "No conversations" });
      return;
    }
    const conversations = [...allConversations].sort((a, b) => {
      var _a2, _b;
      return ((_a2 = b.lastResponseAt) != null ? _a2 : b.createdAt) - ((_b = a.lastResponseAt) != null ? _b : a.createdAt);
    });
    for (const conv of conversations) {
      const isCurrent = conv.id === state.currentConversationId;
      const item = list.createDiv({
        cls: `ocop-history-item${isCurrent ? " active" : ""}`
      });
      const iconEl = item.createDiv({ cls: "ocop-history-item-icon" });
      (0, import_obsidian20.setIcon)(iconEl, isCurrent ? "message-square-dot" : "message-square");
      const content = item.createDiv({ cls: "ocop-history-item-content" });
      const titleEl = content.createDiv({ cls: "ocop-history-item-title", text: conv.title });
      titleEl.setAttribute("title", conv.title);
      content.createDiv({
        cls: "ocop-history-item-date",
        text: isCurrent ? "Current session" : this.formatDate((_a = conv.lastResponseAt) != null ? _a : conv.createdAt)
      });
      if (!isCurrent) {
        content.addEventListener("click", async (e) => {
          e.stopPropagation();
          await this.switchTo(conv.id);
        });
      }
      const actions = item.createDiv({ cls: "ocop-history-item-actions" });
      if (conv.titleGenerationStatus === "pending") {
        const loadingEl = actions.createEl("span", { cls: "ocop-action-btn ocop-action-loading" });
        (0, import_obsidian20.setIcon)(loadingEl, "loader-2");
        loadingEl.setAttribute("aria-label", "Generating title...");
      } else if (conv.titleGenerationStatus === "failed") {
        const regenerateBtn = actions.createEl("button", { cls: "ocop-action-btn" });
        (0, import_obsidian20.setIcon)(regenerateBtn, "refresh-cw");
        regenerateBtn.setAttribute("aria-label", "Regenerate title");
        regenerateBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            await this.regenerateTitle(conv.id);
          } catch (error) {
            console.error("[ConversationController] Failed to regenerate title:", error);
          }
        });
      }
      const renameBtn = actions.createEl("button", { cls: "ocop-action-btn" });
      (0, import_obsidian20.setIcon)(renameBtn, "pencil");
      renameBtn.setAttribute("aria-label", "Rename");
      renameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showRenameInput(item, conv.id, conv.title);
      });
      const deleteBtn = actions.createEl("button", { cls: "ocop-action-btn ocop-delete-btn" });
      (0, import_obsidian20.setIcon)(deleteBtn, "trash-2");
      deleteBtn.setAttribute("aria-label", "Delete");
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (state.isStreaming) return;
        await plugin.deleteConversation(conv.id);
        this.updateHistoryDropdown();
        if (conv.id === state.currentConversationId) {
          await this.loadActive();
        }
      });
    }
  }
  /** Shows inline rename input for a conversation. */
  showRenameInput(item, convId, currentTitle) {
    const titleEl = item.querySelector(".ocop-history-item-title");
    if (!titleEl) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ocop-rename-input";
    input.value = currentTitle;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    const finishRename = async () => {
      const newTitle = input.value.trim() || currentTitle;
      await this.deps.plugin.renameConversation(convId, newTitle);
      this.updateHistoryDropdown();
    };
    input.addEventListener("blur", finishRename);
    input.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        input.blur();
      } else if (e.key === "Escape") {
        input.value = currentTitle;
        input.blur();
      }
    });
  }
  // ============================================
  // Welcome & Greeting
  // ============================================
  getGreeting() {
    var _a;
    const name = (_a = this.deps.plugin.settings.userName) == null ? void 0 : _a.trim();
    return name ? `${name}\uB2D8, \uC900\uBE44\uB410\uC5B4\uC694.` : "\uC900\uBE44\uB410\uC5B4\uC694.";
  }
  /** Updates welcome element visibility based on message count. */
  updateWelcomeVisibility() {
    const welcomeEl = this.deps.getWelcomeEl();
    if (!welcomeEl) return;
    if (this.deps.state.messages.length === 0) {
      welcomeEl.style.display = "";
    } else {
      welcomeEl.style.display = "none";
    }
  }
  // ============================================
  // Utilities
  // ============================================
  /** Generates a fallback title from the first message (used when AI fails). */
  generateFallbackTitle(firstMessage) {
    const firstSentence = firstMessage.split(/[.!?\n]/)[0].trim();
    const autoTitle = firstSentence.substring(0, 50);
    const suffix = firstSentence.length > 50 ? "..." : "";
    return `${autoTitle}${suffix}`;
  }
  /** Regenerates AI title for a conversation. */
  async regenerateTitle(conversationId) {
    var _a;
    const { plugin } = this.deps;
    if (!plugin.settings.enableAutoTitleGeneration) return;
    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) return;
    const fullConv = plugin.getConversationById(conversationId);
    if (!fullConv || fullConv.messages.length < 2) return;
    const firstUserMsg = fullConv.messages.find((m) => m.role === "user");
    const firstAssistantMsg = fullConv.messages.find((m) => m.role === "assistant");
    if (!firstUserMsg || !firstAssistantMsg) return;
    const userContent = firstUserMsg.displayContent || firstUserMsg.content;
    const assistantText = firstAssistantMsg.content || ((_a = firstAssistantMsg.contentBlocks) == null ? void 0 : _a.filter((b) => b.type === "text").map((b) => b.content).join("\n")) || "";
    if (!assistantText) return;
    const isPlan = fullConv.title.startsWith("[Plan]");
    const expectedTitle = fullConv.title;
    await plugin.updateConversation(conversationId, { titleGenerationStatus: "pending" });
    this.updateHistoryDropdown();
    await titleService.generateTitle(
      conversationId,
      userContent,
      assistantText,
      async (convId, result) => {
        const currentConv = plugin.getConversationById(convId);
        if (!currentConv) return;
        const userManuallyRenamed = currentConv.title !== expectedTitle;
        if (result.success && result.title && !userManuallyRenamed) {
          const newTitle = isPlan ? `[Plan] ${result.title}` : result.title;
          await plugin.renameConversation(convId, newTitle);
          await plugin.updateConversation(convId, { titleGenerationStatus: "success" });
        } else if (!userManuallyRenamed) {
          await plugin.updateConversation(convId, { titleGenerationStatus: "failed" });
        } else {
          await plugin.updateConversation(convId, { titleGenerationStatus: void 0 });
        }
        this.updateHistoryDropdown();
      }
    );
  }
  /** Formats a timestamp for display. */
  formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = /* @__PURE__ */ new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    return date.toLocaleDateString(void 0, { month: "short", day: "numeric" });
  }
};

// src/features/chat/controllers/InputController.ts
var import_obsidian21 = require("obsidian");

// src/utils/editor.ts
function findNearestNonEmptyLine(getLine, lineCount, startLine, direction) {
  const step = direction === "before" ? -1 : 1;
  for (let i = startLine + step; i >= 0 && i < lineCount; i += step) {
    const content = getLine(i);
    if (content.trim().length > 0) {
      return content;
    }
  }
  return "";
}
function buildCursorContext(getLine, lineCount, line, column) {
  const lineContent = getLine(line);
  const beforeCursor = lineContent.substring(0, column);
  const afterCursor = lineContent.substring(column);
  const lineIsEmpty = lineContent.trim().length === 0;
  const nothingBefore = beforeCursor.trim().length === 0;
  const nothingAfter = afterCursor.trim().length === 0;
  const isInbetween = lineIsEmpty || nothingBefore && nothingAfter;
  let contextBefore = beforeCursor;
  let contextAfter = afterCursor;
  if (isInbetween) {
    contextBefore = findNearestNonEmptyLine(getLine, lineCount, line, "before");
    contextAfter = findNearestNonEmptyLine(getLine, lineCount, line, "after");
  }
  return { beforeCursor: contextBefore, afterCursor: contextAfter, isInbetween, line, column };
}
function formatEditorContext(context) {
  if (context.mode === "selection" && context.selectedText) {
    const lineAttr = context.startLine && context.lineCount ? ` lines="${context.startLine}-${context.startLine + context.lineCount - 1}"` : "";
    return `<editor_selection path="${context.notePath}"${lineAttr}>
${context.selectedText}
</editor_selection>`;
  } else if (context.mode === "cursor" && context.cursorContext) {
    const ctx = context.cursorContext;
    let content;
    if (ctx.isInbetween) {
      const parts = [];
      if (ctx.beforeCursor) parts.push(ctx.beforeCursor);
      parts.push("| #inbetween");
      if (ctx.afterCursor) parts.push(ctx.afterCursor);
      content = parts.join("\n");
    } else {
      content = `${ctx.beforeCursor}|${ctx.afterCursor} #inline`;
    }
    return `<editor_cursor path="${context.notePath}">
${content}
</editor_cursor>`;
  }
  return "";
}
function prependEditorContext(prompt, context) {
  const formatted = formatEditorContext(context);
  return formatted ? `${formatted}

${prompt}` : prompt;
}

// src/utils/markdown.ts
function appendMarkdownSnippet(existingPrompt, snippet) {
  const trimmedSnippet = snippet.trim();
  if (!trimmedSnippet) {
    return existingPrompt;
  }
  if (!existingPrompt.trim()) {
    return trimmedSnippet;
  }
  const separator = existingPrompt.endsWith("\n\n") ? "" : existingPrompt.endsWith("\n") ? "\n" : "\n\n";
  return existingPrompt + separator + trimmedSnippet;
}

// src/features/chat/controllers/InputController.ts
var PLAN_MODE_REQUEST_PREFIX = "User requested plan mode. Call EnterPlanMode before responding.";
var CURRENT_NOTE_ONLY_PATTERNS = [
  /현재\s*노트/u,
  /이\s*노트/u,
  /current\s+note/i,
  /this\s+note/i,
  /summari[sz]e.*note/i,
  /what(?:'s| is).*note/i
];
var InputController = class {
  constructor(deps) {
    this.deps = deps;
  }
  dismissActiveQuizAnswerPanel() {
    const quizContainerEl = this.deps.getMessagesEl().parentElement;
    if (quizContainerEl) {
      dismissQuizAnswerPanel(quizContainerEl);
    }
  }
  exitQuizMode() {
    this.deps.state.quizSession = null;
    this.dismissActiveQuizAnswerPanel();
  }
  exitSocraticMode() {
    var _a, _b;
    this.deps.state.socraticSession = null;
    (_b = (_a = this.deps).hideSocraticBanner) == null ? void 0 : _b.call(_a);
  }
  /** Quiz 힌트 shortcut (PRD §8.2): asks for one hint without grading or advancing. */
  requestQuizHint() {
    const { state } = this.deps;
    if (state.isStreaming || !state.quizSession) return;
    void this.sendMessage({ content: "\uD78C\uD2B8 \uC8FC\uC138\uC694", quizHintRequest: true });
  }
  /** Socratic 힌트/모르겠어요 shortcuts (PRD §9.1): plain STUCK_PATTERNS-recognized text. */
  sendSocraticShortcut(content) {
    if (!this.deps.state.socraticSession) return;
    void this.sendMessage({ content });
  }
  enableQuizExternalTools() {
    var _a, _b;
    (_b = (_a = this.deps.getWebSearchToggle()) == null ? void 0 : _a.setEnabled) == null ? void 0 : _b.call(_a, true);
  }
  getLatestQuizQuestionContext(currentQuestion, totalQuestions) {
    var _a;
    for (let i = this.deps.state.messages.length - 1; i >= 0; i -= 1) {
      const msg = this.deps.state.messages[i];
      if (msg.role !== "assistant" || !msg.quizQuestion) {
        continue;
      }
      const questionNumber = msg.quizQuestion.current;
      const matchesActiveQuestion = questionNumber === currentQuestion || questionNumber === currentQuestion - 1;
      if (!matchesActiveQuestion || msg.quizQuestion.total !== totalQuestions) {
        continue;
      }
      const questionHeaderPattern = new RegExp(`^##\\s*${questionNumber}\\s*/\\s*${totalQuestions}\uBC88 \uBB38\uC81C`, "im");
      const textBlock = [...(_a = msg.contentBlocks) != null ? _a : []].reverse().find(
        (block) => block.type === "text" && questionHeaderPattern.test(block.content)
      );
      if (!textBlock) {
        return void 0;
      }
      return {
        questionNumber,
        totalQuestions,
        questionText: this.extractQuizQuestionBlock(textBlock.content, questionNumber, totalQuestions)
      };
    }
    return void 0;
  }
  extractQuizQuestionBlock(content, questionNumber, totalQuestions) {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const headerPattern = new RegExp(`^##\\s*${questionNumber}\\s*/\\s*${totalQuestions}\uBC88 \uBB38\uC81C`, "i");
    const startIndex = lines.findIndex((line) => headerPattern.test(line.trim()));
    if (startIndex === -1) {
      return content.trim();
    }
    const nextHeaderIndex = lines.findIndex(
      (line, index) => index > startIndex && /^##\s*\d+\s*\/\s*\d+번 문제/i.test(line.trim())
    );
    const questionLines = nextHeaderIndex === -1 ? lines.slice(startIndex) : lines.slice(startIndex, nextHeaderIndex);
    return questionLines.join("\n").trim();
  }
  inferQuizSessionInit(displayContent) {
    const parsed = parseQuizDisplayContent(displayContent);
    if (!parsed) {
      return void 0;
    }
    return {
      totalQuestions: parsed.totalQuestions,
      scopeLabel: displayContent != null ? displayContent : "/quiz",
      focusText: parsed.focusText
    };
  }
  // ============================================
  // Message Sending
  // ============================================
  /** Sends a message with optional editor context override. */
  async sendMessage(options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
    const { plugin, state, renderer, streamController, selectionController, conversationController } = this.deps;
    const conversationIdAtSend = state.currentConversationId;
    const inputEl = this.deps.getInputEl();
    const imageContextManager = this.deps.getImageContextManager();
    const fileContextManager = this.deps.getFileContextManager();
    const slashCommandManager = this.deps.getSlashCommandManager();
    const contentOverride = options == null ? void 0 : options.content;
    const shouldUseInput = contentOverride === void 0;
    let content = (contentOverride != null ? contentOverride : inputEl.value).trim();
    const hasImages = (_a = imageContextManager == null ? void 0 : imageContextManager.hasImages()) != null ? _a : false;
    if (!content && !hasImages) return;
    if (content === "/quiz" || content.startsWith("/quiz ")) {
      const quizFocusText = content === "/quiz" ? "" : content.slice("/quiz".length).trim();
      const quizModal = new QuizSetupModal(plugin.app, (fileContextManager == null ? void 0 : fileContextManager.getCurrentNotePath()) || null, quizFocusText);
      const quizResult = await quizModal.openAndWait();
      if (!quizResult) {
        return;
      }
      if (quizResult.enableExternalTools) {
        this.enableQuizExternalTools();
      }
      if (shouldUseInput) {
        inputEl.value = "";
      }
      await this.sendMessage({
        content: quizResult.prompt,
        displayContentOverride: quizResult.displayContent,
        promptPrefix: options == null ? void 0 : options.promptPrefix,
        hidden: options == null ? void 0 : options.hidden,
        editorContextOverride: options == null ? void 0 : options.editorContextOverride,
        quizSessionInit: {
          totalQuestions: quizResult.totalQuestions,
          scopeLabel: quizResult.displayContent,
          focusText: quizResult.focusText,
          difficulty: quizResult.difficulty,
          sourceInstruction: quizResult.sourceInstruction
        }
      });
      return;
    }
    if (content === "/socratic" || content.startsWith("/socratic ")) {
      const socraticFocusText = content === "/socratic" ? "" : content.slice("/socratic".length).trim();
      const socraticModal = new SocraticSetupModal(plugin.app, (fileContextManager == null ? void 0 : fileContextManager.getCurrentNotePath()) || null, socraticFocusText);
      const socraticResult = await socraticModal.openAndWait();
      if (!socraticResult) {
        return;
      }
      if (shouldUseInput) {
        inputEl.value = "";
      }
      await this.sendMessage({
        content: socraticResult.prompt,
        displayContentOverride: socraticResult.displayContent,
        promptPrefix: options == null ? void 0 : options.promptPrefix,
        hidden: options == null ? void 0 : options.hidden,
        editorContextOverride: options == null ? void 0 : options.editorContextOverride,
        socraticSessionInit: {
          scopeLabel: socraticResult.displayContent,
          focusText: socraticResult.focusText,
          sourceInstruction: socraticResult.sourceInstruction
        }
      });
      return;
    }
    if (state.isStreaming) {
      const images2 = hasImages ? [...(imageContextManager == null ? void 0 : imageContextManager.getAttachedImages()) || []] : void 0;
      const editorContext2 = selectionController.getContext();
      const promptPrefix = options == null ? void 0 : options.promptPrefix;
      if (state.queuedMessage) {
        state.queuedMessage.content += "\n\n" + content;
        if (images2 && images2.length > 0) {
          state.queuedMessage.images = [...state.queuedMessage.images || [], ...images2];
        }
        state.queuedMessage.editorContext = editorContext2;
        state.queuedMessage.hidden = state.queuedMessage.hidden || (options == null ? void 0 : options.hidden);
        if (promptPrefix) {
          state.queuedMessage.promptPrefix = (_b = state.queuedMessage.promptPrefix) != null ? _b : promptPrefix;
        }
      } else {
        state.queuedMessage = {
          content,
          images: images2,
          editorContext: editorContext2,
          hidden: options == null ? void 0 : options.hidden,
          promptPrefix
        };
      }
      if (shouldUseInput) {
        inputEl.value = "";
      }
      imageContextManager == null ? void 0 : imageContextManager.clearImages();
      this.updateQueueIndicator();
      return;
    }
    if (shouldUseInput) {
      inputEl.value = "";
    }
    const quizSessionInit = (_c = options == null ? void 0 : options.quizSessionInit) != null ? _c : this.inferQuizSessionInit(options == null ? void 0 : options.displayContentOverride);
    const socraticSessionInit = options == null ? void 0 : options.socraticSessionInit;
    if (quizSessionInit) {
      this.exitQuizMode();
      this.exitSocraticMode();
      state.quizSession = {
        totalQuestions: quizSessionInit.totalQuestions,
        currentQuestion: 1,
        scopeLabel: quizSessionInit.scopeLabel,
        focusText: quizSessionInit.focusText,
        difficulty: quizSessionInit.difficulty,
        sourceInstruction: quizSessionInit.sourceInstruction
      };
    }
    if (socraticSessionInit) {
      this.exitQuizMode();
      this.exitSocraticMode();
      state.socraticSession = {
        maxDepth: 20,
        currentDepth: 1,
        scopeLabel: socraticSessionInit.scopeLabel,
        focusText: socraticSessionInit.focusText,
        sourceInstruction: socraticSessionInit.sourceInstruction,
        supportLevel: 1,
        isSummaryPhase: false
      };
      (_e = (_d = this.deps).showSocraticBanner) == null ? void 0 : _e.call(
        _d,
        socraticSessionInit.scopeLabel,
        socraticSessionInit.focusText,
        () => this.sendSocraticShortcut("\uD78C\uD2B8 \uC8FC\uC138\uC694"),
        () => this.sendSocraticShortcut("\uBAA8\uB974\uACA0\uC5B4\uC694. \uC870\uAE08 \uB354 \uC124\uBA85\uD574 \uC8FC\uC138\uC694.")
      );
    }
    state.isStreaming = true;
    state.cancelRequested = false;
    state.ignoreUsageUpdates = false;
    state.subagentsSpawnedThisStream = 0;
    const welcomeEl = this.deps.getWelcomeEl();
    if (welcomeEl) {
      welcomeEl.style.display = "none";
    }
    fileContextManager == null ? void 0 : fileContextManager.startSession();
    const images = (imageContextManager == null ? void 0 : imageContextManager.getAttachedImages()) || [];
    const imagesForMessage = images.length > 0 ? [...images] : void 0;
    const userMsg = {
      id: this.deps.generateId(),
      role: "user",
      content,
      displayContent: options == null ? void 0 : options.displayContentOverride,
      timestamp: Date.now(),
      images: imagesForMessage,
      hidden: options == null ? void 0 : options.hidden
    };
    state.addMessage(userMsg);
    if (!(options == null ? void 0 : options.hidden)) {
      renderer.addMessage(userMsg);
    }
    const assistantMsg = {
      id: this.deps.generateId(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: []
    };
    state.addMessage(assistantMsg);
    const msgEl = renderer.addMessage(assistantMsg);
    const contentEl = msgEl.querySelector(".ocop-message-content");
    state.toolCallElements.clear();
    state.currentContentEl = contentEl;
    state.currentTextEl = null;
    state.currentTextContent = "";
    streamController.showThinkingIndicator(contentEl);
    const currentNotePath = (fileContextManager == null ? void 0 : fileContextManager.getCurrentNotePath()) || null;
    const shouldSendCurrentNote = (_f = fileContextManager == null ? void 0 : fileContextManager.shouldSendCurrentNote(currentNotePath)) != null ? _f : false;
    const shouldForceCurrentNoteScope = this.shouldUseCurrentNoteOnlyScope(content);
    const currentNoteContentPromise = shouldSendCurrentNote && currentNotePath && shouldForceCurrentNoteScope ? this.readCurrentNoteContent(currentNotePath) : Promise.resolve(null);
    const displayContent = content;
    let queryOptions;
    if (content && slashCommandManager) {
      slashCommandManager.setCommands(plugin.settings.slashCommands);
      const detected = slashCommandManager.detectCommand(content);
      if (detected) {
        const cmd = plugin.settings.slashCommands.find(
          (c) => c.name.toLowerCase() === detected.commandName.toLowerCase()
        );
        if (cmd) {
          const result = await slashCommandManager.expandCommand(cmd, detected.args, {
            bash: {
              enabled: plugin.settings.enableInlineBash,
              shouldBlockCommand: (bashCommand) => isCommandBlocked(
                bashCommand,
                getBashToolBlockedCommands(plugin.settings.blockedCommands),
                plugin.settings.enableBlocklist
              ),
              requestApproval: plugin.settings.permissionMode !== "agent" ? (bashCommand) => this.requestInlineBashApproval(bashCommand) : void 0
            }
          });
          content = result.expandedPrompt;
          if (result.errors.length > 0) {
            new import_obsidian21.Notice(formatSlashCommandWarnings(result.errors));
          }
          if (result.allowedTools || result.model) {
            queryOptions = {
              allowedTools: result.allowedTools,
              model: result.model
            };
          }
        }
      }
    }
    if (shouldUseInput) {
      imageContextManager == null ? void 0 : imageContextManager.clearImages();
    }
    const editorContextOverride = options == null ? void 0 : options.editorContextOverride;
    const editorContext = editorContextOverride !== void 0 ? editorContextOverride : selectionController.getContext();
    let promptToSend = `<query>
${content}
</query>`;
    let currentNoteForMessage;
    if (editorContext) {
      promptToSend = prependEditorContext(promptToSend, editorContext);
    }
    if (shouldSendCurrentNote && currentNotePath) {
      if (shouldForceCurrentNoteScope) {
        const currentNoteContent = await currentNoteContentPromise;
        if (currentNoteContent !== null) {
          promptToSend = prependCurrentNoteContent(promptToSend, currentNotePath, currentNoteContent);
          queryOptions = {
            ...queryOptions,
            allowedTools: ["view"]
          };
        } else {
          promptToSend = prependCurrentNote(promptToSend, currentNotePath);
        }
      } else {
        promptToSend = prependCurrentNote(promptToSend, currentNotePath);
      }
      currentNoteForMessage = currentNotePath;
    }
    userMsg.displayContent = (_g = options == null ? void 0 : options.displayContentOverride) != null ? _g : displayContent !== content ? displayContent : void 0;
    userMsg.currentNote = currentNoteForMessage;
    if (options == null ? void 0 : options.promptPrefix) {
      promptToSend = `${options.promptPrefix}

${promptToSend}`;
    }
    if (!quizSessionInit && state.quizSession) {
      const quizSession = state.quizSession;
      const questionContext = this.getLatestQuizQuestionContext(
        quizSession.currentQuestion,
        quizSession.totalQuestions
      );
      const quizControl = (options == null ? void 0 : options.quizHintRequest) ? buildQuizHintPrompt({
        sourceInstruction: quizSession.sourceInstruction,
        focusText: quizSession.focusText,
        questionContext
      }) : buildQuizContinuationPrompt({
        currentQuestion: quizSession.currentQuestion,
        totalQuestions: quizSession.totalQuestions,
        difficulty: quizSession.difficulty,
        sourceInstruction: quizSession.sourceInstruction,
        focusText: quizSession.focusText,
        questionContext
      });
      promptToSend = `${quizControl}

${promptToSend}`;
    }
    if (!socraticSessionInit && state.socraticSession) {
      const s = state.socraticSession;
      const supportLevel = inferSocraticSupportLevel(s.supportLevel, content);
      state.socraticSession = { ...s, supportLevel };
      const socraticControl = buildSocraticContinuationPrompt({
        isSummaryPhase: s.isSummaryPhase,
        sourceInstruction: s.sourceInstruction,
        focusText: s.focusText,
        supportLevel
      });
      promptToSend = `${socraticControl}

${promptToSend}`;
    }
    const containsMentions = promptToSend.includes("@");
    if (containsMentions && fileContextManager) {
      promptToSend = fileContextManager.transformContextMentions(promptToSend);
    }
    fileContextManager == null ? void 0 : fileContextManager.markCurrentNoteSent();
    const externalContextSelector = this.deps.getExternalContextSelector();
    const externalContextPaths = externalContextSelector == null ? void 0 : externalContextSelector.getExternalContexts();
    if (externalContextPaths && externalContextPaths.length > 0) {
      queryOptions = {
        ...queryOptions,
        externalContextPaths
      };
    }
    const webSearchEnabled = (_i = (_h = this.deps.getWebSearchToggle()) == null ? void 0 : _h.isEnabled()) != null ? _i : false;
    queryOptions = { ...queryOptions, enableWebSearch: webSearchEnabled };
    let wasInterrupted = false;
    try {
      wasInterrupted = await this.executeStream(promptToSend, imagesForMessage, assistantMsg, queryOptions);
    } finally {
      if (wasInterrupted) {
        await streamController.appendText('\n\n<span class="ocop-interrupted">Interrupted</span> <span class="ocop-interrupted-hint">\xB7 What should Copilot do instead?</span>');
      }
      streamController.hideThinkingIndicator();
      state.isStreaming = false;
      state.cancelRequested = false;
      state.currentContentEl = null;
      streamController.finalizeCurrentThinkingBlock(assistantMsg);
      await streamController.finalizeCurrentTextBlock(assistantMsg);
      if (!wasInterrupted && contentEl) {
        streamController.injectChoiceButtonsIfNeeded(contentEl, assistantMsg, (choice) => {
          void this.sendMessage({ content: choice });
        });
      }
      state.activeSubagents.clear();
      if (state.quizSession && !quizSessionInit && !wasInterrupted && !(options == null ? void 0 : options.quizHintRequest)) {
        if (state.quizSession.currentQuestion < state.quizSession.totalQuestions) {
          state.quizSession = {
            ...state.quizSession,
            currentQuestion: state.quizSession.currentQuestion + 1
          };
        } else {
          state.quizSession = null;
        }
      }
      if (state.socraticSession && !socraticSessionInit && !wasInterrupted) {
        const s = state.socraticSession;
        if ((_j = assistantMsg.socraticTurn) == null ? void 0 : _j.isSummary) {
          state.socraticSession = null;
          (_l = (_k = this.deps).hideSocraticBanner) == null ? void 0 : _l.call(_k);
        } else if (s.isSummaryPhase) {
        } else if (s.currentDepth >= s.maxDepth) {
          state.socraticSession = { ...s, isSummaryPhase: true };
        } else {
          state.socraticSession = { ...s, currentDepth: s.currentDepth + 1 };
        }
      }
      await conversationController.save(true);
      let skipPostCompletionFollowups = false;
      if (assistantMsg.quizQuestion && !wasInterrupted && !(options == null ? void 0 : options.quizHintRequest)) {
        const quizContainerEl = this.deps.getMessagesEl().parentElement;
        if (quizContainerEl) {
          const result = await showQuizAnswerPanel(
            quizContainerEl,
            assistantMsg.quizQuestion,
            () => this.requestQuizHint()
          );
          const isStillCurrentConversation = state.currentConversationId === conversationIdAtSend;
          const isAssistantMessageStillPresent = state.messages.some((msg) => msg.id === assistantMsg.id);
          if (!isStillCurrentConversation || !isAssistantMessageStillPresent) {
            skipPostCompletionFollowups = true;
          } else if ("answer" in result) {
            setTimeout(() => void this.sendMessage({ content: result.answer }), 50);
          }
        }
      }
      if (!skipPostCompletionFollowups) {
        await this.activatePendingPlanMode();
        await this.triggerTitleGeneration();
        this.processQueuedMessage();
      }
    }
  }
  shouldUseCurrentNoteOnlyScope(content) {
    const trimmed = content.trim();
    return CURRENT_NOTE_ONLY_PATTERNS.some((pattern) => pattern.test(trimmed));
  }
  async readCurrentNoteContent(notePath) {
    const file = this.deps.plugin.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof import_obsidian21.TFile)) {
      return null;
    }
    try {
      return await this.deps.plugin.app.vault.cachedRead(file);
    } catch (e) {
      return null;
    }
  }
  // ============================================
  // Plan Mode
  // ============================================
  setPlanModeRequested(active) {
    const { state } = this.deps;
    if (state.planModeRequested === active) {
      return;
    }
    state.planModeRequested = active;
    this.deps.setPlanModeActive(active);
  }
  ensurePlanModeState(agentInitiated) {
    var _a;
    const { state, plugin } = this.deps;
    if (plugin.settings.permissionMode !== "plan") {
      return;
    }
    if ((_a = state.planModeState) == null ? void 0 : _a.isActive) {
      if (!state.planModeState.agentInitiated && agentInitiated) {
        state.planModeState.agentInitiated = true;
      }
      return;
    }
    state.planModeState = {
      isActive: true,
      planFilePath: null,
      planContent: null,
      originalQuery: null,
      agentInitiated
    };
  }
  async activatePendingPlanMode() {
    const { plugin, state } = this.deps;
    if (!state.planModeActivationPending) {
      return;
    }
    state.planModeActivationPending = false;
    if (plugin.settings.permissionMode !== "plan") {
      plugin.settings.lastNonPlanPermissionMode = plugin.settings.permissionMode;
      plugin.settings.permissionMode = "plan";
      await plugin.saveSettings();
    }
    state.planModeRequested = false;
    this.ensurePlanModeState(true);
    plugin.agentService.setCurrentPlanFilePath(null);
    this.deps.setPlanModeActive(true);
  }
  async exitPlanPermissionMode() {
    var _a;
    const { plugin, state } = this.deps;
    const restored = (_a = plugin.settings.lastNonPlanPermissionMode) != null ? _a : "agent";
    if (plugin.settings.permissionMode === "plan") {
      plugin.settings.permissionMode = restored;
      plugin.settings.lastNonPlanPermissionMode = restored;
      await plugin.saveSettings();
    }
    state.resetPlanModeState();
    state.planModeRequested = false;
    state.planModeActivationPending = false;
    this.deps.setPlanModeActive(false);
  }
  /** Sends a message in plan mode (read-only exploration). */
  async sendPlanModeMessage() {
    var _a, _b;
    const { state, plugin } = this.deps;
    const inputEl = this.deps.getInputEl();
    const content = inputEl.value.trim();
    if (!content) return;
    if (state.isStreaming) {
      new import_obsidian21.Notice("Cannot request plan mode while agent is working");
      return;
    }
    if (plugin.settings.permissionMode === "plan") {
      plugin.agentService.setCurrentPlanFilePath(null);
      const wasAgentInitiated = (_b = (_a = state.planModeState) == null ? void 0 : _a.agentInitiated) != null ? _b : false;
      this.ensurePlanModeState(wasAgentInitiated);
      state.planModeState = {
        isActive: true,
        planFilePath: null,
        planContent: null,
        originalQuery: content,
        agentInitiated: wasAgentInitiated
      };
      inputEl.value = "";
      await this.sendMessageWithPlanMode({ content });
      return;
    }
    await this.sendMessage({ promptPrefix: PLAN_MODE_REQUEST_PREFIX });
  }
  /**
   * Handles agent-initiated EnterPlanMode tool call.
   * Sets up state for re-sending with plan mode after current stream ends.
   */
  async handleEnterPlanMode() {
    const { state, plugin } = this.deps;
    if (plugin.settings.permissionMode === "plan") {
      this.ensurePlanModeState(true);
      return;
    }
    state.planModeActivationPending = true;
  }
  /** Internal: sends message with plan mode options. */
  async sendMessageWithPlanMode(options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const { plugin, state, renderer, streamController, selectionController, conversationController } = this.deps;
    const inputEl = this.deps.getInputEl();
    const imageContextManager = this.deps.getImageContextManager();
    const fileContextManager = this.deps.getFileContextManager();
    if (plugin.settings.permissionMode !== "plan") {
      await this.sendMessage({ promptPrefix: PLAN_MODE_REQUEST_PREFIX });
      return;
    }
    this.ensurePlanModeState((_b = (_a = state.planModeState) == null ? void 0 : _a.agentInitiated) != null ? _b : false);
    const content = ((_c = options == null ? void 0 : options.content) != null ? _c : inputEl.value).trim();
    if (!content) return;
    const skipUserMessage = (_d = options == null ? void 0 : options.skipUserMessage) != null ? _d : false;
    if ((options == null ? void 0 : options.content) === void 0) {
      inputEl.value = "";
    }
    state.isStreaming = true;
    state.cancelRequested = false;
    state.ignoreUsageUpdates = false;
    state.subagentsSpawnedThisStream = 0;
    const welcomeEl = this.deps.getWelcomeEl();
    if (welcomeEl) {
      welcomeEl.style.display = "none";
    }
    fileContextManager == null ? void 0 : fileContextManager.startSession();
    const images = skipUserMessage ? (_e = options == null ? void 0 : options.images) != null ? _e : [] : (_f = options == null ? void 0 : options.images) != null ? _f : (imageContextManager == null ? void 0 : imageContextManager.getAttachedImages()) || [];
    const imagesForMessage = images.length > 0 ? [...images] : void 0;
    if (!skipUserMessage && !(options == null ? void 0 : options.images)) {
      imageContextManager == null ? void 0 : imageContextManager.clearImages();
    }
    let currentNote = null;
    let shouldSendCurrentNote = false;
    let currentNoteForMessage;
    if (skipUserMessage || (options == null ? void 0 : options.currentNote)) {
      currentNote = (options == null ? void 0 : options.currentNote) || null;
    } else {
      currentNote = (fileContextManager == null ? void 0 : fileContextManager.getCurrentNotePath()) || null;
    }
    shouldSendCurrentNote = (_g = fileContextManager == null ? void 0 : fileContextManager.shouldSendCurrentNote(currentNote)) != null ? _g : false;
    if (shouldSendCurrentNote && currentNote) {
      currentNoteForMessage = currentNote;
    }
    const editorContext = (_h = options == null ? void 0 : options.editorContext) != null ? _h : selectionController.getContext();
    let promptToSend = `[Plan Mode]
Explore the codebase and create an implementation plan. Call the ExitPlanMode tool when the plan is ready for user approval.

<query>
${content}
</query>`;
    if (editorContext) {
      promptToSend = prependEditorContext(promptToSend, editorContext);
    }
    if (shouldSendCurrentNote && currentNote) {
      promptToSend = prependCurrentNote(promptToSend, currentNote);
      currentNoteForMessage = currentNote;
    }
    fileContextManager == null ? void 0 : fileContextManager.markCurrentNoteSent();
    if (!skipUserMessage) {
      const displayContent = (_i = options == null ? void 0 : options.displayContent) != null ? _i : content;
      const userMsg = {
        id: this.deps.generateId(),
        role: "user",
        content,
        displayContent: displayContent !== content ? displayContent : void 0,
        timestamp: Date.now(),
        currentNote: currentNoteForMessage,
        images: imagesForMessage,
        hidden: options == null ? void 0 : options.hidden
      };
      state.addMessage(userMsg);
      if (!(options == null ? void 0 : options.hidden)) {
        renderer.addMessage(userMsg);
      }
    }
    const assistantMsg = {
      id: this.deps.generateId(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: []
    };
    state.addMessage(assistantMsg);
    const msgEl = renderer.addMessage(assistantMsg);
    const contentEl = msgEl.querySelector(".ocop-message-content");
    state.toolCallElements.clear();
    state.currentContentEl = contentEl;
    state.currentTextEl = null;
    state.currentTextContent = "";
    streamController.showThinkingIndicator(contentEl);
    const queryOptions = {
      ...options == null ? void 0 : options.queryOptions,
      planMode: true
    };
    let wasInterrupted = false;
    try {
      wasInterrupted = await this.executeStream(promptToSend, imagesForMessage, assistantMsg, queryOptions);
    } finally {
      if (wasInterrupted) {
        await streamController.appendText('\n\n<span class="ocop-interrupted">Plan mode interrupted</span>');
        plugin.agentService.setCurrentPlanFilePath(null);
      }
      streamController.hideThinkingIndicator();
      state.isStreaming = false;
      state.cancelRequested = false;
      state.currentContentEl = null;
      streamController.finalizeCurrentThinkingBlock(assistantMsg);
      await streamController.finalizeCurrentTextBlock(assistantMsg);
      if (!wasInterrupted && contentEl) {
        streamController.injectChoiceButtonsIfNeeded(contentEl, assistantMsg, (choice) => {
          void this.sendMessage({ content: choice });
        });
      }
      state.activeSubagents.clear();
      await conversationController.save(true);
      await this.activatePendingPlanMode();
      await this.triggerTitleGeneration({ isPlanMode: true });
      this.processQueuedMessage();
    }
  }
  // ============================================
  // Queue Management
  // ============================================
  /** Updates the queue indicator UI. */
  updateQueueIndicator() {
    var _a, _b;
    const { state } = this.deps;
    if (!state.queueIndicatorEl) return;
    if (state.queuedMessage) {
      const rawContent = state.queuedMessage.content.trim();
      const preview = rawContent.length > 40 ? rawContent.slice(0, 40) + "..." : rawContent;
      const hasImages = ((_b = (_a = state.queuedMessage.images) == null ? void 0 : _a.length) != null ? _b : 0) > 0;
      let display = preview;
      if (hasImages) {
        display = display ? `${display} [images]` : "[images]";
      }
      state.queueIndicatorEl.setText(`\u2319 Queued: ${display}`);
      state.queueIndicatorEl.style.display = "block";
    } else {
      state.queueIndicatorEl.style.display = "none";
    }
  }
  /** Clears the queued message. */
  clearQueuedMessage() {
    const { state } = this.deps;
    state.queuedMessage = null;
    this.updateQueueIndicator();
  }
  /** Processes the queued message. */
  processQueuedMessage() {
    var _a;
    const { state } = this.deps;
    if (!state.queuedMessage) return;
    const { content, images, editorContext, hidden, promptPrefix } = state.queuedMessage;
    state.queuedMessage = null;
    this.updateQueueIndicator();
    const isPlanMode = this.deps.plugin.settings.permissionMode === "plan";
    if (isPlanMode) {
      setTimeout(
        () => this.sendMessageWithPlanMode({ content, images, editorContext, hidden }),
        0
      );
      return;
    }
    const inputEl = this.deps.getInputEl();
    inputEl.value = content;
    if (images && images.length > 0) {
      (_a = this.deps.getImageContextManager()) == null ? void 0 : _a.setImages(images);
    }
    setTimeout(() => this.sendMessage({ editorContextOverride: editorContext, hidden, promptPrefix }), 0);
  }
  // ============================================
  // Title Generation
  // ============================================
  /**
   * Triggers AI title generation after first exchange.
   * Handles setting fallback title, firing async generation, and updating UI.
   */
  async triggerTitleGeneration(options = {}) {
    var _a;
    const { plugin, state, conversationController } = this.deps;
    const { isPlanMode = false } = options;
    if (state.messages.length !== 2 || !state.currentConversationId) {
      return;
    }
    const firstUserMsg = state.messages.find((m) => m.role === "user");
    const firstAssistantMsg = state.messages.find((m) => m.role === "assistant");
    if (!firstUserMsg || !firstAssistantMsg) {
      return;
    }
    const userContent = firstUserMsg.displayContent || firstUserMsg.content;
    const assistantText = firstAssistantMsg.content || ((_a = firstAssistantMsg.contentBlocks) == null ? void 0 : _a.filter((b) => b.type === "text").map((b) => b.content).join("\n")) || "";
    const fallbackTitle = conversationController.generateFallbackTitle(userContent);
    const displayTitle = isPlanMode ? `[Plan] ${fallbackTitle}` : fallbackTitle;
    await plugin.renameConversation(state.currentConversationId, displayTitle);
    if (!plugin.settings.enableAutoTitleGeneration) {
      return;
    }
    const titleService = this.deps.getTitleGenerationService();
    if (!titleService || !assistantText) {
      return;
    }
    await plugin.updateConversation(state.currentConversationId, { titleGenerationStatus: "pending" });
    conversationController.updateHistoryDropdown();
    const convId = state.currentConversationId;
    const expectedTitle = displayTitle;
    titleService.generateTitle(
      convId,
      userContent,
      assistantText,
      async (conversationId, result) => {
        const currentConv = plugin.getConversationById(conversationId);
        if (!currentConv) return;
        const userManuallyRenamed = currentConv.title !== expectedTitle;
        if (result.success && !userManuallyRenamed) {
          const newTitle = isPlanMode ? `[Plan] ${result.title}` : result.title;
          await plugin.renameConversation(conversationId, newTitle);
          await plugin.updateConversation(conversationId, { titleGenerationStatus: "success" });
        } else if (!userManuallyRenamed) {
          await plugin.updateConversation(conversationId, { titleGenerationStatus: "failed" });
        } else {
          await plugin.updateConversation(conversationId, { titleGenerationStatus: void 0 });
        }
        conversationController.updateHistoryDropdown();
      }
    ).catch((error) => {
      console.error("[InputController] Title generation failed:", error instanceof Error ? error.message : error);
      new import_obsidian21.Notice("\uC81C\uBAA9 \uC0DD\uC131 \uC2E4\uD328");
    });
  }
  // ============================================
  // Streaming Control
  // ============================================
  /**
   * Runs the streaming loop for a query.
   * Errors are caught and displayed inline.
   * @returns true if the stream was interrupted by the user.
   */
  async executeStream(prompt, images, assistantMsg, queryOptions) {
    const { plugin, state, streamController } = this.deps;
    let wasInterrupted = false;
    try {
      for await (const chunk of plugin.agentService.query(prompt, images, state.messages, queryOptions)) {
        if (state.cancelRequested) {
          wasInterrupted = true;
          break;
        }
        await streamController.handleStreamChunk(chunk, assistantMsg);
      }
    } catch (error) {
      console.error("[Copilot] Stream error:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await streamController.appendText(`

**Error:** ${errorMsg}`);
    }
    return wasInterrupted;
  }
  /** Cancels the current streaming operation. */
  cancelStreaming() {
    const { plugin, state, streamController } = this.deps;
    if (!state.isStreaming) return;
    state.cancelRequested = true;
    this.clearQueuedMessage();
    plugin.agentService.cancel();
    streamController.hideThinkingIndicator();
  }
  // ============================================
  // Instruction Mode
  // ============================================
  /** Handles instruction mode submission. */
  async handleInstructionSubmit(rawInstruction) {
    const { plugin } = this.deps;
    const instructionRefineService = this.deps.getInstructionRefineService();
    const instructionModeManager = this.deps.getInstructionModeManager();
    if (!instructionRefineService) return;
    const existingPrompt = plugin.settings.systemPrompt;
    let modal = null;
    let wasCancelled = false;
    try {
      modal = new InstructionModal(
        plugin.app,
        rawInstruction,
        {
          onAccept: async (finalInstruction) => {
            const currentPrompt = plugin.settings.systemPrompt;
            plugin.settings.systemPrompt = appendMarkdownSnippet(currentPrompt, finalInstruction);
            await plugin.saveSettings();
            new import_obsidian21.Notice("Instruction added to custom system prompt");
            instructionModeManager == null ? void 0 : instructionModeManager.clear();
          },
          onReject: () => {
            wasCancelled = true;
            instructionRefineService.cancel();
            instructionModeManager == null ? void 0 : instructionModeManager.clear();
          },
          onClarificationSubmit: async (response) => {
            const result2 = await instructionRefineService.continueConversation(response);
            if (wasCancelled) {
              return;
            }
            if (!result2.success) {
              if (result2.error === "Cancelled") {
                return;
              }
              new import_obsidian21.Notice(result2.error || "Failed to process response");
              modal == null ? void 0 : modal.showError(result2.error || "Failed to process response");
              return;
            }
            if (result2.clarification) {
              modal == null ? void 0 : modal.showClarification(result2.clarification);
            } else if (result2.refinedInstruction) {
              modal == null ? void 0 : modal.showConfirmation(result2.refinedInstruction);
            }
          }
        }
      );
      modal.open();
      instructionRefineService.resetConversation();
      const result = await instructionRefineService.refineInstruction(
        rawInstruction,
        existingPrompt
      );
      if (wasCancelled) {
        return;
      }
      if (!result.success) {
        if (result.error === "Cancelled") {
          instructionModeManager == null ? void 0 : instructionModeManager.clear();
          return;
        }
        new import_obsidian21.Notice(result.error || "Failed to refine instruction");
        modal.showError(result.error || "Failed to refine instruction");
        instructionModeManager == null ? void 0 : instructionModeManager.clear();
        return;
      }
      if (result.clarification) {
        modal.showClarification(result.clarification);
      } else if (result.refinedInstruction) {
        modal.showConfirmation(result.refinedInstruction);
      } else {
        new import_obsidian21.Notice("No instruction received");
        modal.showError("No instruction received");
        instructionModeManager == null ? void 0 : instructionModeManager.clear();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      new import_obsidian21.Notice(`Error: ${errorMsg}`);
      modal == null ? void 0 : modal.showError(errorMsg);
      instructionModeManager == null ? void 0 : instructionModeManager.clear();
    }
  }
  // ============================================
  // Approval Dialogs
  // ============================================
  /** Handles tool approval requests. */
  async handleApprovalRequest(toolName, input, description) {
    const { plugin } = this.deps;
    return new Promise((resolve6) => {
      const modal = new ApprovalModal(plugin.app, toolName, input, description, resolve6);
      modal.open();
    });
  }
  /** Requests approval for inline bash commands. */
  async requestInlineBashApproval(command) {
    const { plugin } = this.deps;
    const description = `Execute inline bash command:
${command}`;
    return new Promise((resolve6) => {
      const modal = new ApprovalModal(
        plugin.app,
        TOOL_BASH,
        { command },
        description,
        (decision) => resolve6(decision === "allow" || decision === "allow-always"),
        { showAlwaysAllow: false, title: "Inline bash execution" }
      );
      modal.open();
    });
  }
  /** Handles AskUserQuestion tool calls by showing a floating panel. */
  async handleAskUserQuestion(input) {
    const { plugin } = this.deps;
    const messagesEl = this.deps.getMessagesEl();
    const containerEl = messagesEl.parentElement;
    if (!containerEl) {
      return null;
    }
    return showAskUserQuestionPanel(plugin.app, containerEl, input);
  }
  // ============================================
  // Plan Mode Approval
  // ============================================
  /** Handles ExitPlanMode tool by showing plan approval panel. */
  async handleExitPlanMode(planContent) {
    const { state, renderer, conversationController, streamController } = this.deps;
    const messagesEl = this.deps.getMessagesEl();
    const containerEl = messagesEl.parentElement;
    if (!containerEl) {
      return { decision: "cancel" };
    }
    if (state.planModeState) {
      state.planModeState.planContent = planContent;
    }
    streamController.hideThinkingIndicator();
    const assistantMsg = state.messages[state.messages.length - 1];
    if (assistantMsg) {
      streamController.finalizeCurrentThinkingBlock(assistantMsg);
      await streamController.finalizeCurrentTextBlock(assistantMsg);
      assistantMsg.isPlanMessage = true;
    }
    const lastMsgEl = messagesEl.lastElementChild;
    if (lastMsgEl) {
      lastMsgEl.classList.add("ocop-message-plan");
    }
    state.currentTextEl = null;
    state.currentTextContent = "";
    state.currentThinkingState = null;
    renderer.scrollToBottom();
    state.pendingPlanContent = planContent;
    await conversationController.save();
    return this.showApprovalPanelAndHandleDecision(planContent, containerEl);
  }
  /**
   * Restores pending plan approval panel when loading a conversation.
   * Called when a conversation with pendingPlanContent is loaded.
   */
  restorePendingPlanApproval(planContent) {
    const messagesEl = this.deps.getMessagesEl();
    const containerEl = messagesEl.parentElement;
    if (!containerEl) {
      return;
    }
    void this.showApprovalPanelAndHandleDecision(planContent, containerEl);
  }
  /** Shows approval panel and handles the decision. */
  async showApprovalPanelAndHandleDecision(planContent, containerEl) {
    const { plugin, state, conversationController } = this.deps;
    const result = await showPlanApprovalPanel(
      plugin.app,
      containerEl,
      planContent,
      this.deps.getComponent()
    );
    state.pendingPlanContent = null;
    if (result.decision === "approve") {
      this.addApprovalIndicator("approve");
      plugin.agentService.setApprovedPlanContent(planContent);
      const planBanner = this.deps.getPlanBanner();
      if (planBanner) {
        void planBanner.show(planContent);
      }
      await this.exitPlanPermissionMode();
      plugin.agentService.setCurrentPlanFilePath(null);
      await conversationController.save();
      setTimeout(
        () => this.sendMessage({ hidden: true, content: "Please implement the approved plan." }),
        100
      );
      return { decision: "approve" };
    } else if (result.decision === "approve_new_session") {
      this.addApprovalIndicator("approve_new_session");
      const planBanner = this.deps.getPlanBanner();
      if (planBanner) {
        void planBanner.show(planContent);
      }
      await this.exitPlanPermissionMode();
      plugin.agentService.setCurrentPlanFilePath(null);
      plugin.agentService.resetSession();
      plugin.agentService.setApprovedPlanContent(planContent);
      state.ignoreUsageUpdates = true;
      state.usage = null;
      this.deps.resetContextMeter();
      await conversationController.save();
      setTimeout(
        () => this.sendMessage({ hidden: true, content: "Please implement the approved plan." }),
        100
      );
      return { decision: "approve_new_session" };
    } else if (result.decision === "revise") {
      this.addApprovalIndicator("revise", result.feedback);
      await conversationController.save();
      plugin.agentService.setCurrentPlanFilePath(null);
      setTimeout(
        () => this.sendMessageWithPlanMode({ content: result.feedback, hidden: true, images: [] }),
        100
      );
      return { decision: "revise", feedback: result.feedback };
    } else {
      plugin.agentService.setCurrentPlanFilePath(null);
      await conversationController.save();
      return { decision: "cancel" };
    }
  }
  /** Hides the plan banner. */
  hidePlanBanner() {
    const planBanner = this.deps.getPlanBanner();
    if (planBanner) {
      planBanner.hide();
    }
  }
  /** Adds an approval indicator message to the chat. */
  addApprovalIndicator(type, feedback) {
    const { state, renderer } = this.deps;
    const indicatorMsg = {
      id: `indicator-${Date.now()}`,
      role: "user",
      content: "",
      // Empty content, rendered via approvalIndicator
      timestamp: Date.now(),
      approvalIndicator: {
        type,
        feedback
      }
    };
    state.addMessage(indicatorMsg);
    renderer.addMessage(indicatorMsg);
    renderer.scrollToBottom();
  }
};

// src/features/chat/controllers/NavigationController.ts
var SCROLL_SPEED = 8;
var NavigationController = class {
  constructor(deps) {
    this.scrollDirection = null;
    this.animationFrameId = null;
    this.initialized = false;
    this.disposed = false;
    this.scrollLoop = () => {
      if (this.scrollDirection === null || this.disposed) return;
      const messagesEl = this.deps.getMessagesEl();
      if (!messagesEl) {
        this.stopScrolling();
        return;
      }
      const scrollAmount = this.scrollDirection === "up" ? -SCROLL_SPEED : SCROLL_SPEED;
      messagesEl.scrollTop += scrollAmount;
      this.animationFrameId = requestAnimationFrame(this.scrollLoop);
    };
    this.deps = deps;
    this.boundMessagesKeydown = this.handleMessagesKeydown.bind(this);
    this.boundKeyup = this.handleKeyup.bind(this);
    this.boundInputKeydown = this.handleInputKeydown.bind(this);
  }
  // ============================================
  // Lifecycle
  // ============================================
  /** Initializes navigation by making messagesEl focusable and attaching listeners. */
  initialize() {
    if (this.initialized || this.disposed) return;
    const messagesEl = this.deps.getMessagesEl();
    const inputEl = this.deps.getInputEl();
    if (!messagesEl || !inputEl) return;
    messagesEl.setAttribute("tabindex", "0");
    messagesEl.addClass("ocop-messages-focusable");
    messagesEl.addEventListener("keydown", this.boundMessagesKeydown);
    document.addEventListener("keyup", this.boundKeyup);
    inputEl.addEventListener("keydown", this.boundInputKeydown, { capture: true });
    this.initialized = true;
  }
  /** Cleans up event listeners and animation frames. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopScrolling();
    document.removeEventListener("keyup", this.boundKeyup);
    const messagesEl = this.deps.getMessagesEl();
    messagesEl == null ? void 0 : messagesEl.removeEventListener("keydown", this.boundMessagesKeydown);
    messagesEl == null ? void 0 : messagesEl.removeClass("ocop-messages-focusable");
    const inputEl = this.deps.getInputEl();
    inputEl == null ? void 0 : inputEl.removeEventListener("keydown", this.boundInputKeydown, { capture: true });
  }
  // ============================================
  // Messages Panel Keyboard Handling
  // ============================================
  handleMessagesKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const settings = this.deps.getSettings();
    const key = e.key.toLowerCase();
    if (key === settings.scrollUpKey.toLowerCase()) {
      e.preventDefault();
      this.startScrolling("up");
      return;
    }
    if (key === settings.scrollDownKey.toLowerCase()) {
      e.preventDefault();
      this.startScrolling("down");
      return;
    }
    if (key === settings.focusInputKey.toLowerCase()) {
      e.preventDefault();
      this.deps.getInputEl().focus();
      return;
    }
  }
  handleKeyup(e) {
    const settings = this.deps.getSettings();
    const key = e.key.toLowerCase();
    if (key === settings.scrollUpKey.toLowerCase() || key === settings.scrollDownKey.toLowerCase()) {
      this.stopScrolling();
    }
  }
  // ============================================
  // Input Keyboard Handling (Escape)
  // ============================================
  handleInputKeydown(e) {
    var _a, _b;
    if (e.key !== "Escape") return;
    if (this.deps.isStreaming()) {
      return;
    }
    try {
      if ((_b = (_a = this.deps).shouldSkipEscapeHandling) == null ? void 0 : _b.call(_a)) {
        return;
      }
    } catch (e2) {
    }
    e.preventDefault();
    e.stopPropagation();
    this.deps.getInputEl().blur();
    this.deps.getMessagesEl().focus();
  }
  // ============================================
  // Continuous Scrolling with requestAnimationFrame
  // ============================================
  startScrolling(direction) {
    if (this.scrollDirection === direction) {
      return;
    }
    this.scrollDirection = direction;
    this.scrollLoop();
  }
  stopScrolling() {
    this.scrollDirection = null;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
  // ============================================
  // Public API
  // ============================================
  /** Focuses the messages panel. */
  focusMessages() {
    this.deps.getMessagesEl().focus();
  }
  /** Focuses the input. */
  focusInput() {
    this.deps.getInputEl().focus();
  }
};

// src/features/chat/controllers/SelectionController.ts
var import_obsidian22 = require("obsidian");
var SELECTION_POLL_INTERVAL = 250;
var SelectionController = class {
  constructor(app, indicatorEl, inputEl) {
    this.storedSelection = null;
    this.pollInterval = null;
    this.app = app;
    this.indicatorEl = indicatorEl;
    this.inputEl = inputEl;
  }
  // ============================================
  // Lifecycle
  // ============================================
  /** Starts polling for editor selection changes. */
  start() {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => this.poll(), SELECTION_POLL_INTERVAL);
  }
  /** Stops polling and clears state. */
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.clear();
  }
  /** Cleans up resources. Same as stop(). */
  dispose() {
    this.stop();
  }
  // ============================================
  // Selection Polling
  // ============================================
  /** Polls editor selection and updates stored selection. */
  poll() {
    var _a, _b, _c, _d;
    const view = this.app.workspace.getActiveViewOfType(import_obsidian22.MarkdownView);
    if (!view) return;
    const editor = view.editor;
    const editorView = editor.cm;
    if (!editorView) return;
    const selectedText = editor.getSelection();
    if (selectedText.trim()) {
      const fromPos = editor.getCursor("from");
      const toPos = editor.getCursor("to");
      const from = editor.posToOffset(fromPos);
      const to = editor.posToOffset(toPos);
      const startLine = fromPos.line + 1;
      const notePath = ((_a = view.file) == null ? void 0 : _a.path) || "unknown";
      const lineCount = selectedText.split(/\r?\n/).length;
      const sameRange = this.storedSelection && this.storedSelection.editorView === editorView && this.storedSelection.from === from && this.storedSelection.to === to && this.storedSelection.notePath === notePath;
      const sameText = sameRange && ((_b = this.storedSelection) == null ? void 0 : _b.selectedText) === selectedText;
      const sameLineCount = sameRange && ((_c = this.storedSelection) == null ? void 0 : _c.lineCount) === lineCount;
      const sameStartLine = sameRange && ((_d = this.storedSelection) == null ? void 0 : _d.startLine) === startLine;
      if (!sameRange || !sameText || !sameLineCount || !sameStartLine) {
        if (this.storedSelection && !sameRange) {
          this.clearHighlight();
        }
        this.storedSelection = { notePath, selectedText, lineCount, startLine, from, to, editorView };
        this.updateIndicator();
      }
    } else if (document.activeElement !== this.inputEl) {
      this.clearHighlight();
      this.storedSelection = null;
      this.updateIndicator();
    }
  }
  // ============================================
  // Highlight Management
  // ============================================
  /** Shows the selection highlight in the editor. */
  showHighlight() {
    if (!this.storedSelection) return;
    const { from, to, editorView } = this.storedSelection;
    showSelectionHighlight(editorView, from, to);
  }
  /** Clears the selection highlight from the editor. */
  clearHighlight() {
    if (!this.storedSelection) return;
    hideSelectionHighlight(this.storedSelection.editorView);
  }
  // ============================================
  // Indicator
  // ============================================
  /** Updates selection indicator based on stored selection. */
  updateIndicator() {
    if (!this.indicatorEl) return;
    if (this.storedSelection) {
      const lineText = this.storedSelection.lineCount === 1 ? "line" : "lines";
      this.indicatorEl.textContent = `Selection ready - ${this.storedSelection.lineCount} ${lineText}`;
      this.indicatorEl.style.display = "block";
      this.indicatorEl.setAttribute("title", "Click to clear selected context");
    } else {
      this.indicatorEl.style.display = "none";
      this.indicatorEl.removeAttribute("title");
    }
  }
  // ============================================
  // Context Access
  // ============================================
  /** Returns stored selection as EditorSelectionContext, or null if none. */
  getContext() {
    if (!this.storedSelection) return null;
    return {
      notePath: this.storedSelection.notePath,
      mode: "selection",
      selectedText: this.storedSelection.selectedText,
      lineCount: this.storedSelection.lineCount,
      startLine: this.storedSelection.startLine
    };
  }
  /** Checks if there is a stored selection. */
  hasSelection() {
    return this.storedSelection !== null;
  }
  // ============================================
  // Clear
  // ============================================
  /** Clears the stored selection and highlight. */
  clear() {
    this.clearHighlight();
    this.storedSelection = null;
    this.updateIndicator();
  }
};

// src/features/chat/controllers/StreamController.ts
var StreamController = class {
  constructor(deps) {
    this.pendingScrollFrameId = null;
    this.deps = deps;
  }
  // ============================================
  // Stream Chunk Handling
  // ============================================
  /** Processes a stream chunk and updates the message. */
  async handleStreamChunk(chunk, msg) {
    var _a, _b, _c;
    const { state, plugin } = this.deps;
    if ("parentToolUseId" in chunk && chunk.parentToolUseId) {
      await this.handleSubagentChunk(chunk, msg);
      this.queueScrollToBottom();
      return;
    }
    switch (chunk.type) {
      case "thinking":
        if (state.currentTextEl) {
          await this.finalizeCurrentTextBlock(msg);
        }
        await this.appendThinking(chunk.content, msg);
        break;
      case "text":
        if (state.currentThinkingState) {
          this.finalizeCurrentThinkingBlock(msg);
        }
        msg.content += chunk.content;
        await this.appendText(chunk.content);
        if (state.currentContentEl) {
          this.showThinkingIndicator(state.currentContentEl);
        }
        break;
      case "tool_use": {
        if (state.currentThinkingState) {
          this.finalizeCurrentThinkingBlock(msg);
        }
        await this.finalizeCurrentTextBlock(msg);
        if (chunk.name === TOOL_TASK) {
          state.subagentsSpawnedThisStream++;
          const isAsync = this.deps.asyncSubagentManager.isAsyncTask(chunk.input);
          if (isAsync) {
            await this.handleAsyncTaskToolUse(chunk, msg);
          } else {
            await this.handleTaskToolUse(chunk, msg);
          }
          break;
        }
        if (chunk.name === TOOL_AGENT_OUTPUT) {
          this.handleAgentOutputToolUse(chunk, msg);
          break;
        }
        if (chunk.name === TOOL_ASK_USER_QUESTION) {
          await this.handleAskUserQuestionToolUse(chunk, msg);
          break;
        }
        if (isPlanModeTool(chunk.name)) {
          break;
        }
        this.handleRegularToolUse(chunk, msg);
        break;
      }
      case "tool_result": {
        this.handleToolResult(chunk, msg);
        break;
      }
      case "blocked":
        await this.appendText(`

\u26A0\uFE0F **Blocked:** ${chunk.content}`);
        break;
      case "error":
        await this.appendText(`

\u274C **Error:** ${chunk.content}`);
        break;
      case "done":
        break;
      case "usage": {
        const currentSessionId = plugin.agentService.getSessionId();
        const chunkSessionId = (_a = chunk.sessionId) != null ? _a : null;
        if (chunkSessionId && currentSessionId && chunkSessionId !== currentSessionId || chunkSessionId && !currentSessionId) {
          break;
        }
        if (state.subagentsSpawnedThisStream > 0) {
          break;
        }
        if (!state.ignoreUsageUpdates) {
          const previousUsage = state.usage;
          state.usage = previousUsage ? {
            ...chunk.usage,
            premiumRequests: ((_b = previousUsage.premiumRequests) != null ? _b : 0) + ((_c = chunk.usage.premiumRequests) != null ? _c : 0)
          } : chunk.usage;
        }
        break;
      }
    }
    this.queueScrollToBottom();
  }
  // ============================================
  // Tool Use Handling
  // ============================================
  /** Handles regular tool_use chunks. */
  handleRegularToolUse(chunk, msg) {
    const { plugin, state } = this.deps;
    const isPlanMode = plugin.settings.permissionMode === "plan";
    if (isPlanMode && isWriteEditTool(chunk.name)) {
      return;
    }
    const toolCall = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: "running",
      isExpanded: false
    };
    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(toolCall);
    if (chunk.name === TOOL_TODO_WRITE) {
      const todos = parseTodoInput(chunk.input);
      if (todos) {
        this.deps.state.currentTodos = todos;
      } else {
        console.warn("[StreamController] TodoWrite input parsing failed", {
          toolId: chunk.id,
          inputKeys: Object.keys(chunk.input)
        });
        if (state.currentContentEl) {
          msg.contentBlocks = msg.contentBlocks || [];
          msg.contentBlocks.push({ type: "tool_use", toolId: chunk.id });
          renderToolCall(state.currentContentEl, toolCall, state.toolCallElements);
        }
      }
    } else if (state.currentContentEl) {
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({ type: "tool_use", toolId: chunk.id });
      if (isWriteEditTool(chunk.name)) {
        const writeEditState = createWriteEditBlock(state.currentContentEl, toolCall);
        state.writeEditStates.set(chunk.id, writeEditState);
        state.toolCallElements.set(chunk.id, writeEditState.wrapperEl);
      } else {
        renderToolCall(state.currentContentEl, toolCall, state.toolCallElements);
      }
    }
    if (state.currentContentEl) {
      this.showThinkingIndicator(state.currentContentEl);
    }
  }
  /** Handles AskUserQuestion tool_use chunks. */
  async handleAskUserQuestionToolUse(chunk, msg) {
    const { state } = this.deps;
    if (!this.deps.plugin.agentService.isAskUserQuestionToolSupported()) {
      const parsedInput = parseAskUserQuestionInput(chunk.input);
      await this.appendText(`

${this.formatAskUserQuestionFallback(parsedInput == null ? void 0 : parsedInput.questions)}`);
      return;
    }
    if (!state.currentContentEl) return;
    const toolCall = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: "running",
      isExpanded: false
    };
    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(toolCall);
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: "tool_use", toolId: chunk.id });
    const askQuestionState = createAskUserQuestionBlock(state.currentContentEl, toolCall);
    state.askUserQuestionStates.set(chunk.id, askQuestionState);
    state.toolCallElements.set(chunk.id, askQuestionState.wrapperEl);
    this.showThinkingIndicator(state.currentContentEl);
  }
  formatAskUserQuestionFallback(questions) {
    const firstQuestion = questions == null ? void 0 : questions[0];
    if (!firstQuestion) {
      return "I need your input before continuing. Please reply in chat.";
    }
    const optionLabels = firstQuestion.options.map((option) => option.label).filter(Boolean);
    const optionHint = optionLabels.length > 0 ? ` Options: ${optionLabels.join(", ")}.` : "";
    return `${firstQuestion.question}${optionHint} Reply in chat and I will continue.`;
  }
  /** Handles tool_result chunks. */
  handleToolResult(chunk, msg) {
    var _a;
    const { plugin, state } = this.deps;
    const subagentState = state.activeSubagents.get(chunk.id);
    if (subagentState) {
      this.finalizeSubagent(chunk, msg, subagentState);
      return;
    }
    if (this.handleAsyncTaskToolResult(chunk, msg)) {
      if (state.currentContentEl) {
        this.showThinkingIndicator(state.currentContentEl);
      }
      return;
    }
    if (this.handleAgentOutputToolResult(chunk, msg)) {
      if (state.currentContentEl) {
        this.showThinkingIndicator(state.currentContentEl);
      }
      return;
    }
    const existingToolCall = (_a = msg.toolCalls) == null ? void 0 : _a.find((tc) => tc.id === chunk.id);
    const askQuestionState = state.askUserQuestionStates.get(chunk.id);
    if ((existingToolCall == null ? void 0 : existingToolCall.name) === TOOL_ASK_USER_QUESTION || askQuestionState) {
      const isBlocked2 = isBlockedToolResult(chunk.content, chunk.isError);
      if (existingToolCall) {
        existingToolCall.status = isBlocked2 ? "blocked" : chunk.isError ? "error" : "completed";
        existingToolCall.result = chunk.content;
      }
      const storedAnswers = plugin.agentService.getAskUserQuestionAnswers(chunk.id);
      const parsed = existingToolCall ? parseAskUserQuestionInput(existingToolCall.input) : null;
      const answers = storedAnswers || (parsed == null ? void 0 : parsed.answers);
      if (existingToolCall && answers) {
        existingToolCall.input = { ...existingToolCall.input, answers };
      }
      if (askQuestionState && existingToolCall) {
        finalizeAskUserQuestionBlock(
          askQuestionState,
          answers,
          chunk.isError || isBlocked2,
          parsed == null ? void 0 : parsed.questions
        );
      }
      if (askQuestionState) {
        state.askUserQuestionStates.delete(chunk.id);
      }
      if (state.currentContentEl) {
        this.showThinkingIndicator(state.currentContentEl);
      }
      return;
    }
    const isBlocked = isBlockedToolResult(chunk.content, chunk.isError);
    if (!existingToolCall && chunk.toolName && state.currentContentEl) {
      const toolCall = {
        id: chunk.id,
        name: chunk.toolName,
        input: {},
        status: isBlocked ? "blocked" : chunk.isError ? "error" : "completed",
        result: chunk.content,
        isExpanded: false
      };
      msg.toolCalls = msg.toolCalls || [];
      msg.toolCalls.push(toolCall);
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({ type: "tool_use", toolId: chunk.id });
      renderToolCall(state.currentContentEl, toolCall, state.toolCallElements);
      updateToolCallResult(chunk.id, toolCall, state.toolCallElements);
    }
    if (existingToolCall) {
      existingToolCall.status = isBlocked ? "blocked" : chunk.isError ? "error" : "completed";
      existingToolCall.result = chunk.content;
      const writeEditState = state.writeEditStates.get(chunk.id);
      if (writeEditState && isWriteEditTool(existingToolCall.name)) {
        if (!chunk.isError && !isBlocked) {
          const diffData = plugin.agentService.getDiffData(chunk.id);
          if (diffData) {
            existingToolCall.diffData = diffData;
            updateWriteEditWithDiff(writeEditState, diffData);
          }
        }
        finalizeWriteEditBlock(writeEditState, chunk.isError || isBlocked);
      } else {
        updateToolCallResult(chunk.id, existingToolCall, state.toolCallElements);
      }
    }
    if (state.currentContentEl) {
      this.showThinkingIndicator(state.currentContentEl);
    }
  }
  // ============================================
  // Text Block Management
  // ============================================
  /** Appends text to the current text block. */
  async appendText(text) {
    const { state } = this.deps;
    if (!state.currentContentEl) return;
    if (!state.currentTextEl) {
      state.currentTextEl = state.currentContentEl.createDiv({ cls: "ocop-text-block" });
      state.currentTextEl.addClass("ocop-text-block-streaming");
      state.currentTextContent = "";
    }
    state.currentTextContent += text;
    state.currentTextEl.append(text);
  }
  /** Finalizes the current text block. */
  async finalizeCurrentTextBlock(msg) {
    const { state, renderer } = this.deps;
    const finalizedText = (msg == null ? void 0 : msg.role) === "assistant" ? normalizeQuizMarkdown(state.currentTextContent) : state.currentTextContent;
    if (msg && finalizedText) {
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({ type: "text", content: finalizedText });
      if (msg.role === "assistant") {
        msg.quizQuestion = parseQuizQuestionMeta(finalizedText);
        msg.socraticTurn = parseSocraticMeta(finalizedText);
      }
    }
    if (state.currentTextEl && finalizedText) {
      state.currentTextEl.removeClass("ocop-text-block-streaming");
      await renderer.renderContent(state.currentTextEl, finalizedText);
    }
    state.currentTextEl = null;
    state.currentTextContent = "";
  }
  // ============================================
  // Thinking Block Management
  // ============================================
  /** Appends thinking content. */
  async appendThinking(content, msg) {
    const { state, renderer } = this.deps;
    if (!state.currentContentEl) return;
    this.hideThinkingIndicator();
    if (!state.currentThinkingState) {
      state.currentThinkingState = createThinkingBlock(
        state.currentContentEl,
        (el, md) => renderer.renderContent(el, md)
      );
    }
    await appendThinkingContent(state.currentThinkingState, content, (el, md) => renderer.renderContent(el, md));
  }
  /** Finalizes the current thinking block. */
  finalizeCurrentThinkingBlock(msg) {
    const { state } = this.deps;
    if (!state.currentThinkingState) return;
    const durationSeconds = finalizeThinkingBlock(state.currentThinkingState);
    if (state.currentContentEl) {
      this.showThinkingIndicator(state.currentContentEl);
    }
    if (msg && state.currentThinkingState.content) {
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({
        type: "thinking",
        content: state.currentThinkingState.content,
        durationSeconds
      });
    }
    state.currentThinkingState = null;
  }
  // ============================================
  // Sync Subagent Handling
  // ============================================
  /** Handles Task tool_use by creating a sync subagent block. */
  async handleTaskToolUse(chunk, msg) {
    const { state } = this.deps;
    if (!state.currentContentEl) return;
    const subagentState = createSubagentBlock(state.currentContentEl, chunk.id, chunk.input);
    state.activeSubagents.set(chunk.id, subagentState);
    msg.subagents = msg.subagents || [];
    msg.subagents.push(subagentState.info);
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: "subagent", subagentId: chunk.id });
    this.showThinkingIndicator(state.currentContentEl);
  }
  /** Routes chunks from subagents. */
  async handleSubagentChunk(chunk, msg) {
    if (!("parentToolUseId" in chunk) || !chunk.parentToolUseId) {
      return;
    }
    const parentToolUseId = chunk.parentToolUseId;
    const { state } = this.deps;
    const subagentState = state.activeSubagents.get(parentToolUseId);
    if (!subagentState) {
      return;
    }
    switch (chunk.type) {
      case "tool_use": {
        const toolCall = {
          id: chunk.id,
          name: chunk.name,
          input: chunk.input,
          status: "running",
          isExpanded: false
        };
        addSubagentToolCall(subagentState, toolCall);
        if (state.currentContentEl) {
          this.showThinkingIndicator(state.currentContentEl);
        }
        break;
      }
      case "tool_result": {
        const toolCall = subagentState.info.toolCalls.find((tc) => tc.id === chunk.id);
        if (toolCall) {
          const isBlocked = isBlockedToolResult(chunk.content, chunk.isError);
          toolCall.status = isBlocked ? "blocked" : chunk.isError ? "error" : "completed";
          toolCall.result = chunk.content;
          updateSubagentToolResult(subagentState, chunk.id, toolCall);
        }
        break;
      }
      case "text":
      case "thinking":
        break;
    }
  }
  /** Finalizes a sync subagent when its Task tool_result is received. */
  finalizeSubagent(chunk, msg, subagentState) {
    var _a;
    const { state } = this.deps;
    const isError = chunk.isError || false;
    finalizeSubagentBlock(subagentState, chunk.content, isError);
    const subagentInfo = (_a = msg.subagents) == null ? void 0 : _a.find((s) => s.id === chunk.id);
    if (subagentInfo) {
      subagentInfo.status = isError ? "error" : "completed";
      subagentInfo.result = chunk.content;
    }
    state.activeSubagents.delete(chunk.id);
    if (state.currentContentEl) {
      this.showThinkingIndicator(state.currentContentEl);
    }
  }
  // ============================================
  // Async Subagent Handling
  // ============================================
  /** Handles async Task tool_use (run_in_background=true). */
  async handleAsyncTaskToolUse(chunk, msg) {
    const { state, asyncSubagentManager } = this.deps;
    if (!state.currentContentEl) return;
    const subagentInfo = asyncSubagentManager.createAsyncSubagent(chunk.id, chunk.input);
    const asyncState = createAsyncSubagentBlock(state.currentContentEl, chunk.id, chunk.input);
    state.asyncSubagentStates.set(chunk.id, asyncState);
    msg.subagents = msg.subagents || [];
    msg.subagents.push(subagentInfo);
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: "subagent", subagentId: chunk.id, mode: "async" });
    this.showThinkingIndicator(state.currentContentEl);
  }
  /** Handles AgentOutputTool tool_use (invisible, links to async subagent). */
  handleAgentOutputToolUse(chunk, _msg) {
    const toolCall = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: "running",
      isExpanded: false
    };
    this.deps.asyncSubagentManager.handleAgentOutputToolUse(toolCall);
  }
  /** Handles async Task tool_result to extract agent_id. */
  handleAsyncTaskToolResult(chunk, _msg) {
    const { asyncSubagentManager } = this.deps;
    if (!asyncSubagentManager.isPendingAsyncTask(chunk.id)) {
      return false;
    }
    asyncSubagentManager.handleTaskToolResult(chunk.id, chunk.content, chunk.isError);
    return true;
  }
  /** Handles AgentOutputTool result to finalize async subagent. */
  handleAgentOutputToolResult(chunk, _msg) {
    const { asyncSubagentManager } = this.deps;
    const isLinked = asyncSubagentManager.isLinkedAgentOutputTool(chunk.id);
    const handled = asyncSubagentManager.handleAgentOutputToolResult(
      chunk.id,
      chunk.content,
      chunk.isError || false
    );
    return isLinked || handled !== void 0;
  }
  /** Callback from AsyncSubagentManager when state changes. */
  onAsyncSubagentStateChange(subagent) {
    const { state } = this.deps;
    let asyncState = state.asyncSubagentStates.get(subagent.id);
    if (!asyncState) {
      for (const s of state.asyncSubagentStates.values()) {
        if (s.info.agentId === subagent.agentId) {
          asyncState = s;
          break;
        }
      }
      if (!asyncState) return;
    }
    this.updateAsyncSubagentUI(asyncState, subagent);
  }
  /** Updates async subagent UI based on state. */
  updateAsyncSubagentUI(asyncState, subagent) {
    asyncState.info = subagent;
    switch (subagent.asyncStatus) {
      case "running":
        updateAsyncSubagentRunning(asyncState, subagent.agentId || "");
        break;
      case "completed":
      case "error":
        finalizeAsyncSubagent(asyncState, subagent.result || "", subagent.asyncStatus === "error");
        break;
      case "orphaned":
        markAsyncSubagentOrphaned(asyncState);
        break;
    }
    this.updateSubagentInMessages(subagent);
    this.queueScrollToBottom();
  }
  /** Updates subagent info in messages array. */
  updateSubagentInMessages(subagent) {
    const { state } = this.deps;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      if (msg.role === "assistant" && msg.subagents) {
        const idx = msg.subagents.findIndex((s) => s.id === subagent.id);
        if (idx !== -1) {
          msg.subagents[idx] = subagent;
          return;
        }
      }
    }
  }
  // ============================================
  // Thinking Indicator
  // ============================================
  /** Shows the thinking indicator. */
  showThinkingIndicator(parentEl) {
    const { state } = this.deps;
    if (state.thinkingEl) {
      parentEl.appendChild(state.thinkingEl);
      this.deps.updateQueueIndicator();
      return;
    }
    state.thinkingEl = parentEl.createDiv({ cls: "ocop-thinking" });
    const dotsEl = state.thinkingEl.createSpan({ cls: "ocop-thinking-dots" });
    dotsEl.createSpan({ cls: "ocop-thinking-dot" });
    dotsEl.createSpan({ cls: "ocop-thinking-dot" });
    dotsEl.createSpan({ cls: "ocop-thinking-dot" });
    state.thinkingEl.createSpan({ text: " \uC791\uC5C5 \uC911", cls: "ocop-thinking-status" });
    if (!this.deps.plugin.agentService.isCliReady()) {
      state.thinkingEl.createSpan({ text: " Copilot \uC2DC\uC791 \uC911...", cls: "ocop-thinking-startup" });
    }
    state.queueIndicatorEl = state.thinkingEl.createDiv({ cls: "ocop-queue-indicator" });
    this.deps.updateQueueIndicator();
  }
  /** Hides the thinking indicator. */
  hideThinkingIndicator() {
    const { state } = this.deps;
    if (state.thinkingEl) {
      state.thinkingEl.remove();
      state.thinkingEl = null;
    }
    state.queueIndicatorEl = null;
  }
  // ============================================
  // Utilities
  // ============================================
  /** Schedules a batched auto-scroll on the next animation frame. */
  queueScrollToBottom() {
    if (this.pendingScrollFrameId !== null) {
      return;
    }
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback) => globalThis.setTimeout(() => callback(Date.now()), 16);
    this.pendingScrollFrameId = schedule(() => {
      this.pendingScrollFrameId = null;
      if (typeof this.deps.renderer.scrollToBottomIfNeeded === "function") {
        this.deps.renderer.scrollToBottomIfNeeded();
      } else {
        const messagesEl = this.deps.getMessagesEl();
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
  }
  cancelQueuedScroll() {
    if (this.pendingScrollFrameId !== null) {
      if (typeof cancelAnimationFrame === "function" && typeof this.pendingScrollFrameId === "number") {
        cancelAnimationFrame(this.pendingScrollFrameId);
      } else {
        clearTimeout(this.pendingScrollFrameId);
      }
      this.pendingScrollFrameId = null;
    }
  }
  /**
   * After stream finalization, scans the last text contentBlock for A)/B) choice patterns.
   * If ≥2 sequential options found, injects clickable choice buttons below the message content.
   */
  injectChoiceButtonsIfNeeded(contentEl, msg, onSelect) {
    var _a;
    const lastTextBlock = [...(_a = msg.contentBlocks) != null ? _a : []].reverse().find((b) => b.type === "text" && b.content);
    if (!lastTextBlock || lastTextBlock.type !== "text" || !lastTextBlock.content) return;
    const options = this.parseChoiceOptions(lastTextBlock.content);
    if (!options) return;
    const panel = contentEl.createDiv({ cls: "ocop-choice-buttons" });
    for (const opt of options) {
      const btn = panel.createEl("button", { cls: "ocop-choice-btn" });
      btn.createSpan({ cls: "ocop-choice-btn-label", text: opt.label + ")" });
      btn.createSpan({ cls: "ocop-choice-btn-text", text: " " + opt.text });
      btn.addEventListener("click", () => {
        panel.remove();
        onSelect(opt.label);
      });
    }
  }
  /** Parses A)/B) option lines from text. Returns ≥2 sequential options or null. */
  parseChoiceOptions(text) {
    const options = [];
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z])\)\s+(.+)$/);
      if (m) {
        options.push({ label: m[1], text: m[2].trim() });
      }
    }
    if (options.length < 2) return null;
    const expectedStart = "A".charCodeAt(0);
    if (options[0].label.charCodeAt(0) !== expectedStart) return null;
    for (let i = 1; i < options.length; i++) {
      if (options[i].label.charCodeAt(0) !== expectedStart + i) return null;
    }
    return options;
  }
  /** Resets streaming state after completion. */
  resetStreamingState() {
    const { state } = this.deps;
    this.cancelQueuedScroll();
    this.hideThinkingIndicator();
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = "";
    state.currentThinkingState = null;
    state.activeSubagents.clear();
  }
};

// src/features/chat/rendering/MessageRenderer.ts
var import_obsidian23 = require("obsidian");

// src/core/images/imageLoader.ts
var fs9 = __toESM(require("fs"));
var path12 = __toESM(require("path"));
init_path();
function resolveImageFilePath(filePath, vaultPath) {
  const normalized = normalizePathForFilesystem(filePath);
  if (path12.isAbsolute(normalized)) {
    return normalized;
  }
  if (vaultPath) {
    return path12.join(vaultPath, normalized);
  }
  return null;
}
function readFileBase64(absPath) {
  try {
    const buffer = fs9.readFileSync(absPath);
    return buffer.toString("base64");
  } catch (error) {
    console.warn("Failed to read image file:", absPath, error);
    return null;
  }
}
function readImageAttachmentBase64(app, image, vaultPath) {
  if (image.cachePath) {
    const cached = readCachedImageBase64(app, image.cachePath);
    if (cached) return cached;
  }
  if (image.filePath) {
    const vault = vaultPath != null ? vaultPath : getVaultPath(app);
    const absPath = resolveImageFilePath(image.filePath, vault);
    if (absPath && fs9.existsSync(absPath)) {
      return readFileBase64(absPath);
    }
  }
  return null;
}
function ensureImageAttachmentBase64(app, image, vaultPath) {
  if (image.data) return image.data;
  const base64 = readImageAttachmentBase64(app, image, vaultPath);
  if (base64) {
    image.data = base64;
  }
  return base64;
}
function toImageDataUri(mediaType, base64) {
  return `data:${mediaType};base64,${base64}`;
}
function getImageAttachmentDataUri(app, image, vaultPath) {
  const base64 = ensureImageAttachmentBase64(app, image, vaultPath);
  if (!base64) return null;
  return toImageDataUri(image.mediaType, base64);
}

// src/utils/fileLink.ts
var WIKILINK_PATTERN = /(?<!!)\[\[([^\]|#^]+)(?:#[^\]|]+)?(?:\^[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
function extractLinkTarget(fullMatch) {
  const inner = fullMatch.slice(2, -2);
  const pipeIndex = inner.indexOf("|");
  return pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner;
}
function findWikilinks(app, text) {
  WIKILINK_PATTERN.lastIndex = 0;
  const matches = [];
  let match;
  while ((match = WIKILINK_PATTERN.exec(text)) !== null) {
    const fullMatch = match[0];
    const linkPath = match[1];
    const linkTarget = extractLinkTarget(fullMatch);
    if (!fileExistsInVault(app, linkPath)) continue;
    const pipeIndex = fullMatch.lastIndexOf("|");
    const displayText = pipeIndex > 0 ? fullMatch.slice(pipeIndex + 1, -2) : linkPath;
    matches.push({ index: match.index, fullMatch, linkPath, linkTarget, displayText });
  }
  return matches.sort((a, b) => b.index - a.index);
}
function fileExistsInVault(app, linkPath) {
  const file = app.metadataCache.getFirstLinkpathDest(linkPath, "");
  if (file) {
    return true;
  }
  const directFile = app.vault.getFileByPath(linkPath);
  if (directFile) {
    return true;
  }
  if (!linkPath.endsWith(".md")) {
    const withExt = app.vault.getFileByPath(linkPath + ".md");
    if (withExt) {
      return true;
    }
  }
  return false;
}
function createWikilink(linkTarget, displayText) {
  const link = document.createElement("a");
  link.className = "ocop-file-link internal-link";
  link.textContent = displayText;
  link.setAttribute("data-href", linkTarget);
  link.setAttribute("href", linkTarget);
  return link;
}
function registerFileLinkHandler(app, container, component) {
  component.registerDomEvent(container, "click", (event) => {
    const target = event.target;
    const link = target.closest(".ocop-file-link, .internal-link");
    if (link) {
      event.preventDefault();
      const linkTarget = link.dataset.href || link.getAttribute("href");
      if (linkTarget) {
        void app.workspace.openLinkText(linkTarget, "", "tab");
      }
    }
  });
}
function buildFragmentWithLinks(text, matches) {
  const fragment = document.createDocumentFragment();
  let currentIndex = text.length;
  for (const { index, fullMatch, linkTarget, displayText } of matches) {
    const endIndex = index + fullMatch.length;
    if (endIndex < currentIndex) {
      fragment.insertBefore(
        document.createTextNode(text.slice(endIndex, currentIndex)),
        fragment.firstChild
      );
    }
    fragment.insertBefore(createWikilink(linkTarget, displayText), fragment.firstChild);
    currentIndex = index;
  }
  if (currentIndex > 0) {
    fragment.insertBefore(
      document.createTextNode(text.slice(0, currentIndex)),
      fragment.firstChild
    );
  }
  return fragment;
}
function processTextNode(app, node) {
  var _a;
  const text = node.textContent;
  if (!text || !text.includes("[[")) return false;
  const matches = findWikilinks(app, text);
  if (matches.length === 0) return false;
  (_a = node.parentNode) == null ? void 0 : _a.replaceChild(buildFragmentWithLinks(text, matches), node);
  return true;
}
function processFileLinks(app, container) {
  if (!app || !container) return;
  container.querySelectorAll("code").forEach((codeEl) => {
    var _a;
    if (((_a = codeEl.parentElement) == null ? void 0 : _a.tagName) === "PRE") return;
    const text = codeEl.textContent;
    if (!text || !text.includes("[[")) return;
    const matches = findWikilinks(app, text);
    if (matches.length === 0) return;
    codeEl.textContent = "";
    codeEl.appendChild(buildFragmentWithLinks(text, matches));
  });
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node2) {
        const parent = node2.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tagName = parent.tagName.toUpperCase();
        if (tagName === "PRE" || tagName === "CODE" || tagName === "A") {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest("pre, code, a, .ocop-file-link, .internal-link")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  const textNodes = [];
  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }
  for (const textNode of textNodes) {
    processTextNode(app, textNode);
  }
}

// src/features/chat/rendering/MessageRenderer.ts
var WELCOME_SUGGESTIONS = [
  "Summarize the current note and outline what matters.",
  "Plan a code or note change before editing anything.",
  "Compare attached files and call out the important differences."
];
var MessageRenderer = class {
  constructor(app, component, messagesEl) {
    this.app = app;
    this.component = component;
    this.messagesEl = messagesEl;
    registerFileLinkHandler(this.app, this.messagesEl, this.component);
  }
  /** Sets the messages container element. */
  setMessagesEl(el) {
    this.messagesEl = el;
  }
  // ============================================
  // Streaming Message Rendering
  // ============================================
  /**
   * Adds a new message to the chat during streaming.
   * Returns the message element for content updates.
   */
  addMessage(msg) {
    var _a, _b;
    if (msg.hidden) {
      this.ensureTodoPanelAtBottom();
      this.scrollToBottom();
      const lastChild = this.messagesEl.lastElementChild;
      return lastChild != null ? lastChild : this.messagesEl;
    }
    if (msg.approvalIndicator) {
      const indicatorEl = this.renderApprovalIndicator(msg.approvalIndicator);
      this.ensureTodoPanelAtBottom();
      this.scrollToBottom();
      return indicatorEl;
    }
    if (msg.role === "user" && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }
    if (msg.role === "user") {
      const textToShow = (_a = msg.displayContent) != null ? _a : msg.content;
      if (!textToShow) {
        this.ensureTodoPanelAtBottom();
        this.scrollToBottom();
        const lastChild = this.messagesEl.lastElementChild;
        return lastChild != null ? lastChild : this.messagesEl;
      }
    }
    const msgEl = this.messagesEl.createDiv({
      cls: `ocop-message ocop-message-${msg.role}`
    });
    const contentEl = msgEl.createDiv({ cls: "ocop-message-content" });
    if (msg.role === "assistant") {
      this.createCopyButton(msgEl, msg);
    }
    if (msg.role === "user") {
      const textToShow = (_b = msg.displayContent) != null ? _b : msg.content;
      if (textToShow) {
        const textEl = contentEl.createDiv({ cls: "ocop-text-block" });
        void this.renderContent(textEl, textToShow).then(() => markMentions(textEl));
      }
    }
    this.ensureTodoPanelAtBottom();
    this.scrollToBottom();
    return msgEl;
  }
  // ============================================
  // Stored Message Rendering (Batch/Replay)
  // ============================================
  /**
   * Renders all messages for conversation load/switch.
   * @param messages Array of messages to render
   * @param getGreeting Function to get greeting text
   * @returns The newly created welcome element
   */
  renderMessages(messages, getGreeting) {
    const existingTodoPanel = this.messagesEl.querySelector(".ocop-todo-panel");
    this.messagesEl.empty();
    const newWelcomeEl = this.createWelcomeElement(getGreeting());
    for (const msg of messages) {
      this.renderStoredMessage(msg);
    }
    this.ensureTodoPanelAtBottom(existingTodoPanel);
    this.scrollToBottom();
    return newWelcomeEl;
  }
  createWelcomeElement(greeting) {
    const welcomeEl = this.messagesEl.createDiv({ cls: "ocop-welcome" });
    welcomeEl.createDiv({ cls: "ocop-welcome-greeting", text: greeting });
    welcomeEl.createDiv({
      cls: "ocop-welcome-subtitle",
      text: "Your vault-aware pair programmer for note analysis, planning, and implementation work."
    });
    const suggestionsEl = welcomeEl.createDiv({ cls: "ocop-welcome-suggestions" });
    for (const prompt of WELCOME_SUGGESTIONS) {
      const button = suggestionsEl.createEl("button", {
        cls: "ocop-welcome-suggestion",
        text: prompt
      });
      button.type = "button";
    }
    return welcomeEl;
  }
  /**
   * Renders a persisted message from history.
   */
  renderStoredMessage(msg) {
    var _a, _b;
    if (msg.hidden) {
      return;
    }
    if (msg.approvalIndicator) {
      this.renderApprovalIndicator(msg.approvalIndicator);
      return;
    }
    if (msg.role === "user" && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }
    if (msg.role === "user") {
      const textToShow = (_a = msg.displayContent) != null ? _a : msg.content;
      if (!textToShow) {
        return;
      }
    }
    const msgEl = this.messagesEl.createDiv({
      cls: `ocop-message ocop-message-${msg.role}`
    });
    if (msg.isPlanMessage) {
      msgEl.classList.add("ocop-message-plan");
    }
    const contentEl = msgEl.createDiv({ cls: "ocop-message-content" });
    if (msg.role === "assistant") {
      this.createCopyButton(msgEl, msg);
    }
    if (msg.role === "user") {
      const textToShow = (_b = msg.displayContent) != null ? _b : msg.content;
      if (textToShow) {
        const textEl = contentEl.createDiv({ cls: "ocop-text-block" });
        void this.renderContent(textEl, textToShow);
      }
    } else if (msg.role === "assistant") {
      this.renderAssistantContent(msg, contentEl);
    }
  }
  /**
   * Renders an approval indicator for plan mode decisions.
   */
  renderApprovalIndicator(indicator) {
    const indicatorEl = this.messagesEl.createDiv({
      cls: "ocop-approval-indicator"
    });
    const iconEl = indicatorEl.createSpan({ cls: "ocop-approval-indicator-icon" });
    const textEl = indicatorEl.createSpan({ cls: "ocop-approval-indicator-text" });
    switch (indicator.type) {
      case "approve":
        indicatorEl.classList.add("ocop-approval-indicator-approve");
        (0, import_obsidian23.setIcon)(iconEl, "check");
        textEl.textContent = "User approved plan.";
        break;
      case "approve_new_session":
        indicatorEl.classList.add("ocop-approval-indicator-approve");
        (0, import_obsidian23.setIcon)(iconEl, "check");
        textEl.textContent = "User approved plan, implement in new session.";
        break;
      case "revise":
        indicatorEl.classList.add("ocop-approval-indicator-revise");
        (0, import_obsidian23.setIcon)(iconEl, "x");
        textEl.textContent = indicator.feedback || "User requested revision.";
        break;
    }
    return indicatorEl;
  }
  /**
   * Renders assistant message content (content blocks or fallback).
   */
  renderAssistantContent(msg, contentEl) {
    var _a, _b;
    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      for (const block of msg.contentBlocks) {
        if (block.type === "thinking") {
          renderStoredThinkingBlock(
            contentEl,
            block.content,
            block.durationSeconds,
            (el, md) => this.renderContent(el, md)
          );
        } else if (block.type === "text") {
          const textEl = contentEl.createDiv({ cls: "ocop-text-block" });
          void this.renderContent(textEl, block.content);
        } else if (block.type === "tool_use") {
          const toolCall = (_a = msg.toolCalls) == null ? void 0 : _a.find((tc) => tc.id === block.toolId);
          if (toolCall) {
            this.renderToolCall(contentEl, toolCall);
          }
        } else if (block.type === "subagent") {
          const subagent = (_b = msg.subagents) == null ? void 0 : _b.find((s) => s.id === block.subagentId);
          if (subagent) {
            const mode = block.mode || subagent.mode || "sync";
            if (mode === "async") {
              renderStoredAsyncSubagent(contentEl, subagent);
            } else {
              renderStoredSubagent(contentEl, subagent);
            }
          }
        }
      }
    } else {
      if (msg.content) {
        const textEl = contentEl.createDiv({ cls: "ocop-text-block" });
        void this.renderContent(textEl, msg.content);
      }
      if (msg.toolCalls) {
        for (const toolCall of msg.toolCalls) {
          this.renderToolCall(contentEl, toolCall);
        }
      }
    }
    if (msg.quizQuestion) {
      this.renderQuizAnswerActions(contentEl, msg.quizQuestion);
    }
  }
  renderQuizAnswerActions(contentEl, quizQuestion) {
    const progressWrapper = contentEl.createDiv({ cls: "ocop-quiz-progress-wrapper" });
    const progressEl = progressWrapper.createDiv({ cls: "ocop-quiz-progress" });
    const fillPct = Math.round(quizQuestion.current / quizQuestion.total * 100);
    progressEl.createDiv({ cls: "ocop-quiz-progress-fill", attr: { style: `width: ${fillPct}%` } });
    progressWrapper.createSpan({ cls: "ocop-quiz-progress-label", text: `${quizQuestion.current} / ${quizQuestion.total}\uBC88` });
    const actionsEl = contentEl.createDiv({ cls: "ocop-quiz-actions" });
    if (quizQuestion.freeText) {
      const input = actionsEl.createEl("input", {
        cls: "ocop-quiz-answer-freetext-input",
        attr: { type: "text", placeholder: "\uB2F5\uBCC0\uC744 \uC785\uB825\uD558\uC138\uC694", "data-freetext-input": "true" }
      });
      const submitBtn2 = actionsEl.createEl("button", {
        cls: "ocop-quiz-submit-btn",
        text: "\uC81C\uCD9C",
        attr: { "data-answer-submit": "true" }
      });
      submitBtn2.type = "button";
      submitBtn2.addEventListener("click", () => {
        const value = input.value.trim();
        if (value) {
          submitBtn2.setAttribute("data-answer-value", value);
        }
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const value = input.value.trim();
          if (value) {
            submitBtn2.setAttribute("data-answer-value", value);
            submitBtn2.click();
          }
        }
      });
      return;
    }
    const selected = /* @__PURE__ */ new Set();
    let submitBtn = null;
    if (quizQuestion.multiSelect) {
      submitBtn = actionsEl.createEl("button", {
        cls: "ocop-quiz-submit-btn",
        text: "\uC120\uD0DD \uC81C\uCD9C",
        attr: { "data-answer-submit": "true" }
      });
      submitBtn.type = "button";
      submitBtn.disabled = true;
      submitBtn.addEventListener("click", () => {
        submitBtn == null ? void 0 : submitBtn.setAttribute("data-answer-value", Array.from(selected).sort().join(","));
      });
    }
    for (const option of quizQuestion.options) {
      const button = actionsEl.createEl("button", {
        cls: "ocop-quiz-answer-btn",
        text: `${option.label}. ${option.text}`,
        attr: {
          "data-answer-label": option.label,
          "data-answer-text": option.text,
          "data-multi-select": quizQuestion.multiSelect ? "true" : "false"
        }
      });
      button.type = "button";
      if (quizQuestion.multiSelect) {
        button.addEventListener("click", () => {
          if (selected.has(option.label)) {
            selected.delete(option.label);
            button.removeClass("is-selected");
          } else {
            selected.add(option.label);
            button.addClass("is-selected");
          }
          if (submitBtn) {
            submitBtn.disabled = selected.size === 0;
          }
        });
      }
    }
  }
  /**
   * Renders a tool call with special handling for Write/Edit, and AskUserQuestion.
   * TodoWrite is not rendered inline - it only shows in the bottom panel.
   */
  renderToolCall(contentEl, toolCall) {
    if (toolCall.name === TOOL_TODO_WRITE) {
      return;
    } else if (toolCall.name === TOOL_ASK_USER_QUESTION) {
      renderStoredAskUserQuestion(contentEl, toolCall);
    } else if (isWriteEditTool(toolCall.name)) {
      renderStoredWriteEdit(contentEl, toolCall);
    } else {
      renderStoredToolCall(contentEl, toolCall);
    }
  }
  // ============================================
  // Image Rendering
  // ============================================
  /**
   * Renders image attachments above a message.
   */
  renderMessageImages(containerEl, images) {
    const imagesEl = containerEl.createDiv({ cls: "ocop-message-images" });
    for (const image of images) {
      const imageWrapper = imagesEl.createDiv({ cls: "ocop-message-image" });
      const imgEl = imageWrapper.createEl("img", {
        attr: {
          alt: image.name
        }
      });
      void this.setImageSrc(imgEl, image);
      imgEl.addEventListener("click", () => {
        void this.showFullImage(image);
      });
    }
  }
  /**
   * Shows full-size image in modal overlay.
   */
  async showFullImage(image) {
    const dataUri = getImageAttachmentDataUri(this.app, image);
    if (!dataUri) return;
    const overlay = document.body.createDiv({ cls: "ocop-image-modal-overlay" });
    const modal = overlay.createDiv({ cls: "ocop-image-modal" });
    modal.createEl("img", {
      attr: {
        src: dataUri,
        alt: image.name
      }
    });
    const closeBtn = modal.createDiv({ cls: "ocop-image-modal-close" });
    closeBtn.setText("\xD7");
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        close();
      }
    };
    const close = () => {
      document.removeEventListener("keydown", handleEsc);
      overlay.remove();
    };
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", handleEsc);
  }
  /**
   * Sets image src from attachment data.
   */
  async setImageSrc(imgEl, image) {
    const dataUri = getImageAttachmentDataUri(this.app, image);
    if (dataUri) {
      imgEl.setAttribute("src", dataUri);
    } else {
      imgEl.setAttribute("alt", `${image.name} (missing)`);
    }
  }
  // ============================================
  // Content Rendering
  // ============================================
  /**
   * Renders markdown content with code block enhancements.
   */
  async renderContent(el, markdown) {
    el.empty();
    await import_obsidian23.MarkdownRenderer.renderMarkdown(markdown, el, "", this.component);
    el.querySelectorAll("pre").forEach((pre) => {
      var _a, _b;
      if ((_a = pre.parentElement) == null ? void 0 : _a.classList.contains("ocop-code-wrapper")) return;
      const wrapper = createEl("div", { cls: "ocop-code-wrapper" });
      (_b = pre.parentElement) == null ? void 0 : _b.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);
      const code = pre.querySelector('code[class*="language-"]');
      if (code) {
        const match = code.className.match(/language-(\w+)/);
        if (match) {
          wrapper.classList.add("has-language");
          const label = createEl("span", {
            cls: "ocop-code-lang-label",
            text: match[1]
          });
          wrapper.appendChild(label);
          label.addEventListener("click", async () => {
            await navigator.clipboard.writeText(code.textContent || "");
            label.setText("copied!");
            setTimeout(() => label.setText(match[1]), 1500);
          });
        }
      }
      const copyBtn = pre.querySelector(".copy-code-button");
      if (copyBtn) {
        wrapper.appendChild(copyBtn);
      }
    });
    processFileLinks(this.app, el);
  }
  // ============================================
  // Utilities
  // ============================================
  /** Creates a copy button for assistant messages. */
  createCopyButton(msgEl, msg) {
    const btn = msgEl.createEl("button", {
      cls: "ocop-msg-copy-btn",
      attr: { "aria-label": "Copy message", type: "button" }
    });
    (0, import_obsidian23.setIcon)(btn, "copy");
    btn.addEventListener("click", () => {
      void navigator.clipboard.writeText(msg.content).then(() => {
        (0, import_obsidian23.setIcon)(btn, "check");
        btn.classList.add("is-copied");
        setTimeout(() => {
          (0, import_obsidian23.setIcon)(btn, "copy");
          btn.classList.remove("is-copied");
        }, 1500);
      });
    });
  }
  /** Scrolls messages container to bottom. */
  scrollToBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
  /** Scrolls to bottom if already near bottom (within threshold). */
  scrollToBottomIfNeeded(threshold = 100) {
    const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold;
    if (isNearBottom) {
      requestAnimationFrame(() => {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      });
    }
  }
  /** Keeps the persistent todo panel pinned to the bottom of the messages container. */
  ensureTodoPanelAtBottom(panelEl) {
    const todoPanel = panelEl != null ? panelEl : this.messagesEl.querySelector(".ocop-todo-panel");
    if (todoPanel) {
      this.messagesEl.appendChild(todoPanel);
    }
  }
};

// src/features/chat/services/AsyncSubagentManager.ts
var AsyncSubagentManager = class {
  constructor(onStateChange) {
    this.activeAsyncSubagents = /* @__PURE__ */ new Map();
    this.pendingAsyncSubagents = /* @__PURE__ */ new Map();
    this.taskIdToAgentId = /* @__PURE__ */ new Map();
    this.outputToolIdToAgentId = /* @__PURE__ */ new Map();
    this.onStateChange = onStateChange;
  }
  /** Checks if a Task tool input indicates async mode (run_in_background=true). */
  isAsyncTask(taskInput) {
    return taskInput.run_in_background === true;
  }
  /** Creates an async subagent in pending state. */
  createAsyncSubagent(taskToolId, taskInput) {
    const description = taskInput.description || "Background task";
    const subagent = {
      id: taskToolId,
      description,
      mode: "async",
      isExpanded: false,
      status: "running",
      toolCalls: [],
      asyncStatus: "pending"
    };
    this.pendingAsyncSubagents.set(taskToolId, subagent);
    return subagent;
  }
  /** Handles Task tool_result to extract agent_id. Transitions: pending → running/error. */
  handleTaskToolResult(taskToolId, result, isError) {
    const subagent = this.pendingAsyncSubagents.get(taskToolId);
    if (!subagent) {
      return;
    }
    if (isError) {
      subagent.asyncStatus = "error";
      subagent.status = "error";
      subagent.result = result || "Task failed to start";
      subagent.completedAt = Date.now();
      this.pendingAsyncSubagents.delete(taskToolId);
      this.onStateChange(subagent);
      return;
    }
    const agentId = this.parseAgentId(result);
    if (!agentId) {
      subagent.asyncStatus = "error";
      subagent.status = "error";
      const truncatedResult = result.length > 100 ? result.substring(0, 100) + "..." : result;
      subagent.result = `Failed to parse agent_id. Result: ${truncatedResult}`;
      subagent.completedAt = Date.now();
      this.pendingAsyncSubagents.delete(taskToolId);
      this.onStateChange(subagent);
      return;
    }
    subagent.asyncStatus = "running";
    subagent.agentId = agentId;
    subagent.startedAt = Date.now();
    this.pendingAsyncSubagents.delete(taskToolId);
    this.activeAsyncSubagents.set(agentId, subagent);
    this.taskIdToAgentId.set(taskToolId, agentId);
    this.onStateChange(subagent);
  }
  /** Links AgentOutputTool to its async subagent for result routing. */
  handleAgentOutputToolUse(toolCall) {
    const agentId = this.extractAgentIdFromInput(toolCall.input);
    if (!agentId) {
      return;
    }
    const subagent = this.activeAsyncSubagents.get(agentId);
    if (!subagent) {
      return;
    }
    subagent.outputToolId = toolCall.id;
    this.outputToolIdToAgentId.set(toolCall.id, agentId);
  }
  /** Handles AgentOutputTool result. Transitions: running → completed/error (if done). */
  handleAgentOutputToolResult(toolId, result, isError) {
    let agentId = this.outputToolIdToAgentId.get(toolId);
    let subagent = agentId ? this.activeAsyncSubagents.get(agentId) : void 0;
    if (!subagent) {
      const inferredAgentId = this.inferAgentIdFromResult(result);
      if (inferredAgentId) {
        agentId = inferredAgentId;
        subagent = this.activeAsyncSubagents.get(inferredAgentId);
      }
    }
    if (!subagent) {
      return void 0;
    }
    if (agentId) {
      subagent.agentId = subagent.agentId || agentId;
      this.outputToolIdToAgentId.set(toolId, agentId);
    }
    const validStates = ["running"];
    if (!validStates.includes(subagent.asyncStatus)) {
      return void 0;
    }
    const stillRunning = this.isStillRunningResult(result, isError);
    if (stillRunning) {
      this.outputToolIdToAgentId.delete(toolId);
      return subagent;
    }
    const extractedResult = this.extractAgentResult(result, agentId != null ? agentId : "");
    subagent.asyncStatus = isError ? "error" : "completed";
    subagent.status = isError ? "error" : "completed";
    subagent.result = extractedResult;
    subagent.completedAt = Date.now();
    if (agentId) this.activeAsyncSubagents.delete(agentId);
    this.outputToolIdToAgentId.delete(toolId);
    this.onStateChange(subagent);
    return subagent;
  }
  /** Checks if AgentOutputTool result indicates the task is still running. */
  isStillRunningResult(result, isError) {
    const trimmed = (result == null ? void 0 : result.trim()) || "";
    const unwrapTextPayload = (raw) => {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const textBlock = parsed.find((b) => b && typeof b.text === "string");
          if (textBlock == null ? void 0 : textBlock.text) return textBlock.text;
        } else if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
          return parsed.text;
        }
      } catch (e) {
      }
      return raw;
    };
    const payload = unwrapTextPayload(trimmed);
    if (isError) {
      return false;
    }
    if (!trimmed) {
      return false;
    }
    try {
      const parsed = JSON.parse(payload);
      const status = parsed.retrieval_status || parsed.status;
      const hasAgents = parsed.agents && Object.keys(parsed.agents).length > 0;
      if (status === "not_ready" || status === "running" || status === "pending") {
        return true;
      }
      if (hasAgents) {
        const agentStatuses = Object.values(parsed.agents).map((a) => a && typeof a.status === "string" ? a.status.toLowerCase() : "");
        const anyRunning = agentStatuses.some(
          (s) => s === "running" || s === "pending" || s === "not_ready"
        );
        if (anyRunning) return true;
        return false;
      }
      if (status === "success" || status === "completed") {
        return false;
      }
      return false;
    } catch (e) {
    }
    const lowerResult = payload.toLowerCase();
    if (lowerResult.includes("not_ready") || lowerResult.includes("not ready")) {
      return true;
    }
    return false;
  }
  /** Extracts the actual result content from AgentOutputTool response. */
  extractAgentResult(result, agentId) {
    const unwrap = (raw) => {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const textBlock = parsed.find((b) => b && typeof b.text === "string");
          if (textBlock == null ? void 0 : textBlock.text) return textBlock.text;
        } else if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
          return parsed.text;
        }
      } catch (e) {
      }
      return raw;
    };
    const payload = unwrap(result);
    try {
      const parsed = JSON.parse(payload);
      if (parsed.agents && agentId && parsed.agents[agentId]) {
        const agentData = parsed.agents[agentId];
        if (agentData.result) {
          return agentData.result;
        }
        return JSON.stringify(agentData, null, 2);
      }
      if (parsed.agents) {
        const agentIds = Object.keys(parsed.agents);
        if (agentIds.length > 0) {
          const firstAgent = parsed.agents[agentIds[0]];
          if (firstAgent.result) {
            return firstAgent.result;
          }
          return JSON.stringify(firstAgent, null, 2);
        }
      }
    } catch (e) {
    }
    return payload;
  }
  /** Orphans all active async subagents when conversation ends. */
  orphanAllActive() {
    const orphaned = [];
    for (const subagent of this.pendingAsyncSubagents.values()) {
      subagent.asyncStatus = "orphaned";
      subagent.status = "error";
      subagent.result = "Conversation ended before task completed";
      subagent.completedAt = Date.now();
      orphaned.push(subagent);
      this.onStateChange(subagent);
    }
    for (const subagent of this.activeAsyncSubagents.values()) {
      if (subagent.asyncStatus === "running") {
        subagent.asyncStatus = "orphaned";
        subagent.status = "error";
        subagent.result = "Conversation ended before task completed";
        subagent.completedAt = Date.now();
        orphaned.push(subagent);
        this.onStateChange(subagent);
      }
    }
    this.pendingAsyncSubagents.clear();
    this.activeAsyncSubagents.clear();
    this.outputToolIdToAgentId.clear();
    return orphaned;
  }
  /** Clears all state for a new conversation. */
  clear() {
    this.pendingAsyncSubagents.clear();
    this.activeAsyncSubagents.clear();
    this.taskIdToAgentId.clear();
    this.outputToolIdToAgentId.clear();
  }
  /** Gets async subagent by agent_id. */
  getByAgentId(agentId) {
    return this.activeAsyncSubagents.get(agentId);
  }
  /** Gets async subagent by task tool_use_id. */
  getByTaskId(taskToolId) {
    const pending = this.pendingAsyncSubagents.get(taskToolId);
    if (pending) return pending;
    const agentId = this.taskIdToAgentId.get(taskToolId);
    if (agentId) {
      return this.activeAsyncSubagents.get(agentId);
    }
    return void 0;
  }
  /** Checks if a task tool_id is a pending async subagent. */
  isPendingAsyncTask(taskToolId) {
    return this.pendingAsyncSubagents.has(taskToolId);
  }
  /** Checks if a tool_id is an AgentOutputTool linked to an async subagent. */
  isLinkedAgentOutputTool(toolId) {
    return this.outputToolIdToAgentId.has(toolId);
  }
  /** Gets all active async subagents (pending + running). */
  getAllActive() {
    return [
      ...this.pendingAsyncSubagents.values(),
      ...this.activeAsyncSubagents.values()
    ];
  }
  /** Checks if there are any active async subagents. */
  hasActiveAsync() {
    return this.pendingAsyncSubagents.size > 0 || this.activeAsyncSubagents.size > 0;
  }
  /** Parses agent_id from Task tool_result. */
  parseAgentId(result) {
    var _a;
    const regexPatterns = [
      /"agent_id"\s*:\s*"([^"]+)"/,
      // JSON style: "agent_id": "value"
      /"agentId"\s*:\s*"([^"]+)"/,
      // camelCase JSON
      /agent_id[=:]\s*"?([a-zA-Z0-9_-]+)"?/i,
      // Flexible format
      /agentId[=:]\s*"?([a-zA-Z0-9_-]+)"?/i,
      // camelCase flexible
      /\b([a-f0-9]{8})\b/
      // Short hex ID (8 chars)
    ];
    for (const pattern of regexPatterns) {
      const match = result.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    try {
      const parsed = JSON.parse(result);
      const agentId = parsed.agent_id || parsed.agentId;
      if (typeof agentId === "string" && agentId.length > 0) {
        return agentId;
      }
      if ((_a = parsed.data) == null ? void 0 : _a.agent_id) {
        return parsed.data.agent_id;
      }
      if (parsed.id && typeof parsed.id === "string") {
        return parsed.id;
      }
    } catch (e) {
    }
    return null;
  }
  /** Infers agent_id from AgentOutputTool result payload. */
  inferAgentIdFromResult(result) {
    try {
      const parsed = JSON.parse(result);
      if (parsed.agents && typeof parsed.agents === "object") {
        const keys = Object.keys(parsed.agents);
        if (keys.length > 0) {
          return keys[0];
        }
      }
    } catch (e) {
    }
    return null;
  }
  /** Extracts agentId from AgentOutputTool input. */
  extractAgentIdFromInput(input) {
    const agentId = input.agentId || input.agent_id;
    return agentId || null;
  }
};

// src/core/prompts/instructionRefine.ts
function buildRefineSystemPrompt(existingInstructions) {
  const existingSection = existingInstructions.trim() ? `

EXISTING INSTRUCTIONS (already in the user's system prompt):
\`\`\`
${existingInstructions.trim()}
\`\`\`

When refining the new instruction:
- Consider how it fits with existing instructions
- Avoid duplicating existing instructions
- If the new instruction conflicts with an existing one, refine it to be complementary or note the conflict
- Match the format of existing instructions (section, heading, bullet points, style, etc.)` : "";
  return `You are an expert Prompt Engineer. You help users craft precise, effective system instructions for their AI assistant.

**Your Goal**: Transform vague or simple user requests into **high-quality, actionable, and non-conflicting** system prompt instructions.

**Process**:
1.  **Analyze Intent**: What behavior does the user want to enforce or change?
2.  **Check Context**: Does this conflict with existing instructions?
    - *No Conflict*: Add as new.
    - *Conflict*: Propose a **merged instruction** that resolves the contradiction (or ask if unsure).
3.  **Refine**: Draft a clear, positive instruction (e.g., "Do X" instead of "Don't do Y").
4.  **Format**: Return *only* the Markdown snippet wrapped in \`<instruction>\` tags.

**Guidelines**:
- **Clarity**: Use precise language. Avoid ambiguity.
- **Scope**: Keep it focused. Don't add unrelated rules.
- **Format**: Valid Markdown (bullets \`-\` or sections \`##\`).
- **No Header**: Do NOT include a top-level header like \`# Custom Instructions\`.
- **Conflict Handling**: If the new rule directly contradicts an existing one, rewrite the *new* one to override specific cases or ask for clarification.

**Output Format**:
- **Success**: \`<instruction>...markdown content...</instruction>\`
- **Ambiguity**: Plain text question.

${existingSection}

**Examples**:

Input: "typescript for code"
Output: <instruction>- **Code Language**: Always use TypeScript for code examples. Include proper type annotations and interfaces.</instruction>

Input: "be concise"
Output: <instruction>- **Conciseness**: Provide brief, direct responses. Omit conversational filler and unnecessary explanations.</instruction>

Input: "organize coding style rules"
Output: <instruction>## Coding Standards

- **Language**: Use TypeScript.
- **Style**: Prefer functional patterns.
- **Review**: Keep diffs small.</instruction>

Input: "use that thing from before"
Output: I'm not sure what you're referring to. Could you please clarify?`;
}

// src/features/chat/services/InstructionRefineService.ts
var InstructionRefineService = class {
  constructor(plugin) {
    this.abortController = null;
    this.existingInstructions = "";
    this.plugin = plugin;
  }
  resetConversation() {
  }
  async refineInstruction(rawInstruction, existingInstructions, onProgress) {
    this.existingInstructions = existingInstructions;
    const prompt = `Please refine this instruction: "${rawInstruction}"`;
    return this.sendMessage(prompt, onProgress);
  }
  async continueConversation(message, onProgress) {
    return this.sendMessage(message, onProgress);
  }
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
  async sendMessage(prompt, onProgress) {
    var _a;
    this.abortController = new AbortController();
    const systemPrompt = buildRefineSystemPrompt(this.existingInstructions);
    const fullPrompt = `${systemPrompt}

${prompt}`;
    try {
      let responseText = "";
      for await (const chunk of this.plugin.agentService.streamQuery(fullPrompt)) {
        if ((_a = this.abortController) == null ? void 0 : _a.signal.aborted) {
          return { success: false, error: "Cancelled" };
        }
        responseText += chunk;
        if (onProgress) {
          const partialResult = this.parseResponse(responseText);
          onProgress(partialResult);
        }
      }
      return this.parseResponse(responseText);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: msg };
    } finally {
      this.abortController = null;
    }
  }
  parseResponse(responseText) {
    const instructionMatch = responseText.match(/<instruction>([\s\S]*?)<\/instruction>/);
    if (instructionMatch) {
      return { success: true, refinedInstruction: instructionMatch[1].trim() };
    }
    const trimmed = responseText.trim();
    if (trimmed) {
      return { success: true, clarification: trimmed };
    }
    return { success: false, error: "Empty response" };
  }
};

// src/core/prompts/titleGeneration.ts
var TITLE_GENERATION_SYSTEM_PROMPT = `You are a specialist in summarizing intent.

**Task**: Generate a **concise, descriptive title** (max 50 chars) for this conversation based on the first interaction.

**Rules**:
1.  **Format**: Sentence case. No periods/quotes.
2.  **Structure**: Start with a **strong verb** (e.g., Create, Fix, Debug, Explain, Analyze).
3.  **Forbidden**: "Conversation with...", "Help me...", "Question about...", "I need...".
4.  **Tech Context**: Detect and include the primary language/framework if code is present (e.g., "Debug Python script", "Refactor React hook").

**Output**: Return ONLY the raw title text.`;

// src/features/chat/services/TitleGenerationService.ts
var TitleGenerationService = class {
  constructor(plugin) {
    this.activeGenerations = /* @__PURE__ */ new Map();
    this.plugin = plugin;
  }
  async generateTitle(conversationId, userMessage, assistantResponse, callback) {
    var _a;
    const existingController = this.activeGenerations.get(conversationId);
    if (existingController) {
      existingController.abort();
    }
    const abortController = new AbortController();
    this.activeGenerations.set(conversationId, abortController);
    const truncatedUser = this.truncateText(userMessage, 500);
    const truncatedAssistant = this.truncateText(assistantResponse, 500);
    const prompt = `${TITLE_GENERATION_SYSTEM_PROMPT}

User's first message:
"""
${truncatedUser}
"""

AI's response:
"""
${truncatedAssistant}
"""

Generate a title for this conversation:`;
    try {
      let responseText = "";
      const titleModel = (_a = this.plugin.settings.titleGenerationModel) == null ? void 0 : _a.trim();
      for await (const chunk of this.plugin.agentService.streamQuery(prompt, {
        skipResume: true,
        model: titleModel && titleModel !== "auto" ? titleModel : void 0
      })) {
        if (abortController.signal.aborted) {
          await this.safeCallback(callback, conversationId, {
            success: false,
            error: "Cancelled"
          });
          return;
        }
        responseText += chunk;
      }
      const title = this.parseTitle(responseText);
      if (title) {
        await this.safeCallback(callback, conversationId, { success: true, title });
      } else {
        console.warn("[TitleGeneration] Failed to parse title from response");
        await this.safeCallback(callback, conversationId, {
          success: false,
          error: "Failed to parse title from response"
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      const isConfigError = msg.includes("not configured") || msg.includes("CLI");
      if (error instanceof Error && error.name !== "AbortError" && !isConfigError) {
        console.error("[TitleGeneration] Error generating title:", error.message);
      }
      await this.safeCallback(callback, conversationId, { success: false, error: msg });
    } finally {
      this.activeGenerations.delete(conversationId);
    }
  }
  cancel() {
    for (const controller of this.activeGenerations.values()) {
      controller.abort();
    }
    this.activeGenerations.clear();
  }
  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }
  parseTitle(responseText) {
    const trimmed = responseText.trim();
    if (!trimmed) return null;
    let title = trimmed;
    if (title.startsWith('"') && title.endsWith('"') || title.startsWith("'") && title.endsWith("'")) {
      title = title.slice(1, -1);
    }
    title = title.replace(/[.!?:;,]+$/, "");
    if (title.length > 50) {
      title = title.substring(0, 47) + "...";
    }
    return title || null;
  }
  async safeCallback(callback, conversationId, result) {
    try {
      await callback(conversationId, result);
    } catch (error) {
      console.error("[TitleGeneration] Error in callback:", error instanceof Error ? error.message : error);
    }
  }
};

// src/features/chat/state/ChatState.ts
function createInitialState() {
  return {
    messages: [],
    isStreaming: false,
    cancelRequested: false,
    currentConversationId: null,
    queuedMessage: null,
    currentContentEl: null,
    currentTextEl: null,
    currentTextContent: "",
    currentThinkingState: null,
    thinkingEl: null,
    queueIndicatorEl: null,
    toolCallElements: /* @__PURE__ */ new Map(),
    activeSubagents: /* @__PURE__ */ new Map(),
    asyncSubagentStates: /* @__PURE__ */ new Map(),
    writeEditStates: /* @__PURE__ */ new Map(),
    askUserQuestionStates: /* @__PURE__ */ new Map(),
    usage: null,
    ignoreUsageUpdates: false,
    subagentsSpawnedThisStream: 0,
    planModeState: null,
    planModeRequested: false,
    planModeActivationPending: false,
    pendingPlanContent: null,
    currentTodos: null,
    quizSession: null,
    socraticSession: null
  };
}
var ChatState = class {
  constructor(callbacks = {}) {
    this.state = createInitialState();
    this.callbacks = callbacks;
  }
  // ============================================
  // Messages
  // ============================================
  get messages() {
    return this.state.messages;
  }
  set messages(value) {
    var _a, _b;
    this.state.messages = value;
    (_b = (_a = this.callbacks).onMessagesChanged) == null ? void 0 : _b.call(_a);
  }
  addMessage(msg) {
    var _a, _b;
    this.state.messages.push(msg);
    (_b = (_a = this.callbacks).onMessagesChanged) == null ? void 0 : _b.call(_a);
  }
  clearMessages() {
    var _a, _b;
    this.state.messages = [];
    (_b = (_a = this.callbacks).onMessagesChanged) == null ? void 0 : _b.call(_a);
  }
  // ============================================
  // Streaming Control
  // ============================================
  get isStreaming() {
    return this.state.isStreaming;
  }
  set isStreaming(value) {
    var _a, _b;
    this.state.isStreaming = value;
    (_b = (_a = this.callbacks).onStreamingStateChanged) == null ? void 0 : _b.call(_a, value);
  }
  get cancelRequested() {
    return this.state.cancelRequested;
  }
  set cancelRequested(value) {
    this.state.cancelRequested = value;
  }
  // ============================================
  // Conversation
  // ============================================
  get currentConversationId() {
    return this.state.currentConversationId;
  }
  set currentConversationId(value) {
    var _a, _b;
    this.state.currentConversationId = value;
    (_b = (_a = this.callbacks).onConversationChanged) == null ? void 0 : _b.call(_a, value);
  }
  // ============================================
  // Queued Message
  // ============================================
  get queuedMessage() {
    return this.state.queuedMessage;
  }
  set queuedMessage(value) {
    this.state.queuedMessage = value;
  }
  // ============================================
  // Streaming DOM State
  // ============================================
  get currentContentEl() {
    return this.state.currentContentEl;
  }
  set currentContentEl(value) {
    this.state.currentContentEl = value;
  }
  get currentTextEl() {
    return this.state.currentTextEl;
  }
  set currentTextEl(value) {
    this.state.currentTextEl = value;
  }
  get currentTextContent() {
    return this.state.currentTextContent;
  }
  set currentTextContent(value) {
    this.state.currentTextContent = value;
  }
  get currentThinkingState() {
    return this.state.currentThinkingState;
  }
  set currentThinkingState(value) {
    this.state.currentThinkingState = value;
  }
  get thinkingEl() {
    return this.state.thinkingEl;
  }
  set thinkingEl(value) {
    this.state.thinkingEl = value;
  }
  get queueIndicatorEl() {
    return this.state.queueIndicatorEl;
  }
  set queueIndicatorEl(value) {
    this.state.queueIndicatorEl = value;
  }
  // ============================================
  // Tool and Subagent Tracking Maps
  // ============================================
  get toolCallElements() {
    return this.state.toolCallElements;
  }
  get activeSubagents() {
    return this.state.activeSubagents;
  }
  get asyncSubagentStates() {
    return this.state.asyncSubagentStates;
  }
  get writeEditStates() {
    return this.state.writeEditStates;
  }
  get askUserQuestionStates() {
    return this.state.askUserQuestionStates;
  }
  // ============================================
  // Usage State
  // ============================================
  get usage() {
    return this.state.usage;
  }
  set usage(value) {
    var _a, _b;
    this.state.usage = value;
    (_b = (_a = this.callbacks).onUsageChanged) == null ? void 0 : _b.call(_a, value);
  }
  get ignoreUsageUpdates() {
    return this.state.ignoreUsageUpdates;
  }
  set ignoreUsageUpdates(value) {
    this.state.ignoreUsageUpdates = value;
  }
  get subagentsSpawnedThisStream() {
    return this.state.subagentsSpawnedThisStream;
  }
  set subagentsSpawnedThisStream(value) {
    this.state.subagentsSpawnedThisStream = value;
  }
  // ============================================
  // Plan Mode State
  // ============================================
  get planModeState() {
    return this.state.planModeState;
  }
  set planModeState(value) {
    this.state.planModeState = value;
  }
  /** Resets plan mode state. */
  resetPlanModeState() {
    this.state.planModeState = null;
  }
  get planModeRequested() {
    return this.state.planModeRequested;
  }
  set planModeRequested(value) {
    this.state.planModeRequested = value;
  }
  get planModeActivationPending() {
    return this.state.planModeActivationPending;
  }
  set planModeActivationPending(value) {
    this.state.planModeActivationPending = value;
  }
  // ============================================
  // Pending Plan Content (for approval persistence)
  // ============================================
  get pendingPlanContent() {
    return this.state.pendingPlanContent;
  }
  set pendingPlanContent(value) {
    this.state.pendingPlanContent = value;
  }
  // ============================================
  // Current Todos (for persistent bottom panel)
  // ============================================
  get currentTodos() {
    return this.state.currentTodos;
  }
  set currentTodos(value) {
    var _a, _b;
    const normalizedValue = value && value.length > 0 ? value : null;
    this.state.currentTodos = normalizedValue;
    (_b = (_a = this.callbacks).onTodosChanged) == null ? void 0 : _b.call(_a, normalizedValue);
  }
  get quizSession() {
    return this.state.quizSession;
  }
  set quizSession(value) {
    this.state.quizSession = value;
  }
  get socraticSession() {
    return this.state.socraticSession;
  }
  set socraticSession(value) {
    this.state.socraticSession = value;
  }
  // ============================================
  // Reset Methods
  // ============================================
  /** Resets streaming-related state. */
  resetStreamingState() {
    this.state.currentContentEl = null;
    this.state.currentTextEl = null;
    this.state.currentTextContent = "";
    this.state.currentThinkingState = null;
    this.state.isStreaming = false;
    this.state.cancelRequested = false;
  }
  /** Clears all maps for a new conversation. */
  clearMaps() {
    this.state.toolCallElements.clear();
    this.state.activeSubagents.clear();
    this.state.asyncSubagentStates.clear();
    this.state.writeEditStates.clear();
    this.state.askUserQuestionStates.clear();
  }
  /** Resets all state for a new conversation. */
  resetForNewConversation() {
    this.clearMessages();
    this.resetStreamingState();
    this.clearMaps();
    this.state.queuedMessage = null;
    this.state.planModeRequested = false;
    this.state.planModeActivationPending = false;
    this.usage = null;
    this.currentTodos = null;
    this.quizSession = null;
    this.socraticSession = null;
  }
  /** Gets persisted messages (strips image data). */
  getPersistedMessages() {
    return this.state.messages.map((msg) => {
      var _a;
      return {
        ...msg,
        images: (_a = msg.images) == null ? void 0 : _a.map((img) => {
          const { data, ...rest } = img;
          return { ...rest };
        })
      };
    });
  }
};

// src/features/chat/ObsidianCopilotView.ts
var ObsidianCopilotView = class extends import_obsidian25.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.selectionController = null;
    this.conversationController = null;
    this.streamController = null;
    this.inputController = null;
    this.navigationController = null;
    this.renderer = null;
    this.instructionRefineService = null;
    this.titleGenerationService = null;
    this.messagesEl = null;
    this.inputEl = null;
    this.inputWrapper = null;
    this.mentionHighlighter = null;
    this.historyDropdown = null;
    this.welcomeEl = null;
    this.selectionIndicatorEl = null;
    this.fileContextManager = null;
    this.imageContextManager = null;
    this.modelSelector = null;
    this.thinkingBudgetSelector = null;
    this.externalContextSelector = null;
    this.webSearchToggle = null;
    this.permissionToggle = null;
    this.slashCommandManager = null;
    this.slashCommandDropdown = null;
    this.instructionModeManager = null;
    this.contextUsageMeter = null;
    this.planBanner = null;
    this.socraticBanner = null;
    this.socraticLauncherButton = null;
    this.todoPanel = null;
    this.plugin = plugin;
    this.state = new ChatState({
      onUsageChanged: (usage) => {
        var _a;
        (_a = this.contextUsageMeter) == null ? void 0 : _a.update(usage);
      },
      onTodosChanged: (todos) => {
        var _a;
        return (_a = this.todoPanel) == null ? void 0 : _a.updateTodos(todos);
      }
    });
    this.asyncSubagentManager = new AsyncSubagentManager(
      (subagent) => {
        var _a;
        return (_a = this.streamController) == null ? void 0 : _a.onAsyncSubagentStateChange(subagent);
      }
    );
  }
  getViewType() {
    return VIEW_TYPE_OBSIDIAN_COPILOT;
  }
  getDisplayText() {
    return "Obsidian AI Tutor";
  }
  getIcon() {
    return "bot";
  }
  async onOpen() {
    var _a, _b;
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("ocop-container");
    const header = container.createDiv({ cls: "ocop-header" });
    this.buildHeader(header);
    this.planBanner = new PlanBanner({
      app: this.plugin.app,
      component: this
    });
    this.planBanner.mount(container);
    this.socraticBanner = new SocraticBanner();
    this.socraticBanner.mount(container);
    this.messagesEl = container.createDiv({ cls: "ocop-messages" });
    this.welcomeEl = this.messagesEl.createDiv({ cls: "ocop-welcome" });
    this.todoPanel = new TodoPanel();
    this.todoPanel.mount(this.messagesEl);
    const inputContainerEl = container.createDiv({ cls: "ocop-input-container" });
    this.buildInputArea(inputContainerEl);
    this.renderer = new MessageRenderer(this.plugin.app, this, this.messagesEl);
    this.initializeControllers();
    this.wireEventHandlers();
    (_a = this.selectionController) == null ? void 0 : _a.start();
    await ((_b = this.conversationController) == null ? void 0 : _b.createNew());
  }
  async onClose() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    (_a = this.mentionHighlighter) == null ? void 0 : _a.destroy();
    this.mentionHighlighter = null;
    (_b = this.selectionController) == null ? void 0 : _b.stop();
    (_c = this.selectionController) == null ? void 0 : _c.clear();
    (_d = this.navigationController) == null ? void 0 : _d.dispose();
    cleanupThinkingBlock(this.state.currentThinkingState);
    this.state.currentThinkingState = null;
    (_e = this.fileContextManager) == null ? void 0 : _e.destroy();
    (_f = this.slashCommandDropdown) == null ? void 0 : _f.destroy();
    this.slashCommandDropdown = null;
    this.slashCommandManager = null;
    (_g = this.instructionModeManager) == null ? void 0 : _g.destroy();
    this.instructionModeManager = null;
    (_h = this.instructionRefineService) == null ? void 0 : _h.cancel();
    this.instructionRefineService = null;
    (_i = this.titleGenerationService) == null ? void 0 : _i.cancel();
    this.titleGenerationService = null;
    (_j = this.todoPanel) == null ? void 0 : _j.destroy();
    this.todoPanel = null;
    this.asyncSubagentManager.orphanAllActive();
    this.state.asyncSubagentStates.clear();
    await ((_k = this.conversationController) == null ? void 0 : _k.save());
  }
  buildHeader(header) {
    const titleContainer = header.createDiv({ cls: "ocop-title" });
    const logoEl = titleContainer.createSpan({ cls: "ocop-logo" });
    logoEl.innerHTML = LOGO_SVG;
    titleContainer.createEl("h4", { text: "Obsidian AI Tutor" });
    const headerActions = header.createDiv({ cls: "ocop-header-actions" });
    const historyContainer = headerActions.createDiv({ cls: "ocop-history-container" });
    const trigger = historyContainer.createDiv({ cls: "ocop-header-btn" });
    (0, import_obsidian25.setIcon)(trigger, "history");
    trigger.setAttribute("aria-label", "Chat history");
    this.historyDropdown = historyContainer.createDiv({ cls: "ocop-history-menu" });
    trigger.addEventListener("click", (e) => {
      var _a;
      e.stopPropagation();
      (_a = this.conversationController) == null ? void 0 : _a.toggleHistoryDropdown();
    });
    const newBtn = headerActions.createDiv({ cls: "ocop-header-btn" });
    (0, import_obsidian25.setIcon)(newBtn, "plus");
    newBtn.setAttribute("aria-label", "New conversation");
    newBtn.addEventListener("click", () => {
      var _a;
      return (_a = this.conversationController) == null ? void 0 : _a.createNew();
    });
  }
  buildInputArea(inputContainerEl) {
    const chipsRowEl = inputContainerEl.createDiv({ cls: "ocop-chips-row" });
    const learningGroupEl = chipsRowEl.createDiv({ cls: "ocop-learning-group" });
    this.inputWrapper = inputContainerEl.createDiv({ cls: "ocop-input-wrapper" });
    this.selectionIndicatorEl = this.inputWrapper.createDiv({ cls: "ocop-selection-indicator" });
    this.selectionIndicatorEl.style.display = "none";
    this.inputEl = this.inputWrapper.createEl("textarea", {
      cls: "ocop-input",
      attr: {
        placeholder: "\uC774 \uB178\uD2B8\uB098 \uCCA8\uBD80\uD55C \uD30C\uC77C\uC5D0 \uB300\uD574 \uBB3C\uC5B4\uBCF4\uC138\uC694\u2026",
        rows: "3"
      }
    });
    this.mentionHighlighter = new MentionHighlighter(this.inputWrapper, this.inputEl);
    this.fileContextManager = new FileContextManager(
      this.plugin.app,
      chipsRowEl,
      this.inputEl,
      {
        getExcludedTags: () => this.plugin.settings.excludedTags,
        onChipsChanged: () => {
          var _a;
          return (_a = this.renderer) == null ? void 0 : _a.scrollToBottomIfNeeded();
        },
        getExternalContexts: () => {
          var _a;
          return ((_a = this.externalContextSelector) == null ? void 0 : _a.getExternalContexts()) || [];
        }
      }
    );
    this.imageContextManager = new ImageContextManager(
      this.plugin.app,
      chipsRowEl,
      this.inputEl,
      {
        onImagesChanged: () => {
          var _a;
          return (_a = this.renderer) == null ? void 0 : _a.scrollToBottomIfNeeded();
        },
        onVaultRefsDropped: (refs) => this.attachDroppedRefs(refs)
      }
    );
    const vaultPath = getVaultPath(this.plugin.app);
    if (vaultPath) {
      this.slashCommandManager = new SlashCommandManager(this.plugin.app, vaultPath);
      this.slashCommandManager.setCommands(this.plugin.settings.slashCommands);
      this.slashCommandDropdown = new SlashCommandDropdown(
        inputContainerEl,
        this.inputEl,
        {
          onSelect: () => {
          },
          onHide: () => {
          },
          getCommands: () => this.plugin.settings.slashCommands
        }
      );
    }
    this.instructionRefineService = new InstructionRefineService(this.plugin);
    this.titleGenerationService = new TitleGenerationService(this.plugin);
    this.instructionModeManager = new InstructionModeManager(
      this.inputEl,
      {
        onSubmit: async (rawInstruction) => {
          var _a;
          await ((_a = this.inputController) == null ? void 0 : _a.handleInstructionSubmit(rawInstruction));
        },
        getInputWrapper: () => this.inputWrapper
      }
    );
    const inputToolbar = this.inputWrapper.createDiv({ cls: "ocop-input-toolbar" });
    const toolbarComponents = createInputToolbar(inputToolbar, learningGroupEl, {
      getSettings: () => toToolbarSettings(this.plugin.settings),
      getEnvironmentVariables: () => this.plugin.getActiveEnvironmentVariables(),
      isAgentInitiatedPlanMode: () => {
        var _a, _b;
        return (_b = (_a = this.state.planModeState) == null ? void 0 : _a.agentInitiated) != null ? _b : false;
      },
      isPlanModeRequested: () => this.state.planModeRequested,
      confirmBlanketWrite: async (provider) => {
        var _a;
        const accepted = await new Promise((resolve6) => {
          new BlanketWriteConsentModal(this.app, getProviderDescriptor(provider).label, resolve6).open();
        });
        if (!accepted) return false;
        const acknowledged = new Set((_a = this.plugin.settings.blanketWriteAcknowledged) != null ? _a : []);
        acknowledged.add(provider);
        this.plugin.settings.blanketWriteAcknowledged = [...acknowledged];
        await this.plugin.saveSettings();
        return true;
      },
      onModelChange: async (model) => {
        var _a, _b, _c;
        this.plugin.settings.model = model;
        const isDefaultModel = COPILOT_MODELS.find((m) => m.value === model);
        if (isDefaultModel) {
          this.plugin.settings.thinkingBudget = DEFAULT_THINKING_BUDGET[model];
        }
        await this.plugin.saveSettings();
        (_a = this.thinkingBudgetSelector) == null ? void 0 : _a.updateDisplay();
        (_b = this.modelSelector) == null ? void 0 : _b.updateDisplay();
        (_c = this.modelSelector) == null ? void 0 : _c.renderOptions();
      },
      onProviderModelChange: async (provider, model) => {
        var _a, _b, _c, _d;
        (_b = (_a = this.plugin.settings).providerModels) != null ? _b : _a.providerModels = {};
        this.plugin.settings.providerModels[provider] = model.trim();
        await this.plugin.saveSettings();
        (_c = this.modelSelector) == null ? void 0 : _c.updateDisplay();
        (_d = this.modelSelector) == null ? void 0 : _d.renderOptions();
      },
      onProviderEffortChange: async (provider, effort) => {
        var _a, _b, _c, _d;
        (_b = (_a = this.plugin.settings).providerEfforts) != null ? _b : _a.providerEfforts = {};
        if (effort.trim()) this.plugin.settings.providerEfforts[provider] = effort.trim();
        else delete this.plugin.settings.providerEfforts[provider];
        await this.plugin.saveSettings();
        (_c = this.modelSelector) == null ? void 0 : _c.updateDisplay();
        (_d = this.modelSelector) == null ? void 0 : _d.renderOptions();
      },
      getNativeProviderModels: (provider) => this.plugin.agentService.listNativeProviderModels(provider),
      onThinkingBudgetChange: async (budget) => {
        this.plugin.settings.thinkingBudget = budget;
        await this.plugin.saveSettings();
      },
      onPermissionModeChange: async (mode) => {
        var _a;
        const current = this.plugin.settings.permissionMode;
        if (mode === "plan") {
          if (current !== "plan") {
            this.plugin.settings.lastNonPlanPermissionMode = current;
          }
        } else {
          this.plugin.settings.lastNonPlanPermissionMode = mode;
        }
        this.plugin.settings.permissionMode = mode;
        await this.plugin.saveSettings();
        if (mode === "plan") {
          if (!((_a = this.state.planModeState) == null ? void 0 : _a.isActive)) {
            this.state.planModeState = {
              isActive: true,
              planFilePath: null,
              planContent: null,
              originalQuery: null,
              agentInitiated: false
            };
          }
        } else {
          this.state.resetPlanModeState();
        }
        this.updatePlanModeUiState();
      },
      onOpenQuiz: async () => {
        var _a, _b, _c;
        const quizModal = new QuizSetupModal(this.plugin.app, ((_a = this.fileContextManager) == null ? void 0 : _a.getCurrentNotePath()) || null);
        const quizResult = await quizModal.openAndWait();
        if (!quizResult) {
          return;
        }
        if (quizResult.enableExternalTools) {
          (_b = this.webSearchToggle) == null ? void 0 : _b.setEnabled(true);
        }
        await ((_c = this.inputController) == null ? void 0 : _c.sendMessage({
          content: quizResult.prompt,
          displayContentOverride: quizResult.displayContent,
          quizSessionInit: {
            totalQuestions: quizResult.totalQuestions,
            scopeLabel: quizResult.displayContent,
            focusText: quizResult.focusText,
            difficulty: quizResult.difficulty,
            sourceInstruction: quizResult.sourceInstruction
          }
        }));
      },
      onOpenSocratic: async () => {
        var _a, _b;
        const socraticModal = new SocraticSetupModal(
          this.plugin.app,
          ((_a = this.fileContextManager) == null ? void 0 : _a.getCurrentNotePath()) || null,
          ""
        );
        const socraticResult = await socraticModal.openAndWait();
        if (!socraticResult) {
          return;
        }
        await ((_b = this.inputController) == null ? void 0 : _b.sendMessage({
          content: socraticResult.prompt,
          displayContentOverride: socraticResult.displayContent,
          socraticSessionInit: {
            scopeLabel: socraticResult.displayContent,
            focusText: socraticResult.focusText,
            sourceInstruction: socraticResult.sourceInstruction
          }
        }));
      }
    });
    this.buildProviderSelector(toolbarComponents.primaryToolbarEl, () => {
      var _a, _b, _c;
      (_a = this.modelSelector) == null ? void 0 : _a.updateDisplay();
      (_b = this.modelSelector) == null ? void 0 : _b.renderOptions();
      (_c = this.thinkingBudgetSelector) == null ? void 0 : _c.updateDisplay();
    });
    const sendButton = toolbarComponents.primaryToolbarEl.createEl("button", {
      cls: "ocop-send-btn",
      attr: { type: "button", "aria-label": "Send message", title: "Send message" }
    });
    (0, import_obsidian25.setIcon)(sendButton, "arrow-up");
    sendButton.addEventListener("click", () => {
      var _a, _b, _c;
      if ((_a = this.permissionToggle) == null ? void 0 : _a.isPlanModeActive()) void ((_b = this.inputController) == null ? void 0 : _b.sendPlanModeMessage());
      else void ((_c = this.inputController) == null ? void 0 : _c.sendMessage());
    });
    this.modelSelector = toolbarComponents.modelSelector;
    this.thinkingBudgetSelector = toolbarComponents.thinkingBudgetSelector;
    this.contextUsageMeter = toolbarComponents.contextUsageMeter;
    this.externalContextSelector = toolbarComponents.externalContextSelector;
    this.webSearchToggle = toolbarComponents.webSearchToggle;
    this.webSearchToggle.setEnabled(this.plugin.settings.enableWebSearch);
    this.permissionToggle = toolbarComponents.permissionToggle;
    this.socraticLauncherButton = toolbarComponents.socraticLauncherButton;
    this.externalContextSelector.setOnChange(() => {
      var _a;
      (_a = this.fileContextManager) == null ? void 0 : _a.preScanExternalContexts();
    });
  }
  buildProviderSelector(toolbar, onProviderChange) {
    createProviderSelector(toolbar, this.plugin, onProviderChange, (handler) => {
      this.registerDomEvent(document, "click", handler);
    });
  }
  initializeControllers() {
    var _a;
    this.selectionController = new SelectionController(
      this.plugin.app,
      this.selectionIndicatorEl,
      this.inputEl
    );
    this.streamController = new StreamController({
      plugin: this.plugin,
      state: this.state,
      renderer: this.renderer,
      asyncSubagentManager: this.asyncSubagentManager,
      getMessagesEl: () => this.messagesEl,
      getFileContextManager: () => this.fileContextManager,
      updateQueueIndicator: () => {
        var _a2;
        return (_a2 = this.inputController) == null ? void 0 : _a2.updateQueueIndicator();
      },
      setPlanModeActive: () => {
        this.updatePlanModeUiState();
      }
    });
    this.conversationController = new ConversationController(
      {
        plugin: this.plugin,
        state: this.state,
        renderer: this.renderer,
        asyncSubagentManager: this.asyncSubagentManager,
        getHistoryDropdown: () => this.historyDropdown,
        getWelcomeEl: () => this.welcomeEl,
        setWelcomeEl: (el) => {
          this.welcomeEl = el;
        },
        getMessagesEl: () => this.messagesEl,
        getInputEl: () => this.inputEl,
        getFileContextManager: () => this.fileContextManager,
        getImageContextManager: () => this.imageContextManager,
        getExternalContextSelector: () => this.externalContextSelector,
        clearQueuedMessage: () => {
          var _a2;
          return (_a2 = this.inputController) == null ? void 0 : _a2.clearQueuedMessage();
        },
        getApprovedPlan: () => this.plugin.agentService.getApprovedPlanContent(),
        setApprovedPlan: (plan) => this.plugin.agentService.setApprovedPlanContent(plan),
        showPlanBanner: (content) => {
          var _a2;
          void ((_a2 = this.planBanner) == null ? void 0 : _a2.show(content));
        },
        hidePlanBanner: () => {
          var _a2;
          return (_a2 = this.planBanner) == null ? void 0 : _a2.hide();
        },
        triggerPendingPlanApproval: (content) => {
          var _a2;
          return (_a2 = this.inputController) == null ? void 0 : _a2.restorePendingPlanApproval(content);
        },
        getTitleGenerationService: () => this.titleGenerationService,
        setPlanModeActive: () => {
          this.updatePlanModeUiState();
        },
        getTodoPanel: () => this.todoPanel
      },
      {
        onNewConversation: () => {
          var _a2, _b;
          (_a2 = this.socraticBanner) == null ? void 0 : _a2.hide();
          (_b = this.socraticLauncherButton) == null ? void 0 : _b.setActive(false);
        }
      }
    );
    this.inputController = new InputController({
      plugin: this.plugin,
      state: this.state,
      renderer: this.renderer,
      streamController: this.streamController,
      selectionController: this.selectionController,
      conversationController: this.conversationController,
      getInputEl: () => this.inputEl,
      getWelcomeEl: () => this.welcomeEl,
      getMessagesEl: () => this.messagesEl,
      getFileContextManager: () => this.fileContextManager,
      getImageContextManager: () => this.imageContextManager,
      getSlashCommandManager: () => this.slashCommandManager,
      getExternalContextSelector: () => this.externalContextSelector,
      getWebSearchToggle: () => this.webSearchToggle,
      getInstructionModeManager: () => this.instructionModeManager,
      getInstructionRefineService: () => this.instructionRefineService,
      getTitleGenerationService: () => this.titleGenerationService,
      getComponent: () => this,
      setPlanModeActive: () => {
        this.updatePlanModeUiState();
      },
      getPlanBanner: () => this.planBanner,
      showSocraticBanner: (scopeLabel, focusText, onHint, onStuck) => {
        var _a2, _b;
        (_a2 = this.socraticBanner) == null ? void 0 : _a2.show(scopeLabel, focusText, onHint, onStuck);
        (_b = this.socraticLauncherButton) == null ? void 0 : _b.setActive(true);
      },
      hideSocraticBanner: () => {
        var _a2, _b;
        (_a2 = this.socraticBanner) == null ? void 0 : _a2.hide();
        (_b = this.socraticLauncherButton) == null ? void 0 : _b.setActive(false);
      },
      generateId: () => this.generateId(),
      resetContextMeter: () => {
        var _a2;
        return (_a2 = this.contextUsageMeter) == null ? void 0 : _a2.update(null);
      }
    });
    (_a = this.permissionToggle) == null ? void 0 : _a.setOnPlanModeToggle((active) => {
      var _a2;
      (_a2 = this.inputController) == null ? void 0 : _a2.setPlanModeRequested(active);
    });
    this.plugin.agentService.setExitPlanModeCallback(
      (planContent) => this.inputController.handleExitPlanMode(planContent)
    );
    this.navigationController = new NavigationController({
      getMessagesEl: () => this.messagesEl,
      getInputEl: () => this.inputEl,
      getSettings: () => this.plugin.settings.keyboardNavigation,
      isStreaming: () => this.state.isStreaming,
      shouldSkipEscapeHandling: () => {
        var _a2, _b, _c;
        if ((_a2 = this.instructionModeManager) == null ? void 0 : _a2.isActive()) return true;
        if ((_b = this.slashCommandDropdown) == null ? void 0 : _b.isVisible()) return true;
        if ((_c = this.fileContextManager) == null ? void 0 : _c.isMentionDropdownVisible()) return true;
        return false;
      }
    });
    this.navigationController.initialize();
  }
  wireEventHandlers() {
    this.registerDomEvent(document, "click", () => {
      var _a;
      (_a = this.historyDropdown) == null ? void 0 : _a.removeClass("visible");
    });
    this.registerDomEvent(this.containerEl, "click", (event) => {
      var _a;
      const target = event.target;
      if (target == null ? void 0 : target.closest(".ocop-selection-indicator")) {
        (_a = this.selectionController) == null ? void 0 : _a.clear();
      }
    });
    this.registerDomEvent(this.containerEl, "click", (event) => {
      var _a, _b;
      const target = event.target;
      const suggestion = target == null ? void 0 : target.closest(".ocop-welcome-suggestion");
      if (!suggestion || !this.inputEl) {
        return;
      }
      const prompt = ((_a = suggestion.dataset.prompt) == null ? void 0 : _a.trim()) || ((_b = suggestion.textContent) == null ? void 0 : _b.trim());
      if (!prompt) {
        return;
      }
      this.inputEl.value = prompt;
      this.inputEl.dispatchEvent(new Event("input"));
      this.inputEl.focus();
      this.inputEl.setSelectionRange(prompt.length, prompt.length);
    });
    this.registerDomEvent(this.containerEl, "click", (event) => {
      const target = event.target;
      const answerBtn = target == null ? void 0 : target.closest(".ocop-quiz-answer-btn");
      if (answerBtn && this.inputController) {
        const isMultiSelect = answerBtn.dataset.multiSelect === "true";
        if (!isMultiSelect) {
          const answer = answerBtn.dataset.answerLabel || answerBtn.textContent || "";
          if (answer) {
            void this.inputController.sendMessage({ content: answer });
          }
        }
        return;
      }
      const submitBtn = target == null ? void 0 : target.closest(".ocop-quiz-submit-btn");
      if (submitBtn && this.inputController) {
        const answerValue = submitBtn.getAttribute("data-answer-value") || "";
        if (answerValue) {
          void this.inputController.sendMessage({ content: answerValue });
        }
      }
    });
    this.registerDomEvent(document, "keydown", (e) => {
      var _a;
      if (e.key === "Escape" && this.state.isStreaming) {
        e.preventDefault();
        (_a = this.inputController) == null ? void 0 : _a.cancelStreaming();
      }
    });
    this.registerEvent(this.plugin.app.vault.on("create", () => {
      var _a;
      return (_a = this.fileContextManager) == null ? void 0 : _a.markFilesCacheDirty();
    }));
    this.registerEvent(this.plugin.app.vault.on("delete", () => {
      var _a;
      return (_a = this.fileContextManager) == null ? void 0 : _a.markFilesCacheDirty();
    }));
    this.registerEvent(this.plugin.app.vault.on("rename", () => {
      var _a;
      return (_a = this.fileContextManager) == null ? void 0 : _a.markFilesCacheDirty();
    }));
    this.registerEvent(this.plugin.app.vault.on("modify", () => {
      var _a;
      return (_a = this.fileContextManager) == null ? void 0 : _a.markFilesCacheDirty();
    }));
    this.registerEvent(
      this.plugin.app.workspace.on("file-open", (file) => {
        var _a;
        if (file) {
          (_a = this.fileContextManager) == null ? void 0 : _a.handleFileOpen(file);
        }
      })
    );
    this.registerDomEvent(document, "click", (e) => {
      var _a, _b;
      if (!((_a = this.fileContextManager) == null ? void 0 : _a.containsElement(e.target)) && e.target !== this.inputEl) {
        (_b = this.fileContextManager) == null ? void 0 : _b.hideMentionDropdown();
      }
    });
    const inputEl = this.inputEl;
    if (!inputEl) return;
    this.registerDomEvent(inputEl, "keydown", (e) => {
      var _a;
      if (e.key === "Tab" && e.shiftKey && !this.state.isStreaming) {
        e.preventDefault();
        e.stopPropagation();
        (_a = this.permissionToggle) == null ? void 0 : _a.togglePlanMode();
      }
    }, { capture: true });
    this.registerDomEvent(inputEl, "keydown", (e) => {
      var _a, _b, _c, _d, _e, _f, _g, _h;
      if ((_a = this.instructionModeManager) == null ? void 0 : _a.handleTriggerKey(e)) {
        return;
      }
      if ((_b = this.instructionModeManager) == null ? void 0 : _b.handleKeydown(e)) {
        return;
      }
      if ((_c = this.slashCommandDropdown) == null ? void 0 : _c.handleKeydown(e)) {
        return;
      }
      if ((_d = this.fileContextManager) == null ? void 0 : _d.handleMentionKeydown(e)) {
        return;
      }
      if (e.key === "Escape" && this.state.isStreaming) {
        e.preventDefault();
        (_e = this.inputController) == null ? void 0 : _e.cancelStreaming();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if ((_f = this.permissionToggle) == null ? void 0 : _f.isPlanModeActive()) {
          void ((_g = this.inputController) == null ? void 0 : _g.sendPlanModeMessage());
        } else {
          void ((_h = this.inputController) == null ? void 0 : _h.sendMessage());
        }
      }
    });
    this.registerDomEvent(inputEl, "input", () => {
      var _a, _b;
      (_a = this.fileContextManager) == null ? void 0 : _a.handleInputChange();
      (_b = this.instructionModeManager) == null ? void 0 : _b.handleInputChange();
    });
    this.registerDomEvent(inputEl, "focus", () => {
      var _a;
      (_a = this.selectionController) == null ? void 0 : _a.showHighlight();
    });
  }
  /**
   * Turns what was dropped into context chips. A reference the vault cannot resolve is
   * reported rather than ignored — silently swallowing the drop is what made the old
   * behaviour read as "drag and drop does nothing".
   */
  attachDroppedRefs(refs) {
    var _a;
    const manager = this.fileContextManager;
    if (!manager) return;
    const unresolved = [];
    let attached = 0;
    for (const ref of refs) {
      const resolved = manager.resolveDroppedRef(ref);
      if (!resolved) {
        unresolved.push(ref);
        continue;
      }
      manager.attachFileFromCommand(resolved);
      attached += 1;
    }
    if (attached > 0) (_a = this.renderer) == null ? void 0 : _a.scrollToBottomIfNeeded();
    if (unresolved.length > 0) {
      new import_obsidian25.Notice(`\uBCF4\uAD00\uD568\uC5D0\uC11C \uCC3E\uC744 \uC218 \uC5C6\uB294 \uD30C\uC77C\uC785\uB2C8\uB2E4: ${unresolved.join(", ")}`, 5e3);
    }
  }
  generateId() {
    return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
  updatePlanModeUiState() {
    var _a;
    const isPlanMode = this.plugin.settings.permissionMode === "plan";
    const isPlanModeRequested = this.state.planModeRequested;
    (_a = this.permissionToggle) == null ? void 0 : _a.setPlanModeActive(isPlanMode || isPlanModeRequested);
  }
};
async function openProviderSetupWizard(plugin, target) {
  try {
    const { SetupWizardModal: SetupWizardModal2 } = await Promise.resolve().then(() => (init_SetupWizardModal(), SetupWizardModal_exports));
    new SetupWizardModal2(plugin.app, plugin, target).open();
  } catch (err) {
    console.warn("[ObsidianCopilot] Setup wizard failed to open:", err);
  }
}
function createProviderSelector(toolbar, plugin, onProviderChange, registerDocumentClick) {
  const container = toolbar.createDiv({ cls: "ocop-provider-selector" });
  const button = container.createEl("button", { cls: "ocop-provider-btn", attr: { type: "button", "aria-label": "Choose AI provider", "aria-expanded": "false" } });
  const popover = container.createDiv({ cls: "ocop-provider-popover" });
  let setupHint = null;
  const updateButton = () => {
    var _a;
    const provider = (_a = PROVIDERS.find((item) => item.id === plugin.settings.selectedProvider)) != null ? _a : PROVIDERS[0];
    button.empty();
    const mark = button.createSpan({ cls: `ocop-provider-mark is-${provider.id}` });
    mark.innerHTML = PROVIDER_MARKS[provider.id];
    button.createSpan({ cls: "ocop-provider-btn-label", text: provider.label });
    button.createSpan({ cls: "ocop-provider-btn-chevron", text: "\u2304" });
  };
  const close = () => {
    popover.removeClass("is-visible");
    button.setAttribute("aria-expanded", "false");
  };
  const renderPopover = () => {
    var _a, _b, _c;
    popover.empty();
    setupHint = null;
    popover.createDiv({ cls: "ocop-provider-popover-title", text: "AI \uC81C\uACF5\uC790" });
    for (const provider of PROVIDERS) {
      const configuredPath = ((_a = plugin.settings.providerCliPaths) == null ? void 0 : _a[provider.id]) || (provider.id === "copilot" ? plugin.settings.copilotCliPath || "" : "");
      const ready = !!findProviderCliPath(provider.id, configuredPath);
      const option = popover.createEl("button", { cls: "ocop-provider-option", attr: { type: "button", "aria-pressed": String(plugin.settings.selectedProvider === provider.id) } });
      const mark = option.createSpan({ cls: `ocop-provider-mark is-${provider.id}` });
      mark.innerHTML = PROVIDER_MARKS[provider.id];
      option.createSpan({ cls: "ocop-provider-option-name", text: provider.label });
      const connection = (_c = (_b = plugin.providerConnections) == null ? void 0 : _b[provider.id]) == null ? void 0 : _c.state;
      const needsAction = !ready ? "\uC124\uCE58 \uD544\uC694" : connection === "not-connected" ? connectionLabel(connection) : "";
      if (needsAction) option.createSpan({ cls: "ocop-provider-option-status", text: needsAction });
      option.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (ready) {
          plugin.settings.selectedProvider = provider.id;
          await plugin.saveSettings();
          updateButton();
          onProviderChange == null ? void 0 : onProviderChange(provider.id);
          close();
        } else {
          if (!setupHint) setupHint = popover.createDiv({ cls: "ocop-provider-setup-hint" });
          setupHint.setText(provider.status === "manual-setup" ? "Add agy to PATH, then reopen this provider menu." : `Install or sign in to ${provider.label}, then reopen this provider menu.`);
          await openProviderSetupWizard(plugin, provider.id);
        }
      });
    }
    if (plugin.settings.selectedProvider !== "copilot") popover.createDiv({ cls: "ocop-provider-cli-note", text: "\uBAA8\uB378\uACFC \uCD94\uB860 \uAC15\uB3C4\uB294 \uC624\uB978\uCABD \uBAA8\uB378 \uBC84\uD2BC\uC5D0\uC11C \uC120\uD0DD\uD569\uB2C8\uB2E4." });
  };
  updateButton();
  renderPopover();
  const firstToolbarChild = toolbar.firstElementChild;
  if (firstToolbarChild && firstToolbarChild !== container) toolbar.insertBefore(container, firstToolbarChild);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (popover.hasClass("is-visible")) close();
    else {
      renderPopover();
      popover.addClass("is-visible");
      button.setAttribute("aria-expanded", "true");
    }
  });
  registerDocumentClick == null ? void 0 : registerDocumentClick((event) => {
    if (!container.contains(event.target)) close();
  });
  return container;
}

// src/features/settings/ObsidianCopilotSettings.ts
var fs13 = __toESM(require("fs"));
var import_obsidian27 = require("obsidian");
init_providerRegistry();
init_providerConnection();
init_path();
init_ObsidianSkillsInstaller();

// src/features/settings/keyboardNavigation.ts
var NAV_ACTIONS = ["scrollUp", "scrollDown", "focusInput"];
var buildNavMappingText = (settings) => {
  return [
    `map ${settings.scrollUpKey} scrollUp`,
    `map ${settings.scrollDownKey} scrollDown`,
    `map ${settings.focusInputKey} focusInput`
  ].join("\n");
};
var parseNavMappings = (value) => {
  const parsed = {};
  const usedKeys = /* @__PURE__ */ new Map();
  const lines = value.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 3 || parts[0] !== "map") {
      return { error: 'Each line must follow "map <key> <action>"' };
    }
    const key = parts[1];
    const action = parts[2];
    if (!NAV_ACTIONS.includes(action)) {
      return { error: `Unknown action: ${parts[2]}` };
    }
    if (key.length !== 1) {
      return { error: `Key must be a single character for ${action}` };
    }
    const normalizedKey = key.toLowerCase();
    if (usedKeys.has(normalizedKey)) {
      return { error: "Navigation keys must be unique" };
    }
    if (parsed[action]) {
      return { error: `Duplicate mapping for ${action}` };
    }
    usedKeys.set(normalizedKey, action);
    parsed[action] = key;
  }
  const missing = NAV_ACTIONS.filter((action) => !parsed[action]);
  if (missing.length > 0) {
    return { error: `Missing mapping for ${missing.join(", ")}` };
  }
  return { settings: parsed };
};

// src/features/settings/ObsidianCopilotSettings.ts
function formatHotkey(hotkey) {
  const isMac = navigator.platform.includes("Mac");
  const modMap = isMac ? { Mod: "\u2318", Ctrl: "\u2303", Alt: "\u2325", Shift: "\u21E7", Meta: "\u2318" } : { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Win" };
  const mods = hotkey.modifiers.map((modifier) => modMap[modifier] || modifier);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
  return isMac ? [...mods, key].join("") : [...mods, key].join("+");
}
function openHotkeySettings(app) {
  const setting = app.setting;
  if (!setting) return;
  setting.open();
  setting.openTabById("hotkeys");
  setTimeout(() => {
    var _a, _b, _c;
    const tab = setting.activeTab;
    if (!tab) return;
    const searchEl = (_b = tab.searchInputEl) != null ? _b : (_a = tab.searchComponent) == null ? void 0 : _a.inputEl;
    if (!searchEl) return;
    searchEl.value = "Obsidian AI Tutor";
    (_c = tab.updateHotkeyVisibility) == null ? void 0 : _c.call(tab);
  }, 100);
}
function getHotkeyForCommand(app, commandId) {
  var _a, _b;
  const hotkeyManager = app.hotkeyManager;
  if (!hotkeyManager) return null;
  const customHotkeys = (_a = hotkeyManager.customKeys) == null ? void 0 : _a[commandId];
  const defaultHotkeys = (_b = hotkeyManager.defaultKeys) == null ? void 0 : _b[commandId];
  const hotkeys = customHotkeys && customHotkeys.length > 0 ? customHotkeys : defaultHotkeys;
  if (!hotkeys || hotkeys.length === 0) return null;
  return hotkeys.map(formatHotkey).join(", ");
}
var ObsidianCopilotSettingTab = class extends import_obsidian27.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    /**
     * Cancels the connection checks of the previous render. display() re-runs on
     * every provider switch and whenever the wizard closes, and without this each
     * render leaves four CLIs running against rows that no longer exist.
     */
    this.probes = new AbortController();
    this.plugin = plugin;
  }
  /**
   * One provider's install-and-login row.
   *
   * The stored state is drawn first so the row is never blank, then the live
   * check replaces it. Every check here is free: three CLIs answer a status
   * command, and copilot is decided by whether a credential exists.
   */
  renderProviderConnectionRow(containerEl, providerId) {
    var _a, _b, _c;
    const descriptor = getProviderDescriptor(providerId);
    const configuredPath = ((_a = this.plugin.settings.providerCliPaths) == null ? void 0 : _a[providerId]) || (providerId === "copilot" ? this.plugin.settings.copilotCliPath || "" : "");
    const stored = (_c = (_b = this.plugin.providerConnections) == null ? void 0 : _b[providerId]) == null ? void 0 : _c.state;
    const row = new import_obsidian27.Setting(containerEl).setName(descriptor.label).setDesc(connectionLabel(stored));
    row.addButton((button) => {
      const label = (state) => state === "connected" ? "\uB2E4\uC2DC \uC5F0\uACB0" : "\uC5F0\uACB0";
      button.setButtonText(label(stored));
      button.onClick(async () => {
        const { SetupWizardModal: SetupWizardModal2 } = await Promise.resolve().then(() => (init_SetupWizardModal(), SetupWizardModal_exports));
        const modal = new SetupWizardModal2(this.app, this.plugin, providerId);
        const close = modal.onClose.bind(modal);
        modal.onClose = () => {
          close();
          this.display();
        };
        modal.open();
      });
      const { signal } = this.probes;
      void checkProviderConnection(providerId, { cliPath: configuredPath || void 0, signal }).then((checked) => {
        if (signal.aborted) return;
        const state = resolveCheckedState(stored, checked);
        this.plugin.setProviderConnection(providerId, state);
        row.setDesc(connectionLabel(state));
        button.setButtonText(label(state));
      });
    });
  }
  /**
   * The default model row, for whichever provider is selected.
   *
   * It used to list the bundled Copilot catalog no matter what, and write every
   * choice into settings.model — which native providers never read. Picking a
   * model after choosing Claude changed nothing.
   */
  renderDefaultModelRow(containerEl) {
    var _a, _b;
    const provider = this.plugin.settings.selectedProvider;
    const descriptor = getProviderDescriptor(provider);
    const save = async (value) => {
      storeDefaultModel(this.plugin.settings, provider, value);
      await this.plugin.saveSettings();
    };
    if (defaultModelSource(provider) === "copilot-catalog") {
      new import_obsidian27.Setting(containerEl).setName("\uAE30\uBCF8 \uBAA8\uB378").setDesc("\uCC44\uD305\uACFC \uC778\uB77C\uC778 \uD3B8\uC9D1\uC5D0 \uC4F8 GitHub Copilot \uBAA8\uB378\uC785\uB2C8\uB2E4.").addDropdown((dropdown) => {
        for (const model of COPILOT_MODELS) {
          dropdown.addOption(model.value, `${model.label} - ${model.costLabel}`);
        }
        dropdown.setValue(this.plugin.settings.model).onChange(save);
      });
      return;
    }
    const stored = ((_b = (_a = this.plugin.settings.providerModels) == null ? void 0 : _a[provider]) == null ? void 0 : _b.trim()) || "";
    const row = new import_obsidian27.Setting(containerEl).setName("\uAE30\uBCF8 \uBAA8\uB378").setDesc(`${descriptor.label}\uC5D0 \uBCF4\uB0BC \uBAA8\uB378\uC785\uB2C8\uB2E4. \uBE44\uC6CC \uB450\uBA74 CLI \uAE30\uBCF8\uAC12\uC744 \uC501\uB2C8\uB2E4.`);
    const showList = (options) => {
      row.controlEl.empty();
      row.addDropdown((dropdown) => {
        dropdown.addOption("", "CLI \uAE30\uBCF8\uAC12");
        for (const option of options) dropdown.addOption(option.id, option.label);
        if (stored && !options.some((option) => option.id === stored)) dropdown.addOption(stored, stored);
        dropdown.setValue(stored).onChange(save);
      });
    };
    const bundled = getStaticProviderModels(provider);
    if (bundled.length > 0) {
      showList(bundled);
      return;
    }
    row.addButton((button) => {
      button.setButtonText(stored ? `${stored} \xB7 \uBAA9\uB85D \uBD88\uB7EC\uC624\uAE30` : "\uBAA8\uB378 \uBAA9\uB85D \uBD88\uB7EC\uC624\uAE30");
      button.onClick(async () => {
        button.setButtonText("\uBD88\uB7EC\uC624\uB294 \uC911\u2026");
        button.setDisabled(true);
        try {
          const options = await this.plugin.agentService.listNativeProviderModels(provider);
          if (options.length === 0) throw new Error("empty list");
          showList(options);
        } catch (e) {
          new import_obsidian27.Notice(`${descriptor.label}\uC5D0\uC11C \uBAA8\uB378 \uBAA9\uB85D\uC744 \uAC00\uC838\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uB85C\uADF8\uC778 \uC5EC\uBD80\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694.`);
          button.setButtonText(stored ? `${stored} \xB7 \uB2E4\uC2DC \uC2DC\uB3C4` : "\uB2E4\uC2DC \uC2DC\uB3C4");
          button.setDisabled(false);
        }
      });
    });
  }
  /**
   * The skills section, for the provider that is selected.
   *
   * Skipped entirely when that CLI has no skills mechanism. It used to return
   * out of display() instead, which took Chat Behavior and Advanced with it —
   * choosing Codex emptied the rest of the settings screen.
   */
  renderSkillsSection(containerEl) {
    const skillProvider = this.plugin.settings.selectedProvider;
    const skillsWrapperEl = containerEl.createDiv({ cls: "ocop-settings-advanced-wrapper" });
    const skillsHeaderEl = skillsWrapperEl.createDiv({ cls: "ocop-settings-advanced-header" });
    skillsHeaderEl.setAttribute("tabindex", "0");
    skillsHeaderEl.createSpan({ cls: "ocop-settings-advanced-title", text: "Skills & Obsidian Context" });
    skillsHeaderEl.createSpan({ cls: "ocop-settings-advanced-toggle", text: "Show" });
    const skillsContentEl = skillsWrapperEl.createDiv({ cls: "ocop-settings-advanced-content" });
    setupCollapsible(skillsWrapperEl, skillsHeaderEl, skillsContentEl, { isExpanded: false }, {
      initiallyExpanded: false,
      onToggle: (isExpanded) => {
        const toggleEl = skillsHeaderEl.querySelector(".ocop-settings-advanced-toggle");
        if (toggleEl) toggleEl.textContent = isExpanded ? "Hide" : "Show";
      },
      baseAriaLabel: "Skills & Obsidian Context settings"
    });
    skillsContentEl.createDiv({
      cls: "setting-item-description",
      text: `${getProviderDescriptor(skillProvider).label}\uAC00 \uC704\uD0A4\uB9C1\uD06C\xB7\uCF5C\uC544\uC6C3\xB7\uC18D\uC131\xB7\uCE94\uBC84\uC2A4\uB97C \uC774\uD574\uD558\uB3C4\uB85D Obsidian \uC2A4\uD0AC\uC744 \uC124\uCE58\uD569\uB2C8\uB2E4.`
    });
    if (isMachineWideSkillsRoot(skillProvider)) {
      skillsContentEl.createDiv({
        cls: "setting-item-description",
        text: "OpenAI Codex\uB294 \uC2A4\uD0AC\uC744 \uC774 \uCEF4\uD4E8\uD130 \uC804\uCCB4\uC5D0 \uC800\uC7A5\uD569\uB2C8\uB2E4 (~/.codex/skills). \uB2E4\uB978 \uAE08\uACE0\uC5D0\uC11C\uB3C4 \uD568\uAED8 \uC801\uC6A9\uB429\uB2C8\uB2E4."
      });
    }
    const skillsInstalled = isObsidianSkillsInstalled(this.app, skillProvider);
    new import_obsidian27.Setting(skillsContentEl).setName("Obsidian context skills").setDesc(
      skillsInstalled ? `\uC124\uCE58\uB428 - ${getProviderDescriptor(skillProvider).label}\uAC00 Obsidian \uBB38\uBC95\uC744 \uC774\uD574\uD569\uB2C8\uB2E4.` : "\uC124\uCE58 \uC548 \uB428 - \uB300\uBD80\uBD84\uC758 \uD559\uC0DD\uC5D0\uAC8C \uAD8C\uC7A5\uD569\uB2C8\uB2E4."
    ).addButton((button) => {
      if (skillsInstalled) {
        button.setButtonText("Reinstall").onClick(async () => {
          await installObsidianSkills(this.app, skillProvider);
          this.display();
        });
      } else {
        button.setButtonText("Install").setCta().onClick(async () => {
          await installObsidianSkills(this.app, skillProvider);
          this.display();
        });
      }
    }).addButton((button) => {
      if (skillsInstalled) {
        button.setButtonText("Remove").onClick(async () => {
          await uninstallObsidianSkills(this.app, skillProvider);
          this.display();
        });
      }
    });
    let skillUrl = "";
    let textInput = null;
    new import_obsidian27.Setting(skillsContentEl).setName("Install custom skill from GitHub").setDesc(`${getProviderDescriptor(skillProvider).label}\uC758 \uC2A4\uD0AC \uD3F4\uB354\uB85C \uBC1B\uC2B5\uB2C8\uB2E4. \uC2A4\uD0AC \uD3F4\uB354 \uC8FC\uC18C(.../tree/main/skills/docx)\uB97C \uB123\uC73C\uBA74 \uB538\uB9B0 \uC2A4\uD06C\uB9BD\uD2B8\uAE4C\uC9C0 \uBC1B\uACE0, \uC800\uC7A5\uC18C\uB098 SKILL.md \uC8FC\uC18C\uB294 \uADF8 \uD30C\uC77C \uD55C \uC7A5\uB9CC \uBC1B\uC2B5\uB2C8\uB2E4.`).addText((text) => {
      textInput = text.inputEl;
      text.setPlaceholder("https://github.com/username/repo").onChange(async (value) => {
        skillUrl = value;
      });
    }).addButton((button) => {
      button.setButtonText("Install").setCta().onClick(async () => {
        if (!skillUrl) {
          new import_obsidian27.Notice("Please enter a URL");
          return;
        }
        button.setButtonText("Installing...").setDisabled(true);
        try {
          const success = await installSkillFromUrl(this.app, skillUrl, skillProvider);
          if (success) {
            if (textInput) textInput.value = "";
            skillUrl = "";
            this.display();
          }
        } finally {
          button.setButtonText("Install").setDisabled(false);
        }
      });
    });
    const SKILL_SUGGESTIONS = [
      {
        label: "Word \uBB38\uC11C (docx)",
        url: "https://github.com/anthropics/skills/tree/main/skills/docx",
        icon: "file-text"
      },
      {
        label: "\uC2AC\uB77C\uC774\uB4DC (pptx)",
        url: "https://github.com/anthropics/skills/tree/main/skills/pptx",
        icon: "presentation"
      },
      {
        label: "\uC5D1\uC140 (xlsx)",
        url: "https://github.com/anthropics/skills/tree/main/skills/xlsx",
        icon: "table"
      }
    ];
    skillsContentEl.createDiv({
      cls: "setting-item-description",
      text: "Anthropic \uACF5\uC2DD \uC2A4\uD0AC (github.com/anthropics/skills). \uB20C\uB7EC\uC11C \uC8FC\uC18C\uB97C \uCC44\uC6B4 \uB4A4 Install\uC744 \uB204\uB985\uB2C8\uB2E4."
    });
    const suggestionsEl = skillsContentEl.createDiv({ cls: "ocop-skill-suggestions" });
    for (const suggestion of SKILL_SUGGESTIONS) {
      const chipEl = suggestionsEl.createDiv({ cls: "ocop-skill-chip" });
      const iconEl = chipEl.createSpan({ cls: "ocop-skill-chip-icon" });
      (0, import_obsidian27.setIcon)(iconEl, suggestion.icon);
      chipEl.createSpan({ text: suggestion.label });
      chipEl.addEventListener("click", () => {
        if (textInput) {
          textInput.value = suggestion.url;
          textInput.dispatchEvent(new Event("input"));
          skillUrl = suggestion.url;
        }
      });
    }
    const installedSkills = getInstalledSkills(this.app, skillProvider);
    if (installedSkills.length > 0) {
      const installedSkillsDesc = skillsContentEl.createDiv({ cls: "ocop-skills-installed-desc" });
      installedSkillsDesc.createEl("p", {
        text: `Installed Skills (${installedSkills.length}):`,
        cls: "setting-item-description"
      });
      const skillsListEl = skillsContentEl.createDiv({ cls: "ocop-skills-list" });
      for (const skill of installedSkills) {
        const skillItemEl = skillsListEl.createDiv({ cls: "ocop-skills-item" });
        const skillInfoEl = skillItemEl.createDiv({ cls: "ocop-skills-item-info" });
        skillInfoEl.createSpan({ cls: "ocop-skills-item-name", text: skill.name });
        if (skill.isBuiltIn) {
          skillInfoEl.createSpan({ cls: "ocop-skills-builtin-badge", text: "Built-in" });
        } else if (skill.isGlobal) {
          skillInfoEl.createSpan({ cls: "ocop-skills-builtin-badge", text: "Global" });
        }
        skillInfoEl.createDiv({
          cls: "ocop-skills-item-desc",
          text: skill.description.length > 100 ? `${skill.description.substring(0, 100)}...` : skill.description
        });
        if (!skill.isBuiltIn && !skill.isGlobal) {
          const removeBtn = skillItemEl.createEl("button", {
            text: "Remove",
            cls: "ocop-skills-remove-btn"
          });
          removeBtn.addEventListener("click", async () => {
            await removeSkill(this.app, skill.name, skillProvider);
            this.display();
          });
        }
      }
    } else {
      skillsContentEl.createDiv({ cls: "ocop-skills-empty", text: "No skills installed. Install Obsidian context skills above or add a custom skill from GitHub." });
    }
  }
  display() {
    var _a;
    const { containerEl } = this;
    this.probes.abort();
    this.probes = new AbortController();
    containerEl.empty();
    containerEl.addClass("ocop-settings");
    new import_obsidian27.Setting(containerEl).setName("Quick Start").setHeading();
    containerEl.createDiv({
      cls: "setting-item-description",
      text: "Start here: choose your default model and install Obsidian context support."
    });
    new import_obsidian27.Setting(containerEl).setName("What should Obsidian AI Tutor call you?").setDesc("Your name for personalized greetings (leave empty for generic greetings)").addText(
      (text) => text.setPlaceholder("Enter your name").setValue(this.plugin.settings.userName).onChange(async (value) => {
        this.plugin.settings.userName = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian27.Setting(containerEl).setName("AI provider").setDesc("Choose one official CLI; only the selected provider is used for requests.").addDropdown((dropdown) => {
      for (const provider of PROVIDERS) dropdown.addOption(provider.id, provider.label);
      dropdown.setValue(this.plugin.settings.selectedProvider).onChange(async (value) => {
        var _a2;
        this.plugin.settings.selectedProvider = value;
        await this.plugin.saveSettings();
        (_a2 = this.plugin.agentService) == null ? void 0 : _a2.cleanup();
        await this.plugin.installBundledSkillsOnce();
        this.display();
      });
    });
    for (const provider of PROVIDERS) {
      this.renderProviderConnectionRow(containerEl, provider.id);
    }
    this.renderDefaultModelRow(containerEl);
    const pathProvider = this.plugin.settings.selectedProvider;
    const pathDescriptor = getProviderDescriptor(pathProvider);
    const storedCliPath = ((_a = this.plugin.settings.providerCliPaths) == null ? void 0 : _a[pathProvider]) || (pathProvider === "copilot" ? this.plugin.settings.copilotCliPath || "" : "");
    const cliPathSetting = new import_obsidian27.Setting(containerEl).setName(`${pathDescriptor.label} \uC2E4\uD589 \uACBD\uB85C`).setDesc(`\uC790\uB3D9\uC73C\uB85C \uCC3E\uC73C\uBA74 \uBE44\uC6CC \uB450\uC138\uC694. \uBABB \uCC3E\uC744 \uB54C\uB9CC "which ${pathDescriptor.command}" \uACB0\uACFC\uB97C \uBD99\uC5EC \uB123\uC2B5\uB2C8\uB2E4.`);
    const cliPathValidationEl = containerEl.createDiv({ cls: "ocop-cli-path-validation" });
    cliPathValidationEl.style.color = "var(--text-error)";
    cliPathValidationEl.style.fontSize = "0.85em";
    cliPathValidationEl.style.marginTop = "-0.5em";
    cliPathValidationEl.style.marginBottom = "0.5em";
    cliPathValidationEl.style.display = "none";
    const validateCliPath = (value) => {
      const trimmed = value.trim();
      if (!trimmed || trimmed === pathDescriptor.command) return null;
      const expandedPath = expandHomePath2(trimmed);
      if (!fs13.existsSync(expandedPath)) return "Path does not exist";
      return fs13.statSync(expandedPath).isFile() ? null : "Path is a directory, not a file";
    };
    cliPathSetting.addText((text) => {
      const placeholder = process.platform === "win32" ? `C:\\Program Files\\${pathDescriptor.command}.exe` : `/usr/local/bin/${pathDescriptor.command}`;
      text.setPlaceholder(placeholder).setValue(storedCliPath).onChange(async (value) => {
        var _a2, _b;
        const error = validateCliPath(value);
        if (error) {
          cliPathValidationEl.setText(error);
          cliPathValidationEl.style.display = "block";
          text.inputEl.style.borderColor = "var(--text-error)";
        } else {
          cliPathValidationEl.style.display = "none";
          text.inputEl.style.borderColor = "";
        }
        this.plugin.settings.providerCliPaths = {
          ...this.plugin.settings.providerCliPaths,
          [pathProvider]: value.trim()
        };
        if (pathProvider === "copilot") this.plugin.settings.copilotCliPath = value.trim();
        await this.plugin.saveSettings();
        (_a2 = this.plugin.cliResolver) == null ? void 0 : _a2.reset();
        (_b = this.plugin.agentService) == null ? void 0 : _b.cleanup();
      });
      text.inputEl.addClass("ocop-settings-cli-path-input");
      text.inputEl.style.width = "100%";
      const initialCliError = validateCliPath(storedCliPath);
      if (initialCliError) {
        cliPathValidationEl.setText(initialCliError);
        cliPathValidationEl.style.display = "block";
        text.inputEl.style.borderColor = "var(--text-error)";
      }
    });
    this.renderSkillsSection(containerEl);
    const chatWrapperEl = containerEl.createDiv({ cls: "ocop-settings-advanced-wrapper" });
    const chatHeaderEl = chatWrapperEl.createDiv({ cls: "ocop-settings-advanced-header" });
    chatHeaderEl.setAttribute("tabindex", "0");
    chatHeaderEl.createSpan({ cls: "ocop-settings-advanced-title", text: "Chat Behavior" });
    chatHeaderEl.createSpan({ cls: "ocop-settings-advanced-toggle", text: "Show" });
    const chatContentEl = chatWrapperEl.createDiv({ cls: "ocop-settings-advanced-content" });
    setupCollapsible(chatWrapperEl, chatHeaderEl, chatContentEl, { isExpanded: false }, {
      initiallyExpanded: false,
      onToggle: (isExpanded) => {
        const toggleEl = chatHeaderEl.querySelector(".ocop-settings-advanced-toggle");
        if (toggleEl) toggleEl.textContent = isExpanded ? "Hide" : "Show";
      },
      baseAriaLabel: "Chat Behavior settings"
    });
    chatContentEl.createDiv({
      cls: "setting-item-description",
      text: "Control how chat behaves day to day without touching advanced system settings."
    });
    new import_obsidian27.Setting(chatContentEl).setName("Excluded tags").setDesc("Notes with these tags will not auto-load as context (one per line, without #)").addTextArea((text) => {
      text.setPlaceholder("system\nprivate\ndraft").setValue(this.plugin.settings.excludedTags.join("\n")).onChange(async (value) => {
        this.plugin.settings.excludedTags = value.split(/\r?\n/).map((entry) => entry.trim().replace(/^#/, "")).filter((entry) => entry.length > 0);
        await this.plugin.saveSettings();
      });
      text.inputEl.rows = 4;
      text.inputEl.cols = 30;
    });
    new import_obsidian27.Setting(chatContentEl).setName("Media folder").setDesc("Folder containing attachments/images. Leave empty for vault root.").addText((text) => {
      text.setPlaceholder("attachments").setValue(this.plugin.settings.mediaFolder).onChange(async (value) => {
        this.plugin.settings.mediaFolder = value.trim();
        await this.plugin.saveSettings();
      });
      text.inputEl.addClass("ocop-settings-media-input");
    });
    new import_obsidian27.Setting(chatContentEl).setName("Web search").setDesc("Allow the agent to use web search and web fetch tools. Turn off to prevent ground-truth leakage during quizzes.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableWebSearch).onChange(async (value) => {
        this.plugin.settings.enableWebSearch = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian27.Setting(chatContentEl).setName("Auto-generate conversation titles").setDesc("Automatically generate conversation titles after the first exchange.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableAutoTitleGeneration).onChange(async (value) => {
        this.plugin.settings.enableAutoTitleGeneration = value;
        await this.plugin.saveSettings();
        this.display();
      })
    );
    if (this.plugin.settings.enableAutoTitleGeneration && this.plugin.settings.selectedProvider === "copilot") {
      new import_obsidian27.Setting(chatContentEl).setName("Title generation model").setDesc("Model used for auto-generating conversation titles.").addDropdown((dropdown) => {
        dropdown.addOption("", "Auto");
        for (const model of COPILOT_MODELS) {
          dropdown.addOption(model.value, model.label);
        }
        dropdown.setValue(this.plugin.settings.titleGenerationModel || "").onChange(async (value) => {
          this.plugin.settings.titleGenerationModel = value;
          await this.plugin.saveSettings();
        });
      });
    }
    const advancedWrapperEl = containerEl.createDiv({ cls: "ocop-settings-advanced-wrapper" });
    const advancedHeaderEl = advancedWrapperEl.createDiv({ cls: "ocop-settings-advanced-header" });
    advancedHeaderEl.setAttribute("tabindex", "0");
    advancedHeaderEl.createSpan({ cls: "ocop-settings-advanced-title", text: "Advanced & Power User" });
    advancedHeaderEl.createSpan({ cls: "ocop-settings-advanced-toggle", text: "Show" });
    const advancedContentEl = advancedWrapperEl.createDiv({ cls: "ocop-settings-advanced-content" });
    setupCollapsible(advancedWrapperEl, advancedHeaderEl, advancedContentEl, { isExpanded: false }, {
      initiallyExpanded: false,
      onToggle: (isExpanded) => {
        const toggleEl = advancedHeaderEl.querySelector(".ocop-settings-advanced-toggle");
        if (toggleEl) toggleEl.textContent = isExpanded ? "Hide" : "Show";
      },
      baseAriaLabel: "Advanced settings"
    });
    new import_obsidian27.Setting(advancedContentEl).setName("Workflows & Shortcuts").setHeading();
    advancedContentEl.createDiv({
      cls: "setting-item-description",
      text: "Configure optional workflow presets and keyboard shortcuts once you are comfortable with the basics."
    });
    const inlineEditCommandId = "obsidian-ai-tutor:inline-edit";
    const inlineEditHotkey = getHotkeyForCommand(this.app, inlineEditCommandId);
    new import_obsidian27.Setting(advancedContentEl).setName("Inline edit hotkey").setDesc(inlineEditHotkey ? `Current: ${inlineEditHotkey}` : "No hotkey set. Click to configure.").addButton((button) => button.setButtonText(inlineEditHotkey ? "Change" : "Set hotkey").onClick(() => openHotkeySettings(this.app)));
    const openChatCommandId = "obsidian-ai-tutor:open-view";
    const openChatHotkey = getHotkeyForCommand(this.app, openChatCommandId);
    new import_obsidian27.Setting(advancedContentEl).setName("Open chat hotkey").setDesc(openChatHotkey ? `Current: ${openChatHotkey}` : "No hotkey set. Click to configure.").addButton((button) => button.setButtonText(openChatHotkey ? "Change" : "Set hotkey").onClick(() => openHotkeySettings(this.app)));
    new import_obsidian27.Setting(advancedContentEl).setName("Workflow Presets").setHeading();
    const slashCommandsDesc = advancedContentEl.createDiv({ cls: "ocop-slash-settings-desc" });
    slashCommandsDesc.createEl("p", {
      text: "Create custom prompt templates triggered by /command. Use $ARGUMENTS for all arguments, $1/$2 for positional args, @file for file content, and !`bash` for command output.",
      cls: "setting-item-description"
    });
    const slashCommandsContainer = advancedContentEl.createDiv({ cls: "ocop-slash-commands-container" });
    new SlashCommandSettings(slashCommandsContainer, this.plugin);
    new import_obsidian27.Setting(advancedContentEl).setName("Safety & Permissions").setHeading();
    advancedContentEl.createDiv({
      cls: "setting-item-description",
      text: "The toggle below is the main safety control for beginners. Detailed allow/block rules are in Advanced."
    });
    new import_obsidian27.Setting(advancedContentEl).setName("Enable command blocklist").setDesc("Block potentially dangerous shell commands").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableBlocklist).onChange(async (value) => {
        this.plugin.settings.enableBlocklist = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian27.Setting(advancedContentEl).setName("Enable inline bash in slash commands").setDesc("Allow !`command` syntax in workflow presets to execute shell commands. Disabled by default for security \u2014 enable only if you trust your slash command sources.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableInlineBash).onChange(async (value) => {
        this.plugin.settings.enableInlineBash = value;
        await this.plugin.saveSettings();
      })
    );
    const platformKey = getCurrentPlatformKey();
    const isWindows4 = platformKey === "windows";
    const platformLabel = isWindows4 ? "Windows" : "Unix";
    new import_obsidian27.Setting(advancedContentEl).setName(`Blocked commands (${platformLabel})`).setDesc(`Patterns to block on ${platformLabel} (one per line). Supports regex.`).addTextArea((text) => {
      const placeholder = isWindows4 ? "del /s /q\nrd /s /q\nRemove-Item -Recurse -Force" : "rm -rf\nchmod 777\nmkfs";
      text.setPlaceholder(placeholder).setValue(this.plugin.settings.blockedCommands[platformKey].join("\n")).onChange(async (value) => {
        this.plugin.settings.blockedCommands[platformKey] = value.split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
        await this.plugin.saveSettings();
      });
      text.inputEl.rows = 6;
      text.inputEl.cols = 40;
    });
    if (isWindows4) {
      new import_obsidian27.Setting(advancedContentEl).setName("Blocked commands (Unix/Git Bash)").setDesc("Unix patterns also blocked on Windows because Git Bash can invoke them.").addTextArea((text) => {
        text.setPlaceholder("rm -rf\nchmod 777\nmkfs").setValue(this.plugin.settings.blockedCommands.unix.join("\n")).onChange(async (value) => {
          this.plugin.settings.blockedCommands.unix = value.split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
          await this.plugin.saveSettings();
        });
        text.inputEl.rows = 4;
        text.inputEl.cols = 40;
      });
    }
    new import_obsidian27.Setting(advancedContentEl).setName("Allowed export paths").setDesc("Paths outside the vault where files can be exported (one per line). Supports ~ for home directory.").addTextArea((text) => {
      const placeholder = process.platform === "win32" ? "~/Desktop\n~/Downloads\n%TEMP%" : "~/Desktop\n~/Downloads\n/tmp";
      text.setPlaceholder(placeholder).setValue(this.plugin.settings.allowedExportPaths.join("\n")).onChange(async (value) => {
        this.plugin.settings.allowedExportPaths = value.split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
        await this.plugin.saveSettings();
      });
      text.inputEl.rows = 4;
      text.inputEl.cols = 40;
    });
    const approvedDesc = advancedContentEl.createDiv({ cls: "ocop-approved-desc" });
    approvedDesc.createEl("p", {
      text: "Actions that have been permanently approved (via Always Allow). These will not require approval in Safe mode.",
      cls: "setting-item-description"
    });
    if (this.plugin.settings.permissions.length === 0) {
      advancedContentEl.createDiv({
        cls: "ocop-approved-empty",
        text: "No approved actions yet. When you click Always Allow in the approval dialog, actions will appear here."
      });
    } else {
      const listEl = advancedContentEl.createDiv({ cls: "ocop-approved-list" });
      for (const action of this.plugin.settings.permissions) {
        const itemEl = listEl.createDiv({ cls: "ocop-approved-item" });
        const infoEl = itemEl.createDiv({ cls: "ocop-approved-item-info" });
        infoEl.createSpan({ cls: "ocop-approved-item-tool", text: action.toolName });
        infoEl.createDiv({ cls: "ocop-approved-item-pattern", text: action.pattern });
        infoEl.createSpan({ cls: "ocop-approved-item-date", text: new Date(action.approvedAt).toLocaleDateString() });
        const removeBtn = itemEl.createEl("button", { text: "Remove", cls: "ocop-approved-remove-btn" });
        removeBtn.addEventListener("click", async () => {
          this.plugin.settings.permissions = this.plugin.settings.permissions.filter((entry) => entry !== action);
          await this.plugin.saveSettings();
          this.display();
        });
      }
      new import_obsidian27.Setting(advancedContentEl).setName("Clear all approved actions").setDesc("Remove all permanently approved actions").addButton(
        (button) => button.setButtonText("Clear all").setWarning().onClick(async () => {
          this.plugin.settings.permissions = [];
          await this.plugin.saveSettings();
          this.display();
        })
      );
    }
    new import_obsidian27.Setting(advancedContentEl).setName("Authentication & Environment").setHeading();
    advancedContentEl.createDiv({
      cls: "setting-item-description",
      text: `\uB300\uBD80\uBD84\uC758 \uD559\uC0DD\uC740 \uADF8\uB300\uB85C \uB450\uBA74 \uB429\uB2C8\uB2E4. ${getProviderDescriptor(this.plugin.settings.selectedProvider).label} \uB85C\uADF8\uC778\uC774 \uC774\uBBF8 \uB05D\uB0AC\uB2E4\uBA74 \uC190\uB308 \uD544\uC694\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.`
    });
    new import_obsidian27.Setting(advancedContentEl).setName("GitHub token").setDesc("Optional. Uses COPILOT_GITHUB_TOKEN, GH_TOKEN, and GITHUB_TOKEN for the Copilot child process when set.").addText(
      (text) => text.setPlaceholder("github_pat_...").setValue(this.plugin.settings.githubToken).onChange(async (value) => {
        this.plugin.settings.githubToken = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian27.Setting(advancedContentEl).setName("Custom variables").setDesc("\uC120\uD0DD\uD55C provider\uC758 CLI\uC5D0 \uB118\uAE38 \uD658\uACBD \uBCC0\uC218\uC785\uB2C8\uB2E4 (KEY=VALUE, \uD55C \uC904\uC5D0 \uD558\uB098).").addTextArea((text) => {
      text.setPlaceholder("COPILOT_GITHUB_TOKEN=your-token\nGH_TOKEN=your-token").setValue(this.plugin.settings.environmentVariables).onChange(async (value) => {
        await this.plugin.applyEnvironmentVariables(value);
      });
      text.inputEl.rows = 6;
      text.inputEl.cols = 50;
      text.inputEl.addClass("ocop-settings-env-textarea");
    });
    const envSnippetsContainer = advancedContentEl.createDiv({ cls: "ocop-env-snippets-container" });
    new EnvSnippetManager(envSnippetsContainer, this.plugin);
    new import_obsidian27.Setting(advancedContentEl).setName("Advanced & Developer").setHeading();
    advancedContentEl.createDiv({
      cls: "setting-item-description",
      text: "Only change these if you know why you need them. They are preserved here for power users and debugging."
    });
    new import_obsidian27.Setting(advancedContentEl).setName("Custom system prompt").setDesc("\uC120\uD0DD\uD55C provider\uC758 \uAE30\uBCF8 \uD504\uB86C\uD504\uD2B8 \uB4A4\uC5D0 \uBD99\uB294 \uCD94\uAC00 \uC9C0\uC2DC\uC785\uB2C8\uB2E4.").addTextArea((text) => {
      text.setPlaceholder("Add custom instructions here...").setValue(this.plugin.settings.systemPrompt).onChange(async (value) => {
        this.plugin.settings.systemPrompt = value;
        await this.plugin.saveSettings();
      });
      text.inputEl.rows = 6;
      text.inputEl.cols = 50;
    });
    new import_obsidian27.Setting(advancedContentEl).setName("Vim-style navigation mappings").setDesc('One mapping per line. Format: "map <key> <action>" (actions: scrollUp, scrollDown, focusInput).').addTextArea((text) => {
      let pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
      let saveTimeout = null;
      const commitValue = async (showError) => {
        if (saveTimeout !== null) {
          window.clearTimeout(saveTimeout);
          saveTimeout = null;
        }
        const result = parseNavMappings(pendingValue);
        if (!result.settings) {
          if (showError) {
            new import_obsidian27.Notice(`Invalid navigation mappings: ${result.error}`);
            pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
            text.setValue(pendingValue);
          }
          return;
        }
        this.plugin.settings.keyboardNavigation.scrollUpKey = result.settings.scrollUp;
        this.plugin.settings.keyboardNavigation.scrollDownKey = result.settings.scrollDown;
        this.plugin.settings.keyboardNavigation.focusInputKey = result.settings.focusInput;
        await this.plugin.saveSettings();
        pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
        text.setValue(pendingValue);
      };
      const scheduleSave = () => {
        if (saveTimeout !== null) {
          window.clearTimeout(saveTimeout);
        }
        saveTimeout = window.setTimeout(() => {
          void commitValue(false);
        }, 500);
      };
      text.setPlaceholder("map w scrollUp\nmap s scrollDown\nmap i focusInput").setValue(pendingValue).onChange((value) => {
        pendingValue = value;
        scheduleSave();
      });
      text.inputEl.rows = 3;
      text.inputEl.addEventListener("blur", async () => {
        await commitValue(true);
      });
    });
  }
};

// src/main.ts
var ObsidianCopilotPlugin = class extends import_obsidian28.Plugin {
  constructor() {
    super(...arguments);
    this.conversations = [];
    this.activeConversationId = null;
    this.runtimeEnvironmentVariables = "";
    this.hasNotifiedEnvChange = false;
  }
  async onload() {
    try {
      await this.loadSettings();
    } catch (error) {
      console.error("[ObsidianCopilot] Failed to load settings during startup:", error);
      this.storage = new StorageService(this);
      this.settings = {
        ...DEFAULT_SETTINGS,
        slashCommands: []
      };
      this.conversations = [];
      this.activeConversationId = null;
      new import_obsidian28.Notice("Obsidian AI Tutor loaded with default settings due to a startup error.");
    }
    this.agentService = new CopilotBridgeService(this);
    this.agentService.onOutcome = (providerId, outcome) => {
      const next = applyRequestOutcome(this.providerConnections, providerId, outcome, Date.now());
      if (next !== this.providerConnections) this.persistProviderConnections(next);
    };
    this.agentService.onPermissionNotice = (message) => {
      new import_obsidian28.Notice(message);
    };
    void this.agentService.prewarmCapabilities();
    this.app.workspace.onLayoutReady(() => {
      void this.checkAndShowSetupWizard();
      void this.installBundledSkillsOnce();
    });
    (0, import_obsidian28.addIcon)("obsidian-ai-tutor-icon", COPILOT_ICON_SVG);
    this.registerView(
      VIEW_TYPE_OBSIDIAN_COPILOT,
      (leaf) => new ObsidianCopilotView(leaf, this)
    );
    this.addRibbonIcon("obsidian-ai-tutor-icon", "Open Obsidian AI Tutor", () => {
      this.activateView();
    });
    this.addCommand({
      id: "open-view",
      name: "Obsidian AI Tutor: Open chat view",
      callback: () => {
        this.activateView();
      }
    });
    this.addCommand({
      id: "inline-edit",
      name: "Obsidian AI Tutor: Inline edit",
      editorCallback: async (editor, view) => {
        var _a;
        const selectedText = editor.getSelection();
        const notePath = ((_a = view.file) == null ? void 0 : _a.path) || "unknown";
        let editContext;
        if (selectedText.trim()) {
          editContext = { mode: "selection", selectedText };
        } else {
          const cursor = editor.getCursor();
          const cursorContext = buildCursorContext(
            (line) => editor.getLine(line),
            editor.lineCount(),
            cursor.line,
            cursor.ch
          );
          editContext = { mode: "cursor", cursorContext };
        }
        const modal = new InlineEditModal(this.app, this, editContext, notePath);
        const result = await modal.openAndWait();
        if (result.decision === "accept" && result.editedText !== void 0) {
          new import_obsidian28.Notice(editContext.mode === "cursor" ? "Inserted" : "Edit applied");
        }
      }
    });
    this.addCommand({
      id: "attach-current-note",
      name: "Obsidian AI Tutor: Attach current note to chat",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return false;
        if (checking) return true;
        this.activateView().then(() => {
          const chatView = this.getView();
          if (chatView == null ? void 0 : chatView.fileContextManager) {
            const normalizedPath = activeFile.path.replace(/\\/g, "/");
            chatView.fileContextManager.attachFileFromCommand(normalizedPath);
            new import_obsidian28.Notice(`Attached: ${activeFile.name}`);
          }
        }).catch((error) => {
          console.error("[ObsidianCopilot] Failed to activate view for file attach:", error);
        });
        return true;
      }
    });
    this.addSettingTab(new ObsidianCopilotSettingTab(this.app, this));
  }
  onunload() {
    this.agentService.cleanup();
  }
  /** Opens the ObsidianCode sidebar view, creating it if necessary. */
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_OBSIDIAN_COPILOT)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: VIEW_TYPE_OBSIDIAN_COPILOT,
          active: true
        });
        leaf = rightLeaf;
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
  /**
   * Show the first-run setup wizard if the Copilot CLI is not found.
   * Only fires once per Obsidian session to avoid pestering users.
   */
  async checkAndShowSetupWizard() {
    try {
      const { hasShownThisSession: hasShownThisSession2 } = await Promise.resolve().then(() => (init_AutoSetupService(), AutoSetupService_exports));
      if (hasShownThisSession2()) return;
      if (this.settings.providerCliPaths[this.settings.selectedProvider]) return;
      const { checkProviderSetupStatus: checkProviderSetupStatus2 } = await Promise.resolve().then(() => (init_AutoSetupService(), AutoSetupService_exports));
      const { cliFound } = checkProviderSetupStatus2(this.settings.selectedProvider);
      if (cliFound) return;
      const { SetupWizardModal: SetupWizardModal2 } = await Promise.resolve().then(() => (init_SetupWizardModal(), SetupWizardModal_exports));
      new SetupWizardModal2(this.app, this).open();
    } catch (err) {
      console.warn("[ObsidianCopilot] Setup wizard failed to open:", err);
    }
  }
  /**
   * Put the bundled Obsidian skills in the vault, once.
   *
   * They teach the CLI wikilinks, callouts, properties and canvas files, and
   * they used to wait behind an Install button in a collapsed settings section
   * — so the students who needed them most never got them. Installed on first
   * launch only: the flag means a student who removes them keeps them removed.
   */
  async installBundledSkillsOnce() {
    try {
      const provider = this.settings.selectedProvider;
      const state = await this.storage.loadState();
      const { installObsidianSkills: installObsidianSkills2, isObsidianSkillsInstalled: isObsidianSkillsInstalled2, shouldInstallBundledSkills: shouldInstallBundledSkills2 } = await Promise.resolve().then(() => (init_ObsidianSkillsInstaller(), ObsidianSkillsInstaller_exports));
      if (!shouldInstallBundledSkills2(state, provider, isObsidianSkillsInstalled2(this.app, provider))) return;
      if (await installObsidianSkills2(this.app, provider)) {
        await this.storage.updateState({
          skillsAutoInstalled: { ...state.skillsAutoInstalled, [provider]: true }
        });
      }
    } catch (error) {
      console.warn("[ObsidianCopilot] Could not install the bundled skills:", error);
    }
  }
  /** Loads settings and conversations from persistent storage. */
  async loadSettings() {
    this.storage = new StorageService(this);
    const { settings, state } = await this.storage.initialize();
    const slashCommands = await this.storage.commands.loadAll();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      slashCommands
    };
    if (this.settings.permissionMode === "yolo") this.settings.permissionMode = "agent";
    if (this.settings.permissionMode === "normal") this.settings.permissionMode = "ask";
    if (this.settings.lastNonPlanPermissionMode === "yolo") this.settings.lastNonPlanPermissionMode = "agent";
    if (this.settings.lastNonPlanPermissionMode === "normal") this.settings.lastNonPlanPermissionMode = "ask";
    if (this.settings.permissionMode === "plan") this.settings.permissionMode = "ask";
    if (this.settings.model === "gpt-4o") this.settings.model = "gpt-4.1";
    migrateProviderModels(this.settings.providerModels);
    this.conversations = await this.storage.sessions.loadAllConversations();
    this.activeConversationId = state.activeConversationId;
    this.providerConnections = state.providerConnections;
    if (this.activeConversationId && !this.conversations.find((c) => c.id === this.activeConversationId)) {
      this.activeConversationId = null;
    }
    const backfilledConversations = this.backfillConversationResponseTimestamps();
    this.runtimeEnvironmentVariables = this.settings.environmentVariables || "";
    for (const conv of backfilledConversations) {
      try {
        await this.storage.sessions.saveConversation(conv);
      } catch (error) {
        console.error(`[ObsidianCopilot] Failed to persist backfilled conversation ${conv.id}:`, error);
      }
    }
  }
  backfillConversationResponseTimestamps() {
    const updated = [];
    for (const conv of this.conversations) {
      if (conv.lastResponseAt != null) continue;
      if (!conv.messages || conv.messages.length === 0) continue;
      for (let i = conv.messages.length - 1; i >= 0; i--) {
        const msg = conv.messages[i];
        if (msg.role === "assistant") {
          conv.lastResponseAt = msg.timestamp;
          updated.push(conv);
          break;
        }
      }
    }
    return updated;
  }
  /** Persists settings to storage. */
  async saveSettings() {
    const { slashCommands: _, ...settingsToSave } = this.settings;
    await this.storage.settings.save(settingsToSave);
    await this.storage.saveState({
      activeConversationId: this.activeConversationId,
      // saveState writes the whole state object, so anything omitted here is
      // erased. Picking a provider in the chat popover calls saveSettings, and
      // without this line that click wiped every stored connection.
      providerConnections: this.providerConnections
    });
  }
  /** Store what a check or a request just decided about one provider. */
  setProviderConnection(providerId, state) {
    this.persistProviderConnections({
      ...this.providerConnections,
      [providerId]: { state, at: Date.now() }
    });
  }
  persistProviderConnections(next) {
    var _a;
    this.providerConnections = next;
    void ((_a = this.storage) == null ? void 0 : _a.updateState({ providerConnections: next }).catch((error) => console.warn("[ObsidianCopilot] Failed to store provider connection:", error)));
  }
  getActiveEnvironmentVariables() {
    return this.runtimeEnvironmentVariables;
  }
  async applyEnvironmentVariables(envText) {
    this.settings.environmentVariables = envText;
    await this.saveSettings();
    if (envText !== this.runtimeEnvironmentVariables) {
      if (!this.hasNotifiedEnvChange) {
        new import_obsidian28.Notice("Environment variables changed. Restart the plugin for changes to take effect.");
        this.hasNotifiedEnvChange = true;
      }
    } else {
      this.hasNotifiedEnvChange = false;
    }
  }
  getResolvedCopilotCliPath() {
    return this.settings.copilotCliPath || findProviderCliPath(this.settings.selectedProvider, this.settings.providerCliPaths[this.settings.selectedProvider] || "") || "copilot";
  }
  get cliResolver() {
    return {
      resolve: () => this.getResolvedCopilotCliPath(),
      reset: () => {
      }
    };
  }
  /** Removes cached images associated with a conversation if not used elsewhere. */
  cleanupConversationImages(conversation) {
    const cachePaths = /* @__PURE__ */ new Set();
    for (const message of conversation.messages || []) {
      if (!message.images) continue;
      for (const img of message.images) {
        if (img.cachePath) {
          cachePaths.add(img.cachePath);
        }
      }
    }
    if (cachePaths.size === 0) return;
    const inUseElsewhere = /* @__PURE__ */ new Set();
    for (const conv of this.conversations) {
      if (conv.id === conversation.id) continue;
      for (const msg of conv.messages || []) {
        if (!msg.images) continue;
        for (const img of msg.images) {
          if (img.cachePath && cachePaths.has(img.cachePath)) {
            inUseElsewhere.add(img.cachePath);
          }
        }
      }
    }
    const deletable = Array.from(cachePaths).filter((p) => !inUseElsewhere.has(p));
    if (deletable.length > 0) {
      deleteCachedImages(this.app, deletable);
    }
  }
  generateConversationId() {
    return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
  generateDefaultTitle() {
    const now = /* @__PURE__ */ new Date();
    return now.toLocaleString(void 0, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  getConversationPreview(conv) {
    const firstUserMsg = conv.messages.find((m) => m.role === "user");
    if (!firstUserMsg) return "New conversation";
    return firstUserMsg.content.substring(0, 50) + (firstUserMsg.content.length > 50 ? "..." : "");
  }
  /** Creates a new conversation and sets it as active. */
  async createConversation() {
    const conversation = {
      id: this.generateConversationId(),
      title: this.generateDefaultTitle(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: null,
      messages: []
    };
    this.conversations.unshift(conversation);
    this.activeConversationId = conversation.id;
    this.agentService.resetSession();
    await this.storage.sessions.saveConversation(conversation);
    await this.storage.updateState({ activeConversationId: this.activeConversationId });
    return conversation;
  }
  /** Switches to an existing conversation by ID. */
  async switchConversation(id) {
    const conversation = this.conversations.find((c) => c.id === id);
    if (!conversation) return null;
    this.activeConversationId = id;
    this.agentService.setSessionId(conversation.sessionId);
    await this.storage.updateState({ activeConversationId: this.activeConversationId });
    return conversation;
  }
  /** Deletes a conversation and switches to another if necessary. */
  async deleteConversation(id) {
    const index = this.conversations.findIndex((c) => c.id === id);
    if (index === -1) return;
    const conversation = this.conversations[index];
    this.cleanupConversationImages(conversation);
    this.conversations.splice(index, 1);
    await this.storage.sessions.deleteConversation(id);
    if (this.activeConversationId === id) {
      if (this.conversations.length > 0) {
        await this.switchConversation(this.conversations[0].id);
      } else {
        await this.createConversation();
      }
    }
  }
  /** Renames a conversation. */
  async renameConversation(id, title) {
    const conversation = this.conversations.find((c) => c.id === id);
    if (!conversation) return;
    conversation.title = title.trim() || this.generateDefaultTitle();
    conversation.updatedAt = Date.now();
    await this.storage.sessions.saveConversation(conversation);
  }
  /** Updates conversation properties (messages, sessionId, etc.). */
  async updateConversation(id, updates) {
    const conversation = this.conversations.find((c) => c.id === id);
    if (!conversation) return;
    Object.assign(conversation, updates, { updatedAt: Date.now() });
    await this.storage.sessions.saveConversation(conversation);
  }
  /** Returns the current active conversation. */
  getActiveConversation() {
    return this.conversations.find((c) => c.id === this.activeConversationId) || null;
  }
  /** Gets a conversation by ID from the in-memory cache. */
  getConversationById(id) {
    return this.conversations.find((c) => c.id === id) || null;
  }
  /** Finds an existing empty conversation (no messages). */
  findEmptyConversation() {
    return this.conversations.find((c) => c.messages.length === 0) || null;
  }
  /** Returns conversation metadata list for the history dropdown. */
  getConversationList() {
    return this.conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastResponseAt: c.lastResponseAt,
      messageCount: c.messages.length,
      preview: this.getConversationPreview(c),
      titleGenerationStatus: c.titleGenerationStatus
    }));
  }
  /** Returns the active ObsidianCode view from workspace, if open. */
  getView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_OBSIDIAN_COPILOT);
    if (leaves.length > 0) {
      return leaves[0].view;
    }
    return null;
  }
};
