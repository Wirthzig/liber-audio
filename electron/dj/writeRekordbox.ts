// --- REKORDBOX XML EXPORT WRITER ---
// rekordbox has no safe external write path (master.db is encrypted and
// undocumented), so we generate a DJ_PLAYLISTS xml the user imports once:
//   rekordbox → Preferences → Advanced → Database → rekordbox xml →
//   point at this file, then drag the playlists in from the xml tree.
// Each triage session writes its own timestamped file — never overwrites.

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
    playlists: number;
    tracks: number;
}

export const writeRekordboxXml = (
    outDir: string,
    playlists: Map<string, RekordboxTrackRef[]>, // playlist name -> tracks
): RekordboxExportResult => {
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

    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const xmlPath = path.join(outDir, `liberaudio-triage-${stamp}.xml`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(xmlPath, xml, 'utf-8');

    return { xmlPath, playlists: playlists.size, tracks: collection.length };
};
