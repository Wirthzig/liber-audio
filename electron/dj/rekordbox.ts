// --- REKORDBOX XML PARSER (read-only) ---
// Parses the official `rekordbox.xml` collection export (DJ_PLAYLISTS format).
// This is Pioneer's supported interchange path — no encrypted master.db access
// needed. The user exports it via rekordbox: File > Export Collection in xml.
//
// TRACK attributes carry metadata (AverageBpm, Tonality, Location as file://
// URL); child POSITION_MARK elements are cues/loops (Type 0 = cue, 4 = loop,
// Num -1 = memory cue, 0-7 = hot cue), Start/End in SECONDS (float).

import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import { DJCrate, DJCue, DJLibrary, DJTrack } from './model';

const asArray = <T>(v: T | T[] | undefined): T[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];

const locationToPath = (location: string): string | null => {
    // "file://localhost/Users/me/Music/track.mp3" (URL-encoded)
    try {
        const url = new URL(location);
        return decodeURIComponent(url.pathname);
    } catch {
        return null;
    }
};

const markToCue = (mark: any): DJCue | null => {
    const start = parseFloat(mark['@_Start']);
    if (isNaN(start)) return null;
    const num = parseInt(mark['@_Num'], 10);
    const isLoop = mark['@_Type'] === '4' || mark['@_End'] !== undefined;
    const cue: DJCue = {
        type: isLoop ? 'loop' : 'cue',
        index: isNaN(num) ? -1 : num,
        positionMs: Math.round(start * 1000),
        name: mark['@_Name'] || undefined,
    };
    if (isLoop && mark['@_End'] !== undefined) {
        const end = parseFloat(mark['@_End']);
        if (!isNaN(end)) cue.endMs = Math.round(end * 1000);
    }
    const [r, g, b] = [mark['@_Red'], mark['@_Green'], mark['@_Blue']].map(v => parseInt(v, 10));
    if (![r, g, b].some(isNaN)) {
        cue.color = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    return cue;
};

// PLAYLISTS is a tree of NODE elements: Type 0 = folder, Type 1 = playlist.
// Playlist TRACK children reference collection tracks via Key (KeyType 0 =
// TrackID, KeyType 1 = Location path).
const walkPlaylists = (node: any, parents: string[], crates: DJCrate[]) => {
    for (const child of asArray<any>(node?.NODE)) {
        const name = child['@_Name'] || 'Untitled';
        if (child['@_Type'] === '1' || child['@_Type'] === 1) {
            const keyType = String(child['@_KeyType'] ?? '0');
            const trackIds = asArray<any>(child.TRACK)
                .map(t => String(t['@_Key'] ?? ''))
                .filter(Boolean)
                .map(key => keyType === '1' ? (locationToPath(key) ?? key) : key);
            crates.push({ name, path: parents, trackIds });
        } else {
            walkPlaylists(child, name === 'ROOT' ? parents : [...parents, name], crates);
        }
    }
};

export const loadRekordboxXml = (xmlPath: string): DJLibrary => {
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        parseAttributeValue: false, // keep everything string, we convert ourselves
        isArray: (name) => ['TRACK', 'NODE', 'POSITION_MARK', 'TEMPO'].includes(name),
    });
    const doc = parser.parse(xml);
    const root = doc?.DJ_PLAYLISTS;
    if (!root) throw new Error(`${xmlPath} is not a rekordbox collection export (no DJ_PLAYLISTS root)`);

    const tracks: DJTrack[] = [];
    const idByLocation = new Map<string, string>();

    for (const t of asArray<any>(root.COLLECTION?.TRACK)) {
        const id = String(t['@_TrackID'] ?? '');
        if (!id) continue;
        const filePath = t['@_Location'] ? locationToPath(String(t['@_Location'])) : null;
        if (filePath) idByLocation.set(filePath, id);

        const bpm = parseFloat(t['@_AverageBpm']);
        const duration = parseFloat(t['@_TotalTime']);
        tracks.push({
            id,
            path: filePath,
            title: t['@_Name'] || 'Unknown Title',
            artist: t['@_Artist'] || 'Unknown Artist',
            album: t['@_Album'] || undefined,
            genre: t['@_Genre'] || undefined,
            durationSec: isNaN(duration) ? undefined : duration,
            bpm: isNaN(bpm) || bpm === 0 ? undefined : bpm,
            key: t['@_Tonality'] || undefined,
            cues: asArray<any>(t.POSITION_MARK).map(markToCue).filter((c): c is DJCue => c !== null),
        });
    }

    const crates: DJCrate[] = [];
    walkPlaylists(root.PLAYLISTS, [], crates);
    // Location-keyed playlist refs → normalize to TrackIDs where we can
    for (const crate of crates) {
        crate.trackIds = crate.trackIds.map(ref => idByLocation.get(ref) ?? ref);
    }

    return { source: 'rekordbox', sourcePath: xmlPath, tracks, crates };
};
