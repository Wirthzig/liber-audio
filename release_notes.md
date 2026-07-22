# LiberAudio v1.2.3 — Reliability Update

Fixes SoundCloud downloading plus a batch of stability improvements. The app auto-updates, or just download and replace your existing copy.

## 🔧 What's Changed
- **SoundCloud downloads work again.** Every SoundCloud track was failing because the app fetched a temporary stream link instead of the track page — fixed.
- **No more freezing after a failed download.** A single failed track used to lock up the download button until you restarted the app; downloads now keep going and recover cleanly.
- **Fewer stalls and hangs.** Scans and downloads that get stuck (dead links, network drops) now time out instead of spinning forever.
- **Spotify:** private or mistyped playlist links now show the correct "private or doesn't exist" message instead of the editorial-playlist tip.
- **Faster startup:** stops needlessly re-downloading the search engine on launch.
- Various smaller correctness and matching fixes.

---
**First time opening the app?** macOS will warn about an unidentified developer — see the quick fix on our [download page](https://wirthzig.github.io/liber-audio/#gatekeeper).

---
**Download below** — pick the file matching your Mac:
- **Apple Silicon** (M1/M2/M3/M4): `LiberAudio-v1.2.3-macOS-arm64.dmg`
- **Intel**: `LiberAudio-v1.2.3-macOS-x64.dmg`
