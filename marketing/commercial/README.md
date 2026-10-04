# Lynx École: the full commercial (English and French)

A papercraft stop-motion commercial of about five and a half minutes that walks through
everything the pilot build does, in ten chapters:

1. Your day
2. Your planning
3. Resources
4. In class
5. A sick day
6. Report cards and families
7. Principals
8. School boards
9. Privacy first
10. Getting started

It is built from code and real screenshots of the app with the demo data, in the style of the
first 60-second promo (`../promo/`), whose papercraft helpers it reuses. The finished videos are
not committed: rebuild them with the steps below.

| File                  | What                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `script.py`           | The voice-over and captions, scene by scene, in English and French                              |
| `scenes.py`           | The 39 scenes: devices with screenshots, paper labels, props, chapter cards                     |
| `art.py`              | Phone (scrolling), laptop (panning), projector, tablet, props, captions with pages              |
| `audio.py`            | Kokoro voice (cached per line), a score that follows the chapters, paper sound effects, the mix |
| `make_commercial.py`  | Build: timeline, sound-effect probe, frames, encode, mix, mux, storyboard                       |
| `screens/`            | The screenshots, each with a JSON of the boxes the video points at                              |
| `capture/`            | The Playwright walkthrough that took the screenshots                                            |
| `out/voiceover-*.txt` | The final voice lines and captions with their timings                                           |

## Rebuild

```bash
cd marketing/commercial/
# The promo's environment and Kokoro model files (see ../promo/README.md for the downloads):
#   ../promo/venv with numpy pillow soundfile kokoro-onnx, ../promo/models/kokoro-v1.0.onnx and voices-v1.0.bin
../promo/venv/bin/python make_commercial.py              # English -> out/lynx-ecole-commercial-en.mp4 (+ storyboard)
../promo/venv/bin/python make_commercial.py --lang fr    # French  -> out/lynx-ecole-commercial-fr.mp4
../promo/venv/bin/python make_commercial.py preview [scene ids]   # two frames per scene in build/preview-<lang>/
../promo/venv/bin/python make_commercial.py frames 12.5 40.0      # frames at these times
../promo/venv/bin/python make_commercial.py remix                 # new mix on the already rendered picture
```

A full build takes about 15 minutes per language on 4 CPUs. ffmpeg must be on the PATH. A voice
line is regenerated only when its text changes (`build/voice-<lang>/`). Each scene lasts as long
as its voice line plus a short lead and tail, so the French cut is a little longer, not faster.

## Claims

Every sentence follows the rules in `marketing/README.md` on the PR #2 branch
(`claude/serene-ride-3n2fa1`), "claims only what ships". A separate review checked the script
against `docs/HANDOFF.md`, `PRIVACY.md`, `docs/ai-data-flow.md`, the feature docs and the app's
own strings. In short:

- **Pilot build.** The title and end cards say pilot build, and that nothing is online yet.
  Hosting is « conçue pour être hébergée au Canada », or on the board's own servers.
- **AI.** No AI output is shown, and nothing is claimed about quality or time saved. The preview
  shows the names the app knows replaced by markers. The teacher removes any other names. AI stays
  off until the principal turns it on, students never use it, and a board can forbid it.
- **Alerts.** They exist only if the principal turns them on. They are encrypted and shown only
  when tapped. A code opens them for whoever holds it, so every view is logged.
- **Absences.** An absence takes two taps. The plan is released at 7:30 by default, or sooner. The
  substitute plan groups students by language level.
- **Report cards and families.** Report card comments are written in the browser and never sent
  to our servers or to the AI. « Info-parents » sends nothing to families.
- **Coverage.** It counts only the expectations loaded in the app. The demo has a sample, marked
  to be verified.
- **People.** No board is named, and all people and data are the demo seed's.

Change a claim only after checking it against those documents again.

## Screens

The screenshots were taken on 2026-10-04 from the PR #2 branch with the demo seed
(`tools/lite-stack/stack.sh reset`), `next start`, the worker on the fake AI provider, and
`capture/commercial-screens.spec.ts` copied into `apps/web/e2e/`:

```bash
E2E_BASE_URL=http://localhost:3000 COMMERCIAL_OUT=$PWD/marketing/commercial/screens \
  pnpm --filter @lynx/web exec playwright test commercial-screens --project=desktop
```

Phone shots are 390 × 844 at 3×, desktop shots 1280 × 800 at 1.5×, French (`fr-CA`,
America/Toronto). Full-page phone shots hide the fixed bottom bar, and the video puts it back. The
walkthrough records an alert for Samuel, reports an absence, issues a code, reveals and hides the
alert as the substitute, and sends the report. It never captures an alert's text or an AI
result, and blurs e-mail addresses. Reset the stack afterwards.

Four screens come from `marketing/site/assets/` on the PR #2 branch (prefix `site-`):

- report card comments (`site-report-comments-desktop`)
- the « Info-parents » editor and its PDF (`site-newsletter-desktop`, `site-newsletter-pdf`)
- a class tablet (`site-tablet-join`)

The PNG captures are stored as WebP (quality 90). Only the screens the video uses are kept.

## Voice, music and credits

- **Voice.** Kokoro TTS (Apache-2.0).
  - English: `af_heart`, en-us.
  - French: `ff_siwis`, fr-fr. This is Kokoro's only French voice and it has a European accent; the
    wording is Canadian French. A recorded Franco-Ontarian voice would be better for anything public.
- **Music.** Original and procedural, in `audio.py`, built on the promo's plucked "ukulele" band.
  The arrangement follows the chapters: quiet for the sick-day morning, fuller in class, and a lift
  of a whole tone for the ending. It is ducked under the voice.
- **Sound effects.** Procedural paper pops, slides, stamps and taps. The probe pass places them
  where elements enter.
- **Fonts.** DejaVu Sans, and Caveat (SIL OFL, in `../promo/fonts/`).
- **App icon.** `apps/web/public/icons/icon-512.png`.
- **Name and data.** « Lynx École » is a working name (`APP` in `script.py` and `art.py`). All
  data shown is fictional demo data.
