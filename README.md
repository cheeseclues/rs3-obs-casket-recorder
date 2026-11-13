# RS3 OBS Casket Recorder v0.6.2 — All five clue tiers

Alt1 reads RuneScape screen pixels and observes real player clicks. When a calibrated Treasure Trails **reward interface** appears after a player click, the application asks OBS Studio to save its Replay Buffer **five seconds after the last recognized reward or reroll**. The saved replay includes moments before the opening. **The application never clicks or controls RuneScape**.

## What's new in v0.6.2

- Separate casket-icon and reward-window image calibrations for **Easy, Medium, Hard, Elite and Master**. All calibrated tiers are monitored automatically; the selected tier only controls **which calibration to add or clear**.
- Each tier can have an optional separately calibrated Reroll button position.
- A **Tier calibration summary** shows which references are stored. A reward window, rather than a matching casket icon alone, is required to save an automatic replay; Puzzle caskets should not trigger a save.
- Existing v0.6.1 **Elite** casket, reward-window and reroll calibrations are imported **once** from browser localStorage. Original legacy keys remain intact. Import is not retried after a tier has been intentionally cleared.
- Reuses a single 52×52 pixel capture if multiple tiers have reward references at the same coordinates, to limit screen-reading overhead. Otherwise samples the distinct calibrated reward positions. Sampling is ~400 ms ordinarily and ~130 ms shortly after clicks.
- Keeps OBS saved password setting, auto-connect, Replay Buffer controls, and save-confirmation logic from v0.6.1. Continues using **port 8091** and a unique versioned launch URL to avoid old Alt1 cached pages.

## Upgrade without losing Elite calibration

1. Close any older RS3 OBS Casket Recorder Alt1 windows.
2. Stop the old Python HTTP server on port 8091, if running. (Ctrl+C in its PowerShell window.)
3. Extract ZIP **root contents** into your existing recorder folder, overwriting the old files. Do not nest the new folder inside the old one.
4. Double-click **Launch-Recorder.cmd** (Python 3.12+ required). It uses port 8091 and opens `recorder-v0.6.2.html` inside Alt1.
5. Check the banner says `ALT1 + OBS · V0.6.2` and the activity log says `v0.6.2 loaded` and `Existing v0.6.1 calibration imported as Elite` on first startup.
6. Set **Calibration tier** to Easy, Medium, Hard or Master; perform each tier's calibration as described below. Elite should already show `✓` for previously saved references.

Manual Alt1 URL: `alt1://browser/http://127.0.0.1:8091/recorder-v0.6.2.html`

**Important:** Calibration data lives in Alt1 browser localStorage for `http://127.0.0.1:8091`. Don't change the host to `localhost` or the port if you want to retain your saved references/password. Keep the older app folder backed up until the new version has been verified in-game.

## Calibrate each tier once

For each tier, use the **Calibration tier** dropdown. It does not restrict live detection, which always checks **all** saved tiers.

1. With that tier's **Reward casket icon** available, click **Calibrate in 3 seconds**, then hover over the icon's center. This is the **optional casket candidate** reference; it cannot trigger OBS by itself.
2. Open a real reward for that tier. With the reward interface still open, click **Calibrate reward window in 3 seconds** and hover over a distinctive, fixed detail (for example a unique title decoration). The reward window is the **required** verification reference for that tier. Avoid empty slots, moving rewards or the mouse tooltip.
3. Optionally, while the corresponding reward is open, click **Calibrate reroll button** and hover at the center of the reroll button. Rerolls require a recognized reward window to extend the replay save.
4. Check the Tier calibration summary (✓ = saved, — = not calibrated). Switch tiers and repeat for the next one.

**If multiple tiers have identical reward-window headers**, calibrating the same distinctive detail for each tier is fine. The app compares all stored references and uses the most likely match. If a tier's reward window is not calibrated and its appearance differs from the saved ones, it may be missed even if its casket image is recognized. For full tier coverage, calibrate each reward window explicitly.

## OBS setup

1. OBS **Settings → Output → Replay Buffer**: enable and set **Maximum Replay Time**. A larger buffer (e.g. 20–60 s) protects multi-opening sequences. Set the same duration in the recorder UI.
2. OBS **Tools → WebSocket Server Settings**: enable WebSocket on port 4455; retain password authentication.
3. In the recorder, enable **Start/restore OBS Replay Buffer automatically**, **Start detection automatically**, and **Enable automatic reward replay saves**. Automatic password remembering uses localStorage and is **not encrypted**.
4. Make a test replay using the manual **Test: Save replay now** button. Before relying on it for rare rewards, try each tier in-game and verify the generated file includes the opening.

The app saves the whole Replay Buffer (not a precisely trimmed clip) and automatically requests overlapping intermediate replay saves for long chains. Its `ReplayBufferSaved` event handler confirms the actual saved file path instead of reporting a prior replay.

## Known limitations / security

- Visual templates depend on UI scale and position; re-calibrate the relevant tier if RuneScape's interface changes.
- Screen recognition is not infallible. Fast interfaces, graphics transitions, lag, and missing permissions can lead to missed clips. Keep a manual backup for especially rare drops.
- Different tier templates increase matching work slightly. If Alt1 / RuneScape input responsiveness or lobby issues return, pause detection and compare behavior.
- A Puzzle casket icon is **not enough** to save a replay; only a reward-window match after a click qualifies. Incorrect reward-window calibration can still lead to false positives.
- Read-only screen pixels and recent click activity only. No client memory access, code injection, or generated gameplay inputs. No guarantee of Jagex endorsement or official approval.
- OBS password is saved only if the user opts in, in browser localStorage. Do not upload browser profiles, logs with secrets, or personal files to GitHub.

## Tests

With Node.js installed, run:

```powershell
node test-detector.js
node test-replay.js
node test-multitier.js
```

These tests use simulated pixels/OBS messages and do **not** replace testing with a live RuneScape client and OBS installation.
