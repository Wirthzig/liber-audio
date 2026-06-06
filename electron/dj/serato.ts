// --- SERATO LIBRARY PARSER (read-only) ---
// Parses the binary TLV format used by `database V2` and `Subcrates/*.crate`
// inside the `_Serato_` folder. Format documented by the Mixxx wiki
// (Serato Database Format) and Holzhaus/serato-tags — original code, spec only.
//
// Every record is:  4-byte ASCII tag | 4-byte big-endian length | payload
// The first character of the tag encodes the payload type:
//   o = nested object (recurse), t/p = UTF-16BE text, u = uint32, s = uint16,
//   b = single byte, v = version string (UTF-16BE), r = uint32

import fs from 'fs';
import path from 'path';
import { DJCrate, DJLibrary, DJTrack } from './model';

interface TLVField {
    tag: string;
    buf: Buffer;
}

const readFields = (buf: Buffer): TLVField[] => {
    const fields: TLVField[] = [];
    let off = 0;
    // Tolerant walker: stop at anything that can't be a full record instead
    // of throwing — Serato sometimes appends padding/unknown trailing bytes.
    while (off + 8 <= buf.length) {
        const tag = buf.toString('ascii', off, off + 4);
        const len = buf.readUInt32BE(off + 4);
        if (!/^[\x20-\x7e]{4}$/.test(tag) || off + 8 + len > buf.length) break;
        fields.push({ tag, buf: buf.subarray(off + 8, off + 8 + len) });
        off += 8 + len;
    }
    return fields;
};

// Buffer has no native utf16be — swap byte pairs, then decode as utf16le
const utf16be = (buf: Buffer): string => {
    const swapped = Buffer.from(buf);
    swapped.swap16();
    return swapped.toString('utf16le').replace(/\0+$/, '');
};

const fieldText = (f: TLVField): string => utf16be(f.buf);

// Serato stores paths relative to the volume root WITHOUT a leading slash
// (e.g. "Users/alex/Music/track.mp3"). On the boot volume that means "/...";
// tracks on external drives live under /Volumes/<name>/... which Serato also
// stores volume-relative inside that drive's own _Serato_ folder.
const resolveSeratoPath = (p: string, seratoRoot: string): string => {
    if (p.startsWith('/')) return p;
    // _Serato_ on an external volume → resolve against that volume
    const volMatch = seratoRoot.match(/^(\/Volumes\/[^/]+)\//);
    return volMatch ? path.join(volMatch[1], p) : '/' + p;
};

const parseDuration = (tlen: string): number | undefined => {
    // "MM:SS.mmm" or "MM:SS"
    const m = tlen.match(/^(\d+):(\d+(?:\.\d+)?)/);
    if (!m) return undefined;
    return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
};

const parseDatabase = (dbPath: string, seratoRoot: string): Map<string, DJTrack> => {
    const tracks = new Map<string, DJTrack>();
    const buf = fs.readFileSync(dbPath);

    for (const record of readFields(buf)) {
        if (record.tag !== 'otrk') continue;

        const t: Partial<DJTrack> = {};
        for (const f of readFields(record.buf)) {
            switch (f.tag) {
                case 'pfil': t.path = resolveSeratoPath(fieldText(f), seratoRoot); break;
                case 'tsng': t.title = fieldText(f); break;
                case 'tart': t.artist = fieldText(f); break;
                case 'talb': t.album = fieldText(f); break;
                case 'tgen': t.genre = fieldText(f); break;
                case 'tlen': t.durationSec = parseDuration(fieldText(f)); break;
                case 'tbpm': { const v = parseFloat(fieldText(f)); if (!isNaN(v)) t.bpm = v; break; }
                case 'tkey': { const v = fieldText(f); if (v) t.key = v; break; }
            }
        }

        if (!t.path) continue;
        tracks.set(t.path, {
            id: t.path,
            path: t.path,
            title: t.title || path.basename(t.path).replace(/\.[^.]+$/, ''),
            artist: t.artist || 'Unknown Artist',
            album: t.album,
            genre: t.genre,
            durationSec: t.durationSec,
            bpm: t.bpm,
            key: t.key,
            cues: [], // GEOB cue tags live in the audio files — Phase 2
        });
    }
    return tracks;
};

const parseCrate = (cratePath: string, seratoRoot: string): string[] => {
    const buf = fs.readFileSync(cratePath);
    const trackPaths: string[] = [];
    for (const record of readFields(buf)) {
        if (record.tag !== 'otrk') continue;
        for (const f of readFields(record.buf)) {
            if (f.tag === 'ptrk') trackPaths.push(resolveSeratoPath(fieldText(f), seratoRoot));
        }
    }
    return trackPaths;
};

export const loadSeratoLibrary = (seratoRoot: string): DJLibrary => {
    const dbPath = path.join(seratoRoot, 'database V2');
    if (!fs.existsSync(dbPath)) throw new Error(`No "database V2" found in ${seratoRoot}`);

    const trackMap = parseDatabase(dbPath, seratoRoot);
    const crates: DJCrate[] = [];

    const subcrateDir = path.join(seratoRoot, 'Subcrates');
    if (fs.existsSync(subcrateDir)) {
        for (const file of fs.readdirSync(subcrateDir).filter(f => f.endsWith('.crate')).sort()) {
            try {
                const trackIds = parseCrate(path.join(subcrateDir, file), seratoRoot);
                // "%%" in the filename encodes the crate folder hierarchy
                const segments = file.replace(/\.crate$/, '').split('%%');
                crates.push({
                    name: segments[segments.length - 1],
                    path: segments.slice(0, -1),
                    trackIds,
                });
                // Crates can reference tracks missing from database V2 (e.g. moved
                // libraries) — surface them as stub tracks so counts stay honest.
                for (const id of trackIds) {
                    if (!trackMap.has(id)) {
                        trackMap.set(id, {
                            id, path: id,
                            title: path.basename(id).replace(/\.[^.]+$/, ''),
                            artist: 'Unknown Artist', cues: [],
                        });
                    }
                }
            } catch (e) {
                console.warn(`[DJ] Skipping unreadable crate ${file}:`, e);
            }
        }
    }

    return {
        source: 'serato',
        sourcePath: seratoRoot,
        tracks: [...trackMap.values()],
        crates,
    };
};
