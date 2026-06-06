import { useEffect, useState } from 'react';
import { DJLibraryView } from './components/DJLibraryView';
import { OnboardingOverlay } from './components/OnboardingOverlay';
import { SoundCloudView } from './components/SoundCloudView';
import { SplitScreen } from './components/SplitScreen';
import { SpotifyView } from './components/SpotifyView';
import { YoutubeView } from './components/YoutubeView';

function App() {
  const [view, setView] = useState<'home' | 'spotify' | 'soundcloud' | 'youtube' | 'djlibrary'>('home');
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [serverConfig, setServerConfig] = useState<{ release?: { text: string; link?: string }, toast?: { text: string; link?: string } } | null>(null);

  useEffect(() => {
    // Init backend dependencies on mount (global)
    if (window.electronAPI) {
      window.electronAPI.initDependencies().catch(console.error);
    }

    // Fetch Server Config (Background)
    fetch('https://universal-music-downloader.onrender.com/config')
      .then(res => res.json())
      .then(data => setServerConfig(data))
      .catch(e => console.error("Config fetch failed:", e));
  }, []);

  const handleServiceSelect = (service: 'spotify' | 'soundcloud' | 'youtube' | 'djlibrary') => {
    setView(service);
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans overflow-hidden">

      {/* 1. Onboarding Overlay (Only shows if first time, logic handled inside component) */}
      {view === 'spotify' && showOnboarding && (
        <OnboardingOverlay onDismiss={() => setShowOnboarding(false)} />
      )}

      {/* 2. Routing */}
      {view === 'home' && <SplitScreen onSelectService={handleServiceSelect} serverConfig={serverConfig} />}

      {view === 'spotify' && <SpotifyView onBack={() => setView('home')} />}
      {view === 'soundcloud' && <SoundCloudView onBack={() => setView('home')} />}
      {view === 'youtube' && <YoutubeView onBack={() => setView('home')} />}
      {view === 'djlibrary' && <DJLibraryView onBack={() => setView('home')} />}

    </div>
  );
}

export default App;
