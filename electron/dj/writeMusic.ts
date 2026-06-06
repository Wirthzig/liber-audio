// --- APPLE MUSIC PLAYLIST WRITER ---
// Uses the official Music.app AppleScript API — Apple's supported automation
// path, zero library-corruption risk. Creates the playlist if needed and
// adds tracks by file path. One osascript per playlist (batched adds).

import { execFile } from 'child_process';

const escapeAS = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export interface MusicWriteResult {
    playlist: string;
    added: number;
    errors: string[];
}

export const addToMusicPlaylist = (playlist: string, absPaths: string[]): Promise<MusicWriteResult> => {
    const pl = escapeAS(playlist);
    const lines = [
        'tell application "Music"',
        `  if not (exists user playlist "${pl}") then make new user playlist with properties {name:"${pl}"}`,
        ...absPaths.map(p => `  add (POSIX file "${escapeAS(p)}") to user playlist "${pl}"`),
        'end tell',
    ];
    return new Promise((resolve) => {
        execFile('osascript', ['-e', lines.join('\n')], { timeout: 120_000 }, (err, _stdout, stderr) => {
            if (err) {
                console.error('[DJ] Music write failed:', stderr || err.message);
                resolve({ playlist, added: 0, errors: [stderr.trim() || err.message] });
            } else {
                resolve({ playlist, added: absPaths.length, errors: [] });
            }
        });
    });
};
