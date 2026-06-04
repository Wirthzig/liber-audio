# LiberAudio v1.2.0 — The "Speed & Freedom" Update

The biggest update yet: massively faster downloads, login with your own Spotify account, a smart local library, and an app that keeps itself working when platforms change things.

## 🌟 What's New?

### ⚡ Seriously Faster Downloads
- **Parallel downloading**: up to 3 tracks download at the same time, while the next songs are already being searched in the background.
- **No more re-encoding**: audio is now stream-copied in its native quality instead of being converted — post-processing went from seconds to instant.
- **Native Apple Silicon**: M-series Macs now get a native arm64 audio engine (previously ran through Rosetta translation).
- **Smarter search**: results are verified against the track duration, covers/remixes/karaoke are filtered out, and search results are cached permanently — re-scanning a playlist costs zero time.

### 🔐 Login with Spotify (Optional)
- Click the new account button on the home screen and approve in your browser — done.
- **Unlocks your private playlists** and skips the shared-backend wait entirely.
- No password ever touches the app (standard OAuth/PKCE flow, tokens stay on your Mac).

### 🗂 Local Library Sync
- New home-screen button: pick your music folder(s) and LiberAudio remembers what you already own.
- Works across **all three platforms** — scanned playlists automatically mark songs you already have, so nothing is ever downloaded twice.
- Folders are re-scanned on every start, and you can add as many as you like.

### 🛡 Self-Healing Search
- The YouTube search engine now **updates itself** — when YouTube changes something, fixes reach you automatically on the next app start, no new release required.
- The downloader (yt-dlp) continues to auto-update as before.

### 🎵 More Music Support
- **Spotify album links** now work (in addition to tracks and playlists).
- Playlists containing removed or local-only tracks no longer break scanning.

### 🐛 Fixes & Polish
- Songs with special characters (`/`, `:`, …) in the title no longer fail.
- Clearer folder pickers: the output folder button now shows the selected folder name, and dialogs say what they're for.
- Numerous stability fixes (startup races, crash on missing downloader, stuck loading states).

---
**First time opening the app?** macOS will warn about an unidentified developer — see the quick fix on our [download page](https://wirthzig.github.io/LiberAudio/#gatekeeper).

---
**Download below** — pick the file matching your Mac:
- **Apple Silicon** (M1/M2/M3/M4): `LiberAudio-v1.2.0-macOS-arm64.dmg`
- **Intel**: `LiberAudio-v1.2.0-macOS-x64.dmg`
