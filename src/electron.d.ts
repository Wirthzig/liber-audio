// --- DJ LIBRARY TYPES (mirror of electron/dj/model.ts) ---
export interface DJCue {
    type: 'cue' | 'loop';
    index: number;
    positionMs: number;
    endMs?: number;
    name?: string;
    color?: string;
}

export interface DJTrack {
    id: string;
    path: string | null;
    title: string;
    artist: string;
    album?: string;
    genre?: string;
    durationSec?: number;
    bpm?: number;
    key?: string;
    cues: DJCue[];
    fileExists?: boolean;
}

export interface DJCrate {
    name: string;
    path: string[];
    trackIds: string[];
}

export interface DJLibrary {
    source: 'serato' | 'rekordbox' | 'itunes';
    sourcePath: string;
    tracks: DJTrack[];
    crates: DJCrate[];
}

export interface DJLibraryHealth {
    trackCount: number;
    crateCount: number;
    missingFiles: number;
    tracksWithCues: number;
}

export interface DetectedLibraries {
    serato: string | null;
    rekordboxXml: string | null;
    itunesXml: string | null;
    rekordboxInstalled: boolean;
    rekordboxXmlMtimeMs: number | null;
    rekordboxDbMtimeMs: number | null;
}

export interface LoadedLibrary {
    library: DJLibrary;
    health: DJLibraryHealth;
}

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
    djDetectLibraries: () => Promise<{ success: boolean; detected?: DetectedLibraries; error?: string }>;
    djLoadLibraries: (req: { seratoPath?: string; rekordboxXmlPath?: string; itunesXmlPath?: string }) => Promise<{ success: boolean; libraries?: LoadedLibrary[]; errors?: string[]; error?: string }>;
    djSelectXml: (title: string) => Promise<string | null>;
    djOpenRekordbox: () => Promise<{ success: boolean; error?: string }>;
    djGetDestinations: () => Promise<DJDestination[]>;
    djSetDestinations: (destinations: DJDestination[]) => Promise<{ success: boolean; error?: string }>;
    djScanFolder: (folder: string) => Promise<{ success: boolean; tracks?: (DJTrack & { mtimeMs: number })[]; error?: string }>;
    djApplyTriage: (assignments: TriageAssignment[]) => Promise<TriageResult>;
    djRevealFile: (filePath: string) => Promise<{ success: boolean }>;
}

// --- DJ TRIAGE TYPES ---
export interface DJDestinationTarget {
    seratoCrate?: string;       // crate file base name incl. %% hierarchy
    musicPlaylist?: string;
    rekordboxPlaylist?: string;
}

export interface DJDestination {
    id: string;
    name: string;
    color: string;              // tailwind-ish hex for the button
    target: DJDestinationTarget;
}

export interface TriageAssignment {
    path: string;
    title: string;
    artist: string;
    targets: DJDestinationTarget[];
}

export interface TriageResult {
    serato: { crate: string; added: number; skipped: number }[];
    music: { playlist: string; added: number; errors: string[] }[];
    rekordbox: { xmlPath: string; playlists: number; tracks: number } | null;
    errors: string[];
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
