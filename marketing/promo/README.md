# Lynx École — stop-motion promo (English + French)

A ~60 s (EN) / ~67 s (FR) papercraft "stop-motion" promo for teacher feedback. Everything is generated
from code and the app screenshots in `screens/`. The finished videos are not committed (about 25 MB each):
rebuild them with the steps below. Generated files (`build/`, `models/`, `venv/`, `*.mp4`, storyboards)
are git-ignored.

> **Out of date on one scene.** This v1 cut labels the sick-day substitute plan « Bientôt » and
> says « une seule touche ». The plan has shipped, and reporting an absence takes two taps. The
> next cut follows [`script-v3.md`](script-v3.md), which adds the library and class mode and uses
> the screenshots in `../site/assets/` (v2 is kept for its « Texte différencié » scene); see also
> [`../README.md`](../README.md) for the "claims only what ships" rule.

## Deliverables

| File                                               | What                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `lynx-ecole-promo-en.mp4`                          | English cut, 1920x1080, 12 fps, H.264 (yuv420p, High 4.0, +faststart) + AAC 48 kHz |
| `lynx-ecole-promo-fr.mp4`                          | French cut (same pipeline, `--lang fr`): French voice, captions, tags and end card |
| `storyboard.png` / `storyboard-fr.png`             | Contact sheets, one frame per scene (3x3)                                          |
| `voiceover-script.txt` / `voiceover-script-fr.txt` | Final voice lines, captions and timings                                            |
| `make_promo.py`                                    | Build entry point (timeline, frame rendering, encode, storyboard)                  |
| `promo_art.py`                                     | Papercraft art + the nine scenes (PIL/numpy)                                       |
| `promo_audio.py`                                   | Kokoro voiceover, procedural music, ducked mix                                     |

## Rebuild

```bash
cd marketing/promo/
python3 -m venv venv && ./venv/bin/pip install numpy pillow soundfile kokoro-onnx
# Kokoro model files (Apache-2.0) from the kokoro-onnx GitHub releases:
mkdir -p models && cd models
curl -sSL -O https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -sSL -O https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
cd ..
# ffmpeg must be on PATH (apt-get install ffmpeg)
./venv/bin/python make_promo.py            # English build (~2-3 min on 4 CPUs)
./venv/bin/python make_promo.py --lang fr  # French build -> lynx-ecole-promo-fr.mp4, storyboard-fr.png, voiceover-script-fr.txt
./venv/bin/python make_promo.py [--lang fr] preview    # two PNGs per scene in build/, no video
./venv/bin/python make_promo.py [--lang fr] frames 12.0 21.4   # render specific times to build/
./venv/bin/python make_promo.py [--lang fr] remix      # re-mix audio + mux onto the already rendered video
```

The voice is generated once and cached in `build/voice.json` (EN) / `build/voice-fr.json` (FR) plus
`build/voice_*.wav`; delete the JSON to regenerate after editing the script lines in `promo_audio.py`
(`LINES_EN` / `LINES_FR`). Scene lengths are derived from the voice line durations (`LEAD`/`TAIL` in
`make_promo.py`), so the French cut is simply longer rather than faster.

### How the language switch works

- `promo_art.py` keeps the scene code in English and routes every on-screen string through `tr()`;
  the `FR` dict maps each English string to its French version, and `L(en, fr)` picks per-language
  layout values (a few positions/font sizes where the French text is longer). `set_lang("fr")` is
  called by `make_promo.py` from `--lang`. Adding a language = adding a dict entry set + `LINES_xx`
  - a `VOICE_CFG` entry.
- Caveat has every French glyph (é è ê à ç « » ’ …); only the dingbats (✓ → ♪ ✝ ☹ ✎ ♥) fall back to
  DejaVu Sans Bold per run. Captions use DejaVu Sans Bold, which covers everything, and shrink a
  step (42 → 40/38/36 px) only when a caption would not fit the frame width.

## Credits / licensing

- **Voice**: [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) TTS (Apache-2.0). English: voice
  `af_heart`, en-us, speed 0.95 ("École" and "prière du matin" are fed as IPA so they sound French).
  French: voice `ff_siwis`, fr-fr, speed 1.0 — Kokoro's only French voice, which is a European
  (SIWIS) voice, so the accent is not Québécois/Franco-Ontarian; the wording is. espeak slips
  fixed with IPA: « Aujourd'hui » (/ɥ/), « paperasse » (schwa), « préparera » (doubled r),
  « Bientôt » (vowel length).
- **Music**: original and procedural — composed in `promo_audio.py` with numpy only (Karplus-Strong
  plucked "ukulele" strums, sine bass, noise shaker and claps, a small glockenspiel motif;
  I–V–vi–IV in C at 96 BPM). No samples or downloaded audio. It is ducked ~9 dB under the voice,
  faded in/out and soft-limited (mix peaks ≈ -1.9 dBFS, integrated ≈ -17 LUFS, no clipping).
- **Fonts**: DejaVu Sans (system) and Caveat (SIL OFL, `fonts/Caveat[wght].ttf`, licence in
  `fonts/OFL-Caveat.txt`) for the handwritten labels.
- **Screens**: real app screenshots with fictional demo data; the app icon is read from the repo
  (`apps/web/public/icons/icon-512.png`) and not modified.
- All other art (kraft desk, sticky notes, phone/laptop frames, scissors, hand, lock, eye, maple
  leaf, stamp, calendar cards…) is drawn procedurally in `promo_art.py`.

## French cut

Same nine scenes, claims and music. Voice script in `voiceover-script-fr.txt`: « vous » form, Canadian
French, the app's own terms (« Aujourd'hui », « Leçon donnée », « journée pédagogique », « messe de
l'école », « départ hâtif », « prière du matin », « plan de suppléance », « personne suppléante »).
The sick-day plan is labelled « BIENTÔT » (ribbon) + « bientôt » (tag) and spoken as « Bientôt : … ».

## Claims made in the video

Only shipped behaviour is shown: today view with routines and next lessons, one-tap "Leçon donnée"
(with undo), calendar adjustments (PA day, school mass, early dismissal), weekly / rotating / rotary
timetables, first-names-only CSV import, encrypted + hidden + logged medical alerts. The one-tap
sick-day substitute plan is labelled "Bientôt · Coming soon" (ribbon + tag) and drawn as paper,
not as an app screen. No pricing, AI, or board endorsement is claimed; the end card notes that
"Lynx École" is a working name and all demo data is fictional.

## 90-second commercial (`make_commercial.py`)

A calmer, 90-second cut of the flagship script (« Lynx École commercials »), in French and in
English: the sick day at 6 h 05, the plan, the code, the substitute, the report, the resource
bank, class mode, « Mon année » and « Couverture », « Bulletins », « Info-parents », the
principal and the board, privacy, and the end card. Scene lengths follow the voice (about 91 s).

**This cut is written as if the pilot is live: it says the data is hosted in Canada and shows the
AI at work (names replaced before anything goes to the AI). Confirm both before it airs.**

| File                                              | What                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `lynx-ecole-commercial-90-fr.mp4` / `…-en.mp4`    | 1920x1080, 30 fps, H.264 (yuv420p, High, +faststart) + AAC 48 kHz, about 23 MB each      |
| `build/commercial/commercial-90-storyboard-*.png` | Contact sheets (4x4), one frame per scene plus three second beats                        |
| `make_commercial.py`                              | Voice lines, scenes, music, mix, encode and storyboard (reuses `promo_audio.py`)         |
| `screens-commercial/`                             | The captures this cut adds (WebP, demo data), and `canada.json` for the map              |
| `fonts/ZillaSlab-*.ttf`, `fonts/Lexend-*.ttf`     | The site's display and body faces (SIL OFL, `fonts/OFL-ZillaSlab.txt`, `OFL-Lexend.txt`) |

Rebuild (same venv and voice files as above; ffmpeg comes from PATH, or from `imageio-ffmpeg`):

```bash
cd marketing/promo/
./venv/bin/pip install imageio-ffmpeg            # only if ffmpeg is not on PATH
./venv/bin/python make_commercial.py --lang fr   # -> lynx-ecole-commercial-90-fr.mp4 + build/commercial/ storyboard (~6 min, 4 CPUs)
./venv/bin/python make_commercial.py --lang en
./venv/bin/python make_commercial.py --lang fr preview       # two PNGs per scene in build/commercial/
./venv/bin/python make_commercial.py --lang fr frames 12 41  # given times
./venv/bin/python make_commercial.py --lang fr remix         # new mix on the rendered picture
```

- **Voice**: the lines are `LINES_FR` / `LINES_EN` (`say` is read, `caption` is burned in with
  French typography); the voice is cached in `build/commercial/voice-<lang>.json`, so delete it
  after editing a line. A few French phonemes are fixed by hand (`FIXES_FR`: glides in « Ensuite »
  and « suivi », « quiz », liaisons that should not be made).
- **Picture**: every screen is a capture of the development build with demo data. The site's
  captures come from `../site/assets/`. `screens-commercial/` adds, from 2026-10-04 after a fresh
  `stack.sh reset` (reset again afterwards): the absence of Tuesday 6 October (a 13 h 30 school
  mass added to the demo calendar; released and re-dated to 7 h 30), the office's code and the
  printed welcome sheet, the substitute's « Maintenant » / « Ensuite », « Élèves » with the alerts
  hidden (a demo alert, never shown), « Suivi de la journée » (draft time re-dated to 15 h 29),
  the teacher's « Confirmer », and a class-mode game on four tablets. The app ran with
  `APP_BASE_URL=http://lynx-ecole.example` (a reserved name) so no development address is on
  screen; the footer label « Version dev » on the office captures was filled with the page
  colour. From earlier sets: the « Bulletins » comment with « Copier » and the preview of
  « Traduire en anglais (IA) » (a colleague's name sent as « Adulte A »), both 2026-10-03, and
  the library's student sheet (2026-09-30). The English cut shows the same French screens.
- **Drawn here**: the kitchen at 6 h 05, the chalkboard (as on the site's hero), the classroom
  wall, the map (Natural Earth outline, public domain, via the world-atlas npm package), the chalk
  marks and the end card on the Franco-Ontarian green and white. Nothing else is drawn as UI.
- **Music**: original and procedural, as for v1, but calmer (felt-piano arpeggios, a pad, a soft
  bass; D major at 76 BPM), ducked under the voice and resolving on the end card.
