import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronUp, Disc3, ExternalLink, FileQuestion, FolderOpen, Loader2, ListMusic, Music2, RefreshCw, Repeat, Search, X, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DetectedLibraries, DJCue, DJTrack, LoadedLibrary } from '../electron';
import { SpotlightTour, type TourStep, useTour } from './SpotlightTour';
import { TriageOverlay } from './TriageOverlay';

interface Props {
    onBack: () => void;
}

const DJ_TOUR: TourStep[] = [
    { target: '[data-tour="dj-sources"]', title: 'Your libraries', text: 'Every DJ library found on this Mac — Serato, rekordbox (XML export) and Apple Music. Switch between them here.' },
    { target: '[data-tour="dj-health"]', title: 'Library health', text: 'Track and crate counts, files that have gone missing, and how many tracks carry hot cues.' },
    { target: '[data-tour="dj-crates"]', title: 'Crates & playlists', text: 'Browse the full crate tree of the selected library. Click one to filter the track table.' },
    { target: '[data-tour="dj-table"]', title: 'Tracks', text: 'Title, BPM, key, and your hot cues/loops read straight from the files. Click a column header to sort.' },
    { target: '[data-tour="dj-search"]', title: 'Search', text: 'Filter by title, artist or album — or type an exact key like 8A to find harmonic matches.' },
    { target: '[data-tour="dj-triage"]', title: 'Sort new tracks', text: '"Tinder for new songs": listen to each track and flick it into your crates and playlists — Serato, rekordbox, Apple Music and Spotify in one go.' },
];

const SOURCE_META = {
    serato: { label: 'Serato', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/40' },
    rekordbox: { label: 'Rekordbox', color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/40' },
    itunes: { label: 'Apple Music', color: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/40' },
} as const;

const fmtDuration = (sec?: number): string => {
    if (!sec || sec <= 0) return '–';
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
};

// DJ-friendly cue timestamp: m:ss.t
const fmtCuePos = (ms: number): string => {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const t = Math.floor((ms % 1000) / 100);
    return `${m}:${String(s).padStart(2, '0')}.${t}`;
};

const fmtAgo = (mtimeMs: number): string => {
    const days = Math.floor((Date.now() - mtimeMs) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
};

// Counts up to `value` over ~1s with an ease-out curve whenever it changes.
function CountUp({ value, className }: { value: number; className?: string }) {
    const [display, setDisplay] = useState(0);
    const frameRef = useRef(0);

    useEffect(() => {
        cancelAnimationFrame(frameRef.current);
        const start = performance.now();
        const duration = 1000;
        const tick = (now: number) => {
            const t = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
            setDisplay(Math.round(value * eased));
            if (t < 1) frameRef.current = requestAnimationFrame(tick);
        };
        frameRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frameRef.current);
    }, [value]);

    return <p className={className}>{display.toLocaleString()}</p>;
}

// Cue dots + animated hover popover listing ALL cues with timestamps.
function CueDots({ cues }: { cues: DJCue[] }) {
    const [popover, setPopover] = useState<{ x: number; y: number } | null>(null);
    const anchorRef = useRef<HTMLSpanElement>(null);

    if (cues.length === 0) return <span className="text-gray-600 text-xs">–</span>;

    const POPOVER_WIDTH = 230;
    const open = () => {
        const rect = anchorRef.current?.getBoundingClientRect();
        if (!rect) return;
        // Popover sits left of the cue cell; clamp so it never leaves the window
        // (left edge is computed explicitly — framer-motion owns `transform`)
        const estHeight = Math.min(cues.length * 30 + 52, 320);
        setPopover({
            x: Math.max(rect.left - POPOVER_WIDTH - 8, 8),
            y: Math.min(rect.top, window.innerHeight - estHeight - 16),
        });
    };

    return (
        <span
            ref={anchorRef}
            className="flex items-center space-x-0.5 cursor-default"
            onMouseEnter={open}
            onMouseLeave={() => setPopover(null)}
        >
            {cues.slice(0, 4).map((c, j) => (
                <span key={j} className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: c.color || '#888' }} />
            ))}
            {cues.length > 4 && <span className="text-[10px] text-gray-500">+{cues.length - 4}</span>}

            <AnimatePresence>
                {popover && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.92, x: 8 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.92, x: 8 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        className="fixed z-50 bg-black/90 backdrop-blur-xl border border-white/15 rounded-xl shadow-2xl p-3 max-h-80 overflow-y-auto"
                        style={{ left: popover.x, top: popover.y, width: POPOVER_WIDTH }}
                    >
                        <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">
                            {cues.length} {cues.length === 1 ? 'marker' : 'markers'}
                        </p>
                        {cues.map((c, j) => (
                            <motion.div
                                key={j}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.03 * j, duration: 0.15 }}
                                className="flex items-center space-x-2 py-1"
                            >
                                <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/20" style={{ backgroundColor: c.color || '#888' }} />
                                {c.type === 'loop'
                                    ? <Repeat size={11} className="text-gray-400 shrink-0" />
                                    : <span className="text-[10px] font-black text-gray-400 w-[11px] text-center shrink-0">{c.index >= 0 ? c.index + 1 : 'M'}</span>}
                                <span className="text-xs tabular-nums text-gray-200 shrink-0">
                                    {fmtCuePos(c.positionMs)}{c.endMs !== undefined && <span className="text-gray-500"> → {fmtCuePos(c.endMs)}</span>}
                                </span>
                                {c.name && <span className="text-xs text-gray-500 truncate">{c.name}</span>}
                            </motion.div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </span>
    );
}

type SortKey = 'title' | 'artist' | 'bpm' | 'key' | 'duration' | 'cues';
type SortDir = 'asc' | 'desc';

export function DJLibraryView({ onBack }: Props) {
    const [loading, setLoading] = useState(true);
    const [detected, setDetected] = useState<DetectedLibraries | null>(null);
    const [libraries, setLibraries] = useState<LoadedLibrary[]>([]);
    const [errors, setErrors] = useState<string[]>([]);
    const [activeLib, setActiveLib] = useState(0);
    const [activeCrate, setActiveCrate] = useState<number | null>(null); // null = all tracks
    const [query, setQuery] = useState('');
    const [sortKey, setSortKey] = useState<SortKey | null>(null);
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [triageTracks, setTriageTracks] = useState<DJTrack[] | null>(null);
    const [sourceMenu, setSourceMenu] = useState(false);

    const loadAll = async (overrides?: { rekordboxXmlPath?: string; itunesXmlPath?: string }) => {
        setLoading(true);
        setErrors([]);
        try {
            const det = await window.electronAPI.djDetectLibraries();
            if (!det.success || !det.detected) throw new Error(det.error || 'Detection failed');
            setDetected(det.detected);

            const req = {
                seratoPath: det.detected.serato ?? undefined,
                rekordboxXmlPath: overrides?.rekordboxXmlPath ?? det.detected.rekordboxXml ?? undefined,
                itunesXmlPath: overrides?.itunesXmlPath ?? det.detected.itunesXml ?? undefined,
            };
            if (req.seratoPath || req.rekordboxXmlPath || req.itunesXmlPath) {
                const res = await window.electronAPI.djLoadLibraries(req);
                if (res.success && res.libraries) {
                    setLibraries(res.libraries);
                    setErrors(res.errors || []);
                    setActiveLib(prev => Math.min(prev, Math.max(res.libraries.length - 1, 0)));
                    setActiveCrate(null);
                } else {
                    setErrors([res.error || 'Failed to load libraries']);
                }
            }
        } catch (e: any) {
            setErrors([e.message]);
        }
        setLoading(false);
    };

    useEffect(() => { loadAll(); }, []);

    const pickXml = async (kind: 'rekordbox' | 'itunes') => {
        const file = await window.electronAPI.djSelectXml(
            kind === 'rekordbox' ? 'Choose your rekordbox.xml export' : 'Choose your iTunes/Music Library.xml export'
        );
        if (file) loadAll(kind === 'rekordbox' ? { rekordboxXmlPath: file } : { itunesXmlPath: file });
    };

    const current = libraries[activeLib];

    // rekordbox.xml exports are snapshots — warn when the live DB is newer
    const xmlStale = !!(detected?.rekordboxXmlMtimeMs && detected?.rekordboxDbMtimeMs
        && detected.rekordboxDbMtimeMs > detected.rekordboxXmlMtimeMs + 60_000
        && current?.library.source === 'rekordbox');

    // Rows carry their ORIGINAL crate position (n) so sorting/filtering never
    // loses the natural order — and the third sort click restores it.
    const visibleTracks: { t: DJTrack; n: number }[] = useMemo(() => {
        if (!current) return [];
        let tracks: DJTrack[];
        if (activeCrate === null) {
            tracks = current.library.tracks;
        } else {
            const crate = current.library.crates[activeCrate];
            const byId = new Map(current.library.tracks.map(t => [t.id, t]));
            tracks = (crate?.trackIds ?? []).map(id => byId.get(id)).filter((t): t is DJTrack => !!t);
        }
        let rows = tracks.map((t, i) => ({ t, n: i + 1 }));

        if (query.trim()) {
            const q = query.trim().toLowerCase();
            rows = rows.filter(({ t }) =>
                t.title.toLowerCase().includes(q) ||
                t.artist.toLowerCase().includes(q) ||
                (t.album?.toLowerCase().includes(q) ?? false) ||
                (t.key?.toLowerCase() === q)
            );
        }

        if (sortKey) {
            const dir = sortDir === 'asc' ? 1 : -1;
            // Missing values always sort last, regardless of direction
            const cmp = (ra: { t: DJTrack }, rb: { t: DJTrack }): number => {
                const a = ra.t, b = rb.t;
                switch (sortKey) {
                    case 'title': return a.title.localeCompare(b.title) * dir;
                    case 'artist': return a.artist.localeCompare(b.artist) * dir;
                    case 'key': {
                        if (!a.key && !b.key) return 0;
                        if (!a.key) return 1;
                        if (!b.key) return -1;
                        return a.key.localeCompare(b.key, undefined, { numeric: true }) * dir;
                    }
                    case 'bpm': {
                        if (!a.bpm && !b.bpm) return 0;
                        if (!a.bpm) return 1;
                        if (!b.bpm) return -1;
                        return (a.bpm - b.bpm) * dir;
                    }
                    case 'duration': {
                        if (!a.durationSec && !b.durationSec) return 0;
                        if (!a.durationSec) return 1;
                        if (!b.durationSec) return -1;
                        return (a.durationSec - b.durationSec) * dir;
                    }
                    case 'cues': return (a.cues.length - b.cues.length) * dir;
                }
            };
            rows = [...rows].sort(cmp);
        }
        return rows;
    }, [current, activeCrate, query, sortKey, sortDir]);

    // Tri-state: first click sorts, second flips, third returns to crate order
    const toggleSort = (key: SortKey) => {
        if (sortKey === key) {
            const firstDir: SortDir = key === 'bpm' || key === 'cues' ? 'desc' : 'asc';
            if (sortDir === firstDir) {
                setSortDir(firstDir === 'asc' ? 'desc' : 'asc');
            } else {
                setSortKey(null); // back to natural order
            }
        } else {
            setSortKey(key);
            setSortDir(key === 'bpm' || key === 'cues' ? 'desc' : 'asc'); // BPM/cues: high first feels natural
        }
    };

    const SortHeader = ({ label, k }: { label: string; k: SortKey }) => (
        <button
            onClick={() => toggleSort(k)}
            className={`flex items-center space-x-1 uppercase tracking-widest font-bold transition-colors ${sortKey === k ? 'text-violet-300' : 'text-gray-500 hover:text-gray-300'}`}
        >
            <span>{label}</span>
            {sortKey === k && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
        </button>
    );

    const tour = useTour('djlibrary');

    return (
        <div className="h-screen flex flex-col bg-black text-white">
            {/* Draggable Top Bar */}
            <div className="h-12 shrink-0" style={{ WebkitAppRegion: 'drag' } as any} />

            {/* Header */}
            <div className="flex items-center justify-between px-8 pb-4 shrink-0">
                <div className="flex items-center space-x-4">
                    <button
                        onClick={onBack}
                        className="p-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 transition-all hover:scale-105"
                        style={{ WebkitAppRegion: 'no-drag' } as any}
                    >
                        <ArrowLeft size={20} className="stroke-[2.5]" />
                    </button>
                    <div className="flex items-center space-x-3">
                        <Disc3 size={28} className="text-violet-400" />
                        <h1 className="text-2xl font-bold tracking-wide">DJ Library</h1>
                        <span className="text-[10px] uppercase tracking-widest bg-violet-500/20 border border-violet-500/40 text-violet-300 px-2 py-1 rounded-full font-bold">Read-only beta</span>
                    </div>
                </div>
                <div className="flex items-center space-x-3" style={{ WebkitAppRegion: 'no-drag' } as any}>
                    {/* Sort new tracks — triage entry point */}
                    <div className="relative" data-tour="dj-triage">
                        <button
                            onClick={() => setSourceMenu(m => !m)}
                            disabled={libraries.length === 0}
                            className="px-5 py-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 text-white transition-all duration-300 hover:scale-105 hover:shadow-[0_0_20px_rgba(167,139,250,0.35)] shadow-lg font-bold flex items-center space-x-2 disabled:opacity-40"
                        >
                            <Zap size={18} className="stroke-[2.5] text-violet-300" />
                            <span className="text-sm uppercase tracking-wide">Sort new tracks</span>
                        </button>
                        <AnimatePresence>
                            {sourceMenu && (
                                <motion.div
                                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                                    transition={{ duration: 0.15 }}
                                    className="absolute right-0 top-full mt-2 z-50 bg-black/90 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-2 w-64"
                                >
                                    <button
                                        onClick={() => { setSourceMenu(false); setTriageTracks(visibleTracks.map(r => r.t)); }}
                                        className="w-full text-left px-3 py-2.5 rounded-xl text-sm hover:bg-white/10 transition-colors"
                                    >
                                        <span className="font-bold block">Current view</span>
                                        <span className="text-xs text-gray-500">{visibleTracks.length} tracks{activeCrate !== null && current ? ` · ${current.library.crates[activeCrate]?.name}` : ''}</span>
                                    </button>
                                    <button
                                        onClick={async () => {
                                            setSourceMenu(false);
                                            const folder = await window.electronAPI.selectFolder('Choose the folder with your new tracks');
                                            if (!folder) return;
                                            const res = await window.electronAPI.djScanFolder(folder);
                                            if (res.success && res.tracks) setTriageTracks(res.tracks);
                                        }}
                                        className="w-full text-left px-3 py-2.5 rounded-xl text-sm hover:bg-white/10 transition-colors"
                                    >
                                        <span className="font-bold block">Choose folder…</span>
                                        <span className="text-xs text-gray-500">e.g. your downloads — newest first</span>
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    <button
                        onClick={() => loadAll()}
                        className="p-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 transition-all hover:scale-105"
                        title="Reload libraries"
                    >
                        <RefreshCw size={18} className={`stroke-[2.5] ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                    <Loader2 size={40} className="animate-spin mb-4" />
                    <p>Reading your DJ libraries…</p>
                </div>
            ) : libraries.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
                    <FileQuestion size={48} className="text-gray-600 mb-4" />
                    <h2 className="text-xl font-bold mb-2">No DJ libraries found</h2>
                    <p className="text-gray-400 text-sm max-w-md mb-6">
                        I looked for a Serato <code className="text-gray-300">_Serato_</code> folder, a <code className="text-gray-300">rekordbox.xml</code> export
                        and an iTunes/Music <code className="text-gray-300">Library.xml</code> export.
                    </p>
                    <div className="flex space-x-3">
                        <button onClick={() => pickXml('rekordbox')} className="px-5 py-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-sm font-bold flex items-center space-x-2">
                            <FolderOpen size={16} /> <span>Locate rekordbox.xml</span>
                        </button>
                        <button onClick={() => pickXml('itunes')} className="px-5 py-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-sm font-bold flex items-center space-x-2">
                            <FolderOpen size={16} /> <span>Locate Library.xml</span>
                        </button>
                    </div>
                    {errors.length > 0 && <p className="text-red-400 text-xs mt-6">{errors.join(' · ')}</p>}
                </div>
            ) : (
                <div className="flex-1 flex min-h-0 px-8 pb-8 space-x-6">
                    {/* Sidebar: sources + crates */}
                    <motion.div
                        initial={{ opacity: 0, x: -16 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                        className="w-80 shrink-0 flex flex-col space-y-4 min-h-0"
                    >
                        {/* Source switcher */}
                        <div className="flex space-x-2" data-tour="dj-sources">
                            {libraries.map((lib, i) => {
                                const meta = SOURCE_META[lib.library.source];
                                return (
                                    <button
                                        key={lib.library.source}
                                        onClick={() => { setActiveLib(i); setActiveCrate(null); setQuery(''); }}
                                        className={`flex-1 px-3 py-2 rounded-xl border text-xs font-bold uppercase tracking-wide transition-all ${i === activeLib ? meta.bg + ' ' + meta.color : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
                                    >
                                        {meta.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Stale rekordbox export warning */}
                        <AnimatePresence>
                            {xmlStale && detected && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="overflow-hidden"
                                >
                                    <div className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2">
                                        <p className="flex items-start space-x-2">
                                            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                            <span>
                                                Your XML export is from <b>{fmtAgo(detected.rekordboxXmlMtimeMs!)}</b>, but the rekordbox
                                                library changed <b>{fmtAgo(detected.rekordboxDbMtimeMs!)}</b> — it may be outdated.
                                            </span>
                                        </p>
                                        <p className="text-amber-200/60">
                                            rekordbox can't be triggered externally: open it and run
                                            <b> File → Export Collection in xml format</b>, then hit reload here.
                                        </p>
                                        <button
                                            onClick={() => window.electronAPI.djOpenRekordbox()}
                                            className="flex items-center space-x-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg px-3 py-1.5 font-bold transition-colors"
                                        >
                                            <ExternalLink size={12} /> <span>Open rekordbox</span>
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Health summary */}
                        {current && (
                            <div className="grid grid-cols-2 gap-2 text-center" data-tour="dj-health">
                                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                    <CountUp value={current.health.trackCount} className="text-xl font-black" />
                                    <p className="text-[10px] uppercase tracking-widest text-gray-500">Tracks</p>
                                </div>
                                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                    <CountUp value={current.health.crateCount} className="text-xl font-black" />
                                    <p className="text-[10px] uppercase tracking-widest text-gray-500">Crates</p>
                                </div>
                                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                    <CountUp value={current.health.missingFiles} className={`text-xl font-black ${current.health.missingFiles > 0 ? 'text-amber-400' : ''}`} />
                                    <p className="text-[10px] uppercase tracking-widest text-gray-500">Missing files</p>
                                </div>
                                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                    <CountUp value={current.health.tracksWithCues} className="text-xl font-black" />
                                    <p className="text-[10px] uppercase tracking-widest text-gray-500">With cues</p>
                                </div>
                            </div>
                        )}

                        {/* Crate list */}
                        <div className="flex-1 overflow-y-auto bg-white/5 border border-white/10 rounded-2xl p-2 min-h-0" data-tour="dj-crates">
                            <button
                                onClick={() => setActiveCrate(null)}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold flex items-center space-x-2 ${activeCrate === null ? 'bg-violet-500/20 text-violet-300' : 'text-gray-300 hover:bg-white/10'}`}
                            >
                                <Music2 size={14} /> <span>All Tracks</span>
                            </button>
                            {current?.library.crates.map((crate, i) => (
                                <button
                                    key={i}
                                    onClick={() => setActiveCrate(i)}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between group ${activeCrate === i ? 'bg-violet-500/20 text-violet-300 font-bold' : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'}`}
                                    style={{ paddingLeft: `${12 + crate.path.length * 14}px` }}
                                    title={[...crate.path, crate.name].join(' / ')}
                                >
                                    <span className="flex items-center space-x-2 truncate">
                                        <ListMusic size={14} className="shrink-0" />
                                        <span className="truncate">{crate.name}</span>
                                    </span>
                                    <span className="text-[10px] text-gray-600 group-hover:text-gray-400 shrink-0 ml-2">{crate.trackIds.length}</span>
                                </button>
                            ))}
                        </div>

                        {/* Missing-export helpers */}
                        {detected && !detected.rekordboxXml && detected.rekordboxInstalled && !libraries.some(l => l.library.source === 'rekordbox') && (
                            <button onClick={() => pickXml('rekordbox')} className="text-left text-xs text-sky-300/80 bg-sky-500/10 border border-sky-500/30 rounded-xl p-3 hover:bg-sky-500/20 transition-colors">
                                Rekordbox is installed but no XML export was found.<br />
                                <span className="font-bold">Export it via rekordbox → File → Export Collection in xml format, then click here to locate it.</span>
                            </button>
                        )}
                        {detected && !detected.itunesXml && !libraries.some(l => l.library.source === 'itunes') && (
                            <button onClick={() => pickXml('itunes')} className="text-left text-xs text-pink-300/80 bg-pink-500/10 border border-pink-500/30 rounded-xl p-3 hover:bg-pink-500/20 transition-colors">
                                To include Apple Music: Music → File → Library → Export Library, then click here to locate the XML.
                            </button>
                        )}
                    </motion.div>

                    {/* Track table */}
                    <motion.div
                        data-tour="dj-table"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: 'easeOut', delay: 0.08 }}
                        className="flex-1 bg-white/5 border border-white/10 rounded-2xl overflow-hidden flex flex-col min-h-0"
                    >
                        {/* Search bar */}
                        <div className="px-4 pt-3 pb-2 shrink-0 flex items-center space-x-3">
                            <div className="relative flex-1 max-w-md" data-tour="dj-search">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                <input
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    placeholder="Search title, artist, album — or an exact key like 8A"
                                    className="w-full bg-white/5 border border-white/10 rounded-full pl-9 pr-9 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:border-violet-500/50 focus:bg-white/10 transition-colors"
                                />
                                {query && (
                                    <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                            <span className="text-xs text-gray-500 tabular-nums shrink-0">
                                {visibleTracks.length.toLocaleString()} {visibleTracks.length === 1 ? 'track' : 'tracks'}
                            </span>
                        </div>

                        <div className="grid grid-cols-[44px_1fr_180px_70px_60px_60px_60px] gap-3 px-4 py-2 border-b border-white/10 text-[10px] shrink-0">
                            <span className="uppercase tracking-widest font-bold text-gray-500">#</span>
                            <SortHeader label="Title" k="title" />
                            <SortHeader label="Artist" k="artist" />
                            <SortHeader label="BPM" k="bpm" />
                            <SortHeader label="Key" k="key" />
                            <SortHeader label="Time" k="duration" />
                            <SortHeader label="Cues" k="cues" />
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {visibleTracks.map(({ t, n }, i) => (
                                <div key={t.id + i} className="grid grid-cols-[44px_1fr_180px_70px_60px_60px_60px] gap-3 px-4 py-2 text-sm border-b border-white/5 hover:bg-white/5 items-center">
                                    <span className="text-gray-600 tabular-nums text-xs">{n}</span>
                                    <span className="truncate flex items-center space-x-2">
                                        {t.fileExists === false && (
                                            <span title={`File missing: ${t.path}`}><AlertTriangle size={13} className="text-amber-400 shrink-0" /></span>
                                        )}
                                        <span className="truncate">{t.title}</span>
                                    </span>
                                    <span className="truncate text-gray-400">{t.artist}</span>
                                    <span className="text-gray-300 tabular-nums">{t.bpm ? Math.round(t.bpm * 10) / 10 : '–'}</span>
                                    <span className="text-gray-300">{t.key || '–'}</span>
                                    <span className="text-gray-400 tabular-nums">{fmtDuration(t.durationSec)}</span>
                                    <CueDots cues={t.cues} />
                                </div>
                            ))}
                            {visibleTracks.length === 0 && (
                                <p className="text-center text-gray-500 text-sm py-12">
                                    {query ? `No tracks matching “${query}”.` : 'No tracks in this crate.'}
                                </p>
                            )}
                        </div>
                    </motion.div>
                </div>
            )}

            {/* First-visit tour — only once libraries are actually on screen */}
            {tour.active && !loading && libraries.length > 0 && !triageTracks && (
                <SpotlightTour steps={DJ_TOUR} onClose={tour.close} />
            )}

            {/* Triage overlay */}
            <AnimatePresence>
                {triageTracks && (
                    <TriageOverlay
                        tracks={triageTracks}
                        libraries={libraries}
                        onClose={() => { setTriageTracks(null); loadAll(); }}
                    />
                )}
            </AnimatePresence>

            {/* Load errors toast */}
            {!loading && errors.length > 0 && libraries.length > 0 && (
                <div className="absolute bottom-6 right-6 bg-red-500/10 border border-red-500/40 text-red-300 text-xs rounded-xl px-4 py-3 max-w-sm">
                    {errors.join(' · ')}
                </div>
            )}
        </div>
    );
}
