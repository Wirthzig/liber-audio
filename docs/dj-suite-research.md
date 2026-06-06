# DJ Support Suite — Research Report

> Round 1: 2026-06-06. 24 sources, 114 claims extracted, top 25 adversarially verified
> (22 confirmed, 3 refuted). Round 2 (follow-up on open questions): same day, 24 sources,
> 112 claims, 23/25 confirmed — see [Round 2 findings](#round-2--follow-up-findings) below.
> Confidence labels reflect 3-vote verification.

## Verdict

All three feature tracks are **technically feasible** in LiberAudio's Electron/React/TypeScript
stack. The binding constraints are **licensing** (AGPL for the best analysis library) and
**external-data availability** (Spotify closed its audio-features API to new apps), *not* format
access — the reverse-engineering ecosystem for Serato and Rekordbox is mature and mostly
permissively licensed.

**Recommended order:** Track 1 (playlist sync) → Track 3 (cue/grid sync) → Track 2 (set brain).

---

## Track 1 — Crate/Playlist Sync (Serato ↔ Rekordbox ↔ iTunes ↔ Spotify)

**Risk: LOW–MEDIUM** · Strategy: **integrate existing libraries**

### Verified findings

- **Rekordbox** — [pyrekordbox](https://github.com/dylanljones/pyrekordbox) (MIT, ✓3-0) unlocks
  the SQLCipher4-encrypted `master.db`, and reads/writes `rekordbox.xml`, My-Settings, and ANLZ
  files. `master.db` support is read + *limited* write.
- **The master.db key is hardcoded and shared across all installs** (✓3-0) — documented via
  Frida hooking of `sqlite3_key` ([liamcottle/pioneer-rekordbox-database-encryption](https://github.com/liamcottle/pioneer-rekordbox-database-encryption)).
  ⚠️ Pioneer obfuscated the app after 6.6.5 to fight key extraction → any direct-DB approach can
  break on a Rekordbox update. **Prefer `rekordbox.xml` import/export (officially supported) for
  writes.**
- **Serato** — [triseratops](https://github.com/Holzhaus/triseratops) (Rust, MPL-2.0, ✓3-0)
  parses **and serializes** Serato metadata in MP3/AIFF/MP4/FLAC/Ogg (Ogg partial). Needs a
  separate tag-container reader. The `.crate`/database format is documented in the
  [Mixxx wiki](https://github.com/mixxxdj/mixxx/wiki/Serato-Database-Format).
- **iTunes/Music** — `Library.xml` (plist), straightforward.
- **Spotify** — audio features are gone for new apps (see Track 2), but **playlist read/write
  policy for newly registered apps is an OPEN QUESTION** — the research did not produce a
  verified claim on this; must be confirmed before promising bidirectional Spotify sync. Note
  there is a Spotify [February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
  to review.
- **Track matching** — AcoustID/Chromaprint web service is available for fingerprint-based
  matching ([acoustid.org/webservice](https://acoustid.org/webservice)); combine with metadata
  fuzzy match + ISRC where available.

### Integration shape

Main-process modules: Serato crate/DB parser, Rekordbox XML round-trip, iTunes XML reader,
sync engine with a canonical internal playlist model. Python (pyrekordbox) as a bundled
subprocess **or** port the needed logic to TS.

---

## Track 2 — AI "Set Brain" (order playlist by BPM / key / energy)

**Risk: MEDIUM–HIGH** · Strategy: **build sequencing ourselves; choose analysis source carefully**

### Verified findings

- **Spotify is dead as a data source for us** (✓3-0 / 3-0): Audio Features + Audio Analysis
  (plus Recommendations, Related Artists, 30s previews) return 403 for apps registered on/after
  **2024-11-27**; extended access narrowed again **2025-05-15** to "established, scalable,
  impactful" apps. → **Local analysis is the realistic path.**
- **essentia.js** (✓3-0) — full Essentia C++ suite as WASM, TypeScript API, runs in
  Node/Electron in-process, covers BPM/beats, key/chords, loudness, + TF.js model inference.
  **But: AGPL v3.** Shipping it in the distributed app triggers source-disclosure copyleft.
  LiberAudio is MIT-licensed/open-source, so this *may* be acceptable — needs an explicit
  licensing decision.
- **Permissive alternatives** (✓3-0) — librosa (ISC) / aubio via a Python subprocess;
  [Audet](https://github.com/makalin/Audet) (MIT) shows the full pipeline (BPM, key +
  confidence, Camelot notation, mood) but is a single-maintainer project — treat as reference,
  not dependency.
- **Existing tag data** — Mixed In Key, Serato (Autotags GEOB: BPM/gain, fully documented), and
  Rekordbox ANLZ already hold BPM/key for analyzed tracks: **read those first, analyze only
  what's missing.**

### Open questions (not verified this round)

- Hosted alternatives (AcousticBrainz status, Cyanite, Tunebat, ReccoBeats) — viability/cost
  unverified.
- Best sequencing heuristic — Camelot-distance + BPM-ramp + energy-arc as TSP-style ordering;
  prior art exists (Spotify research on automatic playlist sequencing, TSP-playlist papers) but
  specifics weren't verified. The sequencing logic is pure TS and ours to design.

---

## Track 3 — Hot Cue / Loop / Beatgrid Sync (Serato ↔ Rekordbox)

**Risk: MEDIUM** (read = solid, write = dangerous) · Strategy: **integrate readers, hand-build writers with safe-write discipline**

### Verified findings

- **Serato Markers2 GEOB structure is reverse-engineered** (✓3-0): base64 payload; each entry =
  zero-terminated ASCII type string (`CUE`, `COLOR`, `BPMLOCK`, …) + 4-byte LE length + payload
  ([Holthuis writeup](https://homepage.rub.de/jan.holthuis/reversing-seratos-geob-tags.html),
  [serato-tags](https://github.com/Holzhaus/serato-tags)).
- **Good news (refuted pessimism):** the claim "Serato BeatGrid was NOT reverse-engineered" was
  **refuted 0-3** — BeatGrid is documented ("mostly done"), so beatgrid sync is more mature than
  often assumed. Documented formats: Markers2 (mostly done), BeatGrid (mostly done), Autotags
  (done), Analysis (done), Overview (done).
- **Caution:** a detailed byte-layout claim for CUE entries was **refuted 1-2** — validate exact
  field offsets against `serato_markers2.py` parser source, not blog prose. Also: serato-tags
  *code* is MIT, but its *docs* are CC BY-SA 4.0 → write original parser code from the spec,
  don't copy doc text.
- **Rekordbox side** — ANLZ (.DAT/.EXT/.2EX) via pyrekordbox (MIT); USB exports (`export.pdb` +
  `PIONEER/USBANLZ`) via [crate-digger](https://github.com/Deep-Symmetry/crate-digger) (Java) and
  [rekordcrate](https://github.com/Holzhaus/rekordcrate) (Rust, MPL-2.0). **Key lever:** both are
  driven by portable **Kaitai `.ksy` specs that can be compiled to JavaScript/TypeScript** →
  in-process parsing without bundling Java/Rust.
- rekordcrate's write capability is **unresolved** (the "read-only" claim was refuted 0-3 but
  write support wasn't positively confirmed) — verify before relying on it.

### Safe-write protocol (mandatory before any write-back ships)

1. Full automatic backup of `_Serato_` / Rekordbox library before every write session
2. Dry-run diff preview — show exactly what changes before applying
3. Checksum/round-trip verification — parse back what was written, compare
4. Prefer `rekordbox.xml` round-trips over direct `master.db` writes

Converter fidelity of DJCU/Lexicon/ATGR tools and real-world beatgrid-drift behavior were **not
verified this round** — open question worth a focused follow-up before building writers.

---

## Build vs. Integrate Summary

| Track | Strategy | Key deps | License posture |
|---|---|---|---|
| 1 — Playlist sync | Integrate | pyrekordbox (MIT), triseratops (MPL-2.0), Library.xml, Spotify Web API | Clean |
| 2 — Set brain | Build sequencing; integrate analysis | essentia.js (**AGPL**) *or* librosa/aubio subprocess (permissive) | **Decision required** |
| 3 — Cue/grid sync | Integrate readers; build writers | serato-tags spec, Kaitai .ksy → TS, pyrekordbox ANLZ | Clean (don't copy CC BY-SA doc text) |

## Architecture additions to the Electron app

- **Main process:** `dj/` module group — Serato parser, Rekordbox XML/DB adapter, iTunes XML
  reader, canonical playlist/cue model, sync engine, safe-write manager (backup/diff/verify)
- **Subprocess binaries** (fits the existing yt-dlp/ffmpeg dependency-manager pattern):
  optional bundled Python (pyrekordbox, librosa) — same spawn/manage lifecycle
- **In-process options:** Kaitai-compiled TS parsers (ANLZ/PDB), essentia.js WASM (if AGPL accepted)
- **Renderer:** sync mapping UI, diff-preview UI, set-builder view (BPM/key/energy timeline)

## Recommended implementation order

1. **Track 1** (LOW–MEDIUM) — read-only first (import + view all libraries), then writes via
   rekordbox.xml / .crate files. Resolve Spotify playlist-API question early.
2. **Track 3 read side** (LOW) — parse cues/grids from both platforms, display + cloud-backup
   them. Pure read = zero corruption risk, and builds the parsers Track 3 writes need.
3. **Track 3 write side** (MEDIUM) — only after safe-write protocol + fidelity follow-up research.
4. **Track 2** (MEDIUM–HIGH) — gated on the AGPL decision; sequencing algorithm is pure TS and
   can be prototyped early against existing MIK/Serato tags.

## Open questions for a follow-up research round

1. ~~Spotify Web API playlist read/write policy for **new** apps in 2026~~ → **Answered, Round 2**
2. ~~Hosted BPM/key/energy providers~~ → **Answered, Round 2**
3. ~~Set-sequencing algorithms — default heuristic design~~ → **Answered, Round 2**
4. ~~Real-world write fidelity / beatgrid drift of DJCU, Lexicon, ATGR converters~~ →
   **Answered, Round 3**

---

# Round 2 — Follow-up Findings

## Q1 — Spotify playlist sync: **CONDITIONAL GO** (✓3-0, primary Spotify docs)

The February 2026 Web API migration changed everything — and the verdict is nuanced:

**What still works (verified against the official Feb 2026 changelog):**
- Reading/writing the authenticated user's **own and collaborative** playlists is fully
  supported: `GET /playlists/{id}`, `GET/POST /me/playlists`, `PUT/POST/DELETE
  /playlists/{id}/items`.
- Endpoints renamed `/tracks` → `/items`; `GET/POST /users/{id}/playlists` removed (everything
  is now scoped to the current user). Third-party playlists return **metadata only** — no items.

**The hard constraints (Development Mode, effective 2026-02-11 for new apps):**
- **Max 5 allowlisted users per app** (down from 25), **1 Client ID per developer**
- The app **owner must hold an active Spotify Premium subscription**
- Extended Quota Mode is orgs-only with **≥250k MAU** — unreachable for us
- Rate limits: per-app, rolling 30-second window, HTTP 429 on exceed
- Dev Mode is explicitly reframed for *non-commercial, personal projects*

**Verdict:** **GO** as a personal/open-source tool where **each user registers their own
Spotify developer app** and pastes their own Client ID (BYO-credentials pattern — common in
open-source Spotify tools). **NO-GO** as a shared service using one app registration.
Electron OAuth: per-user Authorization Code flow with loopback/custom-scheme redirect URI.

## Q2 — Analysis-data strategy: **local-first, hosted enrichment** 

| Provider | Fields | Match by | Catch |
|---|---|---|---|
| **SoundStat** (✓3-0) | BPM, key, mode, key-confidence, energy, danceability, valence, loudness | Spotify track ID | Launched Jan 2025 explicitly as Audio-Features replacement; vendor-only accuracy claims |
| **ReccoBeats** (✓3-0) | audio features | internal UUID (not ISRC/Spotify ID on per-track endpoint) | Extra ID-resolution hop |
| **GetSongBPM** (✓3-0) | BPM, key, Open-Key/Camelot, danceability | search | Free but **mandatory visible backlink** or account suspended |
| **Tunebat** (⚠️2-1) | key, Camelot, BPM, energy | — | Developer-API and 70M-track claims **refuted** — no confirmed programmatic access |

**Recommendation (verified synthesis):** local analysis (Essentia/librosa) as the **primary**
source — it works on the actual files, no ID-matching gap, no rate limits, no deprecation risk.
Hosted (SoundStat preferred) only to enrich tracks without local files. Pricing tiers and a
local-vs-hosted accuracy benchmark for electronic music remain unverified.

## Q3 — Set-sequencing algorithm: concrete spec (✓3-0, Spotify ISMIR 2017 paper)

Spotify's own published formulation matches our use case exactly:

- Model the playlist as a **complete graph**: tracks = vertices, edge weight = Euclidean
  distance between normalized feature vectors (BPM delta, Camelot-key distance, energy step).
- Optimal order = Shortest Hamiltonian Path → **NP-complete**, so use heuristics:
  - **HAM-2 bidirectional greedy** (extend from head *or* tail each step) — empirically
    "virtually always" beats plain greedy (HAM-1). **← our default.**
  - Optional refinement: Hamiltonian-**cycle** 2-approximation (TSP-style) — removes the
    poor-pairing artifacts greedy leaves at the ends; loop-safe sets.
- Energy-arc shaping: bias the energy term per position against a target curve
  (warm-up → peak → cooldown).

**Implementation:** pure TypeScript — distance matrix + HAM-2 pass + optional 2-opt. No deps.
*Not verified this round:* exact Camelot transition weights (±1, relative maj/min, +7 energy
boost) and max-BPM-ramp percentages — these are well-documented DJ practice and can be tuned
as parameters rather than researched further.

## Q4 — Converter write fidelity: answered in Round 3 (below)

Round 2's crawl surfaced the right material but its verification budget ran out; Round 3
resolved it — see the dedicated section below.

## Round 2 refuted claims

- Tunebat "70M-track database" — refuted 1-2
- Tunebat developer "Music Metadata API" exists — refuted 1-2

## Caveats

Spotify has changed API policy four times in 18 months (Nov 2024, Apr/May 2025, Feb 2026) —
re-verify immediately before building the integration. Some Dev-Mode endpoint removals for
existing apps took effect 2026-03-09, and per-user vs per-app rate-limit behavior under the
Authorization Code flow is unconfirmed.

---

# Round 3 — Cue/Beatgrid Write Fidelity & Safe-Write Protocol

> Focused round on Q4. 22 sources, 94 claims extracted, 25 verified — **25/25 confirmed,
> 0 refuted.** The MP3-offset and beatgrid-model findings are grounded in primary sources
> (LAME tech FAQ, HydrogenAudio, Mixxx bug tracker/PRs, serato-tags spec, pyrekordbox docs,
> dj-data-converter issue #3).

## The MP3 offset is REAL, fixed, and compensable (✓ high confidence)

- **Magnitude:** ~26ms at 44.1kHz (1 MPEG frame = 1152 samples), ~24ms at 48kHz, ~51ms when
  two frames are involved. It is a **constant per-file offset, not progressive drift**.
- **Affects ~6% of MP3 files** — specifically those with a Xing/INFO header but **no LAME tag,
  or an invalid LAME CRC**. ~94% of MP3s are unaffected. Lossless formats (FLAC/WAV/AIFF) are
  immune in the documented cases (Mixxx bug #1666275: only MP3 misaligned, FLAC did not).
- **Root cause:** LAME stores encoder delay/padding in its header for gapless playback. Apps
  decode differently — one treats the header frame/padding as audio, another skips it. The
  offset is a property of the *app pair + tag state*, not the file alone.
- **The compensation rule (from dj-data-converter, directly implementable):**
  - Xing/INFO tag absent, **or** valid LAME CRC present → **0ms**
  - Xing/INFO present but no LAME tag → **+26ms**
  - LAME tag present but CRC invalid → **+26ms**
- Lexicon ships exactly this as "Beatgrid shift correction" (±26/51ms) in Convert Library.

## Why beatgrids break: two incompatible models (✓ high confidence)

| | Serato | Rekordbox (ANLZ binary) |
|---|---|---|
| Model | Multi-marker, position-anchored | **Every beat enumerated** |
| Marker data | Non-terminal: float position + integer beats-till-next; terminal: float position + explicit BPM float | 8 bytes/beat: beat number (1–4), tempo (BPM×100), position (ms) |
| Variable BPM | Implied by inter-marker beat counts | Explicit per beat |

Conversion = resampling one model into the other; variable-BPM/live-recorded tracks are where
fidelity loss concentrates. (`rekordbox.xml` `<TEMPO>` elements *can* be single-anchor — another
reason XML is a friendlier interchange target.) Rounding from integer sample math is sub-sample
(~0.023ms) — negligible vs. the 26/51ms LAME offsets.

## Write-target safety (✓ verified constraints)

- pyrekordbox: master.db read **and write** works (cues go to `DjmdCues` table), but **ANLZ
  files are READ-ONLY** — writing them is only "planned". So beatgrid/waveform write-back to
  Rekordbox binary analysis files is not available off the shelf.
- Auto key-extraction for master.db **broke at Rekordbox 6.6.5+** (asar obfuscation) — newer
  installs may need a manually supplied key. Moving target.
- → **Safest Rekordbox write path: `rekordbox.xml` import.** Serato side: GEOB tags via the
  documented serato-tags spec (track-file-local, no central DB to corrupt).

## LiberAudio safe-write checklist (ordered)

1. **App-not-running guard** — refuse to write while Serato/Rekordbox processes are open
2. **Vendor backup first** — prompt the user through Rekordbox `File > Library > Backup
   Library` (pyrekordbox's own documented recommendation); auto-copy `_Serato_` folder
3. **Our own snapshot** — checksummed copy of every file we're about to touch
4. **MP3 offset detection** — parse Xing/INFO/LAME headers per file, apply the 0/26/51ms
   conditional compensation rule above
5. **Dry-run diff** — show exactly which cues/grids change, per track, before writing
6. **Write via safest target** — rekordbox.xml import; GEOB tag rewrite for Serato
7. **Round-trip verification** — re-parse what we wrote, compare against intended values
8. **One-click restore** — keep snapshots until user confirms the library opens correctly

## Still unverified (acceptable residual risk)

- Per-tool fidelity *ranking* (DJCU vs Lexicon vs rekordcloud vs DJ.Studio vs MIXO) — no
  surviving claims; mostly marketing-contested territory anyway
- Whether Serato applies LAME compensation itself (vs being a third decode behavior) — the
  26ms evidence is strongest for Traktor↔Rekordbox; Serato case is vendor-doc-supported and
  mechanism-consistent but less primary-sourced. **Mitigation: hands-on testing with a real
  library before shipping the writer** (the dry-run diff makes this cheap).
- M4A/AAC encoder-delay behavior between platforms
- XML-import vs direct master.db writes: no head-to-head failure-mode data; we choose XML on
  principle (officially supported, no encryption dependency)

## Refuted claims (for the record)

- "CUE entry = 4-byte ms position + RGB + null-terminated UTF-8 name" — refuted 1-2 (layout
  details unreliable; check parser source)
- "Serato BeatGrid format not reverse-engineered" — refuted 0-3 (it IS documented)
- "rekordcrate is read-only" — refuted 0-3 (write capability unresolved, not absent)
