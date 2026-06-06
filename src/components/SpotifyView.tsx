import axios from 'axios';
import { AlertCircle, Check, ChevronLeft, Coffee, DownloadCloud, FolderOpen, ListMusic, Loader2, Search, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Logo from '../assets/spotify-logo.png'; // Re-use logo (make sure it looks good on dark)
import { HistoryManager } from '../utils/historyManager';
import { LibraryManager } from '../utils/libraryManager';
import { DOWNLOAD_CONCURRENCY } from '../utils/matching';

interface Song {
    id: string;
    title: string;
    artist: string;
    status: 'pending' | 'searching' | 'found' | 'notFound' | 'downloading' | 'downloaded' | 'error' | 'exists';
    youtubeUrl?: string;
    isSelected: boolean;
    isPreviouslyDownloaded?: boolean;
    durationMs?: number;
}

interface Props {
    onBack: () => void;
}

interface MyPlaylist {
    id: string;
    name: string;
    trackCount: number;
    imageUrl?: string;
}

export function SpotifyView({ onBack }: Props) {
    const [isLoading, setIsLoading] = useState(false);
    const [isWakingUp, setIsWakingUp] = useState(false);
    const [showErrorOverlay, setShowErrorOverlay] = useState(false);

    const [playlistUrl, setPlaylistUrl] = useState('');
    const [songs, setSongs] = useState<Song[]>([]);
    const [statusMsg, setStatusMsg] = useState('Ready');
    const [targetFolder, setTargetFolder] = useState<string | null>(localStorage.getItem('target_folder'));
    const [isProcessing, setIsProcessing] = useState(false);
    const abortRef = useRef(false);

    // "My Playlists" browser — needs the user's own session (private scope)
    const [hasUserSession, setHasUserSession] = useState(false);
    const [showMyPlaylists, setShowMyPlaylists] = useState(false);
    const [myPlaylists, setMyPlaylists] = useState<MyPlaylist[] | null>(null); // null = not loaded
    const [loadingPlaylists, setLoadingPlaylists] = useState(false);

    useEffect(() => {
        window.electronAPI.spotifyGetToken?.().then(t => setHasUserSession(!!t)).catch(() => { });
    }, []);

    const openMyPlaylists = async () => {
        if (showMyPlaylists) { setShowMyPlaylists(false); return; }
        setShowMyPlaylists(true);
        if (myPlaylists !== null) return; // already loaded this session

        setLoadingPlaylists(true);
        try {
            const token = await window.electronAPI.spotifyGetToken();
            if (!token) { setHasUserSession(false); setShowMyPlaylists(false); return; }
            const all: MyPlaylist[] = [];
            let nextUrl: string | null = 'https://api.spotify.com/v1/me/playlists?limit=50';
            while (nextUrl) {
                const res: any = await axios.get(nextUrl, { headers: { 'Authorization': `Bearer ${token}` } });
                for (const p of res.data.items ?? []) {
                    if (!p?.id) continue;
                    all.push({
                        id: p.id,
                        name: p.name || 'Untitled',
                        trackCount: p.tracks?.total ?? 0,
                        imageUrl: p.images?.[p.images.length - 1]?.url, // smallest image
                    });
                }
                nextUrl = res.data.next;
            }
            setMyPlaylists(all);
        } catch (e) {
            console.error('Failed to load playlists', e);
            setMyPlaylists([]);
        } finally {
            setLoadingPlaylists(false);
        }
    };

    const pickMyPlaylist = (p: MyPlaylist) => {
        const url = `https://open.spotify.com/playlist/${p.id}`;
        setPlaylistUrl(url);
        setShowMyPlaylists(false);
        scanPlaylist(url);
    };

    const getSpotifyToken = async () => {
        // Prefer the user's own session (works for private playlists, no backend wait)
        try {
            const userToken = await window.electronAPI.spotifyGetToken();
            if (userToken) return userToken;
        } catch (e) {
            console.warn('User token unavailable, falling back to shared backend', e);
        }

        try {
            // Fallback: shared Render backend with 4 min timeout
            const res = await axios.get('https://universal-music-downloader.onrender.com/token', { timeout: 240000 });
            return res.data.access_token;
        } catch (e) {
            console.error(e);
            setStatusMsg('Spotify Auth Failed');
            setShowErrorOverlay(true);
            return null;
        }
    };

    const scanPlaylist = async (urlOverride?: string) => {
        const url = urlOverride ?? playlistUrl;
        setIsLoading(true);
        setIsWakingUp(false);
        setShowErrorOverlay(false);

        // Backend Wake-up Timer
        const wakeUpTimer = setTimeout(() => {
            setIsWakingUp(true);
        }, 8000); // 8 seconds to trigger "Waking up..." message

        const token = await getSpotifyToken();
        clearTimeout(wakeUpTimer); // Clear timer immediately after token response
        setIsWakingUp(false);

        if (!token) {
            setIsLoading(false);
            return;
        }

        setStatusMsg('Fetching...');

        let id = '';
        const isTrack = url.includes('/track/');
        const isPlaylist = url.includes('/playlist/');
        const isAlbum = url.includes('/album/');

        if (isTrack) {
            id = url.split('/track/')[1]?.split('?')[0];
        } else if (isPlaylist) {
            id = url.split('/playlist/')[1]?.split('?')[0];
        } else if (isAlbum) {
            id = url.split('/album/')[1]?.split('?')[0];
        }

        if (!id) {
            setStatusMsg('Invalid URL — paste a Track, Playlist or Album link');
            setIsLoading(false);
            return;
        }

        const toSong = (track: any, extraArtist?: string): Song => {
            const artist = track.artists?.map((a: any) => a.name).join(', ') || extraArtist || 'Unknown Artist';
            // Already downloaded before, or already present in the synced library folder
            const isDownloaded = HistoryManager.has(track.id) || LibraryManager.has(artist, track.name);
            return {
                id: track.id,
                title: track.name,
                artist,
                status: isDownloaded ? 'exists' : 'pending',
                isSelected: !isDownloaded,
                isPreviouslyDownloaded: isDownloaded,
                durationMs: track.duration_ms
            };
        };

        try {
            let allSongs: Song[] = [];
            const headers = { 'Authorization': `Bearer ${token}` };

            if (isTrack) {
                // Single Track
                const res = await axios.get(`https://api.spotify.com/v1/tracks/${id}`, { headers });
                allSongs = [toSong(res.data)];
            } else if (isAlbum) {
                // Album (track objects come without the item.track wrapper)
                let nextUrl = `https://api.spotify.com/v1/albums/${id}/tracks?limit=50`;
                while (nextUrl) {
                    const res = await axios.get(nextUrl, { headers });
                    const newItems = res.data.items
                        .filter((t: any) => t && t.id) // skip unavailable tracks
                        .map((t: any) => toSong(t));
                    allSongs = [...allSongs, ...newItems];
                    nextUrl = res.data.next;
                }
            } else {
                // Playlist
                let nextUrl = `https://api.spotify.com/v1/playlists/${id}/tracks`;
                while (nextUrl) {
                    const res = await axios.get(nextUrl, { headers });
                    const newItems = res.data.items
                        .filter((item: any) => item?.track?.id) // removed/local tracks have track === null
                        .map((item: any) => toSong(item.track));
                    allSongs = [...allSongs, ...newItems];
                    nextUrl = res.data.next;
                }
            }
            setSongs(allSongs);
            setStatusMsg(`Found ${allSongs.length} item(s).`);
        } catch (e) {
            setStatusMsg('Error fetching data');
            console.error(e);
            setShowErrorOverlay(true);
        } finally {
            setIsLoading(false);
        }
    };

    const selectFolder = async () => {
        const path = await window.electronAPI.selectFolder('Choose the download output folder');
        if (path) {
            setTargetFolder(path);
            localStorage.setItem('target_folder', path);
        }
    };

    // Pipelined queue: one producer resolves YouTube URLs sequentially (the main
    // process rate-limits searches anyway) while a pool of workers downloads in
    // parallel. Searching song N+1 overlaps with downloading song N.
    const startProcess = async () => {
        if (!targetFolder) {
            alert('Please select a download folder first.');
            return;
        }

        setIsProcessing(true);
        abortRef.current = false;
        setStatusMsg('Starting Download Queue...');

        const newSongs = [...songs];
        const queue = newSongs.map((_, i) => i).filter(i => newSongs[i].isSelected);
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

        const setStatus = (i: number, status: Song['status']) => {
            newSongs[i] = { ...newSongs[i], status };
            setSongs([...newSongs]);
        };

        // undefined = not searched yet, null = not found, string = ready to download
        const resolved: Record<number, string | null> = {};

        // Producer: resolve YouTube URLs ahead of the downloaders
        const searcher = (async () => {
            for (const i of queue) {
                if (abortRef.current) break;
                if (newSongs[i].youtubeUrl) {
                    resolved[i] = newSongs[i].youtubeUrl!;
                    continue;
                }
                setStatus(i, 'searching');
                const url = await window.electronAPI.searchYoutube({
                    artist: newSongs[i].artist,
                    title: newSongs[i].title,
                    duration: newSongs[i].durationMs ? Math.round(newSongs[i].durationMs! / 1000) : undefined
                });
                resolved[i] = url;
                if (url) {
                    newSongs[i] = { ...newSongs[i], youtubeUrl: url };
                    setStatus(i, 'found');
                } else {
                    setStatus(i, 'notFound');
                }
            }
        })();

        // Consumers: parallel download workers pulling from a shared cursor
        let cursor = 0;
        const worker = async () => {
            while (!abortRef.current) {
                const qIdx = cursor++;
                if (qIdx >= queue.length) break;
                const i = queue[qIdx];

                // Wait for the searcher to resolve this song
                while (resolved[i] === undefined && !abortRef.current) await sleep(150);
                if (abortRef.current) break;

                const url = resolved[i];
                if (!url) continue; // search came up empty

                setStatus(i, 'downloading');
                const res = await window.electronAPI.downloadSong({
                    url,
                    folder: targetFolder,
                    artist: newSongs[i].artist,
                    title: newSongs[i].title
                });

                if (res.success) {
                    setStatus(i, 'downloaded');
                    HistoryManager.add({
                        id: newSongs[i].id,
                        source: 'spotify',
                        title: newSongs[i].title,
                        artist: newSongs[i].artist,
                        timestamp: Date.now()
                    });
                } else {
                    setStatus(i, 'error');
                }
            }
        };

        await Promise.all([searcher, ...Array.from({ length: DOWNLOAD_CONCURRENCY }, () => worker())]);

        setIsProcessing(false);
        setStatusMsg(abortRef.current ? 'Stopped' : 'All Done');
    };

    const stopProcess = () => {
        abortRef.current = true;
        setStatusMsg('Stopping...');
    };

    const toggleSelect = (idx: number) => {
        const newSongs = [...songs];
        newSongs[idx].isSelected = !newSongs[idx].isSelected;
        setSongs(newSongs);
    };

    const selectAll = () => setSongs(songs.map(s => ({ ...s, isSelected: true })));
    const selectNone = () => setSongs(songs.map(s => ({ ...s, isSelected: false })));
    const selectNew = () => setSongs(songs.map(s => ({
        ...s,
        isSelected: s.status !== 'downloaded' && s.status !== 'exists'
    })));

    return (
        <div className="min-h-screen bg-[#000000] text-[#1DB954] px-6 pb-6 pt-12 font-sans select-none flex flex-col items-center relative">

            {/* Funny Error Overlay */}
            {showErrorOverlay && (
                <div className="absolute inset-0 z-50 backdrop-blur-md flex items-center justify-center p-8">
                    <div className="bg-black/80 border border-red-500/50 rounded-2xl p-8 max-w-lg w-full shadow-2xl relative text-center backdrop-blur-xl">
                        <h2 className="text-3xl font-black text-red-500 mb-4 uppercase tracking-wide">Whoops! We hit a wall.</h2>
                        <p className="text-gray-300 mb-6 text-lg leading-relaxed">
                            It looks like this playlist is playing hard to get (Private) or doesn't exist.
                            We aren't hackers, we can only see what's public!
                        </p>
                        <p className="text-sm text-gray-500 mb-8 font-mono">
                            Please check the link and make sure it's Public.
                        </p>

                        <button onClick={() => setShowErrorOverlay(false)} className="bg-red-500 text-black hover:bg-red-400 font-black py-3 px-8 rounded-full transition-colors w-full shadow-lg">
                            TRY AGAIN
                        </button>
                    </div>
                </div>
            )}

            {/* Drag Handle */}
            <div className="fixed top-0 left-0 w-full h-12 z-50 draggable-header hover:bg-white/5 transition-colors" />

            {/* Back Button */}
            <button onClick={onBack} className="absolute top-14 left-8 p-3 rounded-full bg-[#121212] border border-[#1DB954]/50 text-[#1DB954] hover:bg-[#1DB954] hover:text-black transition-all z-50 group shadow-lg">
                <ChevronLeft size={24} className="stroke-[3]" />
                <span className="absolute left-full ml-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-[#1DB954] text-black px-3 py-1 rounded-full text-xs font-black whitespace-nowrap pointer-events-none">BACK</span>
            </button>

            {/* Header */}
            <div className="mb-8 mt-4 relative z-10 flex flex-col items-center">
                <img src={Logo} alt="Spotify" className="h-24 object-contain drop-shadow-[0_0_15px_rgba(29,185,84,0.5)]" />
                <h1 className="text-4xl font-black mt-4 text-[#1DB954] uppercase tracking-tighter drop-shadow-md">Spotify</h1>
                <p className="text-sm text-[#1DB954]/80 font-bold mt-1 uppercase tracking-widest">{statusMsg}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-6xl">

                {/* Sidebar */}
                <div className="col-span-1 space-y-6">
                    {/* Input Box */}
                    <div className="bg-[#181818] p-6 rounded-3xl shadow-[0_0_15px_rgba(255,255,255,0.1)]">
                        <h2 className="text-xs font-black text-[#1DB954] uppercase mb-4 tracking-widest relative z-10">Playlist URL</h2>
                        <input
                            className="w-full bg-black border border-white/10 focus:border-[#1DB954] rounded-xl p-3 mb-4 text-sm font-bold text-[#1DB954] outline-none transition-all placeholder-[#1DB954]/30 shadow-inner"
                            placeholder="Paste Link..."
                            value={playlistUrl} onChange={e => setPlaylistUrl(e.target.value)}
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => scanPlaylist()}
                                className="flex-1 bg-[#1DB954] text-black hover:bg-[#1ed760] font-black py-4 rounded-xl transition-all flex items-center justify-center space-x-2 shadow-lg hover:shadow-[0_0_20px_rgba(29,185,84,0.4)] active:scale-95 uppercase tracking-wider"
                            >
                                <Search size={18} className="stroke-[3]" />
                                <span>SCAN</span>
                            </button>
                            {hasUserSession && (
                                <button
                                    onClick={openMyPlaylists}
                                    title="Browse your saved playlists"
                                    className={`px-4 py-4 rounded-xl border font-black transition-all active:scale-95 ${showMyPlaylists ? 'bg-[#1DB954] text-black border-[#1DB954]' : 'bg-black border-[#1DB954]/50 text-[#1DB954] hover:bg-[#1DB954]/10'}`}
                                >
                                    <ListMusic size={18} className="stroke-[3]" />
                                </button>
                            )}
                        </div>

                        {/* My playlists browser */}
                        {showMyPlaylists && (
                            <div className="mt-4 bg-black border border-[#1DB954]/30 rounded-xl overflow-hidden">
                                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1DB954]/20">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-[#1DB954]/70">
                                        Your Playlists{myPlaylists ? ` (${myPlaylists.length})` : ''}
                                    </span>
                                    <button onClick={() => setShowMyPlaylists(false)} className="text-[#1DB954]/50 hover:text-[#1DB954] transition-colors">
                                        <X size={14} />
                                    </button>
                                </div>
                                <div className="max-h-64 overflow-y-auto">
                                    {loadingPlaylists ? (
                                        <div className="flex items-center justify-center py-8 text-[#1DB954]/50">
                                            <Loader2 size={20} className="animate-spin" />
                                        </div>
                                    ) : (myPlaylists ?? []).length === 0 ? (
                                        <p className="text-center text-[#1DB954]/40 text-xs py-6 font-bold">No playlists found.</p>
                                    ) : (
                                        myPlaylists!.map(p => (
                                            <button
                                                key={p.id}
                                                onClick={() => pickMyPlaylist(p)}
                                                className="w-full flex items-center space-x-3 px-4 py-2.5 hover:bg-[#1DB954]/10 transition-colors text-left"
                                            >
                                                {p.imageUrl
                                                    ? <img src={p.imageUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                                                    : <span className="w-8 h-8 rounded bg-[#1DB954]/10 flex items-center justify-center shrink-0"><ListMusic size={14} className="text-[#1DB954]/50" /></span>}
                                                <span className="flex-1 min-w-0">
                                                    <span className="block text-sm font-bold text-[#1DB954] truncate">{p.name}</span>
                                                    <span className="block text-[10px] text-[#1DB954]/50 font-mono">{p.trackCount} tracks</span>
                                                </span>
                                            </button>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Folder & DL Actions */}
                    <div className="bg-[#181818] p-6 rounded-3xl shadow-[0_0_15px_rgba(255,255,255,0.1)]">
                        <button onClick={selectFolder} className="w-full mb-4 bg-black/40 hover:bg-black/60 border border-white/10 text-[#1DB954] py-3 rounded-xl flex items-center justify-center text-sm transition-colors font-bold uppercase tracking-wide">
                            <FolderOpen size={18} className="mr-2 shrink-0" />
                            <span className="truncate">{targetFolder ? `Output: ${targetFolder.split('/').pop()}` : 'Choose Output'}</span>
                        </button>

                        <div className="flex gap-2">
                            {!isProcessing ? (
                                <button onClick={startProcess} className="flex-1 bg-[#1DB954] text-black hover:bg-[#1ed760] py-4 rounded-xl text-sm font-black transition-colors flex items-center justify-center shadow-lg active:scale-95 uppercase tracking-wider">
                                    <DownloadCloud size={20} className="mr-2" /> Download
                                </button>
                            ) : (
                                <button onClick={stopProcess} className="flex-1 bg-[#121212] text-red-500 border border-red-500 py-4 rounded-xl text-sm font-black transition-colors flex items-center justify-center shadow-lg animate-pulse uppercase tracking-wider">
                                    <Square size={20} className="mr-2 fill-current" /> Stop
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* List Container */}
                <div className="col-span-1 md:col-span-2 bg-[#181818] rounded-3xl shadow-[0_0_15px_rgba(255,255,255,0.1)] overflow-hidden flex flex-col h-[600px]">
                    <div className="p-6 bg-black/20 border-b border-white/5 flex flex-col gap-4">
                        <div className="flex justify-between items-center">
                            <h2 className="font-black text-xl text-[#1DB954] uppercase tracking-wider">Tracks ({songs.length})</h2>
                        </div>
                        {songs.length > 0 && (
                            <div className="flex gap-2">
                                <button onClick={selectAll} className="px-3 py-1 bg-[#1DB954] text-black text-[10px] font-black uppercase rounded hover:bg-[#1ed760] transition-colors">Select All</button>
                                <button onClick={selectNew} className="px-3 py-1 bg-transparent border border-[#1DB954] text-[#1DB954] text-[10px] font-black uppercase rounded hover:bg-[#1DB954]/10 transition-colors">Select New</button>
                                <button onClick={selectNone} className="px-3 py-1 text-[#1DB954]/50 hover:text-[#1DB954] text-[10px] font-black uppercase transition-colors">Clear</button>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar relative">
                        {isLoading ? (
                            <div className="h-full flex flex-col items-center justify-center text-[#1DB954]/50 space-y-4">
                                <Loader2 size={48} className="text-[#1DB954] animate-spin" />
                                <div className="text-center">
                                    <p className="text-2xl font-black uppercase tracking-widest animate-pulse">
                                        {isWakingUp ? 'Waking Up Backend...' : 'Scanning...'}
                                    </p>

                                    {isWakingUp && (
                                        <div className="mt-6 max-w-md mx-auto bg-[#1DB954]/10 rounded-xl p-4 border border-[#1DB954]/20">
                                            <p className="text-sm text-[#1DB954]/80 mb-3 leading-relaxed">
                                                Our free backend server sleeps when inactive. It might take <strong>1-2 minutes</strong> to start up.
                                                <br /><br />
                                                If you buy us a coffee, we might be able to afford a server that never sleeps! (Or at least one that naps less.)
                                            </p>
                                            <a
                                                href="https://ko-fi.com/liberaudio"
                                                target="_blank"
                                                className="inline-flex items-center space-x-2 bg-[#1DB954] text-black px-6 py-3 rounded-full text-xs font-black hover:bg-[#1ed760] hover:scale-105 transition-all shadow-lg uppercase tracking-wide"
                                            >
                                                <Coffee size={16} className="stroke-[3]" />
                                                <span>Buy us a Coffee</span>
                                            </a>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : songs.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-[#1DB954]/30">
                                <p className="text-xl font-black uppercase tracking-widest opacity-50">No Playlist Loaded</p>
                            </div>
                        ) : (
                            songs.map((song, idx) => (
                                <div key={idx} className={`flex items-center p-3 hover:bg-[#1DB954]/5 rounded-lg border transition-all ${song.isSelected ? 'border-[#1DB954] bg-[#1DB954]/10' : 'border-transparent'}`}>
                                    <button onClick={() => toggleSelect(idx)} className={`w-5 h-5 rounded border mr-3 flex items-center justify-center transition-colors ${song.isSelected ? 'bg-[#1DB954] border-[#1DB954]' : 'border-[#1DB954]/50'}`}>
                                        {song.isSelected && <Check size={12} className="text-black stroke-[3]" />}
                                    </button>

                                    <div className="flex-1 overflow-hidden">
                                        <div className="flex items-center space-x-2">
                                            <h3 className={`font-bold truncate ${song.isPreviouslyDownloaded ? 'text-[#1DB954]/40' : 'text-[#1DB954]'}`}>{song.title}</h3>
                                            {song.isPreviouslyDownloaded && (
                                                <div className="group relative">
                                                    <AlertCircle size={14} className="text-[#1DB954]/40" />
                                                </div>
                                            )}
                                        </div>
                                        <p className="text-xs text-[#1DB954]/60 truncate font-mono">{song.artist}</p>
                                    </div>
                                    <StatusBadge status={song.status} />
                                </div>
                            ))
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}

const StatusBadge = ({ status }: { status: Song['status'] }) => {
    // Monochrome Green Status Styles
    const styles = {
        pending: 'text-[#1DB954]/40 border-[#1DB954]/20',
        searching: 'text-[#1DB954] border-[#1DB954] animate-pulse',
        found: 'bg-[#1DB954]/20 text-[#1DB954] border-[#1DB954]',
        notFound: 'text-red-500 border-red-500',
        downloading: 'bg-[#1DB954] text-black border-[#1DB954] animate-pulse',
        downloaded: 'bg-[#1DB954] text-black border-[#1DB954]',
        exists: 'text-[#1DB954]/40 border-[#1DB954]/20',
        error: 'text-red-500 border-red-500'
    };

    return (
        <span className={`text-[10px] uppercase font-black px-2 py-1 rounded border ${styles[status]}`}>
            {status === 'exists' ? 'DONE' : status}
        </span>
    );
};
