/**
 * Update service for checking GitHub releases and downloading updates.
 */

import { reportError } from './report-error';

const GITHUB_RELEASES_API = 'https://api.github.com/repos/dongdongbh/Mindwtr/releases/latest';
const GITHUB_RELEASES_URL = 'https://github.com/dongdongbh/Mindwtr/releases/latest';
const MS_STORE_PRODUCT_ID = '9N0V5B0B6FRX';
const MS_STORE_URL = `ms-windows-store://pdp/?ProductId=${MS_STORE_PRODUCT_ID}`;
const WINGET_MANIFESTS_API = 'https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests/d/dongdongbh/Mindwtr';
const WINGET_PACKAGE_URL = 'https://github.com/microsoft/winget-pkgs/tree/master/manifests/d/dongdongbh/Mindwtr';
const HOMEBREW_CASK_API = 'https://formulae.brew.sh/api/cask/mindwtr.json';
const HOMEBREW_CASK_URL = 'https://formulae.brew.sh/cask/mindwtr';
const AUR_RPC_API = 'https://aur.archlinux.org/rpc/?v=5&type=info&arg[]=mindwtr-bin';
const AUR_PACKAGE_URL = 'https://aur.archlinux.org/packages/mindwtr-bin';
const APP_STORE_BUNDLE_ID = 'tech.dongdongbh.mindwtr';
const APP_STORE_LOOKUP_URL = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(APP_STORE_BUNDLE_ID)}&country=US`;
const APP_STORE_LOOKUP_FALLBACK_URL = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(APP_STORE_BUNDLE_ID)}`;
const APP_STORE_LISTING_URL = 'https://apps.apple.com/app/mindwtr/id6758597144';

export type InstallSource =
    | 'unknown'
    | 'direct'
    | 'github-release'
    | 'microsoft-store'
    | 'winget'
    | 'homebrew'
    | 'mac-app-store'
    | 'aur'
    | 'apt'
    | 'rpm'
    | 'flatpak'
    | 'snap'
    | 'appimage';

export type UpdateSource =
    | 'github-release'
    | 'winget'
    | 'homebrew'
    | 'aur'
    | 'app-store';

export interface UpdateInfo {
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion: string;
    releaseUrl: string;
    releaseNotes: string;
    downloadUrl: string | null;
    platform: string;
    assets: Array<{ name: string; url: string }>;
    source: UpdateSource;
    installSource: InstallSource;
    sourceFallback: boolean;
}

type UpdateAsset = { name: string; url: string };

type SourceVersionResult = {
    source: UpdateSource;
    version: string;
    releaseUrl: string;
};

type CheckForUpdatesOptions = {
    installSource?: InstallSource;
};

const getAssetNameFromUrl = (url: string): string => {
    try {
        const parsed = new URL(url);
        const name = parsed.pathname.split('/').pop() || '';
        return decodeURIComponent(name);
    } catch {
        return '';
    }
};

const findChecksumAsset = (assets: UpdateAsset[], downloadUrl: string): UpdateAsset | null => {
    const baseName = getAssetNameFromUrl(downloadUrl);
    if (!baseName) return null;
    const candidates = new Set([
        `${baseName}.sha256`,
        `${baseName}.sha256.txt`,
        `${baseName}.sha256sum`,
    ]);
    return assets.find((asset) => candidates.has(asset.name)) ?? null;
};

const parseChecksum = (text: string): string | null => {
    const token = text.trim().split(/\s+/)[0];
    return token && token.length >= 32 ? token.toLowerCase() : null;
};

const bufferToHex = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

interface GitHubAsset {
    name: string;
    browser_download_url: string;
}

interface GitHubRelease {
    tag_name: string;
    html_url: string;
    body: string;
    assets: GitHubAsset[];
}

interface AppStoreLookupResponse {
    results?: Array<{
        version?: unknown;
        trackViewUrl?: unknown;
    }>;
}

/**
 * Detect current platform
 */
function detectPlatform(): string {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('win')) return 'windows';
    if (userAgent.includes('mac')) return 'macos';
    if (userAgent.includes('linux')) return 'linux';
    return 'unknown';
}

/**
 * Get platform-specific download URL from release assets
 */
function getDownloadUrl(assets: GitHubAsset[], platform: string): string | null {
    const patterns: Record<string, RegExp[]> = {
        windows: [/\.msi$/i, /\.exe$/i],
        macos: [/\.dmg$/i, /\.app\.tar\.gz$/i],
        linux: [/\.AppImage$/i, /\.deb$/i, /\.rpm$/i]
    };

    const platformPatterns = patterns[platform] || [];

    for (const pattern of platformPatterns) {
        const asset = assets.find(a => pattern.test(a.name));
        if (asset) return asset.browser_download_url;
    }

    return null;
}

const stripVersionPrefix = (version: string): string => version.trim().replace(/^v/i, '');

const normalizeComparableVersion = (version: string): string => {
    const cleaned = stripVersionPrefix(version);
    const match = cleaned.match(/\d+(?:\.\d+){0,3}/);
    return match?.[0] || cleaned;
};

/**
 * Compare two semver version strings
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export function compareVersions(v1: string, v2: string): number {
    const clean1 = normalizeComparableVersion(v1);
    const clean2 = normalizeComparableVersion(v2);

    const parts1 = clean1.split('.').map(Number);
    const parts2 = clean2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
}

export function normalizeInstallSource(value: string | null | undefined): InstallSource {
    const normalized = String(value ?? '').trim().toLowerCase();
    switch (normalized) {
        case 'direct':
            return 'direct';
        case 'github-release':
            return 'github-release';
        case 'microsoft-store':
        case 'msstore':
            return 'microsoft-store';
        case 'winget':
            return 'winget';
        case 'homebrew':
            return 'homebrew';
        case 'mac-app-store':
        case 'macappstore':
            return 'mac-app-store';
        case 'aur':
            return 'aur';
        case 'apt':
            return 'apt';
        case 'rpm':
            return 'rpm';
        case 'flatpak':
            return 'flatpak';
        case 'snap':
            return 'snap';
        case 'appimage':
            return 'appimage';
        case 'unknown':
            return 'unknown';
        default:
            return 'unknown';
    }
}

const fetchGithubLatestRelease = async (): Promise<GitHubRelease> => {
    const response = await fetch(GITHUB_RELEASES_API, {
        headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Mindwtr-App',
        },
    });
    if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
    }
    return response.json();
};

const fetchHomebrewLatestVersion = async (): Promise<SourceVersionResult> => {
    const response = await fetch(HOMEBREW_CASK_API, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'Mindwtr-App',
        },
    });
    if (!response.ok) {
        throw new Error(`Homebrew API error: ${response.status}`);
    }
    const payload = await response.json() as { version?: unknown };
    const version = typeof payload.version === 'string' ? payload.version.trim() : '';
    if (!version) throw new Error('Homebrew API returned no version.');
    return {
        source: 'homebrew',
        version: normalizeComparableVersion(version),
        releaseUrl: HOMEBREW_CASK_URL,
    };
};

const fetchWingetLatestVersion = async (): Promise<SourceVersionResult> => {
    const response = await fetch(WINGET_MANIFESTS_API, {
        headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Mindwtr-App',
        },
    });
    if (!response.ok) {
        throw new Error(`winget manifests API error: ${response.status}`);
    }
    const payload = await response.json() as Array<{ name?: unknown; type?: unknown }>;
    const versions = payload
        .filter((entry) => entry && entry.type === 'dir' && typeof entry.name === 'string')
        .map((entry) => normalizeComparableVersion(String(entry.name)))
        .filter(Boolean);
    if (!versions.length) throw new Error('winget manifests list is empty.');
    const latestVersion = versions.reduce((latest, candidate) => (
        compareVersions(candidate, latest) > 0 ? candidate : latest
    ));
    return {
        source: 'winget',
        version: latestVersion,
        releaseUrl: WINGET_PACKAGE_URL,
    };
};

const fetchAurLatestVersion = async (): Promise<SourceVersionResult> => {
    const response = await fetch(AUR_RPC_API, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'Mindwtr-App',
        },
    });
    if (!response.ok) {
        throw new Error(`AUR RPC error: ${response.status}`);
    }
    const payload = await response.json() as { results?: Array<{ Version?: unknown }> };
    const rawVersion = typeof payload.results?.[0]?.Version === 'string'
        ? payload.results?.[0]?.Version
        : '';
    const normalized = normalizeComparableVersion(rawVersion ?? '');
    if (!normalized) throw new Error('AUR RPC returned no version.');
    return {
        source: 'aur',
        version: normalized,
        releaseUrl: AUR_PACKAGE_URL,
    };
};

const fetchAppStoreLatestVersion = async (): Promise<SourceVersionResult> => {
    const lookupUrls = [APP_STORE_LOOKUP_URL, APP_STORE_LOOKUP_FALLBACK_URL];
    let lastError: Error | null = null;
    for (const url of lookupUrls) {
        const response = await fetch(url, {
            headers: {
                Accept: 'application/json',
                'User-Agent': 'Mindwtr-App',
            },
        });
        if (!response.ok) {
            lastError = new Error(`App Store lookup failed (${url}): ${response.status}`);
            continue;
        }
        const payload = await response.json() as AppStoreLookupResponse;
        const first = Array.isArray(payload.results) ? payload.results[0] : null;
        const rawVersion = typeof first?.version === 'string' ? first.version.trim() : '';
        const version = normalizeComparableVersion(rawVersion);
        if (!version) {
            lastError = new Error(`Unable to parse App Store version from ${url}`);
            continue;
        }
        const trackViewUrl = typeof first?.trackViewUrl === 'string' && first.trackViewUrl.trim()
            ? first.trackViewUrl.trim()
            : APP_STORE_LISTING_URL;
        return {
            source: 'app-store',
            version,
            releaseUrl: trackViewUrl,
        };
    }
    if (lastError) throw lastError;
    throw new Error('Unable to fetch App Store version.');
};

const fetchSourceVersion = async (installSource: InstallSource): Promise<SourceVersionResult | null> => {
    switch (installSource) {
        case 'homebrew':
            return fetchHomebrewLatestVersion();
        case 'winget':
            return fetchWingetLatestVersion();
        case 'aur':
            return fetchAurLatestVersion();
        case 'mac-app-store':
            return fetchAppStoreLatestVersion();
        default:
            return null;
    }
};

/**
 * Check for updates from install source first, then GitHub release fallback.
 */
export async function checkForUpdates(currentVersion: string, options: CheckForUpdatesOptions = {}): Promise<UpdateInfo> {
    const platform = detectPlatform();
    const installSource = normalizeInstallSource(options.installSource);
    const cleanCurrentVersion = normalizeComparableVersion(currentVersion);
    let sourceResult: SourceVersionResult | null = null;
    let githubRelease: GitHubRelease | null = null;

    try {
        if (installSource !== 'unknown' && installSource !== 'direct' && installSource !== 'github-release') {
            try {
                sourceResult = await fetchSourceVersion(installSource);
            } catch (error) {
                reportError(`Failed to check ${installSource} for updates`, error);
            }
        }

        try {
            githubRelease = await fetchGithubLatestRelease();
        } catch (error) {
            if (!sourceResult) {
                throw error;
            }
            reportError('Failed to check GitHub fallback for updates', error);
        }

        if (!sourceResult && !githubRelease) {
            throw new Error('No update sources available.');
        }

        const githubLatestVersion = githubRelease ? normalizeComparableVersion(githubRelease.tag_name) : '';
        let latestVersion = sourceResult?.version ?? githubLatestVersion ?? cleanCurrentVersion;
        let source: UpdateSource = sourceResult?.source ?? 'github-release';
        let releaseUrl = sourceResult?.releaseUrl ?? GITHUB_RELEASES_URL;

        if (!latestVersion) {
            latestVersion = cleanCurrentVersion;
        }

        if (githubLatestVersion && compareVersions(githubLatestVersion, latestVersion) > 0) {
            latestVersion = githubLatestVersion;
            source = 'github-release';
            releaseUrl = githubRelease?.html_url || GITHUB_RELEASES_URL;
        }

        const hasUpdate = compareVersions(latestVersion, cleanCurrentVersion) > 0;
        const assets = (githubRelease?.assets || []).map((asset) => ({
            name: asset.name,
            url: asset.browser_download_url,
        }));
        const downloadUrl = githubRelease ? getDownloadUrl(githubRelease.assets || [], platform) : null;

        return {
            hasUpdate,
            currentVersion: cleanCurrentVersion,
            latestVersion,
            releaseUrl,
            releaseNotes: githubRelease?.body || '',
            downloadUrl,
            platform,
            assets,
            source,
            installSource,
            sourceFallback: Boolean(sourceResult && source === 'github-release'),
        };
    } catch (error) {
        reportError('Failed to check for updates', error);
        throw error;
    }
}

/**
 * Download and install update
 * Opens the download URL in browser - user will download and run installer
 */
export async function downloadUpdate(downloadUrl: string): Promise<void> {
    // Open the download URL in the default browser
    // The user will download the installer and run it
    window.open(downloadUrl, '_blank');
}

export type ChecksumVerificationResult = 'verified' | 'unavailable' | 'mismatch';

export async function verifyDownloadChecksum(downloadUrl: string, assets: UpdateAsset[]): Promise<ChecksumVerificationResult> {
    const checksumAsset = findChecksumAsset(assets, downloadUrl);
    if (!checksumAsset || typeof crypto === 'undefined' || !crypto.subtle) {
        return 'unavailable';
    }
    const [fileRes, checksumRes] = await Promise.all([
        fetch(downloadUrl),
        fetch(checksumAsset.url),
    ]);
    if (!fileRes.ok || !checksumRes.ok) {
        throw new Error('Checksum verification failed to download assets.');
    }
    const [fileBuffer, checksumText] = await Promise.all([
        fileRes.arrayBuffer(),
        checksumRes.text(),
    ]);
    const expected = parseChecksum(checksumText);
    if (!expected) return 'unavailable';
    const digest = await crypto.subtle.digest('SHA-256', fileBuffer);
    const actual = bufferToHex(digest);
    return actual === expected ? 'verified' : 'mismatch';
}

export { GITHUB_RELEASES_URL, MS_STORE_URL };
