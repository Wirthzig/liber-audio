import { normalizeForMatch } from './matching';

// Persistent index of the user's local music library.
// The user can sync any number of folders (home view); we scan their audio
// files and remember the normalized "artist - title" names. Every playlist
// scan can then mark songs the user already owns — across Spotify,
// SoundCloud and YouTube. Each sync APPENDS to the index; on app start all
// remembered folders are re-scanned so the index stays accurate.

const FOLDERS_KEY = 'library_folders';
const LEGACY_FOLDER_KEY = 'library_folder';
const INDEX_KEY = 'library_index';

export class LibraryManager {
    private static cachedIndex: Set<string> | null = null;
    private static refreshed = false;

    static getFolders(): string[] {
        try {
            const raw = localStorage.getItem(FOLDERS_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {
            console.error('Failed to parse library folders', e);
        }
        // Migrate from the old single-folder format
        const legacy = localStorage.getItem(LEGACY_FOLDER_KEY);
        return legacy ? [legacy] : [];
    }

    static getIndex(): Set<string> {
        if (this.cachedIndex) return this.cachedIndex;
        try {
            const raw = localStorage.getItem(INDEX_KEY);
            if (raw) {
                this.cachedIndex = new Set(JSON.parse(raw));
                return this.cachedIndex;
            }
        } catch (e) {
            console.error('Failed to parse library index', e);
        }
        this.cachedIndex = new Set();
        return this.cachedIndex;
    }

    private static persist(folders: string[], index: Set<string>) {
        localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
        localStorage.setItem(INDEX_KEY, JSON.stringify([...index]));
        localStorage.removeItem(LEGACY_FOLDER_KEY);
        this.cachedIndex = index;
    }

    /** Scan a folder and APPEND its audio files to the library index. */
    static async sync(folder: string): Promise<{ success: boolean; count?: number; added?: number; error?: string }> {
        const res = await window.electronAPI.scanLibrary(folder);
        if (!res.success || !res.files) {
            return { success: false, error: res.error || 'Folder scan failed' };
        }
        const index = new Set(this.getIndex());
        const before = index.size;
        res.files.map(normalizeForMatch).forEach(n => { if (n) index.add(n); });

        const folders = Array.from(new Set([...this.getFolders(), folder]));
        this.persist(folders, index);
        return { success: true, count: index.size, added: index.size - before };
    }

    /** Re-scan all remembered folders and rebuild the index (app start). */
    static async refresh(): Promise<void> {
        if (this.refreshed) return; // once per session — views remount often
        this.refreshed = true;
        const folders = this.getFolders();
        if (folders.length > 0) {
            const index = new Set<string>();
            for (const folder of folders) {
                try {
                    const res = await window.electronAPI.scanLibrary(folder);
                    if (res.success && res.files) {
                        res.files.map(normalizeForMatch).forEach(n => { if (n) index.add(n); });
                    }
                } catch (e) {
                    console.warn(`Library refresh failed for ${folder}`, e);
                }
            }
            this.persist(folders, index);
        }
        await this.mergeDjLibraries();
    }

    /** Merge every track from the DJ libraries (Serato/rekordbox/iTunes)
     *  into the owned index — in memory only, so it can never go stale in
     *  localStorage. Playlist scans then skip songs the DJ already has. */
    private static async mergeDjLibraries(): Promise<void> {
        try {
            const res = await window.electronAPI.djOwnedTracks();
            if (!res.success || !res.tracks) return;
            const index = this.getIndex();
            for (const t of res.tracks) {
                const n = normalizeForMatch(`${t.artist} - ${t.title}`);
                if (n) index.add(n);
            }
            this.cachedIndex = index;
        } catch { /* DJ libraries unavailable — the folder index still applies */ }
    }

    /** Does the library contain this song? */
    static has(artist: string, title: string): boolean {
        return this.getIndex().has(normalizeForMatch(`${artist} - ${title}`));
    }

    static clear() {
        localStorage.removeItem(FOLDERS_KEY);
        localStorage.removeItem(LEGACY_FOLDER_KEY);
        localStorage.removeItem(INDEX_KEY);
        this.cachedIndex = null;
    }
}
