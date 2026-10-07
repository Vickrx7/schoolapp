"""Audio for the Lynx École promo: Kokoro voiceover, original procedural music, final mix.

- Voice: kokoro-onnx (Apache-2.0). English: "af_heart" (en-us, speed 0.95). French: "ff_siwis" (fr-fr, speed 1.0).
- Music: composed procedurally with numpy (Karplus-Strong "ukulele" strums, soft bass,
  shaker, claps, a little glockenspiel motif). No samples, no downloads. I-V-vi-IV in C at 96 BPM.
- Mix: voice normalized, music ducked under speech, soft limiter, no clipping.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
MODEL = os.path.join(HERE, "models", "kokoro-v1.0.onnx")
VOICES = os.path.join(HERE, "models", "voices-v1.0.bin")
SR = 48000  # working / output sample rate

# ---------------------------------------------------------------------------
# Scripts. `say` is what the TTS reads, `caption` is what gets burned in.
# PHONEME_FIXES lists (phonemizer-output-substring -> replacement) for words espeak gets wrong.
# ---------------------------------------------------------------------------
LINES_EN = [
    dict(id="01_monday",
         say="Monday morning. The bell hasn't rung yet, and you're already juggling a hundred things.",
         caption="Monday morning. The bell hasn't rung yet,\nand you're already juggling a hundred things."),
    dict(id="02_today",
         say="Lynx École puts your whole day on one screen: every period, every routine, and the next lesson for each subject.",
         caption="Lynx École puts your whole day on one screen:\nevery period, every routine, and the next lesson."),
    dict(id="03_adjusts",
         say="P.A. day? School mass? Early dismissal? Your day adjusts on its own.",
         caption="PA day? School mass? Early dismissal?\nYour day adjusts on its own."),
    dict(id="04_onetap",
         say="Taught it? One tap. Your plan moves forward by itself.",
         caption="Taught it? One tap.\nYour plan moves forward by itself."),
    dict(id="05_private",
         say="Your class list stays private: first names only. Everything else never leaves your device.",
         caption="Your class list stays private: first names only.\nEverything else never leaves your device."),
    dict(id="06_alerts",
         say="Medical alerts are encrypted, and stay hidden until you need them.",
         caption="Medical alerts are encrypted,\nand stay hidden until you need them."),
    dict(id="07_ontario",
         say="Made for French Catholic schools in Ontario: rotating days, rotary periods, prière du matin and all.",
         caption="Made for French Catholic schools in Ontario:\nrotating days, rotary periods, prière du matin and all."),
    dict(id="08_soon",
         say="Coming soon: sick at six a.m.? One tap will build a full substitute plan, right where your class left off.",
         caption="Coming soon: sick at 6 a.m.? One tap will build\na full substitute plan, right where your class left off."),
    dict(id="09_end",
         say="Lynx École. Less paperwork, more teaching. We'd love to know what you think.",
         caption="Lynx École. Less paperwork, more teaching.\nWe'd love to know what you think."),
]

LINES_FR = [
    dict(id="01_monday",
         say="Lundi matin. La cloche n'a pas encore sonné, et vous jonglez déjà avec mille choses.",
         caption="Lundi matin. La cloche n'a pas encore sonné,\net vous jonglez déjà avec mille choses."),
    dict(id="02_today",
         say="Avec Lynx École, l'écran « Aujourd'hui » montre toute votre journée : chaque période, chaque routine et la prochaine leçon de chaque matière.",
         caption="L'écran « Aujourd'hui » montre toute votre journée :\nchaque période, chaque routine et la prochaine leçon."),
    dict(id="03_adjusts",
         say="Journée pédagogique? Messe de l'école? Départ hâtif? Votre journée s'ajuste toute seule.",
         caption="Journée pédagogique? Messe de l'école? Départ hâtif?\nVotre journée s'ajuste toute seule."),
    dict(id="04_onetap",
         say="Leçon donnée? Une seule touche, et votre planification avance d'elle-même.",
         caption="Leçon donnée? Une seule touche,\net votre planification avance d'elle-même."),
    dict(id="05_private",
         say="Votre liste de classe reste privée : les prénoms seulement. Le reste ne quitte jamais votre appareil.",
         caption="Votre liste de classe reste privée : les prénoms seulement.\nLe reste ne quitte jamais votre appareil."),
    dict(id="06_alerts",
         say="Les alertes médicales sont chiffrées, et restent cachées jusqu'à ce que vous en ayez besoin.",
         caption="Les alertes médicales sont chiffrées,\net restent cachées jusqu'à ce que vous en ayez besoin."),
    dict(id="07_ontario",
         say="Conçue pour les écoles catholiques de langue française de l'Ontario : jours en rotation, enseignement en rotation, prière du matin et tout le reste.",
         caption="Conçue pour les écoles catholiques de langue française de l'Ontario :\njours en rotation, prière du matin et tout le reste."),
    dict(id="08_soon",
         say="Bientôt : malade à six heures du matin? Une seule touche préparera un plan de suppléance complet pour la personne suppléante, exactement là où votre classe est rendue.",
         caption="Bientôt : malade à 6 h du matin? Une seule touche préparera\nun plan de suppléance complet, là où votre classe est rendue."),
    dict(id="09_end",
         say="Lynx École. Moins de paperasse, plus d'enseignement. Dites-nous ce que vous en pensez!",
         caption="Lynx École. Moins de paperasse, plus d'enseignement.\nDites-nous ce que vous en pensez!"),
]

LINES = LINES_EN  # backwards-compatible alias

# English phonemizer output -> French-ish pronunciation (Kokoro IPA vocab)
PHONEME_FIXES_EN = [
    ("ɪkˈoʊl", "ekˈɔl"),                       # École
    ("pɹˈaɪɚ dˈuː mˈætɪn", "pɹiˈɛɹ dy matˈɛ̃"),  # prière du matin
]
# espeak fr-fr slips
PHONEME_FIXES_FR = [
    ("oʒuʁdyˈi", "oʒuʁdɥˈi"),      # Aujourd'hui: /ɥ/ glide, not "dou-i"
    ("papʁˈas", "papəʁˈas"),       # paperasse: keep the schwa
    ("pʁepaʁʁˈa", "pʁepaʁəʁˈa"),   # préparera: doubled r
    ("bjɛ̃tˈoː", "bjɛ̃tˈo"),         # Bientôt: no long vowel
]
PHONEME_FIXES = PHONEME_FIXES_EN

VOICE_CFG = {
    "en": dict(voice="af_heart", lang="en-us", speed=0.95, lines=LINES_EN, fixes=PHONEME_FIXES_EN, json="voice.json", prefix="voice_"),
    "fr": dict(voice="ff_siwis", lang="fr-fr", speed=1.0, lines=LINES_FR, fixes=PHONEME_FIXES_FR, json="voice-fr.json", prefix="voice_fr_"),
}


def make_voice(lang: str = "en", speed: float | None = None) -> list[dict]:
    """Generate one wav per line (24 kHz mono from Kokoro, resampled to SR). Returns metadata."""
    from kokoro_onnx import Kokoro  # imported lazily (slow)

    cfg = VOICE_CFG[lang]
    speed = cfg["speed"] if speed is None else speed
    os.makedirs(BUILD, exist_ok=True)
    k = Kokoro(MODEL, VOICES)
    meta = []
    for line in cfg["lines"]:
        ph = k.tokenizer.phonemize(line["say"], lang=cfg["lang"])
        for a, b in cfg["fixes"]:
            ph = ph.replace(a, b)
        samples, sr = k.create(ph, voice=cfg["voice"], speed=speed, lang=cfg["lang"], is_phonemes=True)
        samples = np.asarray(samples, dtype=np.float32)
        raw = os.path.join(BUILD, f"{cfg['prefix']}{line['id']}_24k.wav")
        wav = os.path.join(BUILD, f"{cfg['prefix']}{line['id']}.wav")
        sf.write(raw, samples, sr)
        # high-quality resample to SR with ffmpeg (soxr if available, swr otherwise)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-ar", str(SR), "-ac", "1", wav], check=True)
        dur = len(samples) / sr
        meta.append(dict(id=line["id"], say=line["say"], caption=line["caption"], phonemes=ph,
                         wav=wav, duration=round(dur, 3)))
        print(f"{line['id']}: {dur:5.2f}s  {ph}")
    with open(os.path.join(BUILD, cfg["json"]), "w") as f:
        json.dump(meta, f, indent=1, ensure_ascii=False)
    return meta


# ---------------------------------------------------------------------------
# Music
# ---------------------------------------------------------------------------
BPM = 96
BEAT = 60.0 / BPM
BAR = 4 * BEAT


def note(name: str) -> float:
    """'C4' -> Hz"""
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    n = names[name[0]]
    rest = name[1:]
    if rest.startswith("#"):
        n += 1
        rest = rest[1:]
    octave = int(rest)
    midi = 12 * (octave + 1) + n
    return 440.0 * 2 ** ((midi - 69) / 12)


_pluck_cache: dict = {}


def pluck(freq: float, dur: float, rng: np.random.Generator, bright: float = 0.5, decay: float = 0.996) -> np.ndarray:
    """Karplus-Strong plucked string, block-vectorized. Returns mono float array."""
    key = (round(freq, 2), round(dur, 2), bright, decay)
    if key in _pluck_cache:
        return _pluck_cache[key]
    N = max(2, int(round(SR / freq)))
    total = int(dur * SR)
    nblocks = total // N + 2
    out = np.zeros((nblocks + 1) * N, dtype=np.float64)
    seed = rng.uniform(-1, 1, N)
    # soften the excitation a little (less "clicky"): mix noise with a low-passed version
    lp = np.convolve(seed, np.ones(3) / 3, mode="same")
    out[:N] = (1 - bright) * lp + bright * seed
    for k in range(1, nblocks + 1):
        prev = out[k * N - N - 1: k * N]  # N+1 samples (first one is last of block k-2)
        if k == 1:
            prev = np.concatenate(([0.0], out[:N]))
        out[k * N:(k + 1) * N] = decay * 0.5 * (prev[1:] + prev[:-1])
    out = out[:total]
    # gentle fade out so nothing clicks at the end
    fade = min(total, int(0.05 * SR))
    out[-fade:] *= np.linspace(1, 0, fade)
    out /= max(1e-6, np.abs(out).max())
    _pluck_cache[key] = out
    return out


def env_exp(n: int, tau: float, attack: float = 0.002) -> np.ndarray:
    t = np.arange(n) / SR
    e = np.exp(-t / tau)
    a = int(attack * SR)
    if a > 0:
        e[:a] *= np.linspace(0, 1, a)
    return e


def add(buf: np.ndarray, sig: np.ndarray, t0: float, gain: float = 1.0):
    i = int(t0 * SR)
    if i < 0:  # event jittered before t=0: drop the part before the start
        sig = sig[-i:]
        i = 0
    if i >= len(buf) or len(sig) == 0:
        return
    n = min(len(sig), len(buf) - i)
    buf[i:i + n] += gain * sig[:n]


def make_music(duration: float, seed: int = 7) -> np.ndarray:
    """Original, procedural background track of `duration` seconds (stereo float32, peak ~0.9)."""
    rng = np.random.default_rng(seed)
    n = int(duration * SR) + SR
    L = np.zeros(n)
    R = np.zeros(n)

    # Chord voicings (ukulele-ish, re-entrant GCEA): I  V  vi  IV in C
    chords = [
        ["G4", "C4", "E4", "C5"],   # C
        ["G4", "D4", "G4", "B4"],   # G
        ["A4", "C4", "E4", "A4"],   # Am
        ["A4", "C4", "F4", "A4"],   # F
    ]
    bass_roots = ["C2", "G2", "A2", "F2"]
    # island strum in 8ths: (beat offset, direction, accent)
    strum = [(0.0, 1, 1.0), (1.0, 1, 0.8), (1.5, -1, 0.6), (2.5, -1, 0.7), (3.0, 1, 0.9), (3.5, -1, 0.6)]

    nbars = int(np.ceil(duration / BAR)) + 1
    for bar in range(nbars):
        t_bar = bar * BAR
        ch = chords[bar % 4]
        # --- ukulele strums
        for off, direction, acc in strum:
            t = t_bar + off * BEAT + rng.normal(0, 0.004)
            order = ch if direction > 0 else ch[::-1]
            for si, name in enumerate(order):
                f = note(name) * (1 + rng.normal(0, 0.0015))
                p = pluck(f, 1.6, rng, bright=0.45 if direction > 0 else 0.6)
                g = 0.16 * acc * rng.uniform(0.85, 1.0)
                # slight stereo spread by string
                pan = (si - 1.5) / 1.5 * 0.35
                add(L, p, t + si * 0.014, g * (1 - pan) / 1.0)
                add(R, p, t + si * 0.014, g * (1 + pan) / 1.0)
        # --- soft bass on 1 and 3 (and a pickup on 4.5 every other bar)
        root = note(bass_roots[bar % 4])
        for off in ([0.0, 2.0] + ([3.5] if bar % 2 == 1 else [])):
            dur = 0.9 if off != 3.5 else 0.4
            nn = int(dur * SR)
            tt = np.arange(nn) / SR
            f = root if off != 3.5 else root * 1.5  # fifth as pickup
            sig = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * 2 * f * tt)) * env_exp(nn, 0.35, 0.01)
            add(L, sig, t_bar + off * BEAT, 0.15)
            add(R, sig, t_bar + off * BEAT, 0.15)
        # --- shaker on 8ths (off-beats louder) - band-passed noise
        for e in range(8):
            t = t_bar + e * BEAT / 2 + rng.normal(0, 0.003)
            nn = int(0.09 * SR)
            noise = rng.normal(0, 1, nn)
            noise = np.diff(noise, prepend=0)  # high-pass
            noise = np.convolve(noise, np.ones(2) / 2, mode="same")
            sig = noise * env_exp(nn, 0.02, 0.004)
            g = (0.035 if e % 2 else 0.02) * rng.uniform(0.8, 1.1)
            add(L, sig, t, g * 0.8)
            add(R, sig, t, g * 1.0)
        # --- soft claps on 2 and 4 from bar 2 on
        if bar >= 1:
            for off in (1.0, 3.0):
                for flam in range(3):
                    t = t_bar + off * BEAT + flam * 0.011 + rng.normal(0, 0.002)
                    nn = int(0.12 * SR)
                    noise = rng.normal(0, 1, nn)
                    # crude band-pass: smooth then high-pass
                    noise = np.convolve(noise, np.ones(6) / 6, mode="same")
                    noise = np.diff(noise, prepend=0)
                    sig = noise * env_exp(nn, 0.035, 0.002)
                    add(L, sig, t, 0.07)
                    add(R, sig, t, 0.07)
        # --- glockenspiel motif every 2 bars (chord tones), from bar 2, not in the last bars
        if bar >= 2 and bar % 2 == 0 and bar < nbars - 2:
            motif = [(0.0, ch[3]), (0.5, ch[2]), (1.0, ch[0]), (2.0, ch[3]), (2.5, "C5" if bar % 4 else "D5")]
            for off, name in motif:
                f = note(name) * 2  # one octave up
                nn = int(0.8 * SR)
                tt = np.arange(nn) / SR
                sig = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2.76 * f * tt) * np.exp(-tt * 12)) * env_exp(nn, 0.22, 0.001)
                add(L, sig, t_bar + off * BEAT, 0.05)
                add(R, sig, t_bar + off * BEAT, 0.065)

    music = np.stack([L, R], axis=1)[: int(duration * SR)]
    # simple one-pole low-pass for warmth (~6 kHz)
    a = np.exp(-2 * np.pi * 6000 / SR)
    for c in range(2):
        y = music[:, c].copy()
        # vectorized IIR via lfilter-free trick: use cumulative recursion in chunks (python loop is too slow) -> use scipy-free approach
        y = _onepole(y, a)
        music[:, c] = y
    # fade in / out
    fi = int(1.0 * SR)
    fo = int(2.5 * SR)
    music[:fi] *= np.linspace(0, 1, fi)[:, None]
    music[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.5
    music /= max(1e-6, np.abs(music).max())
    return (0.9 * music).astype(np.float32)


def _onepole(x: np.ndarray, a: float) -> np.ndarray:
    """y[n] = (1-a) x[n] + a y[n-1], computed blockwise with numpy to avoid a Python sample loop."""
    n = len(x)
    B = 4096
    y = np.empty_like(x)
    prev = 0.0
    powers = a ** np.arange(1, B + 1)
    for s in range(0, n, B):
        blk = x[s:s + B] * (1 - a)
        m = len(blk)
        # y = filter(blk) + prev * a^k ; filter via cumulative trick: y[k] = sum_j a^(k-j) blk[j]
        # use recursion in log-steps (scan) for exactness
        acc = blk.copy()
        step = 1
        coef = a
        while step < m:
            acc[step:] += coef * acc[:-step]
            step *= 2
            coef = coef ** 2
        acc += prev * powers[:m]
        y[s:s + m] = acc
        prev = acc[-1]
    return y


# ---------------------------------------------------------------------------
# Mix
# ---------------------------------------------------------------------------

def smooth_env(x: np.ndarray, attack: float, release: float) -> np.ndarray:
    """Envelope follower on |x| with separate attack/release (block approximation)."""
    hop = 480  # 10 ms
    n = len(x)
    nb = n // hop + 1
    blocks = np.abs(x[: nb * hop] if len(x) >= nb * hop else np.pad(x, (0, nb * hop - n))).reshape(nb, hop).max(axis=1)
    env = np.zeros(nb)
    ca = np.exp(-0.01 / attack)
    cr = np.exp(-0.01 / release)
    e = 0.0
    for i, b in enumerate(blocks):
        c = ca if b > e else cr
        e = c * e + (1 - c) * b
        env[i] = e
    return np.interp(np.arange(n), np.arange(nb) * hop, env)


def mix(voice_meta: list[dict], starts: list[float], total: float, out_wav: str, seed: int = 7) -> dict:
    """Place voice lines at `starts` seconds, add ducked music, write a stereo 48 kHz wav. Returns stats."""
    n = int(total * SR)
    voice = np.zeros(n)
    for m, t0 in zip(voice_meta, starts):
        v, sr = sf.read(m["wav"], dtype="float64")
        if v.ndim > 1:
            v = v.mean(axis=1)
        assert sr == SR, sr
        # normalize every line to the same peak so levels are even
        v = v / max(1e-6, np.abs(v).max()) * 0.8
        add(voice, v, t0)
    # voice loudness target: RMS over speaking parts ~ -18 dBFS, peak <= -1.5 dBFS
    speaking = np.abs(voice) > 0.02
    rms = np.sqrt(np.mean(voice[speaking] ** 2)) if speaking.any() else 0.1
    g = 10 ** (-18 / 20) / rms
    g = min(g, 10 ** (-1.5 / 20) / max(1e-6, np.abs(voice).max()))
    voice *= g

    music = make_music(total, seed=seed).astype(np.float64)
    # music base level ~ -18 dBFS RMS overall (about -24 dBFS in the gaps), ducked -9 dB under speech
    mrms = np.sqrt(np.mean(music ** 2))
    music *= 10 ** (-18 / 20) / mrms
    env = smooth_env(voice, attack=0.02, release=0.5)
    duck = 1 - 0.65 * np.clip(env / 0.05, 0, 1)   # 1.0 -> 0.35 (-9 dB)
    music *= duck[:, None]

    out = music + voice[:, None]
    # soft limiter (only bites above ~0.85)
    thr = 0.85
    over = np.abs(out) > thr
    out[over] = np.sign(out[over]) * (thr + (1 - thr) * np.tanh((np.abs(out[over]) - thr) / (1 - thr)))
    peak = float(np.abs(out).max())
    spoken = np.zeros(n, bool)
    for m, t0 in zip(voice_meta, starts):
        spoken[int(t0 * SR): int((t0 + m["duration"]) * SR)] = True
    speaking = spoken
    stats = dict(
        peak_dbfs=round(20 * np.log10(peak), 2),
        voice_rms_dbfs=round(20 * np.log10(np.sqrt(np.mean(voice[speaking] ** 2))), 2),
        music_rms_dbfs_gap=round(20 * np.log10(np.sqrt(np.mean(music[~speaking] ** 2)) + 1e-9), 2),
        music_rms_dbfs_under_voice=round(20 * np.log10(np.sqrt(np.mean(music[speaking] ** 2)) + 1e-9), 2),
        limited_samples=int(over.sum()),
    )
    sf.write(out_wav, out.astype(np.float32), SR, subtype="PCM_24")
    return stats


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "voice":
        make_voice(sys.argv[2] if len(sys.argv) > 2 else "en")
    elif len(sys.argv) > 1 and sys.argv[1] == "music":
        m = make_music(float(sys.argv[2]) if len(sys.argv) > 2 else 20.0)
        sf.write(os.path.join(BUILD, "music_test.wav"), m, SR)
        print("wrote music_test.wav", m.shape)
