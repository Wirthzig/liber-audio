import { execFile, spawn } from 'child_process';
import crypto from 'crypto';
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectLibraries, loadLibraries, LoadRequest } from './dj/index';
import { addToMusicPlaylist, MusicWriteResult } from './dj/writeMusic';
import { writeRekordboxXml, RekordboxTrackRef } from './dj/writeRekordbox';
import { appendToSeratoCrate, isSeratoRunning, SeratoWriteResult } from './dj/writeSerato';

// Custom scheme so <audio> can stream local files in dev AND prod
// (plain file:// is blocked by web security when the page is http://localhost)
protocol.registerSchemesAsPrivileged([
    { scheme: 'liberaudio', privileges: { secure: true, stream: true, supportFetchAPI: false } },
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const nodeRequire = createRequire(import.meta.url);

// --- Dependency Manager ---
const APP_SUPPORT = app.getPath('userData');
const YT_DLP_PATH = path.join(APP_SUPPORT, 'yt-dlp');
const FFMPEG_PATH = path.join(APP_SUPPORT, 'ffmpeg');
const FFMPEG_ARCH_MARKER = path.join(APP_SUPPORT, 'ffmpeg-arch');
const SEARCH_CACHE_PATH = path.join(APP_SUPPORT, 'search-cache.json');

// --- YTMusic API Setup ---
let ytmusic: any = null;
let isYtMusicReady = false;
let ytmusicFailStreak = 0; // consecutive hard (non-429) failures
let ytmusicDisabled = false; // skip Tier 1 for the session once it's clearly broken
let lastSearchTime = 0;

// --- SELF-UPDATING SEARCH MODULE ---
// The YTMusic search library is bundled into one self-contained file that
// lives in the GitHub repo (search-module/). On startup we compare versions
// and download a newer bundle if available — so search fixes reach users
// WITHOUT a full app release. Falls back to the built-in copy on any failure.
const SEARCH_MODULE_DIR = path.join(APP_SUPPORT, 'search-module');
const SEARCH_MODULE_PATH = path.join(SEARCH_MODULE_DIR, 'ytmusic-bundle.cjs');
const SEARCH_MODULE_VERSION_PATH = path.join(SEARCH_MODULE_DIR, 'version.json');
const SEARCH_MODULE_BASE = 'https://raw.githubusercontent.com/Wirthzig/LiberAudio/main/search-module';

let searchModuleChecked = false;

const updateSearchModule = async (): Promise<void> => {
    if (searchModuleChecked) return; // once per session
    searchModuleChecked = true;

    const res = await fetch(`${SEARCH_MODULE_BASE}/version.json`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`version fetch failed: ${res.status}`);
    const remote = await res.json();

    let localVersion: string | null = null;
    try {
        localVersion = JSON.parse(fs.readFileSync(SEARCH_MODULE_VERSION_PATH, 'utf-8')).version;
    } catch { /* no local copy yet */ }

    if (localVersion === remote.version && fs.existsSync(SEARCH_MODULE_PATH)) {
        console.log(`[SearchModule] Up to date (${localVersion}).`);
        return;
    }

    console.log(`[SearchModule] Updating search module: ${localVersion ?? '(built-in)'} -> ${remote.version}`);
    const bundleRes = await fetch(`${SEARCH_MODULE_BASE}/ytmusic-bundle.cjs`, { signal: AbortSignal.timeout(30000) });
    if (!bundleRes.ok) throw new Error(`bundle fetch failed: ${bundleRes.status}`);
    const buf = Buffer.from(await bundleRes.arrayBuffer());
    if (buf.length < 50_000) throw new Error('bundle suspiciously small, refusing');

    fs.mkdirSync(SEARCH_MODULE_DIR, { recursive: true });
    fs.writeFileSync(SEARCH_MODULE_PATH, buf);
    fs.writeFileSync(SEARCH_MODULE_VERSION_PATH, JSON.stringify(remote));
    console.log(`[SearchModule] Updated to ${remote.version} ✅`);
};

const loadYtMusicClass = async (): Promise<any> => {
    try {
        await updateSearchModule();
    } catch (e: any) {
        console.warn('[SearchModule] Update check failed (offline?):', e.message);
    }

    // Prefer the downloaded (newer) bundle
    try {
        if (fs.existsSync(SEARCH_MODULE_PATH)) {
            const mod = nodeRequire(SEARCH_MODULE_PATH);
            console.log('[SearchModule] Using downloaded search module.');
            return mod.default || mod;
        }
    } catch (e) {
        console.warn('[SearchModule] Downloaded module failed to load, using built-in:', e);
    }

    const mod = await import('ytmusic-api');
    console.log('[SearchModule] Using built-in search module.');
    return mod.default || mod;
};

// URLs
const YT_DLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
// Static FFmpeg builds with native arm64 support (evermeet.cx only ships x86_64,
// which forces Rosetta emulation on Apple Silicon and slows down every conversion)
const FFMPEG_ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
const FFMPEG_URL = `https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-darwin-${FFMPEG_ARCH}`;

// --- Persistent Search Cache ---
const searchCache = new Map<string, string>();
const loadSearchCache = () => {
    try {
        if (fs.existsSync(SEARCH_CACHE_PATH)) {
            const data = JSON.parse(fs.readFileSync(SEARCH_CACHE_PATH, 'utf-8'));
            for (const [k, v] of Object.entries(data)) searchCache.set(k, v as string);
            console.log(`[Main] Loaded ${searchCache.size} cached search results.`);
        }
    } catch (e) { console.warn('[Main] Failed to load search cache:', e); }
};
const saveSearchCache = () => {
    try {
        fs.writeFileSync(SEARCH_CACHE_PATH, JSON.stringify(Object.fromEntries(searchCache)));
    } catch (e) { console.warn('[Main] Failed to save search cache:', e); }
};
const cacheSearchResult = (key: string, url: string) => {
    searchCache.set(key, url);
    saveSearchCache();
};

const downloadFile = (url: string, dest: string) => {
    return new Promise<void>((resolve, reject) => {
        const handleResponse = (response: any) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                if (response.headers.location) {
                    // Fix: Resolve relative URLs against the current URL logic
                    const nextUrl = new URL(response.headers.location, url).href;
                    console.log(`[Main] Redirecting to: ${nextUrl}`);
                    https.get(nextUrl, handleResponse).on('error', reject);
                    return;
                }
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: Status Code ${response.statusCode}`));
                return;
            }
            const file = fs.createWriteStream(dest);
            response.pipe(file);
            file.on('error', (err: Error) => {
                fs.unlink(dest, () => { });
                reject(err);
            });
            file.on('finish', () => {
                file.close();
                resolve();
            });
        };
        https.get(url, handleResponse).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
};

const getYtDlpLatestVersion = (): Promise<string> => {
    return new Promise((resolve, reject) => {
        https.get('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
            headers: { 'User-Agent': 'LiberAudio' }
        }, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                try { resolve(JSON.parse(data).tag_name); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
};

const setupYtDlp = async () => {
    console.log(`[Main] Checking yt-dlp at: ${YT_DLP_PATH}`);

    const isMissing = !fs.existsSync(YT_DLP_PATH) || fs.statSync(YT_DLP_PATH).size < 30 * 1024 * 1024;
    if (isMissing) {
        if (fs.existsSync(YT_DLP_PATH)) fs.unlinkSync(YT_DLP_PATH);
        console.log('[Main] yt-dlp missing or corrupt, downloading...');
        await downloadFile(YT_DLP_URL, YT_DLP_PATH);
        fs.chmodSync(YT_DLP_PATH, '755');
        await new Promise<void>(res => execFile('xattr', ['-d', 'com.apple.quarantine', YT_DLP_PATH], () => res()));
        return;
    }

    fs.chmodSync(YT_DLP_PATH, '755');
    await new Promise<void>(res => execFile('xattr', ['-d', 'com.apple.quarantine', YT_DLP_PATH], () => res()));

    // Check for updates
    try {
        const installedVersion = await new Promise<string>((resolve, reject) => {
            execFile(YT_DLP_PATH, ['--version'], (err, stdout) => {
                if (err) reject(err); else resolve(stdout.trim());
            });
        });
        const latestVersion = await getYtDlpLatestVersion();
        console.log(`[Main] yt-dlp installed=${installedVersion} latest=${latestVersion}`);

        if (installedVersion !== latestVersion) {
            console.log('[Main] yt-dlp update available, downloading...');
            fs.unlinkSync(YT_DLP_PATH);
            await downloadFile(YT_DLP_URL, YT_DLP_PATH);
            fs.chmodSync(YT_DLP_PATH, '755');
            await new Promise<void>(res => execFile('xattr', ['-d', 'com.apple.quarantine', YT_DLP_PATH], () => res()));
            console.log(`[Main] yt-dlp updated to ${latestVersion}`);
        } else {
            console.log('[Main] yt-dlp is up to date.');
        }
    } catch (e) {
        console.warn('[Main] yt-dlp version check failed, continuing with existing binary:', e);
    }
};

const setupFFmpeg = async () => {
    console.log(`[Main] Checking ffmpeg at: ${FFMPEG_PATH} (want arch: ${FFMPEG_ARCH})`);

    // Re-download if missing, corrupt, or built for the wrong architecture
    // (older installs shipped x86_64-only builds that run under Rosetta on Apple Silicon)
    const installedArch = fs.existsSync(FFMPEG_ARCH_MARKER) ? fs.readFileSync(FFMPEG_ARCH_MARKER, 'utf-8').trim() : null;
    if (fs.existsSync(FFMPEG_PATH)) {
        const stats = fs.statSync(FFMPEG_PATH);
        if (stats.size > 10 * 1024 * 1024 && installedArch === FFMPEG_ARCH) {
            fs.chmodSync(FFMPEG_PATH, '755');
            await new Promise<void>(res => execFile('xattr', ['-d', 'com.apple.quarantine', FFMPEG_PATH], () => res()));
            return;
        }
        fs.unlinkSync(FFMPEG_PATH);
    }

    console.log(`[Main] Downloading ffmpeg (${FFMPEG_ARCH})...`);
    await downloadFile(FFMPEG_URL, FFMPEG_PATH);
    fs.chmodSync(FFMPEG_PATH, '755');
    await new Promise<void>(res => execFile('xattr', ['-d', 'com.apple.quarantine', FFMPEG_PATH], () => res()));
    fs.writeFileSync(FFMPEG_ARCH_MARKER, FFMPEG_ARCH);
    console.log('[Main] ffmpeg ready.');
};

let initPromise: Promise<void> | null = null;

function createWindow() {
    console.log('[Main] Creating Window...');
    const win = new BrowserWindow({
        width: 1500,
        height: 1000,
        titleBarStyle: 'hidden',
        vibrancy: 'under-window',
        visualEffectState: 'active',
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.mjs'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // Make all links open with the browser, not with the application
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https:')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        win.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

// --- AUTO UPDATER CONFIG ---
log.transports.file.level = 'info';
autoUpdater.logger = log;

// --- SPOTIFY USER LOGIN (Authorization Code + PKCE) ---
// Lets users log into their own Spotify account (access to private playlists)
// instead of relying on the shared token proxy. No client secret needed.
const TOKEN_SERVER = 'https://universal-music-downloader.onrender.com';
const SPOTIFY_CALLBACK_PORT = 43725;
const SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${SPOTIFY_CALLBACK_PORT}/callback`;
const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read playlist-modify-public playlist-modify-private';
const SPOTIFY_AUTH_PATH = path.join(APP_SUPPORT, 'spotify-auth.json');

let cachedClientId: string | null = null;
const getSpotifyClientId = async (): Promise<string> => {
    if (cachedClientId) return cachedClientId;
    const res = await fetch(`${TOKEN_SERVER}/client-id`);
    if (!res.ok) throw new Error(`client-id fetch failed: ${res.status}`);
    const data = await res.json();
    if (!data.client_id) throw new Error('Token server did not return a client_id');
    cachedClientId = data.client_id as string;
    return cachedClientId;
};

interface SpotifyAuth {
    access_token: string;
    refresh_token: string;
    expires_at: number; // epoch ms
}

const readSpotifyAuth = (): SpotifyAuth | null => {
    try {
        if (fs.existsSync(SPOTIFY_AUTH_PATH)) {
            return JSON.parse(fs.readFileSync(SPOTIFY_AUTH_PATH, 'utf-8'));
        }
    } catch (e) { console.warn('[Spotify] Failed to read auth file:', e); }
    return null;
};

const writeSpotifyAuth = (auth: SpotifyAuth) => {
    fs.writeFileSync(SPOTIFY_AUTH_PATH, JSON.stringify(auth));
};

const exchangeSpotifyToken = async (params: Record<string, string>): Promise<SpotifyAuth> => {
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) {
        throw new Error(`Spotify token exchange failed: ${JSON.stringify(data)}`);
    }
    const existing = readSpotifyAuth();
    const auth: SpotifyAuth = {
        access_token: data.access_token,
        // Refresh responses may omit refresh_token; keep the old one
        refresh_token: data.refresh_token || existing?.refresh_token || '',
        expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };
    writeSpotifyAuth(auth);
    return auth;
};

const spotifyLogin = (): Promise<{ success: boolean; error?: string }> => {
    return new Promise(async (resolve) => {
        let server: http.Server | null = null;
        const finish = (result: { success: boolean; error?: string }) => {
            if (server) { server.close(); server = null; }
            resolve(result);
        };

        try {
            const clientId = await getSpotifyClientId();
            const verifier = crypto.randomBytes(64).toString('base64url');
            const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
            const state = crypto.randomBytes(16).toString('hex');

            server = http.createServer(async (req, res) => {
                const reqUrl = new URL(req.url || '/', SPOTIFY_REDIRECT_URI);
                if (reqUrl.pathname !== '/callback') { res.writeHead(404); res.end(); return; }

                const code = reqUrl.searchParams.get('code');
                const returnedState = reqUrl.searchParams.get('state');
                const error = reqUrl.searchParams.get('error');

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;background:#000;color:#1DB954;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center"><h1>' +
                    (code ? '✅ Logged in!<br><span style="font-size:.5em;color:#1DB95499">You can close this tab and return to LiberAudio.</span>' : '❌ Login failed.<br><span style="font-size:.5em;color:#ff444499">You can close this tab and try again.</span>') +
                    '</h1></body></html>');

                if (error || !code || returnedState !== state) {
                    finish({ success: false, error: error || 'Invalid callback' });
                    return;
                }

                try {
                    await exchangeSpotifyToken({
                        grant_type: 'authorization_code',
                        code,
                        redirect_uri: SPOTIFY_REDIRECT_URI,
                        client_id: clientId,
                        code_verifier: verifier,
                    });
                    console.log('[Spotify] User logged in 🎉');
                    finish({ success: true });
                } catch (e: any) {
                    finish({ success: false, error: e.message });
                }
            });

            server.on('error', (e: any) => finish({ success: false, error: `Callback server error: ${e.message}` }));
            server.listen(SPOTIFY_CALLBACK_PORT, '127.0.0.1', () => {
                const authUrl = new URL('https://accounts.spotify.com/authorize');
                authUrl.searchParams.set('client_id', clientId);
                authUrl.searchParams.set('response_type', 'code');
                authUrl.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI);
                authUrl.searchParams.set('code_challenge_method', 'S256');
                authUrl.searchParams.set('code_challenge', challenge);
                authUrl.searchParams.set('state', state);
                authUrl.searchParams.set('scope', SPOTIFY_SCOPES);
                console.log('[Spotify] Opening browser for login:', authUrl.href);
                shell.openExternal(authUrl.href).catch((e) => {
                    console.error('[Spotify] Failed to open browser:', e);
                    finish({ success: false, error: 'Could not open the browser. Please try again.' });
                });
            });

            // Give up after 5 minutes
            setTimeout(() => finish({ success: false, error: 'Login timed out' }), 5 * 60 * 1000);
        } catch (e: any) {
            finish({ success: false, error: e.message });
        }
    });
};

const getSpotifyUserToken = async (): Promise<string | null> => {
    const auth = readSpotifyAuth();
    if (!auth) return null;
    if (auth.expires_at > Date.now() + 60_000) return auth.access_token;
    // Refresh
    try {
        const clientId = await getSpotifyClientId();
        const refreshed = await exchangeSpotifyToken({
            grant_type: 'refresh_token',
            refresh_token: auth.refresh_token,
            client_id: clientId,
        });
        return refreshed.access_token;
    } catch (e) {
        console.warn('[Spotify] Token refresh failed, user must re-login:', e);
        return null;
    }
};

// --- ANONYMOUS USAGE ANALYTICS ---
// Counts only: app launches and finished downloads. The install_id is a
// random UUID created on first launch — it identifies this INSTALL, never
// a person. No track titles, no playlists, no Spotify identity, no IPs.
// Fully fire-and-forget: any failure is swallowed, the app never notices.
const ANALYTICS_PATH = path.join(APP_SUPPORT, 'analytics.json');

interface AnalyticsState {
    installId: string;
    enabled: boolean;
    pendingDownloads: number; // counted locally, flushed in batches
}

const loadAnalyticsState = (): AnalyticsState => {
    try {
        const data = JSON.parse(fs.readFileSync(ANALYTICS_PATH, 'utf-8'));
        if (typeof data.installId === 'string' && data.installId.length === 36) {
            return { installId: data.installId, enabled: data.enabled !== false, pendingDownloads: data.pendingDownloads || 0 };
        }
    } catch { /* first launch or corrupt file */ }
    return { installId: crypto.randomUUID(), enabled: true, pendingDownloads: 0 };
};

const analyticsState = loadAnalyticsState();

const saveAnalyticsState = () => {
    try { fs.writeFileSync(ANALYTICS_PATH, JSON.stringify(analyticsState)); }
    catch { /* never let analytics break anything */ }
};
saveAnalyticsState(); // persist installId on first launch

const sendAnalyticsEvent = async (event: 'app_launch' | 'download', count = 1): Promise<boolean> => {
    if (!analyticsState.enabled) return false;
    try {
        const res = await fetch(`${TOKEN_SERVER}/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                install_id: analyticsState.installId,
                app_version: app.getVersion(),
                arch: process.arch,
                event,
                count,
            }),
            signal: AbortSignal.timeout(8000),
        });
        return res.ok;
    } catch { return false; } // offline / server asleep — silently skip
};

const recordDownload = () => {
    analyticsState.pendingDownloads++;
    saveAnalyticsState();
};

// Batched: one request per flush instead of one per song. Unsent counts
// survive crashes via analytics.json and go out on the next flush/launch.
let analyticsFlushing = false;
const flushDownloads = async () => {
    if (analyticsFlushing || analyticsState.pendingDownloads <= 0) return;
    analyticsFlushing = true;
    const count = analyticsState.pendingDownloads;
    if (await sendAnalyticsEvent('download', count)) {
        analyticsState.pendingDownloads -= count;
        saveAnalyticsState();
    }
    analyticsFlushing = false;
};

app.whenReady().then(async () => {
    console.log(`[Main] App Ready. Node: ${process.version}, Arch: ${process.arch}, Platform: ${process.platform}`);

    // liberaudio://<encoded absolute path> → streams the local audio file
    protocol.registerFileProtocol('liberaudio', (request, callback) => {
        try {
            callback({ path: decodeURI(request.url.replace('liberaudio://', '')) });
        } catch (e) {
            console.error('[Main] liberaudio protocol error:', e);
            callback({ error: -6 /* FILE_NOT_FOUND */ });
        }
    });

    loadSearchCache();
    createWindow();

    // Anonymous usage ping + leftover download counts from the last session
    sendAnalyticsEvent('app_launch');
    flushDownloads();
    setInterval(flushDownloads, 5 * 60 * 1000);

    // Initialize YTMusic in the background — do NOT await it here, otherwise
    // IPC handler registration is delayed and early renderer calls
    // ('init-dependencies') fail with "No handler registered".
    (async () => {
        try {
            const YTMusicClass = await loadYtMusicClass();
            ytmusic = new YTMusicClass();
            await ytmusic.initialize();
            isYtMusicReady = true;
            console.log('[Main] YTMusic API Initialized 🎵');
        } catch (e) {
            console.error('[Main] Failed to init YTMusic:', e);
            // Do not block app, just log error. Handlers will fallback to Tier 2.
        }
    })();

    // Check for updates immediately
    console.log('[Main] Checking for updates...');
    autoUpdater.checkForUpdatesAndNotify();

    // Parallel init
    initPromise = Promise.all([setupYtDlp(), setupFFmpeg()])
        .then(() => console.log('[Main] All dependencies ready.'))
        .catch(err => console.error('[Main] Dep Failure:', err));

    ipcMain.handle('init-dependencies', async () => {
        if (initPromise) await initPromise;
        return { success: true };
    });

    ipcMain.handle('select-folder', async (_, title?: string) => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: title || 'Choose Folder',
            message: title || 'Choose Folder', // macOS shows 'message', not 'title'
        });
        return result.canceled ? null : result.filePaths[0];
    });

    // --- SPOTIFY AUTH IPC ---
    ipcMain.handle('spotify-login', () => spotifyLogin());
    ipcMain.handle('spotify-get-token', () => getSpotifyUserToken());
    ipcMain.handle('spotify-logout', () => {
        try {
            if (fs.existsSync(SPOTIFY_AUTH_PATH)) fs.unlinkSync(SPOTIFY_AUTH_PATH);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    // --- LIBRARY SCANNER ---
    // Returns audio file basenames (without extension) so the renderer can
    // match "Artist - Title" against scanned playlists and mark them as owned.
    ipcMain.handle('scan-library', async (_, folder: string) => {
        try {
            const AUDIO_EXTS = new Set(['.m4a', '.mp3', '.opus', '.flac', '.wav', '.aac', '.ogg']);
            const files = fs.readdirSync(folder)
                .filter(f => AUDIO_EXTS.has(path.extname(f).toLowerCase()))
                .map(f => path.basename(f, path.extname(f)));
            console.log(`[Main] Library scan found ${files.length} audio files in ${folder}`);
            return { success: true, files };
        } catch (e: any) {
            console.error('[Main] Library scan failed:', e);
            return { success: false, error: e.message };
        }
    });

    // --- DJ LIBRARY READER (Phase 1: read-only) ---
    // Parses Serato (_Serato_ binary), Rekordbox (xml export) and iTunes/Music
    // (Library.xml export) into one canonical model. Never writes anything.
    ipcMain.handle('dj-detect-libraries', () => {
        try {
            return { success: true, detected: detectLibraries() };
        } catch (e: any) {
            console.error('[DJ] Detection failed:', e);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('dj-load-libraries', (_, req: LoadRequest) => {
        try {
            const { libraries, errors } = loadLibraries(req);
            return { success: true, libraries, errors };
        } catch (e: any) {
            console.error('[DJ] Load failed:', e);
            return { success: false, error: e.message };
        }
    });

    // --- DJ TRIAGE (Phase 2: additive writes only) ---
    const DJ_DESTINATIONS_PATH = path.join(APP_SUPPORT, 'dj-destinations.json');
    const DJ_BACKUP_ROOT = path.join(APP_SUPPORT, 'dj-backups');

    ipcMain.handle('dj-get-destinations', () => {
        try {
            if (fs.existsSync(DJ_DESTINATIONS_PATH)) {
                return JSON.parse(fs.readFileSync(DJ_DESTINATIONS_PATH, 'utf-8'));
            }
        } catch (e) { console.warn('[DJ] Failed to read destinations:', e); }
        return [];
    });

    ipcMain.handle('dj-set-destinations', (_, destinations: any[]) => {
        try {
            fs.writeFileSync(DJ_DESTINATIONS_PATH, JSON.stringify(destinations, null, 2));
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    // List audio files in a folder as triage candidates, newest first
    // (titles parsed from the app's own "Artist - Title.ext" naming)
    ipcMain.handle('dj-scan-folder', (_, folder: string) => {
        try {
            const AUDIO_EXTS = new Set(['.m4a', '.mp3', '.opus', '.flac', '.wav', '.aac', '.ogg', '.aif', '.aiff']);
            const files = fs.readdirSync(folder)
                .filter(f => AUDIO_EXTS.has(path.extname(f).toLowerCase()))
                .map(f => {
                    const full = path.join(folder, f);
                    const base = path.basename(f, path.extname(f));
                    const dash = base.indexOf(' - ');
                    return {
                        id: full,
                        path: full,
                        title: dash > 0 ? base.slice(dash + 3) : base,
                        artist: dash > 0 ? base.slice(0, dash) : 'Unknown Artist',
                        cues: [],
                        mtimeMs: fs.statSync(full).mtimeMs,
                    };
                })
                .sort((a, b) => b.mtimeMs - a.mtimeMs);
            return { success: true, tracks: files };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    interface TriageAssignment {
        path: string;
        title: string;
        artist: string;
        targets: {
            seratoCrate?: string;   // crate file base name incl. %% hierarchy
            musicPlaylist?: string;
            rekordboxPlaylist?: string;
        }[];
    }

    ipcMain.handle('dj-apply-triage', async (_, assignments: TriageAssignment[]) => {
        const result = {
            serato: [] as SeratoWriteResult[],
            music: [] as MusicWriteResult[],
            rekordbox: null as { xmlPath: string; playlists: number; tracks: number } | null,
            errors: [] as string[],
        };

        // Group: platform target -> track list
        const seratoCrates = new Map<string, string[]>();
        const musicPlaylists = new Map<string, string[]>();
        const rbPlaylists = new Map<string, RekordboxTrackRef[]>();
        for (const a of assignments) {
            for (const t of a.targets) {
                if (t.seratoCrate) {
                    (seratoCrates.get(t.seratoCrate) ?? seratoCrates.set(t.seratoCrate, []).get(t.seratoCrate)!).push(a.path);
                }
                if (t.musicPlaylist) {
                    (musicPlaylists.get(t.musicPlaylist) ?? musicPlaylists.set(t.musicPlaylist, []).get(t.musicPlaylist)!).push(a.path);
                }
                if (t.rekordboxPlaylist) {
                    (rbPlaylists.get(t.rekordboxPlaylist) ?? rbPlaylists.set(t.rekordboxPlaylist, []).get(t.rekordboxPlaylist)!)
                        .push({ path: a.path, title: a.title, artist: a.artist });
                }
            }
        }

        // Serato: guarded, backed up, verified
        if (seratoCrates.size > 0) {
            if (await isSeratoRunning()) {
                result.errors.push('Serato is running — close it and apply again. (Nothing was written to Serato; other platforms proceeded.)');
            } else {
                const seratoRoot = detectLibraries().serato;
                if (!seratoRoot) {
                    result.errors.push('No Serato library found.');
                } else {
                    const backupDir = path.join(DJ_BACKUP_ROOT, new Date().toISOString().replace(/[:.]/g, '-'));
                    for (const [crate, paths] of seratoCrates) {
                        try {
                            result.serato.push(appendToSeratoCrate(seratoRoot, crate, paths, backupDir));
                        } catch (e: any) {
                            result.errors.push(e.message);
                        }
                    }
                }
            }
        }

        // Apple Music: official AppleScript API
        for (const [playlist, paths] of musicPlaylists) {
            result.music.push(await addToMusicPlaylist(playlist, paths));
        }

        // rekordbox: timestamped xml export for manual import
        if (rbPlaylists.size > 0) {
            try {
                result.rekordbox = writeRekordboxXml(path.join(APP_SUPPORT, 'rekordbox-exports'), rbPlaylists);
            } catch (e: any) {
                result.errors.push(`rekordbox export: ${e.message}`);
            }
        }

        console.log(`[DJ] Triage applied: ${assignments.length} tracks → serato:${result.serato.length} crates, music:${result.music.length} playlists, rb:${result.rekordbox?.playlists ?? 0}`);
        return result;
    });

    ipcMain.handle('dj-reveal-file', (_, filePath: string) => {
        shell.showItemInFolder(filePath);
        return { success: true };
    });

    // Best-effort launch of rekordbox so the user can re-export their xml.
    // There is no public API/CLI to trigger the export itself.
    ipcMain.handle('dj-open-rekordbox', async () => {
        const tryOpen = (name: string) => new Promise<boolean>(res =>
            execFile('open', ['-a', name], (err) => res(!err)));
        for (const name of ['rekordbox', 'rekordbox 7', 'rekordbox 6']) {
            if (await tryOpen(name)) return { success: true };
        }
        return { success: false, error: 'Could not find the rekordbox app' };
    });

    ipcMain.handle('dj-select-xml', async (_, title: string) => {
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            title,
            message: title, // macOS shows 'message', not 'title'
            filters: [{ name: 'XML Library Export', extensions: ['xml'] }],
        });
        return result.canceled ? null : result.filePaths[0];
    });

    // --- GENERIC METADATA SCANNER (SC/YT) ---
    ipcMain.handle('fetch-metadata', async (_, url) => {
        if (initPromise) await initPromise;
        console.log(`[Main] Fetching metadata for: ${url}`);

        return new Promise((resolve) => {
            const args = ['--dump-single-json', '--no-warnings'];

            if (!url.includes('soundcloud.com')) {
                args.push('--flat-playlist');
            }
            args.push(url);

            const child = spawn(YT_DLP_PATH, args);
            child.on('error', (err) => {
                console.error('[Main] Failed to spawn yt-dlp:', err);
                resolve({ success: false, error: 'Downloader is not installed yet. Please wait a moment and try again.' });
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', d => stdout += d.toString());
            child.stderr.on('data', d => stderr += d.toString());

            child.on('close', (code) => {
                if (code !== 0) {
                    console.error(`[Main] Metadata fetch failed: ${stderr}`);
                    resolve({ success: false, error: 'Failed to fetch metadata' });
                    return;
                }

                try {
                    const data = JSON.parse(stdout);
                    let entries = [];
                    if (data.entries) {
                        entries = data.entries;
                    } else if (data._type === 'playlist') {
                        entries = [];
                    } else {
                        entries = [data];
                    }

                    const tracks = entries.map((entry: any) => {
                        if (!entry) return null;

                        let title = entry.title || entry.fulltitle || entry.track || entry.alt_title;
                        let artist = entry.uploader || entry.artist || entry.creator || entry.channel || entry.uploader_id;
                        const entryUrl = entry.url || entry.webpage_url || entry.original_url || url;

                        if ((!title || !artist) && entryUrl.includes('soundcloud.com')) {
                            try {
                                const parts = entryUrl.split('/').filter((p: string) => p.length > 0);
                                if (parts.length >= 2) {
                                    const slugTitle = parts[parts.length - 1];
                                    const slugArtist = parts[parts.length - 2];
                                    const clean = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

                                    if (!title) title = clean(slugTitle);
                                    if (!artist) artist = clean(slugArtist);
                                }
                            } catch (e) {
                                console.error('[Main] Failed to parse SC URL:', e);
                            }
                        }

                        return {
                            id: entry.id || 'no-id',
                            title: title || 'Unknown Title',
                            artist: artist || 'Unknown Artist',
                            url: entryUrl,
                            duration: entry.duration || 0
                        };
                    }).filter((t: any) => t !== null);

                    console.log(`[Main] Found ${tracks.length} items.`);
                    resolve({ success: true, tracks });

                } catch (e) {
                    console.error('[Main] JSON Parse error during metadata fetch', e);
                    resolve({ success: false, error: 'Invalid response from downloader' });
                }
            });
        });
    });

    // --- HELPERS ---
    const normalizeStr = (str: string): string => {
        return str
            .toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
            .replace(/\s+-\s+topic/g, '') // Remove " - Topic"
            .replace(/\(official\s+video\)/g, '')
            .replace(/\(official\s+audio\)/g, '')
            .replace(/\(lyrics\)/g, '')
            .replace(/\(official\)/g, '')
            .replace(/\[.*?\]/g, '') // remove brackets generally
            .replace(/[\(\[\{\)\]\}]/g, '') // Remove the brackets chars themselves
            .replace(/\b(feat|ft|featuring)\b.*/g, '') // remove feat
            .replace(/[^a-z0-9]/g, '') // remove ALL punctuation and spaces
            .trim();
    };

    const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

    const searchYtDlp = (query: string, prefix: string = 'ytsearch5'): Promise<any[]> => {
        return new Promise((resolve) => {
            const args = [
                '--dump-single-json',
                '--flat-playlist',
                '--no-warnings',
                `${prefix}:${query}`
            ];
            const child = spawn(YT_DLP_PATH, args);
            child.on('error', (err) => {
                console.error('[Main] Failed to spawn yt-dlp for search:', err);
                resolve([]);
            });
            let stdout = '';
            child.stdout.on('data', d => stdout += d.toString());
            child.on('close', () => {
                try {
                    const data = JSON.parse(stdout);
                    resolve(data.entries || []);
                } catch (e) { resolve([]); }
            });
        });
    };

    // --- SHARED MATCH SCORING (used by all search tiers) ---
    const NEGATIVE_KEYWORDS = ['cover', 'karaoke', 'instrumental', 'remix', 'live', 'concerto', 'mix'];

    interface SearchCandidate {
        id: string;
        title: string;
        artist: string;
        isSong?: boolean;
        duration?: number; // seconds
        raw?: any;
    }

    const pickBestMatch = (
        candidates: SearchCandidate[],
        targetTitle: string,
        targetArtist: string,
        targetDuration: number | undefined,
        tier: string
    ): SearchCandidate | null => {
        const cleanTitle = normalizeStr(targetTitle);
        const cleanArtist = normalizeStr(targetArtist);
        const targetLower = (targetTitle + ' ' + targetArtist).toLowerCase();

        let bestMatch: SearchCandidate | null = null;
        let highestScore = -1;

        for (const c of candidates) {
            const rTitle = normalizeStr(c.title || '');
            const rArtist = normalizeStr(c.artist || '');
            console.log(`[${tier}] Scoring: "${c.title}" by "${c.artist}"`);

            const fullTitleLower = (c.title || '').toLowerCase();
            const rejectedKw = NEGATIVE_KEYWORDS.find(kw => fullTitleLower.includes(kw) && !targetLower.includes(kw));
            if (rejectedKw) {
                console.log(`[${tier}] -> Reject: Negative Filter ("${rejectedKw}")`);
                continue;
            }

            let score = 0;
            if (rTitle.includes(cleanTitle) || cleanTitle.includes(rTitle)) score += 3;

            if (rArtist.includes(cleanArtist) || cleanArtist.includes(rArtist)) score += 3;
            else if (rTitle.includes(cleanArtist)) score += 2;

            if (c.isSong) score += 1;

            // Duration verification: strong signal for picking the right upload
            if (targetDuration && c.duration) {
                const diff = Math.abs(c.duration - targetDuration);
                if (diff <= 3) score += 2;
                else if (diff > 20) score -= 2;
            }

            console.log(`[${tier}] -> Score: ${score}`);

            if (score > highestScore && score >= 5) {
                highestScore = score;
                bestMatch = c;
            }
        }

        if (bestMatch) {
            console.log(`[${tier}] 🏆 Winner: "${bestMatch.title}" (Score: ${highestScore})`);
        }
        return bestMatch;
    };

    // --- TIERED YOUTUBE SEARCH ---
    ipcMain.handle('search-youtube', async (_, payload) => {
        // Try init if not ready, but don't hard fail if it breaks
        if (!isYtMusicReady || !ytmusic) {
            console.warn('[Main] YTMusic not ready, trying to init...');
            try {
                const YTMusicClass = await loadYtMusicClass();
                ytmusic = new YTMusicClass();
                await ytmusic.initialize();
                isYtMusicReady = true;
            }
            catch (e) {
                console.error('YTMusic auto-init fail (will skip Tier 1):', e);
                // Proceed to fallbacks
            }
        }

        let targetArtist = '';
        let targetTitle = '';
        let targetDuration: number | undefined;
        if (typeof payload === 'string') {
            const parts = payload.split(' - ');
            if (parts.length > 1) {
                targetArtist = parts[0];
                targetTitle = parts.slice(1).join(' - ');
            } else {
                targetTitle = payload;
            }
        } else {
            targetArtist = payload.artist || '';
            targetTitle = payload.title || '';
            targetDuration = payload.duration;
        }

        const query = `${targetArtist} - ${targetTitle}`;
        const cacheKey = normalizeStr(query);

        if (searchCache.has(cacheKey)) {
            console.log(`[Main] Cache HIT for: "${query}"`);
            return searchCache.get(cacheKey);
        }

        console.log(`[Main] Searching: "${query}"`);

        const now = Date.now();
        const timeSinceLast = now - lastSearchTime;
        if (timeSinceLast < 1100) {
            await sleep(1100 - timeSinceLast);
        }
        lastSearchTime = Date.now();

        // --- TIER 1: YouTube Music (in-process API) ---
        if (isYtMusicReady && ytmusic && !ytmusicDisabled) {
            console.log('[Tier 1] Searching YTMusic...');
            let retries = 0;
            const maxRetries = 2;
            while (retries <= maxRetries) {
                try {
                    const results = await ytmusic.search(query);
                    const candidates: SearchCandidate[] = results.slice(0, 5)
                        .filter((r: any) => ['SONG', 'song', 'VIDEO', 'video'].includes(r.type))
                        .map((r: any) => ({
                            id: r.videoId,
                            title: r.name || '',
                            artist: r.artist?.name || '',
                            isSong: r.type === 'SONG' || r.type === 'song',
                            duration: r.duration || undefined,
                        }));

                    const best = pickBestMatch(candidates, targetTitle, targetArtist, targetDuration, 'Tier 1');
                    ytmusicFailStreak = 0; // the API itself works
                    if (best) {
                        const url = `https://music.youtube.com/watch?v=${best.id}`;
                        cacheSearchResult(cacheKey, url);
                        return url;
                    }

                    console.log(`[Tier 1] No verified match for "${query}". Falling back...`);
                    break;

                } catch (e: any) {
                    console.error(`[Tier 1] Error (Attempt ${retries + 1}):`, e.message);
                    if (e.message && e.message.includes('429')) {
                        const backoff = 2000 * Math.pow(2, retries);
                        await sleep(backoff);
                        retries++;
                    } else {
                        // Hard failure (e.g. 400 after a YouTube backend change).
                        // After a few in a row, stop wasting time on Tier 1 this session.
                        ytmusicFailStreak++;
                        if (ytmusicFailStreak >= 3) {
                            ytmusicDisabled = true;
                            console.warn('[Tier 1] Disabled for this session after repeated failures.');
                        }
                        break;
                    }
                }
            }
        } else {
            console.warn('[Tier 1] Skipped (YTMusic not ready).');
        }

        // --- TIER 2 & 3: yt-dlp (YouTube Music + normal YouTube, IN PARALLEL) ---
        // Both subprocess searches run concurrently; Tier 2 results are
        // preferred when both verify. Saves one full search round-trip.
        console.log('[Main] Falling back to Tier 2+3: yt-dlp (parallel ytmsearch5 + ytsearch5)...');
        try {
            const [musicResults, normalResults] = await Promise.all([
                searchYtDlp(query, 'ytmsearch5'),
                searchYtDlp(query, 'ytsearch5'),
            ]);

            for (const [tier, results] of [['Tier 2', musicResults], ['Tier 3', normalResults]] as const) {
                const candidates: SearchCandidate[] = results.map((r: any) => ({
                    id: r.id,
                    title: r.title || '',
                    artist: r.uploader || '',
                    duration: r.duration || undefined,
                }));

                const best = pickBestMatch(candidates, targetTitle, targetArtist, targetDuration, tier);
                if (best) {
                    const url = `https://youtube.com/watch?v=${best.id}`;
                    cacheSearchResult(cacheKey, url);
                    return url;
                }
            }
        } catch (e) {
            console.error('[Tier 2/3] Error:', e);
        }

        return null; // Give up
    });

    // Strip characters that are illegal in filenames (or would change the path)
    const sanitizeFilename = (s: string): string => {
        return s.replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'Unknown';
    };

    ipcMain.handle('download-song', async (_event, { url, folder, artist, title }) => {
        // Ensure dependencies are ready before starting download
        if (initPromise) await initPromise;

        return new Promise((resolve) => {
            const safeTitle = sanitizeFilename(title);
            const safeArtist = sanitizeFilename(artist);
            const outputTemplate = path.join(folder, `${safeArtist} - ${safeTitle}.%(ext)s`);

            const args = [
                '--ffmpeg-location', FFMPEG_PATH, // <--- CRITICAL: Use the bundled binary
                // Prefer native m4a (AAC): yt-dlp stream-copies instead of re-encoding,
                // which makes the post-processing step near-instant for YouTube sources.
                '-f', 'bestaudio[ext=m4a]/bestaudio',
                '-x', '--audio-format', 'm4a',
                '--concurrent-fragments', '4', // parallel fragment download
                '--embed-metadata', '--embed-thumbnail',
                '--convert-thumbnails', 'jpg',
                '--postprocessor-args', 'ThumbnailsConvertor+ffmpeg:-vf crop=ih:ih',
                '--no-warnings',
                '-o', outputTemplate,
                '--postprocessor-args', `ffmpeg:-metadata title="${safeTitle}" -metadata artist="${safeArtist}" -metadata album="${safeTitle}" -metadata album_artist="${safeArtist}"`,
                url
            ];

            const child = spawn(YT_DLP_PATH, args);
            child.on('error', (err) => {
                console.error('[Main] Failed to spawn yt-dlp for download:', err);
                resolve({ success: false, error: 'Downloader is not installed yet. Please wait a moment and try again.' });
            });
            child.stdout.on('data', (d) => process.stdout.write(d));
            let stderrOutput = '';
            child.stderr.on('data', (d) => { stderrOutput += d.toString(); process.stderr.write(d); });

            child.on('close', (code) => {
                if (code === 0) {
                    recordDownload(); // anonymous counter only — no titles
                    resolve({ success: true });
                }
                else resolve({ success: false, error: stderrOutput || `Exit code ${code}` });
            });
        });
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// --- UPDATER EVENTS ---
autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
});
autoUpdater.on('update-available', (info) => {
    log.info('Update available.', info);
});
autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available.', info);
});
autoUpdater.on('error', (err) => {
    log.error('Error in auto-updater. ' + err);
});
autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Download speed: " + progressObj.bytesPerSecond;
    log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
    log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
    log.info(log_message);
});
autoUpdater.on('update-downloaded', () => {
    log.info('Update downloaded');
    dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: 'A new version has been downloaded. Restart now to apply?',
        buttons: ['Restart', 'Later']
    }).then((returnValue) => {
        if (returnValue.response === 0) autoUpdater.quitAndInstall();
    });
});

app.on('before-quit', () => {
    // Best-effort flush; anything unsent is persisted and goes out next launch
    flushDownloads();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
