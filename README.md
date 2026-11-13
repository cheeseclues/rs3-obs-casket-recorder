# RS3 OBS Casket Recorder v0.6.1 — Replay Buffer / Pre-roll

OBS keeps recent gameplay footage **before** reward opening. Alt1 never starts OBS normal recording automatically; instead, when the calibrated **Treasure Trails reward interface** is detected after a player click, it schedules an OBS `SaveReplayBuffer` request five seconds after the most recent verified reward or reroll.

## v0.6.1 save confirmation fix

OBS WebSocket SaveReplayBuffer acknowledges the request before the file is necessarily finalized. This release subscribes to the `ReplayBufferSaved` output event and logs the confirmed file path rather than the previous replay. A 10 s timeout/fallback checks for a changed path and warns if no new save can be confirmed. This prevents misleading `Replay 17-53-16.mp4` logs for a later reward. No changes to existing localStorage keys, calibration, or password behavior.

## OBS one-time setup

1. OBS → **Settings → Output** → Enable **Replay Buffer** (may require Advanced output mode or supported recording encoder).
2. Set **Maximum Replay Time** to **60 seconds**. With an especially high-bitrate 4K recording, ensure the replay memory limit is large enough.
3. Set recording/replay path and quality as desired in OBS. For RuneScape-only audio, keep separate Application Audio Capture instead of desktop audio.
4. Leave OBS WebSocket server on port **4455**, with authentication enabled.
5. In the Alt1 app, set **OBS Maximum Replay Time** to the SAME number of seconds (default 60) and enable **Auto Replay Buffer**, **Start detection automatically**, **Enable automatic reward replay saves** and optional OBS auto-connect.
6. The app starts the OBS Replay Buffer on connection. Check the status reads **Buffer running** before opening a casket. Click **Test: Save replay now** to verify that a video file is created by OBS.

The app cannot read OBS's configured Replay Buffer length over the v5 WebSocket API, so match the duration manually. This matters for preventing older footage from rolling out.

## Installation (Windows)

Requirements: RuneScape 3, Alt1 Toolkit, OBS Studio with WebSocket enabled on local port 4455, and Python 3 on PATH.

1. Clone or download this repository, and close any older Alt1 recorder window.
2. Stop any older Python HTTP server occupying port **8091**. If upgrading, copy the new files into your existing recorder directory so the same local app URL and saved browser storage continue working.
3. In OBS, enable Replay Buffer and the OBS WebSocket server (keep authentication enabled).
4. Run **Launch-Recorder.cmd**. It starts a local Python server and opens Alt1's dedicated v0.6.1 URL.
5. If needed, open `alt1://addapp/http://127.0.0.1:8091/appconfig-v0.6.1.json` to install the app and grant **Screen Pixels** and **Game State** permissions.
6. Confirm the header **ALT1 + OBS · V0.6.1** and `v0.6.1 loaded` in the activity log. Configure OBS password, replay-buffer duration, calibrations and automatic detection once.

Using the **same host and port** (`127.0.0.1:8091`) retains existing browser localStorage credentials and calibrations; switching hosts or ports does not.

Manual Alt1 URL: `alt1://browser/http://127.0.0.1:8091/recorder-v0.6.1.html`

## How it handles Puzzle caskets

The casket image is merely a candidate. A Puzzle casket can look similar; **no replay is saved unless the separately calibrated Treasure Trails reward window opens** following a real player click. If that template matches a different UI element, it could still save false positives; calibrate a reward-only detail.

## Short and long sequences

- A reward opens: schedule replay save **5 s after** the event.
- A reroll or another recognized reward: reset deadline to **5 s after** that event.
- Long sequences: an intermediate replay save is requested about every **65% of the configured buffer period**. This can produce overlapping videos, not one seamless combined video. It avoids overwriting older footage if the configured OBS buffer is at least as long as the value in the app. For a 60 s buffer the interval is ~39 s.
- The `SaveReplayBuffer` request saves the **entire buffered replay window**, not a precise five-second clip. Exact trimming needs an FFmpeg post-processing step.
- OBS continuously encodes the buffered video; this uses more hardware resources than the old on-demand mode. If RuneScape movement responsiveness or lobby disconnects return, test with replay buffering switched off.
- There is no guarantee of capturing every reward: fast UI transitions, unreadable screen frames, app downtime or OBS failures may cause misses.

## Technical and safety

- Only screen pixels and recent RuneScape clicks are read via the Alt1 interface. The tool does not click, type into, inject into, or read process memory from RuneScape.
- Connection to OBS only uses WebSocket `ws://127.0.0.1:4455`, not an external service.
- Stored OBS password is opt-in in localStorage and unencrypted.
- OBS normal recording is never started or stopped automatically. **The old manual 5-second recording test button still uses normal OBS recording.**
- The recorder should be used at your own risk; no endorsement or formal permission is implied.

## Tests

Run `node test-detector.js` and `node test-replay.js` (Node.js required for tests only). These are simulated tests and cannot guarantee in-game accuracy.

## Repository hygiene

- Never commit OBS passwords, exports of localStorage, recordings or local log files. The app saves a password to localStorage only if the user opts in; it is **not encrypted**.
- `launcher.log`, `python-http.*.log`, and recorded videos are ignored by `.gitignore`.
- This is an independent, unofficial community utility. It is **not endorsed or approved by Jagex, Alt1 or OBS**. Use at your own risk and respect game and software terms.
- No open-source license is included in this release; publication alone does not grant reuse rights. The repository owner may choose to add a license separately.