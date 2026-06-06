import { Coffee, Disc3, FolderCheck, FolderSync, HelpCircle, Loader2, Rocket, Settings, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import MainLogo from '../assets/main-logo.png';
import SoundcloudLogo from '../assets/soundcloud-logo.png';
import SpotifyLogo from '../assets/spotify-logo.png';
import YoutubeLogo from '../assets/youtube-logo.png';
import { LibraryManager } from '../utils/libraryManager';
import { openSettings } from './SettingsOverlay';
import { markAllToursSeen, markTourSeen, resetAllTours, SpotlightTour, type TourStep } from './SpotlightTour';

const HOME_TOUR: TourStep[] = [
    { target: '[data-tour="panel-spotify"]', title: 'Spotify', text: 'Browse your playlists (log in via Settings for private ones) and download tracks in high quality.' },
    { target: '[data-tour="panel-soundcloud"]', title: 'SoundCloud', text: 'Paste any public SoundCloud playlist or track link and download it.' },
    { target: '[data-tour="panel-youtube"]', title: 'YouTube', text: 'Same for YouTube — playlists or single videos, converted to audio.' },
    { target: '[data-tour="panel-djlibrary"]', title: 'DJ Library', text: 'Your Serato, rekordbox and Apple Music libraries in one view — hot cues included. Triage new downloads into crates and playlists, Tinder-style.' },
    { target: '[data-tour="settings"]', title: 'Settings', text: 'Log into Spotify here, or connect your own Spotify API app for unlimited integrations.' },
    { target: '[data-tour="sync"]', title: 'Library sync', text: 'Point this at your music folder — songs you already own are marked and never downloaded twice.' },
    { target: '[data-tour="help"]', title: 'Help', text: 'Reopens the welcome screen — from there you can take this tour again anytime.' },
];

interface Props {
    onSelectService: (service: 'spotify' | 'soundcloud' | 'youtube' | 'djlibrary') => void;
    serverConfig: { release?: { text: string; link?: string }, toast?: { text: string; link?: string } } | null;
}

export function SplitScreen({ onSelectService, serverConfig }: Props) {
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [showTour, setShowTour] = useState(false);
    const [showToast, setShowToast] = useState(false);
    const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'done'>('idle');
    const [syncCount, setSyncCount] = useState<number | null>(null);
    const [lastAdded, setLastAdded] = useState(0);

    // Refresh the library index on startup
    useEffect(() => {
        LibraryManager.refresh().then(() => {
            const n = LibraryManager.getIndex().size;
            if (n > 0) setSyncCount(n);
        });
    }, []);

    const handleSyncClick = async () => {
        if (syncState === 'syncing') return;
        // NOTE: this picks the LIBRARY folder to scan — it does not touch the
        // download output folder (that's set via "Choose Output" in each view).
        const folder = await window.electronAPI.selectFolder('Choose your music library folder to scan');
        if (!folder) return;
        setSyncState('syncing');
        const res = await LibraryManager.sync(folder);
        setSyncState('done');
        if (res.success) {
            setSyncCount(res.count ?? 0);
            setLastAdded(res.added ?? 0);
        }
        setTimeout(() => setSyncState('idle'), 3000);
    };

    useEffect(() => {
        if (serverConfig?.toast && serverConfig.toast.text !== 'None') {
            setShowToast(true);
        }
    }, [serverConfig]);

    useEffect(() => {
        const hasSeen = localStorage.getItem('has_seen_onboarding');
        if (!hasSeen) {
            setShowOnboarding(true);
        }
    }, []);

    // "Show me around" re-arms every view's first-visit tour; "Skip" opts
    // out of all of them (Help reopens this overlay to change your mind)
    const startTour = () => {
        localStorage.setItem('has_seen_onboarding', 'true');
        setShowOnboarding(false);
        resetAllTours();
        setShowTour(true);
    };
    const dismissOnboarding = () => {
        localStorage.setItem('has_seen_onboarding', 'true');
        setShowOnboarding(false);
        markAllToursSeen();
    };

    return (
        <div className="flex w-full h-screen font-sans select-none relative">
            {/* Draggable Top Bar (Invisible) */}
            <div
                className="absolute top-0 left-0 w-full h-12 z-30"
                style={{ WebkitAppRegion: 'drag' } as any}
            />

            {/* Top Right Actions Container */}
            <div
                className="absolute top-6 right-6 z-40 flex items-center space-x-4"
                style={{ WebkitAppRegion: 'no-drag' } as any}
            >
                {/* Release Button (Dynamic) */}
                {serverConfig?.release && serverConfig.release.text !== 'None' && (
                    <a
                        href={serverConfig.release.link || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-5 py-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 text-white transition-all duration-300 hover:scale-105 hover:shadow-[0_0_20px_rgba(255,255,255,0.3)] shadow-lg font-bold flex items-center space-x-2"
                    >
                        <Rocket size={20} className="stroke-[2.5]" />
                        <span className="text-sm uppercase tracking-wide">{serverConfig.release.text}</span>
                    </a>
                )}

                {/* Buy Me a Coffee Button */}
                <a
                    href="https://ko-fi.com/liberaudio"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-5 py-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 text-white transition-all duration-300 hover:scale-105 hover:shadow-[0_0_20px_rgba(255,255,255,0.3)] shadow-lg font-bold flex items-center space-x-2"
                    title="Buy me a coffee"
                >
                    <Coffee size={20} className="stroke-[2.5]" />
                    <span className="text-sm">Buy me a Coffee</span>
                </a>

                {/* Settings Button (Spotify account + own API credentials) */}
                <div className="relative group" data-tour="settings">
                    <button
                        onClick={openSettings}
                        className="p-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 text-white transition-all duration-300 hover:scale-105 hover:shadow-[0_0_20px_rgba(255,255,255,0.3)] shadow-lg"
                    >
                        <Settings size={24} className="stroke-[2.5]" />
                    </button>
                    <span className="absolute top-full right-0 mt-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/90 border border-white/10 text-white px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap pointer-events-none shadow-xl z-50">
                        Settings — Spotify login &amp; API credentials
                    </span>
                </div>

                {/* Library Sync Button */}
                <div className="relative group" data-tour="sync">
                    <button
                        onClick={handleSyncClick}
                        className="p-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 text-white transition-all duration-300 hover:scale-105 hover:shadow-[0_0_20px_rgba(255,255,255,0.3)] shadow-lg"
                    >
                        {syncState === 'syncing'
                            ? <Loader2 size={24} className="stroke-[2.5] animate-spin" />
                            : syncCount !== null ? <FolderCheck size={24} className="stroke-[2.5]" /> : <FolderSync size={24} className="stroke-[2.5]" />}
                    </button>
                    <span className="absolute top-full right-0 mt-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/90 border border-white/10 text-white px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap pointer-events-none shadow-xl z-50">
                        {syncState === 'syncing'
                            ? 'Scanning folder…'
                            : syncState === 'done'
                                ? `Synced! +${lastAdded} added · ${syncCount ?? 0} songs total`
                                : syncCount !== null
                                    ? `Library: ${syncCount} songs — click to add another folder`
                                    : 'Sync your music folder — songs you already have won\'t be downloaded again'}
                    </span>
                </div>

                {/* Help Button */}
                <button
                    data-tour="help"
                    onClick={() => setShowOnboarding(true)}
                    className="p-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 text-white transition-all duration-300 hover:scale-105 hover:shadow-[0_0_20px_rgba(255,255,255,0.3)] shadow-lg"
                    title="Show Info & Instructions"
                >
                    <HelpCircle size={24} className="stroke-[2.5]" />
                </button>
            </div>

            {/* Onboarding Overlay */}
            {showOnboarding && (
                <div className="absolute inset-0 z-50 backdrop-blur-md bg-black/40 flex items-center justify-center p-8">
                    <div className="bg-black/50 border border-white/10 rounded-3xl p-10 max-w-2xl w-full shadow-2xl relative backdrop-blur-xl">
                        <div className="flex flex-col items-center text-center">
                            <img src={MainLogo} alt="App Logo" className="h-32 mb-8 drop-shadow-2xl" />

                            <h1 className="text-3xl font-bold text-white mb-4">Welcome to LiberAudio</h1>

                            <div className="bg-red-500/10 border border-red-500/50 rounded-xl p-4 mb-6">
                                <h3 className="text-red-500 font-bold text-sm uppercase mb-1">Legal Disclaimer</h3>
                                <p className="text-xs text-red-200/80 leading-relaxed">
                                    This application is a <strong>Proof of Concept for Educational Purposes Only</strong>.
                                    By using this tool, you agree to respect the Terms of Service of all supported platforms.
                                    Do not use this tool to infringe on copyright. The authors assume no liability for misuse.
                                </p>
                            </div>

                            <div className="bg-blue-500/10 border border-blue-500/50 rounded-xl p-4 mb-6">
                                <h3 className="text-blue-400 font-bold text-sm uppercase mb-1">Playlist Access</h3>
                                <p className="text-xs text-blue-200/80 leading-relaxed">
                                    SoundCloud and YouTube playlists must be set to <strong>Public</strong>.
                                    For Spotify, log in via <strong>Settings</strong> (top right) to also access your
                                    Private and Collaborative playlists.
                                </p>
                            </div>

                            <p className="text-gray-400 mb-8 leading-relaxed">
                                Download your favorite music from Spotify, SoundCloud, and YouTube in high quality —
                                then sort it into your DJ Library: triage new tracks into Serato crates, rekordbox
                                and Apple Music playlists, with your hot cues and loops in view.
                            </p>

                            <div className="flex items-center space-x-3">
                                <button
                                    onClick={startTour}
                                    className="bg-white text-black hover:bg-gray-200 font-bold py-4 px-10 rounded-full text-lg transition-transform active:scale-95 shadow-xl"
                                >
                                    Show me around
                                </button>
                                <button
                                    onClick={dismissOnboarding}
                                    className="bg-white/10 hover:bg-white/20 border border-white/10 text-white font-bold py-4 px-10 rounded-full text-lg transition-transform active:scale-95"
                                >
                                    Skip
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Spotify (Left) */}
            <div
                data-tour="panel-spotify"
                className="flex-1 bg-black hover:bg-[#121212] transition-colors cursor-pointer group flex flex-col items-center justify-center border-r border-white/10 relative overflow-hidden"
                onClick={() => onSelectService('spotify')}
            >
                <div className="absolute inset-0 bg-spotify-green/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="z-10 text-center p-6 flex flex-col items-center">
                    <img src={SpotifyLogo} alt="Spotify" className="w-24 h-24 mb-6 object-contain drop-shadow-[0_0_30px_rgba(29,185,84,0.4)] group-hover:scale-110 transition-transform duration-300" />
                    <h2 className="text-3xl font-bold text-spotify-green tracking-wider uppercase mb-2">Spotify</h2>
                    <p className="text-gray-500 text-sm group-hover:text-gray-300 transition-colors">Download Playlists & Tracks</p>
                </div>
            </div>

            {/* SoundCloud (Middle) */}
            <div
                data-tour="panel-soundcloud"
                className="flex-1 bg-[#ff5500] hover:bg-[#ff6600] transition-colors cursor-pointer group flex flex-col items-center justify-center border-r border-white/10 relative"
                onClick={() => onSelectService('soundcloud')}
            >
                <div className="z-10 text-center p-6 flex flex-col items-center">
                    <img src={SoundcloudLogo} alt="SoundCloud" className="w-32 h-32 mb-6 object-contain drop-shadow-2xl group-hover:scale-110 transition-transform duration-300" />
                    <h2 className="text-3xl font-bold text-black tracking-wider uppercase mb-2">SoundCloud</h2>
                    <p className="text-black/70 text-sm font-bold">Download Playlists & Tracks</p>
                </div>
            </div>

            {/* YouTube (Right) */}
            <div
                data-tour="panel-youtube"
                className="flex-1 bg-[#ff0000] hover:bg-[#ff1a1a] transition-colors cursor-pointer group flex flex-col items-center justify-center border-r border-white/10 relative"
                onClick={() => onSelectService('youtube')}
            >
                <div className="z-10 text-center p-6 flex flex-col items-center">
                    <img src={YoutubeLogo} alt="YouTube" className="w-32 h-32 mb-6 object-contain drop-shadow-2xl group-hover:scale-110 transition-transform duration-300" />
                    <h2 className="text-3xl font-bold text-white tracking-wider uppercase mb-2">YouTube</h2>
                    <p className="text-white/70 text-sm font-bold">Download Playlists & Tracks</p>
                </div>
            </div>

            {/* DJ Library (Far Right) */}
            <div
                data-tour="panel-djlibrary"
                className="flex-1 bg-[#1a1025] hover:bg-[#241536] transition-colors cursor-pointer group flex flex-col items-center justify-center relative overflow-hidden"
                onClick={() => onSelectService('djlibrary')}
            >
                <div className="absolute inset-0 bg-violet-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="z-10 text-center p-6 flex flex-col items-center">
                    <Disc3 size={96} className="text-violet-400 mb-6 drop-shadow-[0_0_30px_rgba(167,139,250,0.4)] group-hover:scale-110 group-hover:rotate-180 transition-transform duration-700" />
                    <h2 className="text-3xl font-bold text-violet-400 tracking-wider uppercase mb-2">DJ Library</h2>
                    <p className="text-gray-500 text-sm group-hover:text-gray-300 transition-colors">Serato · Rekordbox · Apple Music</p>
                </div>
            </div>

            {/* Guided tour (after the welcome overlay's "Show me around") */}
            {showTour && !showOnboarding && (
                <SpotlightTour steps={HOME_TOUR} onClose={() => { markTourSeen('home'); setShowTour(false); }} />
            )}

            {/* Startup Toast (Dynamic) */}
            {serverConfig?.toast && serverConfig.toast.text !== 'None' && showToast && (
                <div className="fixed bottom-8 right-8 z-50 animate-in fade-in slide-in-from-bottom-10 duration-700">
                    <div className="bg-black/40 backdrop-blur-xl border border-white/10 p-6 rounded-2xl shadow-2xl relative max-w-sm">
                        <button
                            onClick={() => setShowToast(false)}
                            className="absolute -top-2 -right-2 bg-white text-black rounded-full p-1 hover:bg-gray-200 transition-colors shadow-lg"
                        >
                            <X size={14} className="stroke-[3]" />
                        </button>
                        <div className="flex items-start space-x-4">
                            <div>
                                <h3 className="text-white font-bold text-lg mb-1">Message from the Dev Team:</h3>
                                <p className="text-white/70 text-sm leading-relaxed mb-3">
                                    {serverConfig.toast.text}
                                </p>
                                {serverConfig.toast.link && serverConfig.toast.link !== 'None' && (
                                    <a
                                        href={serverConfig.toast.link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-block bg-white text-black px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide hover:scale-105 transition-transform"
                                    >
                                        Check it Out
                                    </a>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
