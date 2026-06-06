import { AlertTriangle, ArrowLeft, Disc3, FileQuestion, FolderOpen, Loader2, ListMusic, Music2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DetectedLibraries, DJTrack, LoadedLibrary } from '../electron';

interface Props {
    onBack: () => void;
}

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

export function DJLibraryView({ onBack }: Props) {
    const [loading, setLoading] = useState(true);
    const [detected, setDetected] = useState<DetectedLibraries | null>(null);
    const [libraries, setLibraries] = useState<LoadedLibrary[]>([]);
    const [errors, setErrors] = useState<string[]>([]);
    const [activeLib, setActiveLib] = useState(0);
    const [activeCrate, setActiveCrate] = useState<number | null>(null); // null = all tracks

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
                    setActiveLib(0);
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
    const visibleTracks: DJTrack[] = useMemo(() => {
        if (!current) return [];
        if (activeCrate === null) return current.library.tracks;
        const crate = current.library.crates[activeCrate];
        if (!crate) return [];
        const byId = new Map(current.library.tracks.map(t => [t.id, t]));
        return crate.trackIds.map(id => byId.get(id)).filter((t): t is DJTrack => !!t);
    }, [current, activeCrate]);

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
                <button
                    onClick={() => loadAll()}
                    className="p-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 transition-all hover:scale-105"
                    title="Reload libraries"
                    style={{ WebkitAppRegion: 'no-drag' } as any}
                >
                    <RefreshCw size={18} className={`stroke-[2.5] ${loading ? 'animate-spin' : ''}`} />
                </button>
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
                    <div className="w-80 shrink-0 flex flex-col space-y-4 min-h-0">
                        {/* Source switcher */}
                        <div className="flex space-x-2">
                            {libraries.map((lib, i) => {
                                const meta = SOURCE_META[lib.library.source];
                                return (
                                    <button
                                        key={lib.library.source}
                                        onClick={() => { setActiveLib(i); setActiveCrate(null); }}
                                        className={`flex-1 px-3 py-2 rounded-xl border text-xs font-bold uppercase tracking-wide transition-all ${i === activeLib ? meta.bg + ' ' + meta.color : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
                                    >
                                        {meta.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Health summary */}
                        {current && (
                            <div className="grid grid-cols-2 gap-2 text-center">
                                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                    <p className="text-xl font-black">{current.health.trackCount.toLocaleString()}</p>
                                    <p className="text-[10px] uppercase tracking-widest text-gray-500">Tracks</p>
                                </div>
                                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                    <p className="text-xl font-black">{current.health.crateCount}</p>
                                    <p className="text-[10px] uppercase tracking-widest text-gray-500">Crates</p>
                                </div>
                                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                    <p className={`text-xl font-black ${current.health.missingFiles > 0 ? 'text-amber-400' : ''}`}>{current.health.missingFiles}</p>
                                    <p className="text-[10px] uppercase tracking-widest text-gray-500">Missing files</p>
                                </div>
                                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                    <p className="text-xl font-black">{current.health.tracksWithCues}</p>
                                    <p className="text-[10px] uppercase tracking-widest text-gray-500">With cues</p>
                                </div>
                            </div>
                        )}

                        {/* Crate list */}
                        <div className="flex-1 overflow-y-auto bg-white/5 border border-white/10 rounded-2xl p-2 min-h-0">
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
                    </div>

                    {/* Track table */}
                    <div className="flex-1 bg-white/5 border border-white/10 rounded-2xl overflow-hidden flex flex-col min-h-0">
                        <div className="grid grid-cols-[1fr_180px_60px_60px_60px_50px] gap-3 px-4 py-3 border-b border-white/10 text-[10px] uppercase tracking-widest text-gray-500 font-bold shrink-0">
                            <span>Title</span><span>Artist</span><span>BPM</span><span>Key</span><span>Time</span><span>Cues</span>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {visibleTracks.map((t, i) => (
                                <div key={t.id + i} className="grid grid-cols-[1fr_180px_60px_60px_60px_50px] gap-3 px-4 py-2 text-sm border-b border-white/5 hover:bg-white/5 items-center">
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
                                    <span className="flex items-center space-x-0.5">
                                        {t.cues.slice(0, 4).map((c, j) => (
                                            <span key={j} className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: c.color || '#888' }} title={`${c.type} ${c.index >= 0 ? c.index + 1 : '(memory)'} @ ${fmtDuration(c.positionMs / 1000)}`} />
                                        ))}
                                        {t.cues.length > 4 && <span className="text-[10px] text-gray-500">+{t.cues.length - 4}</span>}
                                    </span>
                                </div>
                            ))}
                            {visibleTracks.length === 0 && (
                                <p className="text-center text-gray-500 text-sm py-12">No tracks in this crate.</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Load errors toast */}
            {!loading && errors.length > 0 && libraries.length > 0 && (
                <div className="absolute bottom-6 right-6 bg-red-500/10 border border-red-500/40 text-red-300 text-xs rounded-xl px-4 py-3 max-w-sm">
                    {errors.join(' · ')}
                </div>
            )}
        </div>
    );
}
