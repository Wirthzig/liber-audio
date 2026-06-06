import { AnimatePresence, motion } from 'framer-motion';
import { Check, Loader2, ListMusic, Plus, RefreshCw, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DJTrack, TriageResult } from '../electron';
import { openSettings } from './SettingsOverlay';

// --- SYNC TO SPOTIFY ---
// Pushes the currently viewed crate/playlist into a Spotify playlist of the
// user's choice. Additive only — it rides the same dj-apply-triage path as
// the triage flow (search-match per track, dedup against the playlist,
// POST-append; never deletes). First slice of the future sync engine.

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

interface SpotifyPlaylist { id: string; name: string; trackCount: number }

export function SyncToSpotify({ tracks, crateName }: { tracks: DJTrack[]; crateName: string }) {
    const [open, setOpen] = useState(false);
    const [loggedIn, setLoggedIn] = useState<boolean | null>(null); // null = checking
    const [playlists, setPlaylists] = useState<SpotifyPlaylist[] | null>(null);
    const [query, setQuery] = useState('');
    const [phase, setPhase] = useState<'pick' | 'syncing' | 'done'>('pick');
    const [result, setResult] = useState<TriageResult | null>(null);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');

    // Login check + playlist fetch when the panel opens
    useEffect(() => {
        if (!open) return;
        let live = true;
        setPhase('pick');
        setResult(null);
        setQuery('');
        setCreating(false);
        (async () => {
            const token = await window.electronAPI.spotifyGetToken();
            if (!live) return;
            setLoggedIn(!!token);
            if (!token) return;
            try {
                const items: SpotifyPlaylist[] = [];
                let url: string | null = 'https://api.spotify.com/v1/me/playlists?limit=50';
                while (url && items.length < 400) {
                    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                    if (!res.ok) break;
                    const data: any = await res.json();
                    for (const p of data.items ?? []) {
                        if (p?.id) items.push({ id: p.id, name: p.name, trackCount: p.tracks?.total ?? 0 });
                    }
                    url = data.next;
                }
                if (live) setPlaylists(items);
            } catch { if (live) setPlaylists([]); }
        })();
        return () => { live = false; };
    }, [open]);

    const sync = async (p: SpotifyPlaylist) => {
        setPhase('syncing');
        const assignments = tracks
            .filter(t => t.title)
            .map(t => ({
                path: t.path ?? '',
                title: t.title,
                artist: t.artist,
                durationSec: t.durationSec,
                targets: [{ spotifyPlaylistId: p.id, spotifyPlaylistName: p.name }],
            }));
        const res = await window.electronAPI.djApplyTriage(assignments);
        setResult(res);
        setPhase('done');
    };

    // Create a fresh (private) playlist and sync straight into it —
    // creation is additive, so it stays within the never-delete contract
    const createAndSync = async () => {
        const name = newName.trim();
        if (!name) return;
        setPhase('syncing');
        try {
            const token = await window.electronAPI.spotifyGetToken();
            if (!token) throw new Error('Not logged in');
            const res = await fetch('https://api.spotify.com/v1/me/playlists', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, public: false, description: 'Created by LiberAudio' }),
            });
            if (!res.ok) throw new Error(`Spotify ${res.status}`);
            const p = await res.json();
            await sync({ id: p.id, name: p.name, trackCount: 0 });
        } catch (e: any) {
            setResult({ serato: [], music: [], rekordbox: null, spotify: [], errors: [`Creating the playlist failed: ${e.message}`] });
            setPhase('done');
        }
    };

    // Alphabetical, with fuzzy name matches for the current crate pinned on
    // top ("AmexSet" surfaces "AmexSet 2024" and "amexset_live" first)
    const ncrate = normName(crateName);
    const matchesQuery = (p: SpotifyPlaylist) =>
        !query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase());
    const isNameMatch = (p: SpotifyPlaylist) => {
        const np = normName(p.name);
        return ncrate.length > 1 && np.length > 1 && (np.includes(ncrate) || ncrate.includes(np));
    };
    const sorted = [...(playlists ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        .filter(matchesQuery);
    const topMatches = sorted.filter(isNameMatch);
    const rest = sorted.filter(p => !isNameMatch(p));
    const sp = result?.spotify?.[0];

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(o => !o)}
                disabled={tracks.length === 0}
                className="px-5 py-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 text-white transition-all duration-300 hover:scale-105 hover:shadow-[0_0_20px_rgba(29,185,84,0.35)] shadow-lg font-bold flex items-center space-x-2 disabled:opacity-40"
                data-tour="dj-spotify-sync"
            >
                <RefreshCw size={18} className="stroke-[2.5] text-[#1DB954]" />
                <span className="text-sm uppercase tracking-wide">Sync to Spotify</span>
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.97 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-full mt-2 z-50 bg-black/90 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl w-80 overflow-hidden"
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                            <span className="text-xs font-bold truncate">
                                {phase === 'done' ? 'Synced' : <>Sync <span className="text-[#1DB954]">{crateName}</span> ({tracks.length})</>}
                            </span>
                            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white transition-colors shrink-0 ml-2">
                                <X size={14} />
                            </button>
                        </div>

                        {/* Not logged in → point at settings */}
                        {phase === 'pick' && loggedIn === false && (
                            <div className="p-4 text-xs text-gray-400 leading-relaxed">
                                <p className="mb-3">Log into Spotify first to sync playlists.</p>
                                <button
                                    onClick={() => { setOpen(false); openSettings(); }}
                                    className="bg-[#1DB954]/20 hover:bg-[#1DB954]/30 border border-[#1DB954]/40 text-[#1DB954] rounded-lg px-3 py-1.5 font-bold transition-colors"
                                >
                                    Open Settings
                                </button>
                            </div>
                        )}

                        {/* Target picker */}
                        {phase === 'pick' && loggedIn && (
                            <>
                                {playlists === null ? (
                                    <div className="flex items-center justify-center py-8 text-gray-500">
                                        <Loader2 size={18} className="animate-spin" />
                                    </div>
                                ) : (
                                    <>
                                        <input
                                            value={query}
                                            onChange={e => setQuery(e.target.value)}
                                            placeholder="Filter your playlists…"
                                            className="w-full bg-transparent border-b border-white/10 px-4 py-2.5 text-sm placeholder:text-gray-600 focus:outline-none"
                                        />

                                        {/* Create a new playlist as the sync target */}
                                        <div className="p-1 border-b border-white/10">
                                            {!creating ? (
                                                <button
                                                    onClick={() => { setCreating(true); setNewName(crateName); }}
                                                    className="w-full flex items-center space-x-2 px-3 py-2 text-sm rounded-xl hover:bg-white/10 transition-colors text-left text-[#1DB954] font-bold"
                                                >
                                                    <Plus size={13} /> <span>New playlist…</span>
                                                </button>
                                            ) : (
                                                <div className="flex items-center space-x-1.5 p-1">
                                                    <input
                                                        autoFocus
                                                        value={newName}
                                                        onChange={e => setNewName(e.target.value)}
                                                        onKeyDown={e => { if (e.key === 'Enter') createAndSync(); }}
                                                        placeholder="Playlist name"
                                                        className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#1DB954]/50 transition-colors"
                                                    />
                                                    <button
                                                        onClick={createAndSync}
                                                        disabled={!newName.trim()}
                                                        className="px-3 py-1.5 rounded-lg bg-[#1DB954]/20 hover:bg-[#1DB954]/30 border border-[#1DB954]/40 text-[#1DB954] text-xs font-bold transition-colors disabled:opacity-40 shrink-0"
                                                    >
                                                        Create
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <div className="max-h-64 overflow-y-auto p-1">
                                            {topMatches.map(p => (
                                                <button
                                                    key={p.id}
                                                    onClick={() => sync(p)}
                                                    className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-xl bg-[#1DB954]/10 hover:bg-[#1DB954]/20 border border-[#1DB954]/30 transition-colors text-left mb-1"
                                                >
                                                    <span className="truncate text-[#1DB954] font-bold">{p.name}</span>
                                                    <span className="text-[9px] font-black uppercase text-[#1DB954]/60 shrink-0 ml-2">match</span>
                                                </button>
                                            ))}
                                            {rest.map(p => (
                                                <button
                                                    key={p.id}
                                                    onClick={() => sync(p)}
                                                    className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-xl hover:bg-white/10 transition-colors text-left"
                                                >
                                                    <span className="truncate flex items-center space-x-2">
                                                        <ListMusic size={13} className="text-gray-500 shrink-0" />
                                                        <span className="truncate">{p.name}</span>
                                                    </span>
                                                    <span className="text-[10px] text-gray-600 shrink-0 ml-2">{p.trackCount}</span>
                                                </button>
                                            ))}
                                            {sorted.length === 0 && (
                                                <p className="text-center text-gray-600 text-xs py-4">No playlists found.</p>
                                            )}
                                        </div>
                                    </>
                                )}
                            </>
                        )}

                        {/* Progress — one search per track, can take a while */}
                        {phase === 'syncing' && (
                            <div className="flex flex-col items-center py-8 text-gray-400 text-xs space-y-3">
                                <Loader2 size={22} className="animate-spin text-[#1DB954]" />
                                <p>Matching {tracks.length} tracks on Spotify…</p>
                            </div>
                        )}

                        {/* Result */}
                        {phase === 'done' && (
                            <div className="p-4 text-xs space-y-2">
                                {sp ? (
                                    <p className="text-[#1DB954] font-bold">
                                        {sp.playlist}: {sp.added} added{sp.skipped > 0 && `, ${sp.skipped} already there`}
                                    </p>
                                ) : (
                                    <p className="text-red-400">{result?.errors[0] ?? 'Nothing was synced.'}</p>
                                )}
                                {sp && sp.errors.map((e, i) => <p key={i} className="text-red-400">{e}</p>)}
                                {sp && sp.unmatched.length > 0 && (
                                    <div className="text-amber-200/70 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2 max-h-32 overflow-y-auto">
                                        <p className="font-bold text-amber-300/90 mb-1">Not found on Spotify ({sp.unmatched.length}):</p>
                                        {sp.unmatched.map((u, i) => <p key={i} className="truncate">{u.artist} – {u.title}</p>)}
                                    </div>
                                )}
                                {result?.spotifyLimited && (
                                    <button
                                        onClick={() => { setOpen(false); openSettings(); }}
                                        className="flex items-center space-x-1.5 bg-[#1DB954]/20 hover:bg-[#1DB954]/30 border border-[#1DB954]/40 text-[#1DB954] rounded-lg px-3 py-1.5 font-bold transition-colors"
                                    >
                                        <Sparkles size={11} /> <span>Hit Spotify's limits — set up your own API</span>
                                    </button>
                                )}
                                <button
                                    onClick={() => setOpen(false)}
                                    className="w-full mt-1 flex items-center justify-center space-x-1.5 bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg px-3 py-2 font-bold transition-colors"
                                >
                                    <Check size={12} /> <span>Done</span>
                                </button>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
