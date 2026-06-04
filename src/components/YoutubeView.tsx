import { Check, ChevronLeft, DownloadCloud, FolderOpen, Loader2, Search, Square } from 'lucide-react';
import { useRef, useState } from 'react';
import Logo from '../assets/youtube-logo.png'; // Re-using existing logo
import { HistoryManager } from '../utils/historyManager';
import { LibraryManager } from '../utils/libraryManager';
import { DOWNLOAD_CONCURRENCY } from '../utils/matching';

interface Song {
    id: string;
    title: string;
    artist: string;
    url: string;
    duration: number;
    status: 'pending' | 'downloading' | 'downloaded' | 'error' | 'exists';
    isSelected: boolean;
    isPreviouslyDownloaded?: boolean;
}

interface Props {
    onBack: () => void;
}

export function YoutubeView({ onBack }: Props) {
    const [url, setUrl] = useState('');
    const [songs, setSongs] = useState<Song[]>([]);
    const [statusMsg, setStatusMsg] = useState('Ready');
    const [targetFolder, setTargetFolder] = useState<string | null>(localStorage.getItem('target_folder'));
    const [isProcessing, setIsProcessing] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [showErrorOverlay, setShowErrorOverlay] = useState(false);
    const abortRef = useRef(false);

    const scanUrl = async () => {
        if (!url) { setStatusMsg('Please enter a URL'); return; }
        setStatusMsg('Scanning YouTube...');
        setIsLoading(true);
        setShowErrorOverlay(false);

        try {
            const res = await window.electronAPI.fetchMetadata(url);
            if (res.success && res.tracks) {
                const newSongs = res.tracks.map((t: any) => {
                    const isDownloaded = HistoryManager.has(t.id) || LibraryManager.has(t.artist, t.title);
                    return {
                        id: t.id,
                        title: t.title,
                        artist: t.artist,
                        url: t.url,
                        duration: t.duration,
                        status: (isDownloaded ? 'exists' : 'pending') as 'pending' | 'downloading' | 'downloaded' | 'error' | 'exists',
                        isSelected: !isDownloaded,
                        isPreviouslyDownloaded: isDownloaded
                    };
                });
                setSongs(newSongs);
                setStatusMsg(`Found ${newSongs.length} video(s).`);
            } else {
                setStatusMsg(res.error || 'No videos found or invalid URL');
                setShowErrorOverlay(true);
            }
        } catch (e) {
            console.error(e);
            setStatusMsg('Error scanning URL (Check Console)');
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

    // Parallel download pool: several yt-dlp processes at once
    const startProcess = async () => {
        if (!targetFolder) { alert('Select folder first'); return; }

        setIsProcessing(true);
        abortRef.current = false;
        setStatusMsg('Downloading...');

        const newSongs = [...songs];
        const queue = newSongs.map((_, i) => i).filter(i => newSongs[i].isSelected);

        const setStatus = (i: number, status: Song['status']) => {
            newSongs[i] = { ...newSongs[i], status };
            setSongs([...newSongs]);
        };

        let cursor = 0;
        const worker = async () => {
            while (!abortRef.current) {
                const qIdx = cursor++;
                if (qIdx >= queue.length) break;
                const i = queue[qIdx];

                setStatus(i, 'downloading');
                const res = await window.electronAPI.downloadSong({
                    url: newSongs[i].url,
                    folder: targetFolder,
                    artist: newSongs[i].artist,
                    title: newSongs[i].title
                });

                if (res.success) {
                    setStatus(i, 'downloaded');
                    HistoryManager.add({
                        id: newSongs[i].id,
                        source: 'youtube',
                        title: newSongs[i].title,
                        artist: newSongs[i].artist,
                        timestamp: Date.now()
                    });
                } else {
                    setStatus(i, 'error');
                }
            }
        };

        await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, () => worker()));

        setIsProcessing(false);
        setStatusMsg(abortRef.current ? 'Stopped' : 'All Done');
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
        <div className="min-h-screen bg-[#ff0000] text-white px-6 pb-6 pt-12 font-sans select-none flex flex-col items-center relative">

            {/* Funny Error Overlay */}
            {showErrorOverlay && (
                <div className="absolute inset-0 z-50 backdrop-blur-md flex items-center justify-center p-8">
                    <div className="bg-black/80 border border-white/20 rounded-2xl p-8 max-w-lg w-full shadow-2xl relative text-center backdrop-blur-xl">
                        <h2 className="text-3xl font-black text-[#ff0000] mb-4 uppercase tracking-wide">Whoops! We hit a wall. 🧱</h2>
                        <p className="text-gray-300 mb-6 text-lg leading-relaxed">
                            It looks like this video/playlist is playing hard to get (Private) or doesn't exist.
                            We aren't hackers, we can only see what's public! 🕵️‍♂️
                        </p>
                        <p className="text-sm text-gray-500 mb-8 font-mono">
                            Please check the link and make sure it's Public.
                        </p>

                        <button onClick={() => setShowErrorOverlay(false)} className="bg-[#ff0000] text-white hover:bg-white hover:text-[#ff0000] font-black py-3 px-8 rounded-full transition-colors w-full shadow-lg">
                            TRY AGAIN
                        </button>
                    </div>
                </div>
            )}

            {/* Drag Handle */}
            <div className="fixed top-0 left-0 w-full h-12 z-50 draggable-header hover:bg-black/5 transition-colors" />

            {/* Back Button */}
            <button onClick={onBack} className="absolute top-14 left-8 p-3 rounded-full bg-white text-[#ff0000] shadow-xl hover:scale-105 transition-transform z-50 group">
                <ChevronLeft size={24} className="stroke-[3]" />
                <span className="absolute left-full ml-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-white text-[#ff0000] px-3 py-1 rounded-full font-black text-xs whitespace-nowrap pointer-events-none shadow-lg">BACK</span>
            </button>

            {/* Header */}
            <div className="mb-8 mt-4 relative z-10 flex flex-col items-center">
                <img src={Logo} alt="YouTube" className="h-24 object-contain drop-shadow-2xl" />
                <h1 className="text-4xl font-black mt-4 text-white uppercase tracking-tighter drop-shadow-md">YouTube</h1>
                <p className="text-sm text-white/80 font-bold mt-1 uppercase tracking-widest">{statusMsg}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-6xl">
                {/* Sidebar (Input) */}
                <div className="col-span-1 space-y-6">
                    {/* MONOCHROME CONTAINER: Red BG, Deep Shadow */}
                    <div className="bg-[#ff0000] text-white p-6 rounded-3xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)] border border-white/10 relative overflow-hidden">
                        <h2 className="text-xs font-black text-white uppercase mb-4 tracking-widest relative z-10">Video URL</h2>
                        <input
                            className="w-full bg-black/20 border-2 border-transparent focus:border-white/40 rounded-xl p-3 mb-4 text-sm font-bold focus:bg-black/40 outline-none transition-all placeholder-white/40 text-white relative z-10 shadow-inner"
                            placeholder="Paste Link..."
                            value={url} onChange={e => setUrl(e.target.value)}
                        />
                        <button
                            onClick={scanUrl}
                            className="relative z-10 w-full bg-white text-[#ff0000] hover:bg-gray-100 font-black py-4 rounded-xl transition-all flex items-center justify-center space-x-2 shadow-lg active:scale-95 uppercase tracking-wider"
                        >
                            <Search size={20} className="stroke-[3]" />
                            <span>SCAN</span>
                        </button>
                    </div>

                    <div className="bg-[#ff0000] p-6 rounded-3xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)] border border-white/10">
                        <button onClick={selectFolder} className="w-full mb-4 bg-black/20 hover:bg-black/30 border-2 border-transparent py-3 rounded-xl flex items-center justify-center text-sm transition-colors text-sm font-bold text-white uppercase tracking-wide">
                            <FolderOpen size={18} className="mr-2 stroke-[2.5] shrink-0" />
                            <span className="truncate">{targetFolder ? `Output: ${targetFolder.split('/').pop()}` : 'Choose Folder'}</span>
                        </button>

                        <div className="flex gap-2">
                            {!isProcessing ? (
                                <button onClick={startProcess} className="flex-1 bg-white text-black hover:bg-gray-100 py-4 rounded-xl text-sm font-black uppercase tracking-wider transition-colors flex items-center justify-center shadow-lg transform active:scale-95">
                                    <DownloadCloud size={22} className="mr-2 stroke-[3]" /> Download
                                </button>
                            ) : (
                                <button onClick={() => abortRef.current = true} className="flex-1 bg-white text-[#ff0000] border-2 border-white py-4 rounded-xl text-sm font-black uppercase tracking-wider transition-colors flex items-center justify-center shadow-lg animate-pulse">
                                    <Square size={22} className="mr-2 fill-current" /> Stop
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* List Container */}
                <div className="col-span-1 md:col-span-2 bg-[#ff0000] rounded-3xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)] border border-white/10 overflow-hidden flex flex-col h-[600px] relative">
                    <div className="p-6 bg-black/10 border-b border-white/5 flex flex-col gap-4">
                        <div className="flex justify-between items-center">
                            <h2 className="font-black text-xl text-white uppercase tracking-wider">Videos Found ({songs.length})</h2>
                            <span className="text-[10px] text-white/60 font-bold uppercase border border-white/20 rounded px-2 py-1">Editable Metadata</span>
                        </div>

                        {/* Selection Controls */}
                        {songs.length > 0 && (
                            <div className="flex gap-2">
                                <button onClick={selectAll} className="px-3 py-1 bg-white text-[#ff0000] text-[10px] font-black uppercase rounded hover:bg-gray-200 transition-colors shadow-md">Select All</button>
                                <button onClick={selectNew} className="px-3 py-1 bg-black/20 border-2 border-white/20 text-white text-[10px] font-black uppercase rounded hover:bg-black/40 transition-colors shadow-md">Select New</button>
                                <button onClick={selectNone} className="px-3 py-1 text-white/40 hover:text-white text-[10px] font-black uppercase transition-colors">Clear</button>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        {isLoading ? (
                            <div className="h-full flex flex-col items-center justify-center text-white/50 space-y-4">
                                <Loader2 size={48} className="text-white animate-spin" />
                                <p className="text-2xl font-black uppercase tracking-widest animate-pulse">Scanning...</p>
                            </div>
                        ) : songs.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-white/20 space-y-4">
                                <Search size={64} className="stroke-[3]" />
                                <p className="text-xl uppercase tracking-widest font-black">No Videos Scanned</p>
                            </div>
                        ) : (
                            songs.map((song, idx) => (
                                <div key={idx} className={`flex items-center p-3 hover:bg-black/10 rounded-xl border-2 transition-all group ${song.isSelected ? 'border-white bg-white/10' : 'border-transparent bg-black/10'}`}>
                                    <button onClick={() => toggleSelect(idx)} className={`w-8 h-8 rounded-lg border-2 mr-4 flex items-center justify-center transition-all ${song.isSelected ? 'bg-white border-white' : 'border-white/20 hover:border-white'}`}>
                                        {song.isSelected && <Check size={20} className="text-[#ff0000] stroke-[4]" />}
                                    </button>

                                    <div className="flex-1 overflow-hidden pr-4 group">
                                        {/* Editable Inputs */}
                                        <input
                                            value={song.title}
                                            onChange={(e) => {
                                                const newSongs = [...songs];
                                                newSongs[idx].title = e.target.value;
                                                setSongs(newSongs);
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="bg-transparent border-b border-transparent focus:border-white p-0 text-white font-black text-base w-full outline-none placeholder-white/30 transition-colors uppercase tracking-tight"
                                            placeholder="TITLE"
                                        />
                                        <input
                                            value={song.artist}
                                            onChange={(e) => {
                                                const newSongs = [...songs];
                                                newSongs[idx].artist = e.target.value;
                                                setSongs(newSongs);
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="bg-transparent border-b border-transparent focus:border-white p-0 text-xs text-white/60 font-bold w-full outline-none transition-colors uppercase tracking-wide mt-1 focus:text-white"
                                            placeholder="ARTIST"
                                        />
                                    </div>

                                    <div className="flex flex-col items-end space-y-1">
                                        <span className={`text-[10px] uppercase font-black px-2 py-1 rounded shadow-sm ${song.status === 'downloaded' || song.status === 'exists' ? 'bg-black text-white' :
                                            song.status === 'downloading' ? 'bg-white text-[#ff0000] border-2 border-white animate-pulse' :
                                                song.status === 'error' ? 'bg-white text-red-600' :
                                                    'bg-black/20 text-white/40'
                                            }`}>
                                            {song.status === 'exists' ? 'DONE' : song.status}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
