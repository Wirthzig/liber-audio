// --- EMBEDDED ALBUM ART READER (read-only) ---
// Pulls the cover image out of the audio file itself:
//   MP3/AIFF: ID3v2 APIC frame
//   M4A/MP4:  moov > udta > meta > ilst > covr atom
//   FLAC:     METADATA_BLOCK_PICTURE (type 6)
// Header-only reads where possible; any failure returns null.

import fs from 'fs';

export interface Artwork {
    mime: string;
    data: Buffer;
}

const syncsafe = (buf: Buffer, off: number): number =>
    ((buf[off] & 0x7f) << 21) | ((buf[off + 1] & 0x7f) << 14) | ((buf[off + 2] & 0x7f) << 7) | (buf[off + 3] & 0x7f);

// --- ID3 APIC ---

const apicFromId3 = (id3: Buffer): Artwork | null => {
    if (id3.length < 10 || id3.toString('ascii', 0, 3) !== 'ID3') return null;
    const version = id3[3];
    const flags = id3[5];
    const tagSize = syncsafe(id3, 6);
    let off = 10;
    if (flags & 0x40) off += (version === 4 ? syncsafe(id3, 10) : id3.readUInt32BE(10));

    const end = Math.min(10 + tagSize, id3.length);
    while (off + 10 <= end) {
        const frameId = id3.toString('ascii', off, off + 4);
        if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
        const frameSize = version === 4 ? syncsafe(id3, off + 4) : id3.readUInt32BE(off + 4);
        if (frameSize <= 0 || off + 10 + frameSize > end) break;
        if (frameId === 'APIC') {
            const body = id3.subarray(off + 10, off + 10 + frameSize);
            const enc = body[0];
            const mimeEnd = body.indexOf(0, 1);
            if (mimeEnd === -1) return null;
            const mime = body.toString('latin1', 1, mimeEnd) || 'image/jpeg';
            let p = mimeEnd + 1 + 1; // + picture type byte
            // description: UTF-16 encodings terminate with a double-null on
            // an even boundary; latin1/utf8 with a single null
            if (enc === 1 || enc === 2) {
                while (p + 1 < body.length && !(body[p] === 0 && body[p + 1] === 0)) p += 2;
                p += 2;
            } else {
                p = body.indexOf(0, p) + 1;
                if (p === 0) return null;
            }
            const data = body.subarray(p);
            return data.length > 0 ? { mime, data: Buffer.from(data) } : null;
        }
        off += 10 + frameSize;
    }
    return null;
};

const readId3 = (filePath: string, aiff: boolean): Buffer | null => {
    const fd = fs.openSync(filePath, 'r');
    try {
        if (!aiff) {
            const head = Buffer.alloc(10);
            if (fs.readSync(fd, head, 0, 10, 0) < 10 || head.toString('ascii', 0, 3) !== 'ID3') return null;
            const size = 10 + syncsafe(head, 6);
            const tag = Buffer.alloc(size);
            fs.readSync(fd, tag, 0, size, 0);
            return tag;
        }
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
            pos += 8 + ckSize + (ckSize % 2);
        }
        return null;
    } finally { fs.closeSync(fd); }
};

// --- MP4 covr ---

const covrFromMp4 = (filePath: string): Artwork | null => {
    const fd = fs.openSync(filePath, 'r');
    try {
        const stat = fs.fstatSync(fd);
        const head = Buffer.alloc(16);
        let pos = 0;
        let moov: Buffer | null = null;
        while (pos + 8 <= stat.size) {
            if (fs.readSync(fd, head, 0, 16, pos) < 8) break;
            let size = head.readUInt32BE(0);
            const type = head.toString('ascii', 4, 8);
            let hdr = 8;
            if (size === 1) { size = Number(head.readBigUInt64BE(8)); hdr = 16; }
            else if (size === 0) size = stat.size - pos;
            if (size < hdr) break;
            if (type === 'moov') {
                moov = Buffer.alloc(size - hdr);
                fs.readSync(fd, moov, 0, moov.length, pos + hdr);
                break;
            }
            pos += size;
        }
        if (!moov) return null;

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
        const ilst = meta && findChild(meta, 'ilst', 4);
        const covr = ilst && findChild(ilst, 'covr');
        const data = covr && findChild(covr, 'data');
        if (!data || data.length <= 8) return null;
        // data atom: 4 bytes version/flags (flag 13 = jpeg, 14 = png) + 4 reserved
        const mime = data[3] === 14 ? 'image/png' : 'image/jpeg';
        return { mime, data: Buffer.from(data.subarray(8)) };
    } finally { fs.closeSync(fd); }
};

// --- FLAC PICTURE block ---

const pictureFromFlac = (filePath: string): Artwork | null => {
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
            if (blockType === 6) { // PICTURE
                const block = Buffer.alloc(blockSize);
                fs.readSync(fd, block, 0, blockSize, pos + 4);
                let off = 4; // skip picture type
                const mimeLen = block.readUInt32BE(off); off += 4;
                const mime = block.toString('ascii', off, off + mimeLen) || 'image/jpeg'; off += mimeLen;
                const descLen = block.readUInt32BE(off); off += 4 + descLen;
                off += 16; // width/height/depth/colors
                const dataLen = block.readUInt32BE(off); off += 4;
                if (off + dataLen > block.length) return null;
                return { mime, data: Buffer.from(block.subarray(off, off + dataLen)) };
            }
            if (isLast) return null;
            pos += 4 + blockSize;
        }
    } finally { fs.closeSync(fd); }
};

// --- Public API ---

export const readArtwork = (filePath: string): Artwork | null => {
    try {
        const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
        if (ext === '.mp3') {
            const id3 = readId3(filePath, false);
            return id3 && apicFromId3(id3);
        }
        if (ext === '.aif' || ext === '.aiff') {
            const id3 = readId3(filePath, true);
            return id3 && apicFromId3(id3);
        }
        if (ext === '.m4a' || ext === '.mp4') return covrFromMp4(filePath);
        if (ext === '.flac') return pictureFromFlac(filePath);
        return null;
    } catch {
        return null;
    }
};
