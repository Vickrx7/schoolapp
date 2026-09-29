# Lynx École — stop-motion promo (English + French)

A ~60 s (EN) / ~67 s (FR) papercraft "stop-motion" promo for teacher feedback. Everything is generated
from code and the app screenshots in `screens/`. The finished videos are not committed (about 25 MB each):
rebuild them with the steps below. Generated files (`build/`, `models/`, `venv/`, `*.mp4`, storyboards)
are git-ignored.

> **Out of date on one scene.** This v1 cut labels the sick-day substitute plan « Bientôt » and
> says « une seule touche ». The plan has shipped, and reporting an absence takes two taps. The
> next cut follows [`script-v2.md`](script-v2.md); see also [`../README.md`](../README.md) for the
> "claims only what ships" rule.

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
