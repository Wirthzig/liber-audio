// --- REKORDBOX XML EXPORT WRITER ---
// rekordbox has no safe external write path (master.db is encrypted and
// undocumented), so we maintain ONE persistent DJ_PLAYLISTS xml that
// accumulates every triage session. The user points rekordbox at it once
// (Preferences → Advanced → Database → rekordbox xml) and afterwards just
// refreshes the "rekordbox xml" tree — same bridge pattern Lexicon uses.
// Accumulated playlists live in a JSON state file; the xml is regenerated
// from it on every apply (dedup by file path per playlist).

import fs from 'fs';
import path from 'path';

const xmlEscape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const toLocation = (absPath: string): string =>
    'file://localhost' + encodeURI(absPath).replace(/#/g, '%23').replace(/\?/g, '%3F');

export interface RekordboxTrackRef {
    path: string;
    title: string;
    artist: string;
}

export interface RekordboxExportResult {
    xmlPath: string;
    playlists: number;      // playlists touched this session
    tracks: number;         // tracks added this session
    totalPlaylists: number; // everything in the persistent xml
    firstExport: boolean;   // true → show the one-time rekordbox setup steps
}

export const updateRekordboxXml = (
    stateFile: string,
    xmlPath: string,
    newPlaylists: Map<string, RekordboxTrackRef[]>, // playlist name -> tracks
): RekordboxExportResult => {
    const firstExport = !fs.existsSync(xmlPath);

    // Merge this session into the accumulated state (dedup per playlist)
    let state: Record<string, RekordboxTrackRef[]> = {};
    try {
        if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    } catch { /* corrupt state — start fresh, xml still regenerates fully */ }

    let added = 0;
    for (const [name, tracks] of newPlaylists) {
        const cur = state[name] ?? [];
        const seen = new Set(cur.map(t => t.path));
        const fresh = tracks.filter(t => !seen.has(t.path));
        state[name] = [...cur, ...fresh];
        added += fresh.length;
    }
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

    // Regenerate the xml from the FULL state
    const playlists = new Map(Object.entries(state));
    // Collection: unique tracks across all playlists, sequential TrackIDs
    const idByPath = new Map<string, number>();
    const collection: RekordboxTrackRef[] = [];
    for (const tracks of playlists.values()) {
        for (const t of tracks) {
            if (!idByPath.has(t.path)) {
                idByPath.set(t.path, idByPath.size + 1);
                collection.push(t);
            }
        }
    }

    const trackXml = collection.map(t =>
        `    <TRACK TrackID="${idByPath.get(t.path)}" Name="${xmlEscape(t.title)}" Artist="${xmlEscape(t.artist)}" Location="${xmlEscape(toLocation(t.path))}"/>`
    ).join('\n');

    const playlistXml = [...playlists.entries()].map(([name, tracks]) => {
        const keys = tracks.map(t => `        <TRACK Key="${idByPath.get(t.path)}"/>`).join('\n');
        return `      <NODE Name="${xmlEscape(name)}" Type="1" KeyType="0" Entries="${tracks.length}">\n${keys}\n      </NODE>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="LiberAudio" Version="1.0" Company="LiberAudio"/>
  <COLLECTION Entries="${collection.length}">
${trackXml}
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="1">
      <NODE Type="0" Name="LiberAudio Triage" Count="${playlists.size}">
${playlistXml}
      </NODE>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>
`;

    fs.mkdirSync(path.dirname(xmlPath), { recursive: true });
    fs.writeFileSync(xmlPath, xml, 'utf-8');

    return {
        xmlPath,
        playlists: newPlaylists.size,
        tracks: added,
        totalPlaylists: playlists.size,
        firstExport,
    };
};
