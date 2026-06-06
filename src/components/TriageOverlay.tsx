import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, FolderOpen, Loader2, Music2, Pause, Play, Plus, Settings2, SkipForward, Trash2, X, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DJDestination, DJTrack, LoadedLibrary, TriageAssignment, TriageResult } from '../electron';

const WAVE_BARS = 120;

// SoundCloud-style waveform: real peaks decoded from the audio file,
// mirrored bars, played part tinted, click to seek.
function Waveform({ src, progress, onSeek }: { src: string; progress: number; onSeek: (ratio: number) => void }) {
    const [peaks, setPeaks] = useState<number[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        setPeaks(null);
        (async () => {
            try {
                const buf = await (await fetch(src)).arrayBuffer();
                // Mono 16kHz offline context keeps decode memory small
                const ctx = new OfflineAudioContext(1, 1, 16000);
                const audio = await ctx.decodeAudioData(buf);
                const data = audio.getChannelData(0);
                const block = Math.floor(data.length / WAVE_BARS);
                // RMS (energy) per block, NOT peak: limited/compressed masters
                // peak at ~1.0 everywhere, which renders as a flat brick — RMS
                // still shows intros, breakdowns and drops.
                const raw: number[] = [];
                for (let i = 0; i < WAVE_BARS; i++) {
                    let sum = 0;
                    const start = i * block;
                    for (let j = start; j < start + block; j++) {
                        sum += data[j] * data[j];
                    }
                    raw.push(Math.sqrt(sum / block));
                }
                const top = Math.max(...raw, 0.001);
                // gamma > 1 EXPANDS contrast between loud and quiet sections
                if (!cancelled) setPeaks(raw.map(v => Math.pow(v / top, 1.4)));
            } catch {
                if (!cancelled) setPeaks([]); // decode failed → placeholder stays
            }
        })();
        return () => { cancelled = true; };
    }, [src]);

    const seek = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1));
    };

    const loading = peaks === null;
    const bars = loading || peaks.length === 0
        ? Array.from({ length: WAVE_BARS }, (_, i) => 0.25 + 0.2 * Math.abs(Math.sin(i * 0.7)))
        : peaks;

    return (
        <div className="flex-1 h-20 flex items-center cursor-pointer select-none" onClick={loading ? undefined : seek}>
            <div className={`w-full flex items-center space-x-px ${loading ? 'animate-pulse' : ''}`}>
                {bars.map((p, i) => {
                    const played = i / bars.length <= progress;
                    const h = Math.max(p, 0.06);
                    return (
                        <motion.div
                            key={i}
                            className="flex-1 flex flex-col items-center justify-center"
                            initial={{ scaleY: 0, opacity: 0 }}
                            animate={{ scaleY: 1, opacity: 1 }}
                            transition={{ delay: i * 0.004, duration: 0.3, ease: 'easeOut' }}
                        >
                            {/* top bar + smaller mirrored reflection, SoundCloud-style */}
                            <div
                                className="w-full rounded-t-sm transition-colors duration-150"
                                style={{
                                    height: `${h * 44}px`,
                                    backgroundColor: loading ? 'rgba(255,255,255,0.08)' : played ? '#A78BFA' : 'rgba(255,255,255,0.18)',
                                    boxShadow: played && !loading ? '0 0 6px rgba(167,139,250,0.35)' : undefined,
                                }}
                            />
                            <div
                                className="w-full rounded-b-sm mt-px transition-colors duration-150"
                                style={{
                                    height: `${h * 18}px`,
                                    backgroundColor: loading ? 'rgba(255,255,255,0.04)' : played ? 'rgba(167,139,250,0.35)' : 'rgba(255,255,255,0.07)',
                                }}
                            />
                        </motion.div>
                    );
                })}
            </div>
        </div>
    );
}

interface Props {
    tracks: DJTrack[];
    libraries: LoadedLibrary[];
    onClose: () => void;
}

const PALETTE = ['#A78BFA', '#34D399', '#38BDF8', '#F472B6', '#FBBF24', '#FB7185', '#4ADE80', '#22D3EE', '#E879F9'];

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Crate file base ('%%'-joined hierarchy) — what the Serato writer expects
const crateFileBase = (crate: { name: string; path: string[] }) => [...crate.path, crate.name].join('%%');

export function TriageOverlay({ tracks, libraries, onClose }: Props) {
    const [destinations, setDestinations] = useState<DJDestination[] | null>(null); // null = loading
    const [mode, setMode] = useState<'triage' | 'setup' | 'summary' | 'applying' | 'done'>('triage');
    const [index, setIndex] = useState(0);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [decisions, setDecisions] = useState<Map<string, Set<string>>>(new Map()); // trackId -> destIds
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [result, setResult] = useState<TriageResult | null>(null);
    const audioRef = useRef<HTMLAudioElement>(null);

    // Embedded album art, cached per file path for back/forward navigation
    const [artUrl, setArtUrl] = useState<string | null>(null);
    const artCache = useRef(new Map<string, string | null>());

    const track = tracks[index];
    const seratoLib = libraries.find(l => l.library.source === 'serato')?.library;
    const rbLib = libraries.find(l => l.library.source === 'rekordbox')?.library;
    const itunesLib = libraries.find(l => l.library.source === 'itunes')?.library;

    // Load saved destinations; jump to setup when none exist yet
    useEffect(() => {
        window.electronAPI.djGetDestinations().then(d => {
            setDestinations(d);
            if (d.length === 0) setMode('setup');
        });
    }, []);

    const saveDestinations = (d: DJDestination[]) => {
        setDestinations(d);
        window.electronAPI.djSetDestinations(d);
    };

    // Cross-platform suggestions: playlists whose normalized names collide
    const suggestions = useMemo(() => {
        const byName = new Map<string, { name: string; serato?: string; rekordbox?: string; music?: string }>();
        for (const c of seratoLib?.crates ?? []) {
            const k = normName(c.name);
            byName.set(k, { ...(byName.get(k) ?? { name: c.name }), serato: crateFileBase(c) });
        }
        for (const c of rbLib?.crates ?? []) {
            const k = normName(c.name);
            byName.set(k, { ...(byName.get(k) ?? { name: c.name }), rekordbox: c.name });
        }
        for (const c of itunesLib?.crates ?? []) {
            const k = normName(c.name);
            byName.set(k, { ...(byName.get(k) ?? { name: c.name }), music: c.name });
        }
        // Only multi-platform collisions are interesting suggestions
        return [...byName.values()].filter(s => [s.serato, s.rekordbox, s.music].filter(Boolean).length >= 2);
    }, [seratoLib, rbLib, itunesLib]);

    // Tracks already in a destination's Serato crate → duplicate warning
    const alreadyIn = useMemo(() => {
        if (!track || !seratoLib) return new Set<string>();
        const hits = new Set<string>();
        for (const d of destinations ?? []) {
            if (!d.target.seratoCrate) continue;
            const crate = seratoLib.crates.find(c => crateFileBase(c) === d.target.seratoCrate);
            if (crate?.trackIds.includes(track.id)) hits.add(d.id);
        }
        return hits;
    }, [track, destinations, seratoLib]);

    // --- Audio ---
    const audioSrc = track?.path ? 'liberaudio://' + encodeURI(track.path) : undefined;

    useEffect(() => {
        setSelected(new Set(decisions.get(track?.id ?? '') ?? []));
        setProgress(0);
    }, [index, track?.id]);

    useEffect(() => {
        setArtUrl(null);
        const p = track?.path;
        if (!p) return;
        const cached = artCache.current.get(p);
        if (cached !== undefined) { setArtUrl(cached); return; }
        let live = true;
        window.electronAPI.djGetArtwork(p).then(a => {
            const url = a ? `data:${a.mime};base64,${a.data}` : null;
            artCache.current.set(p, url);
            if (live) setArtUrl(url);
        }).catch(() => { });
        return () => { live = false; };
    }, [track?.id]);

    const onLoaded = () => {
        const a = audioRef.current;
        if (!a) return;
        // DJs judge from the body of the track, not the intro
        if (a.duration && isFinite(a.duration)) a.currentTime = a.duration * 0.25;
        a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    };

    const togglePlay = () => {
        const a = audioRef.current;
        if (!a) return;
        if (a.paused) { a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); }
    };

    // --- Decisions ---
    const toggleDest = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const commitAndAdvance = (dir: 1 | -1 = 1) => {
        if (track) {
            setDecisions(prev => {
                const next = new Map(prev);
                if (selected.size > 0) next.set(track.id, new Set(selected));
                else next.delete(track.id);
                return next;
            });
        }
        const ni = index + dir;
        if (ni < 0) return;
        if (ni >= tracks.length) { setMode('summary'); audioRef.current?.pause(); setPlaying(false); }
        else setIndex(ni);
    };

    // --- Keyboard ---
    useEffect(() => {
        if (mode !== 'triage') return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === ' ') { e.preventDefault(); togglePlay(); }
            else if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); commitAndAdvance(1); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); commitAndAdvance(-1); }
            else if (e.key === 'Escape') onClose();
            else if (/^[1-9]$/.test(e.key)) {
                const d = (destinations ?? [])[parseInt(e.key, 10) - 1];
                if (d) toggleDest(d.id);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    // --- Apply ---
    const apply = async () => {
        setMode('applying');
        const byId = new Map(tracks.map(t => [t.id, t]));
        const destById = new Map((destinations ?? []).map(d => [d.id, d]));
        const assignments: TriageAssignment[] = [];
        for (const [trackId, destIds] of decisions) {
            const t = byId.get(trackId);
            if (!t?.path || destIds.size === 0) continue;
            assignments.push({
                path: t.path,
                title: t.title,
                artist: t.artist,
                durationSec: t.durationSec,
                targets: [...destIds].map(id => destById.get(id)?.target).filter((x): x is NonNullable<typeof x> => !!x),
            });
        }
        const res = await window.electronAPI.djApplyTriage(assignments);
        setResult(res);
        setMode('done');
    };

    const decidedCount = decisions.size;

    if (destinations === null) {
        return (
            <div className="fixed inset-0 z-50 backdrop-blur-md bg-black/60 flex items-center justify-center">
                <Loader2 size={32} className="animate-spin text-violet-400" />
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 backdrop-blur-xl bg-black/70 flex items-center justify-center p-8"
        >
            {audioSrc && mode === 'triage' && (
                <audio
                    ref={audioRef}
                    src={audioSrc}
                    onLoadedMetadata={onLoaded}
                    onTimeUpdate={() => {
                        const a = audioRef.current;
                        if (a?.duration) setProgress(a.currentTime / a.duration);
                    }}
                    onEnded={() => setPlaying(false)}
                />
            )}

            <button
                onClick={onClose}
                className="absolute top-6 right-6 p-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 transition-all hover:scale-105"
            >
                <X size={18} />
            </button>

            {/* ---------- SETUP ---------- */}
            {mode === 'setup' && (
                <SetupPanel
                    destinations={destinations}
                    suggestions={suggestions}
                    seratoLib={seratoLib} rbLib={rbLib} itunesLib={itunesLib}
                    onSave={(d) => { saveDestinations(d); if (d.length > 0) setMode('triage'); }}
                />
            )}

            {/* ---------- TRIAGE ---------- */}
            {mode === 'triage' && track && (
                <motion.div
                    key={track.id}
                    initial={{ opacity: 0, x: 40, scale: 0.97 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="w-full max-w-3xl"
                >
                    <p className="text-center text-xs text-gray-500 uppercase tracking-widest font-bold mb-4">
                        {index + 1} / {tracks.length} · {decidedCount} sorted
                    </p>

                    <div className="bg-white/5 border border-white/10 rounded-3xl p-8 shadow-2xl">
                        {/* Track info */}
                        <div className="text-center mb-6">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, y: 8 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                transition={{ duration: 0.3, ease: 'easeOut' }}
                                className="mx-auto mb-4 w-28 h-28"
                            >
                                {artUrl ? (
                                    <img src={artUrl} alt="" className="w-28 h-28 rounded-2xl object-cover shadow-2xl ring-1 ring-white/10" />
                                ) : (
                                    <div className="w-28 h-28 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                                        <Music2 size={36} className="text-gray-600" />
                                    </div>
                                )}
                            </motion.div>
                            <h2 className="text-2xl font-bold truncate">{track.title}</h2>
                            <p className="text-gray-400 truncate">{track.artist}</p>
                            <div className="flex items-center justify-center space-x-2 mt-2">
                                {track.bpm && <span className="text-[10px] font-bold bg-white/10 border border-white/10 rounded-full px-2.5 py-1">{Math.round(track.bpm)} BPM</span>}
                                {track.key && <span className="text-[10px] font-bold bg-white/10 border border-white/10 rounded-full px-2.5 py-1">{track.key}</span>}
                            </div>
                        </div>

                        {/* Player: SoundCloud-style waveform */}
                        <div className="flex items-center space-x-5 mb-8">
                            <motion.button
                                onClick={togglePlay}
                                whileTap={{ scale: 0.9 }}
                                animate={playing ? { boxShadow: '0 0 30px rgba(167,139,250,0.45)' } : { boxShadow: '0 0 0px rgba(167,139,250,0)' }}
                                className="p-5 rounded-full bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 text-violet-300 transition-colors shrink-0"
                            >
                                {playing ? <Pause size={24} /> : <Play size={24} className="translate-x-0.5" />}
                            </motion.button>
                            {audioSrc && (
                                <Waveform
                                    src={audioSrc}
                                    progress={progress}
                                    onSeek={(ratio) => {
                                        const a = audioRef.current;
                                        if (a?.duration) a.currentTime = ratio * a.duration;
                                    }}
                                />
                            )}
                        </div>

                        {/* Destination buttons */}
                        <div className="grid grid-cols-3 gap-3 mb-8">
                            {destinations.map((d, i) => {
                                const isSel = selected.has(d.id);
                                const isDup = alreadyIn.has(d.id);
                                return (
                                    <button
                                        key={d.id}
                                        onClick={() => toggleDest(d.id)}
                                        className={`relative px-4 py-3 rounded-2xl border text-sm font-bold transition-all hover:scale-[1.03] ${isSel ? 'text-black shadow-lg' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'}`}
                                        style={isSel ? { backgroundColor: d.color, borderColor: d.color } : {}}
                                    >
                                        <span className="absolute top-1.5 left-2.5 text-[9px] opacity-50 font-black">{i + 1}</span>
                                        {isSel && <Check size={12} className="absolute top-2 right-2" />}
                                        <span className="truncate block">{d.name}</span>
                                        {isDup && <span className="block text-[9px] font-normal opacity-70">already in crate</span>}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Nav */}
                        <div className="flex items-center justify-between">
                            <button
                                onClick={() => commitAndAdvance(-1)}
                                disabled={index === 0}
                                className="p-3 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 disabled:opacity-30 transition-colors"
                            >
                                <ArrowLeft size={18} />
                            </button>
                            <button onClick={() => setMode('setup')} className="text-xs text-gray-500 hover:text-gray-300 flex items-center space-x-1.5 transition-colors">
                                <Settings2 size={13} /> <span>Destinations</span>
                            </button>
                            <button
                                onClick={() => commitAndAdvance(1)}
                                className={`flex items-center space-x-2 px-6 py-3 rounded-full font-bold transition-all hover:scale-105 ${selected.size > 0 ? 'bg-violet-500 text-white shadow-[0_0_25px_rgba(167,139,250,0.4)]' : 'bg-white/10 border border-white/10 text-gray-300'}`}
                            >
                                {selected.size > 0 ? <ArrowRight size={16} /> : <SkipForward size={16} />}
                                <span>{selected.size > 0 ? 'Next' : 'Skip'}</span>
                            </button>
                        </div>
                    </div>

                    <p className="text-center text-[10px] text-gray-600 mt-4">
                        1–9 toggle destinations · Space play/pause · ⏎ / → next · ← back · Esc close
                    </p>
                </motion.div>
            )}

            {/* ---------- SUMMARY ---------- */}
            {(mode === 'summary' || mode === 'applying') && (
                <div className="w-full max-w-xl bg-white/5 border border-white/10 rounded-3xl p-8 text-center">
                    <Zap size={36} className="text-violet-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold mb-2">Session complete</h2>
                    <p className="text-gray-400 text-sm mb-6">
                        {decidedCount} of {tracks.length} tracks sorted into {new Set([...decisions.values()].flatMap(s => [...s])).size} destinations.
                        Nothing is written until you apply.
                    </p>
                    <div className="max-h-56 overflow-y-auto text-left text-xs text-gray-400 bg-black/30 rounded-xl p-4 mb-6 space-y-1">
                        {[...decisions.entries()].map(([id, dests]) => {
                            const t = tracks.find(x => x.id === id);
                            return (
                                <p key={id} className="truncate">
                                    <span className="text-gray-200">{t?.artist} – {t?.title}</span>
                                    <span className="text-violet-300"> → {[...dests].map(d => destinations.find(x => x.id === d)?.name).filter(Boolean).join(', ')}</span>
                                </p>
                            );
                        })}
                        {decidedCount === 0 && <p>No tracks were assigned.</p>}
                    </div>
                    <div className="flex justify-center space-x-3">
                        <button onClick={() => setMode('triage')} className="px-5 py-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-sm font-bold transition-colors">
                            Keep sorting
                        </button>
                        <button
                            onClick={apply}
                            disabled={decidedCount === 0 || mode === 'applying'}
                            className="px-8 py-3 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-sm font-bold transition-all hover:scale-105 disabled:opacity-40 flex items-center space-x-2"
                        >
                            {mode === 'applying' && <Loader2 size={14} className="animate-spin" />}
                            <span>{mode === 'applying' ? 'Applying…' : 'Apply changes'}</span>
                        </button>
                    </div>
                </div>
            )}

            {/* ---------- DONE ---------- */}
            {mode === 'done' && result && (() => {
                const lines: { key: string; className: string; node: React.ReactNode }[] = [
                    ...result.serato.map(s => ({
                        key: `s-${s.crate}`,
                        className: 'text-emerald-300',
                        node: <>Serato · {s.crate.split('%%').pop()}: {s.added} added{s.skipped > 0 && `, ${s.skipped} already there`}</>,
                    })),
                    ...result.music.map(m => ({
                        key: `m-${m.playlist}`,
                        className: m.errors.length ? 'text-red-400' : 'text-pink-300',
                        node: <>Apple Music · {m.playlist}: {m.errors.length ? m.errors[0] : `${m.added} added`}</>,
                    })),
                    ...(result.spotify ?? []).map(s => ({
                        key: `p-${s.playlist}`,
                        className: s.errors.length ? 'text-red-400' : 'text-[#1DB954]',
                        node: <>Spotify · {s.playlist}: {s.errors.length
                            ? s.errors[0]
                            : `${s.added} added${s.skipped > 0 ? `, ${s.skipped} already there` : ''}${s.unmatched.length > 0 ? ` · ${s.unmatched.length} not found` : ''}`}</>,
                    })),
                ];
                const unmatched = (result.spotify ?? []).flatMap(s => s.unmatched);
                return (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        className="w-full max-w-xl bg-white/5 border border-white/10 rounded-3xl p-8"
                    >
                        <div className="flex flex-col items-center mb-6">
                            <motion.div
                                initial={{ scale: 0, rotate: -30 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.1 }}
                            >
                                <CheckCircle2 size={44} className="text-emerald-400 mb-3" />
                            </motion.div>
                            <h2 className="text-2xl font-bold">Applied</h2>
                        </div>
                        <div className="space-y-3 text-sm">
                            {lines.map((l, i) => (
                                <motion.p
                                    key={l.key}
                                    initial={{ opacity: 0, x: -12 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.25 + i * 0.08, duration: 0.25 }}
                                    className={l.className}
                                >
                                    {l.node}
                                </motion.p>
                            ))}
                            {result.rekordbox && (
                                <motion.div
                                    initial={{ opacity: 0, x: -12 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.25 + lines.length * 0.08, duration: 0.25 }}
                                    className="text-sky-300"
                                >
                                    <p>rekordbox · {result.rekordbox.tracks} tracks added to {result.rekordbox.playlists} {result.rekordbox.playlists === 1 ? 'playlist' : 'playlists'} in the LiberAudio xml bridge.</p>
                                    <p className="text-xs text-sky-200/60 mt-1">
                                        {result.rekordbox.firstExport
                                            ? 'One-time setup: rekordbox → Preferences → Advanced → Database → rekordbox xml → choose this file. Your LiberAudio playlists then appear in the rekordbox xml tree.'
                                            : 'Already linked — in rekordbox, refresh the “rekordbox xml” tree (or restart rekordbox) and drag the updated playlists in.'}
                                    </p>
                                    <button
                                        onClick={() => window.electronAPI.djRevealFile(result.rekordbox!.xmlPath)}
                                        className="mt-2 flex items-center space-x-1.5 text-xs bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 rounded-lg px-3 py-1.5 font-bold transition-colors"
                                    >
                                        <FolderOpen size={12} /> <span>Show XML in Finder</span>
                                    </button>
                                </motion.div>
                            )}
                            {unmatched.length > 0 && (
                                <div className="text-xs text-amber-200/70 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2">
                                    <p className="font-bold text-amber-300/90 mb-1">Couldn't find on Spotify (nothing was added for these):</p>
                                    {unmatched.map((u, i) => <p key={i} className="truncate">{u.artist} – {u.title}</p>)}
                                </div>
                            )}
                            {result.errors.map((e, i) => <p key={i} className="text-red-400 text-xs">{e}</p>)}
                        </div>
                        <button onClick={onClose} className="mt-8 w-full py-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 font-bold transition-colors">
                            Close
                        </button>
                    </motion.div>
                );
            })()}

            {mode === 'triage' && !track && (
                <div className="text-center text-gray-400">
                    <Music2 size={40} className="mx-auto mb-4 text-gray-600" />
                    <p>No tracks to sort in this source.</p>
                </div>
            )}
        </motion.div>
    );
}

// --- Destination setup sub-panel ---
function SetupPanel({ destinations, suggestions, seratoLib, rbLib, itunesLib, onSave }: {
    destinations: DJDestination[];
    suggestions: { name: string; serato?: string; rekordbox?: string; music?: string }[];
    seratoLib?: { crates: { name: string; path: string[] }[] };
    rbLib?: { crates: { name: string }[] };
    itunesLib?: { crates: { name: string }[] };
    onSave: (d: DJDestination[]) => void;
}) {
    const [drafts, setDrafts] = useState<DJDestination[]>(destinations);
    const [newName, setNewName] = useState('');
    const [pickerQuery, setPickerQuery] = useState('');
    const [showPicker, setShowPicker] = useState(false);
    const [spotifyPlaylists, setSpotifyPlaylists] = useState<{ id: string; name: string }[]>([]);

    // The user's own Spotify playlists, addable as destinations — only when
    // logged in (silently absent otherwise, same as a missing local library)
    useEffect(() => {
        let live = true;
        (async () => {
            try {
                const token = await window.electronAPI.spotifyGetToken();
                if (!token) return;
                const items: { id: string; name: string }[] = [];
                let url: string | null = 'https://api.spotify.com/v1/me/playlists?limit=50';
                while (url && items.length < 400) {
                    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                    if (!res.ok) return;
                    const data: any = await res.json();
                    for (const p of data.items ?? []) if (p?.id) items.push({ id: p.id, name: p.name });
                    url = data.next;
                }
                if (live) setSpotifyPlaylists(items);
            } catch { /* offline — picker simply shows no Spotify rows */ }
        })();
        return () => { live = false; };
    }, []);

    const addDraft = (name: string, target: DJDestination['target']) => {
        setDrafts(prev => [...prev, {
            id: crypto.randomUUID(),
            name,
            color: PALETTE[prev.length % PALETTE.length],
            target,
        }]);
    };

    const unusedSuggestions = suggestions.filter(s =>
        !drafts.some(d => normName(d.name) === normName(s.name)));

    // Every existing playlist, addable as a SINGLE-platform destination —
    // platform-specific crates are first-class; cross-platform linking is
    // optional (and the future sync engine builds on these mappings anyway)
    const existingItems = useMemo(() => [
        ...(seratoLib?.crates ?? []).map(c => ({
            key: 's:' + crateFileBase(c), platform: 'Serato', cls: 'text-emerald-400',
            label: c.name, sub: c.path.join(' / '),
            target: { seratoCrate: crateFileBase(c) } as DJDestination['target'],
        })),
        ...(rbLib?.crates ?? []).map(c => ({
            key: 'r:' + c.name, platform: 'rekordbox', cls: 'text-sky-400',
            label: c.name, sub: '',
            target: { rekordboxPlaylist: c.name } as DJDestination['target'],
        })),
        ...(itunesLib?.crates ?? []).map(c => ({
            key: 'm:' + c.name, platform: 'Music', cls: 'text-pink-400',
            label: c.name, sub: '',
            target: { musicPlaylist: c.name } as DJDestination['target'],
        })),
        ...spotifyPlaylists.map(p => ({
            key: 'p:' + p.id, platform: 'Spotify', cls: 'text-[#1DB954]',
            label: p.name, sub: '',
            target: { spotifyPlaylistId: p.id, spotifyPlaylistName: p.name } as DJDestination['target'],
        })),
    ], [seratoLib, rbLib, itunesLib, spotifyPlaylists]);

    const filteredItems = existingItems.filter(it =>
        !pickerQuery.trim() || it.label.toLowerCase().includes(pickerQuery.trim().toLowerCase()));

    return (
        <div className="w-full max-w-2xl bg-white/5 border border-white/10 rounded-3xl p-8 max-h-[85vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-1">Destinations</h2>
            <p className="text-gray-400 text-sm mb-6">
                Each destination is one button in the triage flow — and can feed several platforms at once.
            </p>

            {/* Cross-platform suggestions */}
            {unusedSuggestions.length > 0 && (
                <div className="mb-6">
                    <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">
                        Found on multiple platforms — link them?
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {unusedSuggestions.map(s => (
                            <button
                                key={s.name}
                                onClick={() => addDraft(s.name, { seratoCrate: s.serato, rekordboxPlaylist: s.rekordbox, musicPlaylist: s.music })}
                                className="flex items-center space-x-1.5 text-xs bg-violet-500/10 hover:bg-violet-500/25 border border-violet-500/40 text-violet-300 rounded-full px-3 py-1.5 font-bold transition-colors"
                            >
                                <Plus size={12} />
                                <span>{s.name}</span>
                                <span className="opacity-50 font-normal">
                                    {[s.serato && 'S', s.rekordbox && 'R', s.music && 'M'].filter(Boolean).join('+')}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Existing drafts */}
            <div className="space-y-2 mb-6">
                {drafts.map((d, i) => (
                    <div key={d.id} className="flex items-center space-x-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="font-bold text-sm flex-1 truncate">{i + 1}. {d.name}</span>
                        <span className="text-[10px] text-gray-500 shrink-0">
                            {[d.target.seratoCrate && 'Serato', d.target.rekordboxPlaylist && 'rekordbox', d.target.musicPlaylist && 'Music', d.target.spotifyPlaylistId && 'Spotify'].filter(Boolean).join(' · ') || 'no targets!'}
                        </span>
                        <button onClick={() => setDrafts(prev => prev.filter(x => x.id !== d.id))} className="text-gray-600 hover:text-red-400 transition-colors">
                            <Trash2 size={14} />
                        </button>
                    </div>
                ))}
                {drafts.length === 0 && <p className="text-gray-500 text-sm text-center py-4">No destinations yet — link a suggestion above or create one below.</p>}
            </div>

            {/* Existing single-platform playlists */}
            <div className="mb-6">
                <button
                    onClick={() => setShowPicker(p => !p)}
                    className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-gray-300 font-bold mb-2 transition-colors"
                >
                    {showPicker ? '▾' : '▸'} Add an existing playlist (single platform)
                </button>
                {showPicker && (
                    <div className="bg-black/30 border border-white/10 rounded-xl overflow-hidden">
                        <input
                            value={pickerQuery}
                            onChange={e => setPickerQuery(e.target.value)}
                            placeholder="Filter playlists…"
                            className="w-full bg-transparent border-b border-white/10 px-4 py-2.5 text-sm placeholder:text-gray-600 focus:outline-none"
                        />
                        <div className="max-h-44 overflow-y-auto">
                            {filteredItems.map(it => (
                                <button
                                    key={it.key}
                                    onClick={() => addDraft(it.label, it.target)}
                                    className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-white/10 transition-colors text-left"
                                >
                                    <span className="truncate">
                                        {it.sub && <span className="text-gray-600">{it.sub} / </span>}
                                        {it.label}
                                    </span>
                                    <span className={`text-[9px] font-black uppercase shrink-0 ml-3 ${it.cls}`}>{it.platform}</span>
                                </button>
                            ))}
                            {filteredItems.length === 0 && <p className="text-center text-gray-600 text-xs py-4">No matches.</p>}
                        </div>
                    </div>
                )}
            </div>

            {/* New destination: same-named target on every available platform */}
            <div className="flex items-center space-x-2 mb-8">
                <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { addDraftFromName(); } }}
                    placeholder="New destination name (e.g. Peak Time)"
                    className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm placeholder:text-gray-600 focus:outline-none focus:border-violet-500/50 transition-colors"
                />
                <button
                    onClick={addDraftFromName}
                    disabled={!newName.trim()}
                    className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-sm font-bold disabled:opacity-40 transition-colors"
                >
                    Add
                </button>
            </div>

            <button
                onClick={() => onSave(drafts)}
                disabled={drafts.length === 0}
                className="w-full py-3 rounded-full bg-violet-500 hover:bg-violet-400 text-white font-bold transition-all hover:scale-[1.02] disabled:opacity-40"
            >
                Save & start sorting
            </button>
        </div>
    );

    function addDraftFromName() {
        const name = newName.trim();
        if (!name) return;
        // Default: create/use a same-named playlist on every platform.
        // Existing Serato crates are matched by name; otherwise a new crate is
        // created. Apple Music needs no parsed library — AppleScript creates
        // the playlist directly in Music.app.
        const existingCrate = seratoLib?.crates.find(c => normName(c.name) === normName(name));
        addDraft(name, {
            seratoCrate: seratoLib ? (existingCrate ? crateFileBase(existingCrate) : name) : undefined,
            rekordboxPlaylist: rbLib ? name : undefined,
            musicPlaylist: name,
        });
        setNewName('');
    }
}
