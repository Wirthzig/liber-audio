import { motion } from 'framer-motion';
import { Check, Copy, ExternalLink, Loader2, LogIn, LogOut, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SpotifyConfig } from '../electron';

// Any component can open the settings panel (e.g. the triage done screen
// after a Spotify rate-limit) without prop-drilling through the view tree.
export const openSettings = () => window.dispatchEvent(new Event('liberaudio:open-settings'));

export function SettingsOverlay({ onClose }: { onClose: () => void }) {
    const [config, setConfig] = useState<SpotifyConfig | null>(null);
    const [clientIdInput, setClientIdInput] = useState('');
    const [busy, setBusy] = useState<'login' | 'save' | null>(null);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showByo, setShowByo] = useState(false);

    const refresh = () => window.electronAPI.spotifyGetConfig().then(c => {
        setConfig(c);
        setClientIdInput(c.customClientId ?? '');
        // Surface the BYO section automatically when it's relevant
        if (c.customClientId || c.limited) setShowByo(true);
    });
    useEffect(() => { refresh(); }, []);

    const login = async () => {
        setBusy('login');
        setError(null);
        const res = await window.electronAPI.spotifyLogin();
        if (!res.success) setError(res.error ?? 'Login failed');
        await refresh();
        setBusy(null);
    };

    const logout = async () => {
        await window.electronAPI.spotifyLogout();
        await refresh();
    };

    // Save the pasted Client ID (or empty = back to shared), then re-login —
    // tokens are bound to the client ID, so a session restart is required.
    const saveClientId = async (id: string | null) => {
        setBusy('save');
        setError(null);
        const res = await window.electronAPI.spotifySetClientId(id);
        if (!res.success) {
            setError(res.error ?? 'Could not save');
            setBusy(null);
            return;
        }
        await refresh();
        setBusy(null);
        await login();
    };

    const copyRedirect = () => {
        if (!config) return;
        navigator.clipboard.writeText(config.redirectUri);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] backdrop-blur-xl bg-black/70 flex items-center justify-center p-8"
            onClick={onClose}
        >
            <div
                className="w-full max-w-xl bg-white/5 border border-white/10 rounded-3xl p-8 max-h-[85vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold">Settings</h2>
                    <button onClick={onClose} className="p-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* --- SPOTIFY --- */}
                <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-3">Spotify</p>

                {config === null ? (
                    <Loader2 size={20} className="animate-spin text-gray-500" />
                ) : (
                    <>
                        {/* Account */}
                        <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-3">
                            <div>
                                <p className="text-sm font-bold">{config.loggedIn ? 'Logged in' : 'Not logged in'}</p>
                                <p className="text-xs text-gray-500">
                                    {config.customClientId ? 'Using your own API app — no shared limits' : 'Using the shared connection'}
                                </p>
                            </div>
                            <button
                                onClick={config.loggedIn ? logout : login}
                                disabled={busy !== null}
                                className="flex items-center space-x-2 px-4 py-2 rounded-full bg-[#1DB954]/20 hover:bg-[#1DB954]/30 border border-[#1DB954]/40 text-[#1DB954] text-sm font-bold transition-colors disabled:opacity-40"
                            >
                                {busy === 'login'
                                    ? <Loader2 size={14} className="animate-spin" />
                                    : config.loggedIn ? <LogOut size={14} /> : <LogIn size={14} />}
                                <span>{busy === 'login' ? 'Check your browser…' : config.loggedIn ? 'Log out' : 'Log in'}</span>
                            </button>
                        </div>

                        {/* Limited warning → the BYO pitch */}
                        {config.limited && !config.customClientId && (
                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 mb-3 text-xs text-amber-200/90 leading-relaxed">
                                <p className="font-bold text-amber-300 mb-1">The shared Spotify connection has hit its limits.</p>
                                Set up your own free Spotify API app below — takes about 2 minutes, removes all
                                shared limits, and unlocks unlimited Spotify integrations in this tool.
                            </div>
                        )}

                        {/* BYO client ID */}
                        <button
                            onClick={() => setShowByo(p => !p)}
                            className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-gray-300 font-bold mb-2 transition-colors"
                        >
                            {showByo ? '▾' : '▸'} Use your own Spotify API app
                        </button>
                        {showByo && (
                            <div className="bg-black/30 border border-white/10 rounded-xl p-4 space-y-4 text-sm">
                                <p className="text-xs text-gray-400 leading-relaxed">
                                    The built-in connection is shared and limited by Spotify. With your own (free)
                                    API app, the limits are yours alone. You need a Spotify Premium account.
                                </p>

                                <div className="space-y-3">
                                    <div className="flex items-start space-x-3">
                                        <span className="shrink-0 w-5 h-5 rounded-full bg-white/10 border border-white/10 text-[10px] font-black flex items-center justify-center">1</span>
                                        <div className="flex-1">
                                            <p className="text-xs text-gray-300">Open the Spotify Developer Dashboard and click <strong>Create app</strong>.</p>
                                            <a
                                                href="https://developer.spotify.com/dashboard"
                                                target="_blank" rel="noopener noreferrer"
                                                className="inline-flex items-center space-x-1.5 mt-1.5 text-xs bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg px-3 py-1.5 font-bold transition-colors"
                                            >
                                                <ExternalLink size={11} /> <span>Open Dashboard</span>
                                            </a>
                                        </div>
                                    </div>

                                    <div className="flex items-start space-x-3">
                                        <span className="shrink-0 w-5 h-5 rounded-full bg-white/10 border border-white/10 text-[10px] font-black flex items-center justify-center">2</span>
                                        <div className="flex-1">
                                            <p className="text-xs text-gray-300 mb-1.5">Name it anything (e.g. "LiberAudio") and paste this as the <strong>Redirect URI</strong>:</p>
                                            <button
                                                onClick={copyRedirect}
                                                className="flex items-center space-x-2 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 font-mono text-xs text-gray-300 hover:border-white/30 transition-colors"
                                            >
                                                <span>{config.redirectUri}</span>
                                                {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} className="text-gray-500" />}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex items-start space-x-3">
                                        <span className="shrink-0 w-5 h-5 rounded-full bg-white/10 border border-white/10 text-[10px] font-black flex items-center justify-center">3</span>
                                        <div className="flex-1">
                                            <p className="text-xs text-gray-300 mb-1.5">Copy the app's <strong>Client ID</strong> from its settings page and paste it here:</p>
                                            <div className="flex items-center space-x-2">
                                                <input
                                                    value={clientIdInput}
                                                    onChange={e => setClientIdInput(e.target.value)}
                                                    placeholder="Client ID"
                                                    spellCheck={false}
                                                    className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs placeholder:text-gray-600 focus:outline-none focus:border-[#1DB954]/50 transition-colors"
                                                />
                                                <button
                                                    onClick={() => saveClientId(clientIdInput)}
                                                    disabled={!clientIdInput.trim() || busy !== null || clientIdInput.trim() === config.customClientId}
                                                    className="px-4 py-2 rounded-lg bg-[#1DB954]/20 hover:bg-[#1DB954]/30 border border-[#1DB954]/40 text-[#1DB954] text-xs font-bold transition-colors disabled:opacity-40"
                                                >
                                                    {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : 'Save & log in'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {config.customClientId && (
                                    <button
                                        onClick={() => saveClientId(null)}
                                        disabled={busy !== null}
                                        className="text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors disabled:opacity-40"
                                    >
                                        Switch back to the shared connection
                                    </button>
                                )}
                            </div>
                        )}

                        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
                    </>
                )}
            </div>
        </motion.div>
    );
}
