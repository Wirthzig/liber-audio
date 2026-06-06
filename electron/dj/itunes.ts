// --- iTUNES / APPLE MUSIC LIBRARY.XML PARSER (read-only) ---
// Parses the classic property-list library export. Music.app produces it via
// File > Library > Export Library (the modern .musiclibrary bundle itself is
// undocumented/binary, so the XML export is the supported read path).
//
// Plists encode dicts as alternating <key>/<value> element sequences, so we
// parse with preserveOrder and rebuild JS objects from the pairs.

import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import { DJCrate, DJLibrary, DJTrack } from './model';

// preserveOrder output: [{ tagName: [children], ':@'?: attrs }, ...]
const tagOf = (node: any): string => Object.keys(node).find(k => k !== ':@') || '';

const plistValue = (node: any): any => {
    const tag = tagOf(node);
    const children = node[tag];
    switch (tag) {
        case 'dict': {
            const obj: Record<string, any> = {};
            for (let i = 0; i < children.length; i += 2) {
                const keyNode = children[i];
                const valNode = children[i + 1];
                if (!valNode || tagOf(keyNode) !== 'key') break; // malformed — bail on this dict
                obj[text(keyNode)] = plistValue(valNode);
            }
            return obj;
        }
        case 'array': return children.map(plistValue);
        case 'integer': return parseInt(text(node), 10);
        case 'real': return parseFloat(text(node));
        case 'true': return true;
        case 'false': return false;
        case 'string': case 'date': case 'data': default: return text(node);
    }
};

const text = (node: any): string => {
    const children = node[tagOf(node)];
    if (!Array.isArray(children)) return '';
    return children.map((c: any) => c['#text'] ?? '').join('');
};

export const loadItunesXml = (xmlPath: string): DJLibrary => {
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: true });
    const doc = parser.parse(xml);

    const plistNode = doc.find((n: any) => tagOf(n) === 'plist');
    const rootDict = plistNode?.plist?.find((n: any) => tagOf(n) === 'dict');
    if (!rootDict) throw new Error(`${xmlPath} is not an iTunes/Music library export (no plist dict)`);

    const lib = plistValue(rootDict);
    const tracksDict: Record<string, any> = lib['Tracks'] || {};
    const playlists: any[] = lib['Playlists'] || [];

    const tracks: DJTrack[] = [];
    for (const [id, t] of Object.entries(tracksDict)) {
        let filePath: string | null = null;
        if (typeof t['Location'] === 'string') {
            try { filePath = decodeURIComponent(new URL(t['Location']).pathname); } catch { /* leave null */ }
        }
        tracks.push({
            id,
            path: filePath,
            title: t['Name'] || 'Unknown Title',
            artist: t['Artist'] || 'Unknown Artist',
            album: t['Album'] || undefined,
            genre: t['Genre'] || undefined,
            durationSec: typeof t['Total Time'] === 'number' ? t['Total Time'] / 1000 : undefined,
            bpm: typeof t['BPM'] === 'number' ? t['BPM'] : undefined,
            cues: [], // iTunes has no cue concept
        });
    }

    const crates: DJCrate[] = [];
    // Folder hierarchy: playlists reference their folder via Parent Persistent ID
    const folderNames = new Map<string, string>(); // Playlist Persistent ID -> Name (folders only)
    for (const p of playlists) {
        if (p['Folder'] === true && p['Playlist Persistent ID']) {
            folderNames.set(p['Playlist Persistent ID'], p['Name'] || 'Folder');
        }
    }
    for (const p of playlists) {
        // Skip system/auto playlists (Library, Downloaded, Music, …) and folders
        if (p['Master'] === true || p['Distinguished Kind'] !== undefined || p['Folder'] === true) continue;
        const parent = p['Parent Persistent ID'] ? folderNames.get(p['Parent Persistent ID']) : undefined;
        crates.push({
            name: p['Name'] || 'Untitled',
            path: parent ? [parent] : [],
            trackIds: (p['Playlist Items'] || [])
                .map((item: any) => String(item['Track ID'] ?? ''))
                .filter(Boolean),
        });
    }

    return { source: 'itunes', sourcePath: xmlPath, tracks, crates };
};
