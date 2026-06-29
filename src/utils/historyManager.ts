export interface HistoryItem {
    id: string;
    source: 'spotify' | 'soundcloud' | 'youtube';
    title: string;
    artist: string;
    timestamp: number;
}

const STORAGE_KEY = 'global_download_history';
const OLD_KEY = 'download_history';

// In-memory history cache.
//
// The previous implementation re-parsed the entire localStorage blob (and
// re-ran the legacy migration) on EVERY has()/add() call, and rewrote the
// whole array on every add(). Across a download batch that is O(N²) in the
// growing history size — the app got slower the longer it ran and effectively
// needed a restart after a playlist. We now load once, keep an array + a Set
// of ids for O(1) lookups, mutate in memory, and persist with a debounced
// write. The legacy migration runs exactly once.
export class HistoryManager {
    private static items: HistoryItem[] | null = null;
    private static ids = new Set<string>();
    private static flushTimer: ReturnType<typeof setTimeout> | null = null;
    private static unloadBound = false;

    private static load(): HistoryItem[] {
        if (this.items !== null) return this.items;

        let history: HistoryItem[] = [];
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) history = JSON.parse(raw);
        } catch (e) {
            console.error('Failed to parse history', e);
        }

        // One-time migration of the legacy id-only history, then delete the old
        // key so this never runs again.
        try {
            const oldRaw = localStorage.getItem(OLD_KEY);
            if (oldRaw) {
                const oldIds: string[] = JSON.parse(oldRaw);
                const existing = new Set(history.map(h => h.id));
                for (const id of oldIds) {
                    if (!existing.has(id)) {
                        history.push({ id, source: 'spotify', title: 'Unknown Title', artist: 'Unknown Artist', timestamp: Date.now() });
                        existing.add(id);
                    }
                }
                localStorage.removeItem(OLD_KEY);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
            }
        } catch (e) {
            console.error('Migration failed', e);
        }

        this.items = history;
        this.ids = new Set(history.map(h => h.id));
        this.bindUnloadFlush();
        return this.items;
    }

    // Persist on tab/window teardown so a pending debounced write isn't lost.
    private static bindUnloadFlush() {
        if (this.unloadBound || typeof window === 'undefined') return;
        this.unloadBound = true;
        window.addEventListener('beforeunload', () => this.flush());
    }

    private static schedulePersist() {
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => this.flush(), 500);
    }

    private static flush() {
        if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
        if (this.items === null) return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
        } catch (e) {
            console.error('Failed to persist history', e);
        }
    }

    /** Returns a copy so callers can't mutate the internal cache. */
    static getHistory(): HistoryItem[] {
        return [...this.load()];
    }

    static add(item: HistoryItem) {
        this.load();
        if (!this.ids.has(item.id)) {
            this.items!.push(item);
            this.ids.add(item.id);
            this.schedulePersist();
        }
    }

    static remove(id: string) {
        this.load();
        if (this.ids.has(id)) {
            this.items = this.items!.filter(h => h.id !== id);
            this.ids.delete(id);
            this.schedulePersist();
        }
    }

    static has(id: string): boolean {
        this.load();
        return this.ids.has(id);
    }
}
