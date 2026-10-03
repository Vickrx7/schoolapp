# Marketing

Promotional material for the platform (working name « Lynx École », set by
`APP_NAME`; D-002). French first (Canadian French, Ontario school usage, inclusive
writing), with a complete English version.

## The rule: claims only what ships

Every sentence must be true of the development build today. Use these labels, and nothing
stronger:

| Label (FR / EN)                                             | Use it for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| « Disponible (version pilote) » / "Available (pilot build)" | Phases 1–6 and the three features built after them: built and covered by automated tests. Since Phase 6 this includes the « Tableau de bord de la direction », the « Journal d’audit » (office-issued code flag, CSV), « Conseil » (staff, schools, years, reviewers, AI use per school, feedback, the board’s log), « Bienvenue » and the pilot terms, « Pour bien commencer » and the sample class, « Commentaires », « Nouveautés », the public privacy page, nightly retention with the 60-day notice, the board-hosted Docker install (signed, encrypted backups, health checks) and sign-in throttling. Since 2026-10-03 (versions 0.7 to 0.9, `docs/mon-annee.md`, `docs/report-comments.md`, `docs/info-parents.md`): « Mon année » with « Couverture », the « Plan à long terme (PDF) » and the board’s « Périodes de bulletin »; « Commentaires de bulletin » (comment banks, « Créer une banque de commentaires avec l’IA », the « Bulletins » composer); « Info-parents » with « Traduire en anglais (IA) ». Not a live service, and nobody has used it in a real school yet (`docs/HANDOFF.md` §2). |
| « Bientôt » / "Coming soon"                                 | What is left before the pilot (`docs/PILOT.md` § 1, `DEPLOYMENT.md` § 3.11): the hosted install in Canada going online, Supabase’s written answer on its logs and backups, the restore drill and outside monitoring, the zero-data-retention request to Anthropic, the lawyer’s review of the terms, the first run of the real AI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| « Vision » / "Later"                                        | SPEC §12 modules. Never give a date. A parent portal and parent accounts stay here: « Info-parents » is a message the teacher copies or prints. Report card comments left the Vision list on 2026-10-03; the IEP log stays.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

« En construction » is no longer used: nothing is half-built today.

Privacy claims must match `PRIVACY.md`, `docs/ai-data-flow.md` and `DECISIONS.md` exactly:

- Say what the product does. Claim no certification or compliance (no SOC 2, ISO 27001, privacy
  impact assessment, penetration test, Ministry or board approval, lawyer’s review), and never say
  « 100 % sécuritaire », « chiffrement de bout en bout » or « toutes les données sont chiffrées »:
  in the database, the app encrypts alerts and report notes only (backups are encrypted whole
  before they leave the server).
- Nothing is hosted yet. Say « conçu pour être hébergé au Canada », never « vos données sont au
  Canada ». The board-hosted install exists and is tested in CI, but no board has installed it.
- AI: the app replaces the names it knows (the students and staff of the teacher’s schools) with
  markers; it does not recognize other names typed in free text (a parent’s, a sibling’s), which
  the teacher removes, since she sees and edits the exact text before it is sent. Never write
  « l’IA ne voit jamais un nom » or « aucun renseignement personnel ne quitte le Canada ». The text
  sent is processed in the United States (Claude, by Anthropic) and kept for a limited time under
  Anthropic’s commercial terms: the zero-data-retention request has not been sent. The real AI has
  never been called, for any feature (« Texte différencié », « Consignes détaillées », « Créer avec
  l’IA », bulk generation, « Créer une banque de commentaires avec l’IA », « Traduire en anglais
  (IA) »): make no quality or time-saved claims and show no AI output.
- Report card comments (« Bulletins »): composed in the teacher’s browser and never sent to our
  servers or to the AI; no AI reads a comment about a student. On the device the class’s first
  names are stored as markers (other names the teacher types stay as typed). They are erased at
  sign-out, or when the app next opens in that browser for another account, or for the first time
  after their date (60 days after the report goes home, or after the last chosen date). A browser
  where the app never opens again keeps them until its data is cleared: never write that they are
  erased on a schedule or « au plus tard le … ». « Créer une banque de commentaires avec l’IA » sends
  curriculum labels and the teacher’s « Précisions » only (known names replaced, a title before an
  unknown name blocks the request, « J’ai vérifié »).
- « Info-parents » sends nothing to families and stores no family contact: the teacher copies or
  prints it. It is not a parent portal. « Traduire en anglais (IA) » sends the French paragraphs
  with known names replaced and the grade, holds back a paragraph with a detected detail or a
  title not followed by a known name, lists capitalized words, and needs « J’ai vérifié ». A name
  without a title is listed, not blocked, and not always listed: say so next to any claim about
  the translation.
- « Couverture » counts only the attentes loaded in the app; a new board has none, and the demo
  has a partial, paraphrased sample (3e and 5e) marked « À vérifier ». Never write « couverture du
  curriculum complète » or « conforme au curriculum ».
- No board is a client and the pilot has not started. Name no board and show no board logo.
- The absence takes two taps, not one.

Before changing any claim, check it against `docs/HANDOFF.md` §2, the phase notes
(`docs/phase-1.md` to `docs/phase-6.md`, with Phase 6’s « Final review », and the three feature
docs), `PRIVACY.md` (release 0.9) and `DECISIONS.md`, and relabel it when a feature ships.

## Files

| Path                   | What                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site/index.html`      | Bilingual landing page for pilot teachers, principals and school-board decision makers. FR/EN toggle (remembered in the browser; it also swaps every `alt`), sections for the teacher’s day, the substitute day, the library and class mode, the school year (« Mon année », « Commentaires de bulletin », « Info-parents »), privacy, principals and boards, the first sign-in, a form that sends nothing. |
| `site/assets/`         | Twenty-two screenshots of the development build (WebP, 15–75 KB each), shown next to the sections they illustrate. See « Screenshots ».                                                                                                                                                                                                                                                                     |
| `one-pager/index.html` | Board brief: French, then English. Each language prints on one letter page (2 pages in all), with a line per post-MVP feature (« Année scolaire ») and three screenshots: the plan, the audit log, « Administration du conseil » (cropped to their top in print).                                                                                                                                           |
| `one-pager/assets/`    | Smaller copies (760 px wide) of `plan-desktop`, `audit-desktop` and `board-desktop`, for the brief.                                                                                                                                                                                                                                                                                                         |
| `promo/script-v5.md`   | 60-second promo script, French and English, scene by scene, with the full voice-over: the sick day in two beats, then « Mon année », « Bulletins » and « Info-parents », then principals. Replaces `script-v4.md`.                                                                                                                                                                                          |
| `promo/script-v4.md`   | The previous 60-second script (Phases 1 to 6), kept for its library, class-mode and board scenes. `script-v3.md` has longer library and class-mode scenes; `script-v2.md` has the AI scene.                                                                                                                                                                                                                 |
| `promo/`               | v1 stop-motion promo sources (Phase 1 claims; its sick-day scene is out of date, see its README).                                                                                                                                                                                                                                                                                                           |

## Screenshots

`site/assets/` holds real captures of the development build, taken with the demo seed
(`tools/lite-stack/stack.sh reset`), `next start`, the fake AI worker and Playwright, in French
(`fr-CA`, America/Toronto), phone 390 × 844 at 2× (saved 560 wide), desktop 1280 × 800:

| File                           | Size       | Taken      | Shows                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `today-phone.webp`             | 560 × 1212 | 2026-09-30 | « Aujourd’hui » on a phone.                                                                                                                                                                                                                                                              |
| `absence-phone.webp`           | 560 × 1212 | 2026-09-30 | The absence form after tap 1, with « Envoyer ».                                                                                                                                                                                                                                          |
| `plan-desktop.webp`            | 1280 × 800 | 2026-09-30 | « Réviser le plan »: the Français period with a library resource, one version per group.                                                                                                                                                                                                 |
| `office-desktop.webp`          | 1280 × 680 | 2026-09-30 | The office’s « Suppléances du jour » with one code and one device.                                                                                                                                                                                                                       |
| `substitute-phone.webp`        | 560 × 1212 | 2026-09-30 | The substitute’s « Maintenant » / « Ensuite » (phone clock set to 11 h 20 on the day).                                                                                                                                                                                                   |
| `library-search.webp`          | 1280 × 800 | 2026-09-30 | Search « huard » with its filters.                                                                                                                                                                                                                                                       |
| `library-item.webp`            | 1280 × 800 | 2026-09-30 | « Le huard, oiseau des lacs » and its five versions.                                                                                                                                                                                                                                     |
| `coverage.webp`                | 1280 × 800 | 2026-09-30 | « Couverture du curriculum », 3e année Mathématiques.                                                                                                                                                                                                                                    |
| `projector.webp`               | 1280 × 800 | 2026-09-30 | A quiz on the projector after « Afficher la réponse ».                                                                                                                                                                                                                                   |
| `tablet-join.webp`             | 928 × 330  | 2026-09-30 | A class tablet after joining (« Tu es l’appareil 1 »), cropped to its content.                                                                                                                                                                                                           |
| `direction-desktop.webp`       | 1280 × 800 | 2026-10-02 | « Tableau de bord de la direction » on the day of Isabelle’s absence: « Publié », 1 code, 1 device, « Suivi reçu », and the alert entries with « Code émis par le secrétariat ».                                                                                                         |
| `audit-desktop.webp`           | 1280 × 800 | 2026-10-02 | The principal’s « Journal d’audit », category « Alertes »: the substitute’s read, « code émis par Julie Bergeron », with the office-issued badge.                                                                                                                                        |
| `board-desktop.webp`           | 1280 × 800 | 2026-10-02 | « Administration du conseil »: the board’s checklist (5 of 5), « État du système » on install day (first backup « prévu »), « Conservation des données ».                                                                                                                                |
| `staff-desktop.webp`           | 1280 × 800 | 2026-10-02 | « Conseil » › « Personnel »: seven demo people, roles and access states. The e-mail column is blurred (CSS blur added before the capture).                                                                                                                                               |
| `feedback-desktop.webp`        | 1280 × 560 | 2026-10-02 | « Commentaires reçus »: a teacher typed « Samuel aimerait… », the board reads « [élève] aimerait… ». Cropped below the card.                                                                                                                                                             |
| `start-phone.webp`             | 560 × 1212 | 2026-10-02 | A newly invited teacher’s « Aujourd’hui »: « Pour bien commencer » (0 of 4) and her sample class.                                                                                                                                                                                        |
| `sample-class-phone.webp`      | 560 × 1212 | 2026-10-02 | « Classe exemple (3e année) » with its « Exemple » badge, the 60-day notice and its two units.                                                                                                                                                                                           |
| `year-desktop.webp`            | 1280 × 800 | 2026-10-03 | « Mon année · 2026-2027 », 3e année: « Planifier une unité », the PDF option and button, then September to November with the calendar (PA day, Thanksgiving, masses), the progress report’s dates, Advent, and the Français and Mathématiques units (two « En cours », one « À venir »). |
| `coverage-class-phone.webp`    | 560 × 1212 | 2026-10-03 | « Couverture », 3e Français, domaine C: C1.1 and C1.3 « Enseignée » with their lessons, C1.2 « Prévue », C1.4 « Pas encore prévue », each « À vérifier ».                                                                                                                                |
| `report-comments-desktop.webp` | 1280 × 800 | 2026-10-03 | « Bulletins », 1re étape, Mathématiques: the 20 demo students (Adam, Aïcha, Chloé « Prêt »), Aïcha at « Féminin », level 3, the demo bank’s strengths with one ticked (B1.1).                                                                                                            |
| `newsletter-desktop.webp`      | 1280 × 800 | 2026-10-03 | The « Info-parents » editor, « Dates à retenir »: French and English side by side, each « English : préparé par l’application ».                                                                                                                                                         |
| `newsletter-pdf.webp`          | 816 × 1056 | 2026-10-03 | The French PDF of the same untouched first draft (week of 28 September), rendered at 96 dpi with PyMuPDF: no student named.                                                                                                                                                              |

The 2026-10-02 set was taken after a fresh reset: Isabelle added an alert for Samuel and reported
an absence for that day, Julie issued a code, a substitute opened the plan, revealed and hid the
alerts and sent the report; Nathalie invited a throwaway teacher (« Chantal Demers »,
`@demo.lynx.test`), who then signed in on a phone, accepted « Bienvenue », created the 3e sample
class and sent one comment. Chromium ran with `LANGUAGE=fr_CA:fr`, so date fields read
day/month/year, not the US order. The stack was reset again afterwards.

The 2026-10-03 set was taken after the post-MVP review (code at `8702004`), after a fresh reset, as
Isabelle, on a Saturday (the demo’s current week is that of 28 September): « Mon année » scrolled
to its heading, « Couverture » of 3e Français scrolled to domaine C on a phone, « Bulletins » in a
fresh browser context (Adam and Chloé given a level and two entries, then Aïcha; the comments
stayed in that context and went with it), and « Info-parents » prepared for the week with
« Préparer le message » and not edited. The school’s AI stayed off, so no AI screen was captured.
The stack was reset again afterwards.

Rules for any new capture: demo first names and demo staff only, never an alert’s text, never an
AI result (fake provider), no e-mail address (blur it, as on « Personnel »), no toast or focus ring
left over, nothing that looks like real personal data. Two screens are not used on purpose:

- the projector lobby (« Rejoignez la partie ») shows the development address (`localhost`);
  retake it with a neutral address before using it;
- « Bienvenue » says « Les données sont conservées au Canada », true of the hosted design but not
  yet of any live service; use it once hosting is live.

Retake the captures when the screens change.

## The two HTML pages

- They are written to be published as claude.ai Artifacts: no `<!doctype>`, `<html>`, `<head>`
  or `<body>` (the host adds them), fonts from Google Fonts only, everything else in the file or
  in `assets/`, light and dark themes, no horizontal scroll at 390 px. They also open directly in
  a browser.
- **Images are separate files.** Both pages reference `assets/<name>.webp` by relative path. When
  publishing a page as an Artifact, publish its `assets/` folder with it (the Artifact tool’s
  `files` map, published path `assets/<name>.webp`), or the images will be missing. The site uses
  all twenty-two files in `site/assets/`; the one-pager uses the three in `one-pager/assets/`
  (`library-item.webp` and `projector.webp` left the one-pager on 2026-10-02).
- No print button (Artifacts can’t print). The one-pager’s `@media print` rules make each language
  one letter page; check it still prints on 2 pages after any change (Chrome, Letter, default
  margins). Since the « Année scolaire » row (2026-10-03) each page has about 9 px to spare, and
  print crops the three screenshots to their top 30 mm: shorten a line before adding one.
- **Before sharing:**
  - The contact address `pilote@iplynx.ca` is a placeholder. Nobody has confirmed that mailbox.
    Change `CONTACT_EMAIL` in `site/index.html` (the script writes it into every
    `[data-contact-email]`; change the fallback text of those three elements too) and the two
    `.contact` lines in `one-pager/index.html` (each marked with a « Placeholder » comment).
  - To rename the product, change `APP_NAME` in `site/index.html` (every `[data-app-name]`
    follows) and the name in `one-pager/index.html`.
- Both files pass `prettier --check`. French typography: a no-break space (U+00A0) inside « »,
  before « : », in times (« 8 h 45 »), units (« 30 s »), thousands (« 1 000 »), markers
  (« Élève A ») and between a number and its noun (« 14 jours »); a narrow no-break space (U+202F)
  before « ; », « ! » and « ? ». The app’s own catalogue puts no space before the question and
  exclamation marks (Canadian usage); the pages follow the rule above and keep the app’s words.
  Keep them when editing.
- Wording traps found in review:
  - « Activités pour les élèves » exists when the plan uses a library resource or when
    « Consignes détaillées (IA) » add an activity.
  - Only alerts and report notes are encrypted by the app, and a code works for whoever holds it,
    alerts included. Keep both next to any encryption or alert claim.
  - Only the names the app knows become markers (the students and staff of the teacher’s schools);
    the detectors block emails, phone numbers, identification numbers, addresses and a child’s
    birth date, not "any personal detail". The library’s first-name check knows the teacher’s own
    students only. Feedback replaces the first names of the students of the sender’s schools.
  - Students have no accounts, but they do have one screen: the class-mode quiz on a class
    device, which carries a number, never a name. Don’t write « les élèves n’ont pas d’écran ».
  - The library holds 78 resources written for the demo (« à valider en classe »; 19 have
    versions for every level) and a paraphrased curriculum sample (265 entries, 3e and 5e année,
    « À vérifier »). Never write « des milliers de ressources », « aligné sur le curriculum » or
    « approuvé par votre conseil ».
  - Class mode has not been tried on real classroom hardware (projectors, school Wi-Fi filters,
    managed Chromebooks, iPads). Exit tickets are projected, not played on devices.
  - Bulk generation and content packs are operator tools with no screens; bulk generation has
    only run with the fake provider.
  - Board admins do not set budgets, modules or retention: whoever runs the server applies them at
    the board’s request. The retention minimums wait for a lawyer’s review. IP Lynx recording its
    access in the board’s log is an operating rule, not something the database enforces.
  - The principal’s dashboard shows no figure per teacher and never units, lessons or progress;
    the board’s log never shows absences, substitute days or alert reads.
  - In English, write "the principal" (or "principal or vice-principal"), not "the direction".
  - Never call report card comments « Commentaires » alone: that is the feedback button. Write
    « Commentaires de bulletin », or « Bulletins » for the class tab. The English app says "My
    year", "Coverage", "Report cards" and "Family newsletter"; the English site uses those words
    and keeps « Info-parents » as the feature’s name.
  - The « Bulletins » capture shows a demo bank written by hand for the demo, not AI output, and
    « Info-parents » drafts its message without AI: only the optional translation uses AI.
  - The direction, the office and the board never see « Mon année », « Couverture » or the
    « Info-parents » messages, and nobody but the teacher’s browser holds report card comments.
