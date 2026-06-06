// --- DJ LIBRARY CANONICAL MODEL ---
// One internal shape for every source (Serato, Rekordbox, iTunes/Music).
// Parsers map their native formats INTO this; everything downstream
// (UI, future sync engine, set brain) only ever sees these types.

export type DJSource = 'serato' | 'rekordbox' | 'itunes';

export interface DJCue {
    type: 'cue' | 'loop';
    index: number;        // hot cue slot / loop slot (-1 = memory cue)
    positionMs: number;
    endMs?: number;       // loops only
    name?: string;
    color?: string;       // hex like #FF0000
}

export interface DJTrack {
    id: string;           // source-local id (path for Serato, TrackID for RB, Track ID for iTunes)
    path: string | null;  // absolute file path, null if not resolvable
    title: string;
    artist: string;
    album?: string;
    genre?: string;
    durationSec?: number;
    bpm?: number;
    key?: string;         // as stored by the source (e.g. "Am", "8A", "1d")
    cues: DJCue[];
    fileExists?: boolean; // filled by the health check
}

export interface DJCrate {
    name: string;
    path: string[];       // folder hierarchy, e.g. ['House', 'Peak Time']
    trackIds: string[];   // reference DJTrack.id within the same library
}

export interface DJLibrary {
    source: DJSource;
    sourcePath: string;   // where we read it from
    tracks: DJTrack[];
    crates: DJCrate[];
}

export interface DJLibraryHealth {
    trackCount: number;
    crateCount: number;
    missingFiles: number;
    tracksWithCues: number;
}
