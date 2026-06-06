// --- DJ LIBRARY MODULE ENTRY ---
// Detection of installed libraries + load orchestration + health check.
// Read-only by design: Phase 1 never writes to any DJ library.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadItunesXml } from './itunes';
import { DJLibrary, DJLibraryHealth } from './model';
import { loadRekordboxXml } from './rekordbox';
import { loadSeratoLibrary } from './serato';

export interface DetectedLibraries {
    serato: string | null;       // _Serato_ folder containing "database V2"
    rekordboxXml: string | null; // most recent rekordbox.xml export found
    itunesXml: string | null;    // iTunes/Music Library.xml export
    rekordboxInstalled: boolean; // master.db exists → user has rekordbox but maybe no export yet
    // Staleness check: if the rekordbox DB changed AFTER the xml export, the
    // export no longer reflects the current library and should be re-done.
    rekordboxXmlMtimeMs: number | null;
    rekordboxDbMtimeMs: number | null;
}

const HOME = os.homedir();

const newestExisting = (candidates: string[]): string | null => {
    let best: { p: string; mtime: number } | null = null;
    for (const p of candidates) {
        try {
            const st = fs.statSync(p);
            if (st.isFile() && (!best || st.mtimeMs > best.mtime)) best = { p, mtime: st.mtimeMs };
        } catch { /* not there */ }
    }
    return best?.p ?? null;
};

export const detectLibraries = (): DetectedLibraries => {
    const seratoRoot = path.join(HOME, 'Music', '_Serato_');
    const serato = fs.existsSync(path.join(seratoRoot, 'database V2')) ? seratoRoot : null;

    // rekordbox.xml lives wherever the user exported it — check common spots
    const rekordboxXml = newestExisting([
        path.join(HOME, 'Documents', 'rekordbox.xml'),
        path.join(HOME, 'Desktop', 'rekordbox.xml'),
        path.join(HOME, 'Downloads', 'rekordbox.xml'),
        path.join(HOME, 'Music', 'rekordbox.xml'),
    ]);

    const itunesXml = newestExisting([
        path.join(HOME, 'Music', 'iTunes', 'iTunes Music Library.xml'),
        path.join(HOME, 'Music', 'iTunes', 'iTunes Library.xml'),
        path.join(HOME, 'Music', 'Library.xml'),
        path.join(HOME, 'Documents', 'Library.xml'),
        path.join(HOME, 'Desktop', 'Library.xml'),
        path.join(HOME, 'Downloads', 'Library.xml'),
    ]);

    const rekordboxInstalled = fs.existsSync(path.join(HOME, 'Library', 'Pioneer', 'rekordbox'));

    const mtimeOf = (p: string | null): number | null => {
        if (!p) return null;
        try { return fs.statSync(p).mtimeMs; } catch { return null; }
    };
    // master.db / master.backup.db mtime tells us when rekordbox last wrote
    const dbCandidates = ['master.db', 'master.backup.db']
        .map(f => path.join(HOME, 'Library', 'Pioneer', 'rekordbox', f));
    const rekordboxDbMtimeMs = dbCandidates.map(mtimeOf).reduce<number | null>(
        (a, b) => (a !== null && b !== null ? Math.max(a, b) : a ?? b), null);

    return {
        serato, rekordboxXml, itunesXml, rekordboxInstalled,
        rekordboxXmlMtimeMs: mtimeOf(rekordboxXml),
        rekordboxDbMtimeMs,
    };
};

export const computeHealth = (lib: DJLibrary): DJLibraryHealth => {
    let missingFiles = 0;
    let tracksWithCues = 0;
    for (const t of lib.tracks) {
        if (t.path) {
            t.fileExists = fs.existsSync(t.path);
            if (!t.fileExists) missingFiles++;
        }
        if (t.cues.length > 0) tracksWithCues++;
    }
    return {
        trackCount: lib.tracks.length,
        crateCount: lib.crates.length,
        missingFiles,
        tracksWithCues,
    };
};

export interface LoadedLibrary {
    library: DJLibrary;
    health: DJLibraryHealth;
}

export interface LoadRequest {
    seratoPath?: string;
    rekordboxXmlPath?: string;
    itunesXmlPath?: string;
}

export const loadLibraries = (req: LoadRequest): { libraries: LoadedLibrary[]; errors: string[] } => {
    const libraries: LoadedLibrary[] = [];
    const errors: string[] = [];

    const attempt = (label: string, fn: () => DJLibrary) => {
        try {
            const library = fn();
            libraries.push({ library, health: computeHealth(library) });
            console.log(`[DJ] Loaded ${label}: ${library.tracks.length} tracks, ${library.crates.length} crates`);
        } catch (e: any) {
            console.error(`[DJ] Failed to load ${label}:`, e);
            errors.push(`${label}: ${e.message}`);
        }
    };

    if (req.seratoPath) attempt('Serato', () => loadSeratoLibrary(req.seratoPath!));
    if (req.rekordboxXmlPath) attempt('Rekordbox', () => loadRekordboxXml(req.rekordboxXmlPath!));
    if (req.itunesXmlPath) attempt('iTunes/Music', () => loadItunesXml(req.itunesXmlPath!));

    return { libraries, errors };
};
