// --- SERATO CUE/LOOP READER (read-only) ---
// Serato stores hot cues and saved loops INSIDE each audio file, in a
// "Serato Markers2" tag (format documented by Holzhaus/serato-tags):
//   MP3/AIFF: ID3v2 GEOB frame with description "Serato Markers2"
//   M4A/MP4:  freeform atom ----:com.serato.dj:markersv2
//   FLAC:     Vorbis comment SERATO_MARKERS_V2
// The payload is "\x01\x01" + base64 text; decoded it is "\x01\x01" followed
// by entries:  null-terminated ASCII type ("CUE", "LOOP", ...) |
//              4-byte BE length | payload.
//
// NOTE: exact CUE/LOOP field offsets were cross-checked against the
// serato-tags reference parser, but unknown entry types are skipped
// defensively — a parse failure on one file never breaks the library load.

import fs from 'fs';
import { DJCue } from './model';

// --- Markers2 entry decoding ---

const parseCueEntry = (payload: Buffer): DJCue | null => {
    // [0]=0x00 [1]=index [2..5]=position ms u32be [6]=0x00 [7..9]=RGB
    // [10..11]=0x0000 [12..]=name utf-8, null-terminated
    if (payload.length < 12) return null;
    const nameEnd = payload.indexOf(0, 12);
    return {
        type: 'cue',
        index: payload[1],
        positionMs: payload.readUInt32BE(2),
        color: '#' + payload.subarray(7, 10).toString('hex').toUpperCase(),
        name: payload.toString('utf8', 12, nameEnd === -1 ? payload.length : nameEnd) || undefined,
    };
};

const parseLoopEntry = (payload: Buffer): DJCue | null => {
    // [0]=0x00 [1]=index [2..5]=start ms [6..9]=end ms [10..13]=0xFFFFFFFF
    // [14..17]=color [18]=0x00 [19]=locked [20..]=name utf-8, null-terminated
    if (payload.length < 20) return null;
    const nameEnd = payload.indexOf(0, 20);
    return {
        type: 'loop',
        index: payload[1],
        positionMs: payload.readUInt32BE(2),
        endMs: payload.readUInt32BE(6),
        color: '#' + payload.subarray(15, 18).toString('hex').toUpperCase(),
        name: payload.toString('utf8', 20, nameEnd === -1 ? payload.length : nameEnd) || undefined,
    };
};

// blob = "\x01\x01" + base64 text (possibly line-wrapped / null-padded)
const parseMarkers2Blob = (blob: Buffer): DJCue[] => {
    if (blob.length < 2 || blob[0] !== 0x01 || blob[1] !== 0x01) return [];
    const b64 = blob.subarray(2).toString('ascii').replace(/[^A-Za-z0-9+/=]/g, '');
    let data: Buffer;
    try { data = Buffer.from(b64, 'base64'); } catch { return []; }
    if (data.length < 2 || data[0] !== 0x01 || data[1] !== 0x01) return [];

    const cues: DJCue[] = [];
    let off = 2;
    while (off < data.length && data[off] !== 0x00) {
        const typeEnd = data.indexOf(0, off);
        if (typeEnd === -1 || typeEnd + 5 > data.length) break;
        const entryType = data.toString('ascii', off, typeEnd);
        const len = data.readUInt32BE(typeEnd + 1);
        const payload = data.subarray(typeEnd + 5, typeEnd + 5 + len);
        if (payload.length < len) break;

        try {
            if (entryType === 'CUE') {
                const c = parseCueEntry(payload);
                if (c) cues.push(c);
            } else if (entryType === 'LOOP') {
                const l = parseLoopEntry(payload);
                if (l) cues.push(l);
            } // COLOR / BPMLOCK / FLIP etc. — not cues, skip
        } catch { /* one bad entry must not kill the rest */ }

        off = typeEnd + 5 + len;
    }
    return cues;
};

// MP4/FLAC wrap the blob once more: base64 of
// "application/octet-stream\0\0Serato Markers2\0" + <blob>
const unwrapDoubleEncoded = (b64Text: string): Buffer | null => {
    let outer: Buffer;
    try { outer = Buffer.from(b64Text.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64'); } catch { return null; }
    const marker = Buffer.from('Serato Markers2\0', 'ascii');
    const idx = outer.indexOf(marker);
    if (idx === -1) return null;
    return outer.subarray(idx + marker.length);
};

// --- ID3v2 (MP3 + AIFF "ID3 " chunk) ---

const syncsafe = (buf: Buffer, off: number): number =>
    ((buf[off] & 0x7f) << 21) | ((buf[off + 1] & 0x7f) << 14) | ((buf[off + 2] & 0x7f) << 7) | (buf[off + 3] & 0x7f);

const geobFromId3 = (id3: Buffer): Buffer | null => {
    if (id3.length < 10 || id3.toString('ascii', 0, 3) !== 'ID3') return null;
    const version = id3[3]; // 3 = v2.3, 4 = v2.4
    const flags = id3[5];
    const tagSize = syncsafe(id3, 6);
    let off = 10;
    if (flags & 0x40) off += (version === 4 ? syncsafe(id3, 10) : id3.readUInt32BE(10)); // extended header

    const end = Math.min(10 + tagSize, id3.length);
    while (off + 10 <= end) {
        const frameId = id3.toString('ascii', off, off + 4);
        if (!/^[A-Z0-9]{4}$/.test(frameId)) break; // hit padding
        const frameSize = version === 4 ? syncsafe(id3, off + 4) : id3.readUInt32BE(off + 4);
        if (frameSize <= 0 || off + 10 + frameSize > end) break;
        if (frameId === 'GEOB') {
            const body = id3.subarray(off + 10, off + 10 + frameSize);
            // encoding(1) | mime\0 | filename\0 | description\0 | data
            let p = 1;
            const mimeEnd = body.indexOf(0, p); if (mimeEnd === -1) { off += 10 + frameSize; continue; }
            p = mimeEnd + 1;
            const fileEnd = body.indexOf(0, p); if (fileEnd === -1) { off += 10 + frameSize; continue; }
            p = fileEnd + 1;
            const descEnd = body.indexOf(0, p); if (descEnd === -1) { off += 10 + frameSize; continue; }
            const description = body.toString('latin1', p, descEnd);
            if (description === 'Serato Markers2') return body.subarray(descEnd + 1);
        }
        off += 10 + frameSize;
    }
    return null;
};

const readId3FromMp3 = (filePath: string): Buffer | null => {
    const fd = fs.openSync(filePath, 'r');
    try {
        const head = Buffer.alloc(10);
        if (fs.readSync(fd, head, 0, 10, 0) < 10 || head.toString('ascii', 0, 3) !== 'ID3') return null;
        const size = 10 + syncsafe(head, 6);
        const tag = Buffer.alloc(size);
        fs.readSync(fd, tag, 0, size, 0);
        return tag;
    } finally { fs.closeSync(fd); }
};

const readId3FromAiff = (filePath: string): Buffer | null => {
    const fd = fs.openSync(filePath, 'r');
    try {
        const head = Buffer.alloc(12);
        if (fs.readSync(fd, head, 0, 12, 0) < 12 || head.toString('ascii', 0, 4) !== 'FORM') return null;
        let pos = 12;
        const chunkHead = Buffer.alloc(8);
        while (fs.readSync(fd, chunkHead, 0, 8, pos) === 8) {
            const ckId = chunkHead.toString('ascii', 0, 4);
            const ckSize = chunkHead.readUInt32BE(4);
            if (ckId === 'ID3 ') {
                const tag = Buffer.alloc(ckSize);
                fs.readSync(fd, tag, 0, ckSize, pos + 8);
                return tag;
            }
            pos += 8 + ckSize + (ckSize % 2); // chunks are word-aligned
        }
        return null;
    } finally { fs.closeSync(fd); }
};

// --- MP4/M4A atoms ---

const markersFromMp4 = (filePath: string): Buffer | null => {
    const fd = fs.openSync(filePath, 'r');
    try {
        const stat = fs.fstatSync(fd);
        const head = Buffer.alloc(16);
        // Find the top-level moov atom (may sit before or after mdat)
        let pos = 0;
        let moov: Buffer | null = null;
        while (pos + 8 <= stat.size) {
            if (fs.readSync(fd, head, 0, 16, pos) < 8) break;
            let size = head.readUInt32BE(0);
            const type = head.toString('ascii', 4, 8);
            let hdr = 8;
            if (size === 1) { size = Number(head.readBigUInt64BE(8)); hdr = 16; }
            else if (size === 0) size = stat.size - pos; // extends to EOF
            if (size < hdr) break;
            if (type === 'moov') {
                moov = Buffer.alloc(size - hdr);
                fs.readSync(fd, moov, 0, moov.length, pos + hdr);
                break;
            }
            pos += size;
        }
        if (!moov) return null;

        // Walk moov > udta > meta(+4) > ilst > '----' freeform atoms
        const findChild = (buf: Buffer, type: string, skip = 0): Buffer | null => {
            let off = skip;
            while (off + 8 <= buf.length) {
                const size = buf.readUInt32BE(off);
                if (size < 8 || off + size > buf.length) return null;
                if (buf.toString('ascii', off + 4, off + 8) === type) return buf.subarray(off + 8, off + size);
                off += size;
            }
            return null;
        };
        const udta = findChild(moov, 'udta');
        const meta = udta && findChild(udta, 'meta');
        const ilst = meta && findChild(meta, 'ilst', 4); // meta has 4 version/flag bytes
        if (!ilst) return null;

        let off = 0;
        while (off + 8 <= ilst.length) {
            const size = ilst.readUInt32BE(off);
            if (size < 8 || off + size > ilst.length) break;
            if (ilst.toString('ascii', off + 4, off + 8) === '----') {
                const item = ilst.subarray(off + 8, off + size);
                const mean = findChild(item, 'mean');
                const name = findChild(item, 'name');
                if (mean?.toString('ascii', 4) === 'com.serato.dj' && name?.toString('ascii', 4) === 'markersv2') {
                    const data = findChild(item, 'data');
                    if (data) return unwrapDoubleEncoded(data.subarray(8).toString('ascii')); // 8 = version/flags + reserved
                }
            }
            off += size;
        }
        return null;
    } finally { fs.closeSync(fd); }
};

// --- FLAC Vorbis comments ---

const markersFromFlac = (filePath: string): Buffer | null => {
    const fd = fs.openSync(filePath, 'r');
    try {
        const head = Buffer.alloc(4);
        if (fs.readSync(fd, head, 0, 4, 0) < 4 || head.toString('ascii') !== 'fLaC') return null;
        let pos = 4;
        const blockHead = Buffer.alloc(4);
        for (; ;) {
            if (fs.readSync(fd, blockHead, 0, 4, pos) < 4) return null;
            const isLast = (blockHead[0] & 0x80) !== 0;
            const blockType = blockHead[0] & 0x7f;
            const blockSize = (blockHead[1] << 16) | (blockHead[2] << 8) | blockHead[3];
            if (blockType === 4) { // VORBIS_COMMENT
                const block = Buffer.alloc(blockSize);
                fs.readSync(fd, block, 0, blockSize, pos + 4);
                let off = block.readUInt32LE(0) + 4; // skip vendor string
                const count = block.readUInt32LE(off); off += 4;
                for (let i = 0; i < count && off + 4 <= block.length; i++) {
                    const len = block.readUInt32LE(off); off += 4;
                    const comment = block.toString('utf8', off, off + len); off += len;
                    const eq = comment.indexOf('=');
                    if (eq !== -1 && comment.slice(0, eq).toUpperCase() === 'SERATO_MARKERS_V2') {
                        return unwrapDoubleEncoded(comment.slice(eq + 1));
                    }
                }
                return null;
            }
            if (isLast) return null;
            pos += 4 + blockSize;
        }
    } finally { fs.closeSync(fd); }
};

// --- Public API ---

export const readSeratoCues = (filePath: string): DJCue[] => {
    try {
        const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
        let blob: Buffer | null = null;
        if (ext === '.mp3') {
            const id3 = readId3FromMp3(filePath);
            blob = id3 && geobFromId3(id3);
        } else if (ext === '.aif' || ext === '.aiff') {
            const id3 = readId3FromAiff(filePath);
            blob = id3 && geobFromId3(id3);
        } else if (ext === '.m4a' || ext === '.mp4') {
            blob = markersFromMp4(filePath);
        } else if (ext === '.flac') {
            blob = markersFromFlac(filePath);
        }
        if (!blob) return [];
        // MP4/FLAC unwrap returns the inner blob which may itself start
        // with \x01\x01 + base64 (same as the GEOB payload)
        return parseMarkers2Blob(blob).sort((a, b) => a.positionMs - b.positionMs);
    } catch {
        return []; // unreadable/odd file — never break the library load
    }
};
