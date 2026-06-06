// --- SERATO CRATE WRITER (additive only) ---
// The ONLY mutation we ever do to a Serato library: appending otrk/ptrk
// records to Subcrates/*.crate files (or creating a new crate). We never
// touch database V2, never modify or remove existing entries, and never
// write audio-file tags.
//
// Safe-write protocol (see docs/dj-suite-research.md):
//   1. refuse to write while Serato is running
//   2. back up affected .crate files to app storage first
//   3. append, skipping paths already present (dedup)
//   4. verify by re-parsing the crate and checking every expected path

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

const utf16be = (s: string): Buffer => {
    const buf = Buffer.from(s, 'utf16le');
    buf.swap16();
    return buf;
};

const record = (tag: string, payload: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.write(tag, 0, 'ascii');
    head.writeUInt32BE(payload.length, 4);
    return Buffer.concat([head, payload]);
};

// Serato stores paths volume-relative without the leading slash
const toSeratoPath = (absPath: string): string => absPath.replace(/^\//, '');

const readCratePaths = (cratePath: string): Set<string> => {
    const paths = new Set<string>();
    if (!fs.existsSync(cratePath)) return paths;
    const buf = fs.readFileSync(cratePath);
    let off = 0;
    while (off + 8 <= buf.length) {
        const tag = buf.toString('ascii', off, off + 4);
        const len = buf.readUInt32BE(off + 4);
        if (off + 8 + len > buf.length) break;
        if (tag === 'otrk') {
            const inner = buf.subarray(off + 8, off + 8 + len);
            let ioff = 0;
            while (ioff + 8 <= inner.length) {
                const itag = inner.toString('ascii', ioff, ioff + 4);
                const ilen = inner.readUInt32BE(ioff + 4);
                if (ioff + 8 + ilen > inner.length) break;
                if (itag === 'ptrk') {
                    const swapped = Buffer.from(inner.subarray(ioff + 8, ioff + 8 + ilen));
                    swapped.swap16();
                    paths.add(swapped.toString('utf16le').replace(/\0+$/, ''));
                }
                ioff += 8 + ilen;
            }
        }
        off += 8 + len;
    }
    return paths;
};

export const isSeratoRunning = (): Promise<boolean> =>
    new Promise(res => execFile('pgrep', ['-if', 'serato dj'], (err, stdout) => res(!err && stdout.trim().length > 0)));

export interface SeratoWriteResult {
    crate: string;
    added: number;
    skipped: number; // already present
}

// crateFileBase: filename without .crate, with '%%' hierarchy (as parsed)
export const appendToSeratoCrate = (
    seratoRoot: string,
    crateFileBase: string,
    absPaths: string[],
    backupDir: string,
): SeratoWriteResult => {
    const subcrateDir = path.join(seratoRoot, 'Subcrates');
    fs.mkdirSync(subcrateDir, { recursive: true });
    const cratePath = path.join(subcrateDir, `${crateFileBase}.crate`);

    // 1. Backup the current crate file (if it exists)
    fs.mkdirSync(backupDir, { recursive: true });
    if (fs.existsSync(cratePath)) {
        fs.copyFileSync(cratePath, path.join(backupDir, `${crateFileBase}.crate`));
    }

    // 2. Dedup against existing contents
    const existing = readCratePaths(cratePath);
    const newPaths = absPaths.map(toSeratoPath).filter(p => !existing.has(p));
    const skipped = absPaths.length - newPaths.length;

    if (newPaths.length > 0) {
        const chunks: Buffer[] = [];
        if (!fs.existsSync(cratePath)) {
            // New crate needs the version header Serato expects
            chunks.push(record('vrsn', utf16be('1.0/Serato ScratchLive Crate')));
        }
        for (const p of newPaths) {
            chunks.push(record('otrk', record('ptrk', utf16be(p))));
        }
        fs.appendFileSync(cratePath, Buffer.concat(chunks));
    }

    // 3. Round-trip verify: every path we wanted must now be present
    const after = readCratePaths(cratePath);
    for (const p of absPaths.map(toSeratoPath)) {
        if (!after.has(p)) {
            throw new Error(`Verification failed for crate "${crateFileBase}": "${p}" missing after write. Backup at ${backupDir}`);
        }
    }

    return { crate: crateFileBase, added: newPaths.length, skipped };
};
