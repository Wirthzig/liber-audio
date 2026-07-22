import { useEffect, useState } from 'react';
import MainLogo from '../assets/main-logo.png';

interface Props {
    onDismiss: () => void;
}

export function OnboardingOverlay({ onDismiss }: Props) {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Check local storage
        const hasSeen = localStorage.getItem('has_seen_onboarding');
        if (!hasSeen) {
            setIsVisible(true);
        }
    }, []);

    const handleDismiss = () => {
        localStorage.setItem('has_seen_onboarding', 'true');
        setIsVisible(false);
        onDismiss();
    };

    if (!isVisible) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md transition-opacity duration-500"
            onClick={handleDismiss}
        >
            <div
                className="bg-white/10 border border-white/20 p-8 rounded-3xl shadow-2xl max-w-lg text-center backdrop-blur-xl relative overflow-hidden group"
                onClick={e => e.stopPropagation()}
            >
                {/* Liquid effect background (subtle gradient animation) */}
                <div className="absolute inset-0 bg-gradient-to-br from-spotify-green/10 via-transparent to-blue-500/10 opacity-50 group-hover:opacity-75 transition-opacity" />

                <div className="relative z-10 flex flex-col items-center">
                    <img src={MainLogo} alt="App Logo" className="w-32 h-32 mb-6 object-contain drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]" />

                    <h2 className="text-3xl font-bold text-white mb-4 tracking-tight">Welcome to LiberAudio</h2>

                    <p className="text-gray-300 mb-6 leading-relaxed">
                        Download your favorite tracks in high quality.
                        Just paste a link and we handle the rest!
                    </p>

                    <button
                        onClick={handleDismiss}
                        className="px-8 py-3 bg-white text-black font-bold rounded-full hover:bg-gray-200 transition-transform transform active:scale-95 shadow-lg"
                    >
                        Get Started
                    </button>
                </div>
            </div>
        </div>
    );
}
