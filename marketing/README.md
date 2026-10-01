# Marketing

Promotional material for the platform (working name « Lynx École », set by
`NEXT_PUBLIC_APP_NAME`; D-002). French first (Canadian French, Ontario school usage, inclusive
writing), with a complete English version.

## The rule: claims only what ships

Every sentence must be true of the development build today. Use these labels, and nothing
stronger:

| Label (FR / EN)                                             | Use it for                                                                                                                                                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| « Disponible (version pilote) » / "Available (pilot build)" | Phases 1–5, including the « Banque de ressources » and the « Mode classe »: built and covered by automated tests. Not a live service, and no real teacher, substitute or class has used it yet (`docs/HANDOFF.md` §2). |
| « Bientôt » / "Coming soon"                                 | Phase 6, before the pilot: hosting in Canada, a Docker install on a board’s servers, onboarding, the principal’s dashboard, the audit log viewer, backups and monitoring (SPEC §13, HANDOFF §6).                       |
| « Vision » / "Later"                                        | SPEC §12 modules. Never give a date.                                                                                                                                                                                   |

« En construction » is no longer used: nothing is half-built today.

Privacy claims must match `DECISIONS.md` and `docs/ai-data-flow.md` exactly:

- Say what the product does. Claim no certification or compliance (no SOC 2, ISO 27001, privacy
  impact assessment, penetration test, Ministry or board approval), and never say « 100 %
  sécuritaire », « chiffrement de bout en bout » or « toutes les données sont chiffrées »: the
  app encrypts alerts and report notes only.
- Nothing is hosted yet. Say « conçu pour être hébergé au Canada », never « vos données sont au
  Canada ».
- The de-identified AI text may be processed outside Canada (Claude, by Anthropic) and is kept
  under the provider’s retention terms. The real AI has never been called, for any feature
  (« Texte différencié », « Consignes détaillées », « Créer avec l’IA », bulk generation): make no
  quality or time-saved claims and show no AI output.
- No board is a client and the pilot has not started. Name no board and show no board logo.
- The absence takes two taps, not one.

Before changing any claim, check it against `docs/HANDOFF.md` §2, the phase notes
(`docs/phase-1.md` to `docs/phase-5.md`) and `DECISIONS.md`, and relabel it when a feature ships.

## Files

| Path                   | What                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site/index.html`      | Bilingual landing page for pilot teachers and school-board decision makers. FR/EN toggle (remembered in the browser; it also swaps every `alt`), pilot form that sends nothing.                      |
| `site/assets/`         | Ten screenshots of the development build (WebP, 15–75 KB each), shown next to the sections they illustrate. See « Screenshots ».                                                                     |
| `one-pager/index.html` | Board brief: French, then English. Each language prints on one letter page (2 pages in all), with three screenshots.                                                                                 |
| `one-pager/assets/`    | Smaller copies (760 px wide) of three site screenshots, for the brief.                                                                                                                               |
| `promo/script-v3.md`   | 60-second promo script, French and English, scene by scene: the two taps, the plan, the code, the library and class mode, built on the screenshots. Replaces `script-v2.md` (kept for its AI scene). |
| `promo/`               | v1 stop-motion promo sources (Phase 1 claims; its sick-day scene is out of date, see its README).                                                                                                    |

## Screenshots

`site/assets/` holds real captures of the development build, taken on 2026-09-30 with the demo
seed (`tools/lite-stack/stack.sh reset`), `next start`, the fake AI worker and Playwright, in
French (`fr-CA`, America/Toronto):

| File                    | Size       | Shows                                                                                    |
| ----------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `today-phone.webp`      | 560 × 1212 | « Aujourd’hui » on a phone (390 × 844).                                                  |
| `absence-phone.webp`    | 560 × 1212 | The absence form after tap 1, with « Envoyer ».                                          |
| `plan-desktop.webp`     | 1280 × 800 | « Réviser le plan »: the Français period with a library resource, one version per group. |
| `office-desktop.webp`   | 1280 × 680 | The office’s « Suppléances du jour » with one code and one device.                       |
| `substitute-phone.webp` | 560 × 1212 | The substitute’s « Maintenant » / « Ensuite » (phone clock set to 11 h 20 on the day).   |
| `library-search.webp`   | 1280 × 800 | Search « huard » with its filters.                                                       |
| `library-item.webp`     | 1280 × 800 | « Le huard, oiseau des lacs » and its five versions.                                     |
| `coverage.webp`         | 1280 × 800 | « Couverture du curriculum », 3e année Mathématiques.                                    |
| `projector.webp`        | 1280 × 800 | A quiz on the projector after « Afficher la réponse ».                                   |
| `tablet-join.webp`      | 928 × 330  | A class tablet after joining (« Tu es l’appareil 1 »), cropped to its content.           |

Rules for any new capture: demo first names and demo staff only, never an alert’s text, never an
AI result (fake provider), no e-mail address, nothing that looks like real personal data. The
projector lobby (« Rejoignez la partie ») shows the development address (`localhost`); retake it
with a neutral address before using it. Retake the captures when the screens change.

## The two HTML pages

- They are written to be published as claude.ai Artifacts: no `<!doctype>`, `<html>`, `<head>`
  or `<body>` (the host adds them), fonts from Google Fonts only, everything else in the file or
  in `assets/`, light and dark themes, no horizontal scroll at 390 px. They also open directly in
  a browser.
- **Images are separate files.** Both pages reference `assets/<name>.webp` by relative path. When
  publishing a page as an Artifact, publish its `assets/` folder with it (the Artifact tool’s
  `files` map, published path `assets/<name>.webp`), or the images will be missing.
- No print button (Artifacts can’t print). The one-pager’s `@media print` rules make each language
  one letter page; check it still prints on 2 pages after any change (Chrome, Letter, default
  margins).
- **Before sharing:**
  - The contact address `pilote@iplynx.ca` is a placeholder. Nobody has confirmed that mailbox.
    Change `CONTACT_EMAIL` in `site/index.html` (the script writes it into every
    `[data-contact-email]`; change the fallback text of those three elements too) and the two
    `.contact` lines in `one-pager/index.html` (each marked with a « Placeholder » comment).
  - To rename the product, change `APP_NAME` in `site/index.html` (every `[data-app-name]`
    follows) and the name in `one-pager/index.html`.
- Both files pass `prettier --check`. French text uses non-breaking spaces inside « » and before
  « : », in times (« 8 h 45 »), units (« 30 s ») and thousands (« 1 000 »), and in markers
  (« Élève A »). Keep them when editing.
- Wording traps found in review:
  - « Activités pour les élèves » exists when the plan uses a library resource or when
    « Consignes détaillées (IA) » add an activity.
  - Only alerts and report notes are encrypted by the app, and a code works for whoever holds it,
    alerts included. Keep both next to any encryption or alert claim.
  - Only known names become markers; the detectors block emails, phone numbers, identification
    numbers, addresses and a child’s birth date, not "any personal detail". The library’s
    first-name check knows the teacher’s own students only.
  - Students have no accounts, but they do have one screen: the class-mode quiz on a class
    device, which carries a number, never a name. Don’t write « les élèves n’ont pas d’écran ».
    -The library holds 78 resources written for the demo (« à valider en classe »; 19 have
    versions for every level) and a
    paraphrased curriculum sample (265 entries, 3e and 5e année, « À vérifier »). Never write
    « des milliers de ressources », « aligné sur le curriculum » or « approuvé par votre conseil ».
  - Class mode has not been tried on real classroom hardware (projectors, school Wi-Fi filters,
    managed Chromebooks, iPads). Exit tickets are projected, not played on devices.
  - Bulk generation and content packs are operator tools with no screens; bulk generation has
    only run with the fake provider.
  - In English, write "the principal" (or "principal or vice-principal"), not "the direction".
