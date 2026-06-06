// --- SPOTIFY PLAYLIST WRITER (additive only) ---
// The ONLY mutation we ever do to a user's Spotify account: POSTing new
// items to playlists they picked as triage destinations. We never DELETE
// items or playlists, and never use the PUT replace-items endpoint (which
// can wipe a playlist in one call).
//
// Triage tracks are local files — no Spotify IDs — so each track is matched
// via the search API (artist + title, duration sanity check when known).
// Tracks that don't match confidently are reported as `unmatched`, never
// guessed into the playlist.

export interface SpotifyTrackRef {
    artist: string;
    title: string;
    durationSec?: number;
}

export interface SpotifyWriteResult {
    playlist: string;
    added: number;
    skipped: number;     // already in the playlist
    unmatched: { artist: string; title: string }[];
    errors: string[];
}

// Thrown so the caller can tell "shared API is exhausted" apart from
// ordinary errors (drives the "set up your own API" upsell).
export class SpotifyLimitedError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'SpotifyLimitedError';
    }
}

const API = 'https://api.spotify.com/v1';

// Fetch with 429 handling: respect Retry-After up to 3 times, then surface
// a SpotifyLimitedError. 403 (user not allowlisted on the shared app) is
// surfaced the same way.
const spFetch = async (token: string, url: string, init?: RequestInit): Promise<any> => {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, {
            ...init,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
        });
        if (res.status === 429) {
            const wait = Math.min(parseInt(res.headers.get('Retry-After') || '2', 10), 30);
            if (attempt >= 3) throw new SpotifyLimitedError(429, 'Spotify rate limit reached');
            await new Promise(r => setTimeout(r, (wait + 1) * 1000));
            continue;
        }
        if (res.status === 403) {
            const body = await res.text().catch(() => '');
            throw new SpotifyLimitedError(403, body || 'Spotify rejected the request (403)');
        }
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Spotify ${res.status}: ${body.slice(0, 200)}`);
        }
        if (res.status === 204) return null;
        return res.json();
    }
};

const norm = (s: string) => s.toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/\(.*?\)|\[.*?\]/g, ' ')                  // drop (feat. …) / [remix] qualifiers
    .replace(/[^a-z0-9]+/g, ' ').trim();

// A search candidate counts as a match when title and artist agree after
// normalization, and (if we know the local duration) lengths are within 7s.
const isMatch = (cand: any, ref: SpotifyTrackRef): boolean => {
    const ct = norm(cand.name);
    const rt = norm(ref.title);
    if (!ct || !rt || !(ct.includes(rt) || rt.includes(ct))) return false;
    const candArtists = norm((cand.artists ?? []).map((a: any) => a.name).join(' '));
    const refArtist = norm(ref.artist);
    const artistOk = refArtist === '' || refArtist === 'unknown artist'
        || candArtists.includes(refArtist) || refArtist.includes(candArtists)
        // any single artist token overlapping is enough ("A & B" vs "A, B")
        || refArtist.split(' ').some(t => t.length > 2 && candArtists.includes(t));
    if (!artistOk) return false;
    if (ref.durationSec && cand.duration_ms) {
        if (Math.abs(cand.duration_ms / 1000 - ref.durationSec) > 7) return false;
    }
    return true;
};

const searchTrack = async (token: string, ref: SpotifyTrackRef): Promise<any | null> => {
    const queries = [
        `track:"${ref.title}" artist:"${ref.artist}"`,   // precise, field-filtered
        `${ref.artist} ${ref.title}`,                    // loose fallback (helps remixes/edits)
    ];
    for (const q of queries) {
        const data = await spFetch(token, `${API}/search?type=track&limit=5&q=${encodeURIComponent(q)}`);
        const hit = (data?.tracks?.items ?? []).find((c: any) => isMatch(c, ref));
        if (hit) return hit;
    }
    return null;
};

// All item URIs + normalized "artist title" keys already in the playlist,
// so re-running a triage session never double-adds.
const readExisting = async (token: string, playlistId: string) => {
    const uris = new Set<string>();
    const keys = new Set<string>();
    let url: string | null =
        `${API}/playlists/${playlistId}/tracks?fields=next,items(track(uri,name,artists(name)))&limit=100`;
    while (url) {
        const data: any = await spFetch(token, url);
        for (const it of data?.items ?? []) {
            const t = it?.track;
            if (!t?.uri) continue;
            uris.add(t.uri);
            keys.add(norm((t.artists ?? []).map((a: any) => a.name).join(' ')) + '|' + norm(t.name));
        }
        url = data?.next ?? null;
    }
    return { uris, keys };
};

export const addToSpotifyPlaylist = async (
    token: string,
    playlistId: string,
    playlistName: string,
    tracks: SpotifyTrackRef[],
): Promise<SpotifyWriteResult> => {
    const result: SpotifyWriteResult = { playlist: playlistName, added: 0, skipped: 0, unmatched: [], errors: [] };
    try {
        const existing = await readExisting(token, playlistId);

        const toAdd: string[] = [];
        for (const ref of tracks) {
            const hit = await searchTrack(token, ref);
            if (!hit) {
                result.unmatched.push({ artist: ref.artist, title: ref.title });
                continue;
            }
            const key = norm((hit.artists ?? []).map((a: any) => a.name).join(' ')) + '|' + norm(hit.name);
            if (existing.uris.has(hit.uri) || existing.keys.has(key) || toAdd.includes(hit.uri)) {
                result.skipped++;
                continue;
            }
            toAdd.push(hit.uri);
        }

        // Append-only: POST adds items, period. (PUT on this endpoint REPLACES
        // the whole playlist — never use it.)
        for (let i = 0; i < toAdd.length; i += 100) {
            await spFetch(token, `${API}/playlists/${playlistId}/tracks`, {
                method: 'POST',
                body: JSON.stringify({ uris: toAdd.slice(i, i + 100) }),
            });
            result.added += Math.min(100, toAdd.length - i);
        }
    } catch (e: any) {
        if (e instanceof SpotifyLimitedError) throw e; // caller handles the upsell path
        result.errors.push(e.message);
    }
    return result;
};
