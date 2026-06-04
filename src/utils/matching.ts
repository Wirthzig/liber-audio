// Normalize a string for fuzzy matching: lowercase, strip accents and all
// punctuation/whitespace. Mirrors the normalization used by the main-process
// search so "Sync Folder" matches files named "Artist - Title.m4a".
export const normalizeForMatch = (str: string): string =>
    str
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');

// How many yt-dlp downloads run at the same time
export const DOWNLOAD_CONCURRENCY = 3;
