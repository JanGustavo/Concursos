/**
 * Verificador de atualizações da extensão.
 *
 * Ajuste estes valores se a extensão for publicada em outro repositório.
 */
const GITHUB_OWNER = 'JanGustavo';
const GITHUB_REPO = 'Concursos';

const UPDATE_CACHE_KEY = 'granPlusUpdateCache';
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4000;

function parseSemver(version) {
  const match = String(version || '').trim().replace(/^v/i, '').match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : []
  };
}

function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;

  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av === bv) continue;
    const an = /^\d+$/.test(av);
    const bn = /^\d+$/.test(bv);
    if (an && bn) return Number(av) > Number(bv) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

function getUpdateUrls() {
  const base = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
  return {
    release: `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    manifest: `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/gran-questoes-plus/manifest.json`,
    download: `${base}/releases/latest/download/gran-questoes-plus.zip`
  };
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function readRemoteRelease() {
  const urls = getUpdateUrls();
  try {
    const release = await fetchWithTimeout(urls.release);
    const version = String(release.tag_name || '').replace(/^v/i, '');
    if (!parseSemver(version)) throw new Error('Release semver inválida.');
    return { version, downloadUrl: urls.download };
  } catch (releaseError) {
    try {
      const manifest = await fetchWithTimeout(urls.manifest);
      const version = String(manifest.version || '');
      if (!parseSemver(version)) throw new Error('Manifest semver inválida.');
      return { version, downloadUrl: urls.download };
    } catch (manifestError) {
      throw new Error('Servidor de atualização indisponível no momento.');
    }
  }
}

async function getUpdateCache() {
  const result = await chrome.storage.local.get(UPDATE_CACHE_KEY);
  return result[UPDATE_CACHE_KEY] || null;
}

async function checkForUpdates(options = {}) {
  const localVersion = chrome.runtime.getManifest().version;
  const cached = await getUpdateCache();
  const force = options.force === true;
  if (!force && cached && Date.now() - Number(cached.checkedAt) < UPDATE_INTERVAL_MS) {
    return { ...cached.result, cached: true };
  }

  try {
    const remote = await readRemoteRelease();
    const comparison = compareSemver(remote.version, localVersion);
    const result = comparison != null && comparison > 0
      ? {
          status: 'update',
          localVersion,
          remoteVersion: remote.version,
          downloadUrl: remote.downloadUrl
        }
      : { status: 'current', localVersion, remoteVersion: remote.version };
    await chrome.storage.local.set({
      [UPDATE_CACHE_KEY]: { checkedAt: Date.now(), result }
    });
    return result;
  } catch (error) {
    const result = {
      status: 'error',
      message: 'Servidor de atualização indisponível no momento.'
    };
    await chrome.storage.local.set({
      [UPDATE_CACHE_KEY]: { checkedAt: Date.now(), result }
    });
    return result;
  }
}

self.GranUpdater = Object.freeze({
  checkForUpdates,
  compareSemver,
  getUpdateUrls,
  UPDATE_INTERVAL_MS
});
