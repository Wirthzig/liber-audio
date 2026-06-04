export interface ElectronAPI {
    initDependencies: () => Promise<void>;
    selectFolder: (title?: string) => Promise<string | null>;
    searchYoutube: (query: { artist: string; title: string; duration?: number } | string) => Promise<string | null>;
    fetchMetadata: (url: string) => Promise<{ success: boolean; tracks?: any[]; error?: string }>;
    downloadSong: (data: { url: string; folder: string; artist: string; title: string }) => Promise<{ success: boolean; error?: string }>;
    scanLibrary: (folder: string) => Promise<{ success: boolean; files?: string[]; error?: string }>;
    spotifyLogin: () => Promise<{ success: boolean; error?: string }>;
    spotifyGetToken: () => Promise<string | null>;
    spotifyLogout: () => Promise<{ success: boolean; error?: string }>;
    getAnalyticsEnabled: () => Promise<boolean>;
    setAnalyticsEnabled: (enabled: boolean) => Promise<boolean>;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
