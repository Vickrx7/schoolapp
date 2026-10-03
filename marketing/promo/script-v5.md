# Promo script v5: « De 6 h 05 au bulletin » (60 s, French and English)

v5 keeps v4’s opening (`script-v4.md`, kept as is): the sick day at 6 h 05, now told in two beats.
It then follows the year with the three features built after Phase 6: « Mon année » and
« Couverture », « Commentaires de bulletin » (« Bulletins ») and « Info-parents ». The principal’s
beat is shorter than in v4; the library, class-mode and board beats stay in v4 and v3.

**Rule: claims only what ships.** Every scene below is « Disponible (version pilote) »: built and
covered by automated tests in the development build (Phases 1 to 6 and versions 0.7 to 0.9), not a
live service, and not yet used in a real school. Nothing is hosted, no board is a client, the pilot
has not started, and the real AI has never been called. Sources are listed per scene; the labels
are in `marketing/README.md`.

Status as of 2026-10-03. Target length 60 s for English; the French cut may run a few seconds
longer (scene lengths follow the voice). The full voice-over, French then English, is at the end.

## Scenes

### 1. 6 h 05 (0:00–0:04)

- **Picture:** a dark kitchen, a phone lights up on the counter. The clock reads 6:05. Papercraft
  style as in v1.
- **On screen:** FR « 6 h 05 » / EN « 6:05 a.m. »
- **VO FR:** « 6 h 05. Vous êtes malade. Deux touches : Je suis absente, puis Envoyer. » (The
  speaker reads the button in their own gender. The screen shows « Je suis absent·e ».)
- **VO EN:** "6:05 a.m. You’re sick. Two taps: I’m absent, then Send."
- **Claim:** two taps from « Aujourd’hui » (D-047, D-055; `docs/phase-3.md`).

### 2. Le plan et le code (0:04–0:13)

- **Picture:** `site/assets/absence-phone.webp` (tap 2 on « Envoyer »), then
  `site/assets/plan-desktop.webp`, then `site/assets/substitute-phone.webp` (« Maintenant » /
  « Ensuite »). No alert text: the captures have none.
- **On screen:** FR « Complet sans IA · Un code d’une journée » / EN « Complete without AI · A
  one-day code ».
- **VO FR:** « Votre plan de suppléance est prêt, complet sans IA. Le secrétariat remet un code
  d’une journée, et la personne suppléante vous envoie son suivi. »
- **VO EN:** "Your substitute plan is ready, complete without AI. The office hands out a one-day
  code, and the substitute sends you a report."
- **Claims:** plan built from each class’s progress, complete without AI (D-047, D-052); one-day
  codes (D-050), no substitute account (D-049), end-of-day report (D-054).

### 3. Mon année (0:13–0:24), new in v5

- **Picture:** `site/assets/year-desktop.webp` (the units on the weeks, the calendar row with the
  PA day and Thanksgiving, the report card row, Advent), then
  `site/assets/coverage-class-phone.webp` with a zoom on « Enseignée », « Prévue » and « Pas encore
  prévue ».
- **On screen:** FR « Votre année, semaine par semaine » / EN « Your year, week by week ». Small, on
  the coverage picture: FR « Curriculum de démonstration, à vérifier » / EN « Demo curriculum, to
  verify ».
- **VO FR:** « Placez vos unités sur l’année, avec les congés, les messes et les dates de bulletin.
  Couverture montre, attente par attente, ce que la classe a prévu et enseigné. »
- **VO EN:** "Place your units on the year, with days off, masses and report card dates. Coverage
  shows, expectation by expectation, what the class planned and taught."
- **Claims:** « Mon année » and « Couverture » (D-123 to D-127, `docs/mon-annee.md`). Coverage counts
  only the attentes loaded in the app: the demo has a partial, paraphrased sample marked « À vérifier », and a new board has none until a curriculum is imported. Say nothing about the
  whole curriculum. Private to the class team (D-013).

### 4. Les bulletins (0:24–0:36), new in v5

- **Picture:** `site/assets/report-comments-desktop.webp`: a slow pan from the student list
  (« Prêt · 316 / 1 000 ») to Aïcha’s level 3 and the ticked strength.
- **On screen:** FR « Vos commentaires restent sur votre appareil » / EN « Your comments stay on
  your device ».
- **VO FR:** « Pour les bulletins, choisissez le niveau, cochez les entrées d’une banque, ajustez,
  copiez. Vos commentaires restent dans votre navigateur : jamais envoyés à nos serveurs ni à
  l’IA. »
- **VO EN:** "For report cards, choose the level, tick a bank’s entries, adjust, copy. Your comments
  stay in your browser: never sent to our servers or to the AI."
- **Claims:** « Bulletins » (D-130, D-135, `docs/report-comments.md`); comments composed in the
  browser, never sent to our servers or the AI, no AI reads a comment about a student (`PRIVACY.md`
  § 1, 3, 4, 13). Do not add when or how they are erased in this scene: the full rule (sign-out,
  or the next opening in that browser for another account or after the date) does not fit on
  screen; the site says it.

### 5. Info-parents (0:36–0:47), new in v5

- **Picture:** `site/assets/newsletter-desktop.webp` (French and English side by side,
  « English : préparé par l’application »), then `site/assets/newsletter-pdf.webp` (the printed
  page).
- **On screen:** FR « Rien n’est envoyé aux familles : vous copiez ou imprimez » / EN « Nothing is
  sent to families : you copy or print ».
- **VO FR:** « Info-parents prépare le message de la semaine aux familles, en français et en
  anglais. Vous le relisez, puis vous le copiez ou l’imprimez. »
- **VO EN:** "Info-parents drafts the week’s message to families, in French and English. You read
  it over, then copy or print it."
- **Claims:** the first draft comes from the class’s planning and calendar, without AI (D-137);
  the app sends nothing to families and stores no family contact (D-136, D-141, `PRIVACY.md` § 3,
  13). The English in the pictures was prepared by the app, not translated by AI. « Traduire en
  anglais (IA) » is not shown: it has only run with the fake provider.

### 6. La direction (0:47–0:54)

- **Picture:** `site/assets/direction-desktop.webp` (« Absences aujourd’hui »: « Publié », « 1 code
  actif », « Suivi reçu »), then `site/assets/audit-desktop.webp` with a zoom on « Code émis par le
  secrétariat ».
- **On screen:** FR « Pour la direction » / EN « For principals ».
- **VO FR:** « La direction voit les absences du jour et chaque consultation d’alerte, jamais votre
  planification. »
- **VO EN:** "The principal sees today’s absences and every alert read, never your planning."
- **Claims:** D-102, D-103; the direction never sees units, lessons, progress, « Mon année »,
  « Couverture » or « Info-parents » messages (`PRIVACY.md` § 4, 7). Not yet tried with a real
  principal.

### 7. Carte de fin (0:54–1:00)

- **Picture:** the app icon on a chalkboard.
- **On screen:** FR « Lynx École · Version pilote · Projet pilote gratuit prévu », then small:
  « Nom de travail · Données fictives · Rien n’est encore en ligne ». EN « Lynx École · Pilot build
  · Free pilot planned », then small: « Working name · Fictional data · Nothing is online yet ».
- **VO FR:** « Lynx École. Version pilote : projet pilote gratuit prévu. »
- **VO EN:** "Lynx École. Pilot build. Free pilot planned."
- **Claims:** nothing is hosted and the pilot has not started (`docs/HANDOFF.md` §2, §6); the name
  is a placeholder (D-002).

## Full voice-over

About 135 words in French and 125 in English, read over the scene timings above (not yet timed
with a voice).

### French

« 6 h 05. Vous êtes malade. Deux touches : Je suis absente, puis Envoyer. Votre plan de suppléance
est prêt, complet sans IA. Le secrétariat remet un code d’une journée, et la personne suppléante
vous envoie son suivi. Placez vos unités sur l’année, avec les congés, les messes et les dates de
bulletin. Couverture montre, attente par attente, ce que la classe a prévu et enseigné. Pour les
bulletins, choisissez le niveau, cochez les entrées d’une banque, ajustez, copiez. Vos commentaires
restent dans votre navigateur : jamais envoyés à nos serveurs ni à l’IA. Info-parents prépare le
message de la semaine aux familles, en français et en anglais. Vous le relisez, puis vous le copiez
ou l’imprimez. La direction voit les absences du jour et chaque consultation d’alerte, jamais votre
planification. Lynx École. Version pilote : projet pilote gratuit prévu. »

### English

"6:05 a.m. You’re sick. Two taps: I’m absent, then Send. Your substitute plan is ready, complete
without AI. The office hands out a one-day code, and the substitute sends you a report. Place your
units on the year, with days off, masses and report card dates. Coverage shows, expectation by
expectation, what the class planned and taught. For report cards, choose the level, tick a bank’s
entries, adjust, copy. Your comments stay in your browser: never sent to our servers or to the AI.
Info-parents drafts the week’s message to families, in French and English. You read it over, then
copy or print it. The principal sees today’s absences and every alert read, never your planning.
Lynx École. Pilot build. Free pilot planned."

## Production notes

- **Screens:** use the captures in `marketing/site/assets/` (see `marketing/README.md`): the
  2026-09-30 set for scenes 1 and 2, the 2026-10-03 set for scenes 3 to 5, the 2026-10-02 set for
  scene 6. They show demo names only, no alert text, no AI output and no e-mail address.
- **« Bulletins »:** the entries come from a demo bank written by hand and approved in the demo
  board; say nothing about AI in that scene. Never show a comment with a real student’s name.
- **« Info-parents »:** the pictures show the app’s untouched first draft; no student is named in
  it. Do not film the translation preview: its fake answer reads "Demo translation: …".
- **« Couverture »:** keep « À vérifier » visible, and the small « Curriculum de démonstration, à
  vérifier » line.
- **« Bienvenue »:** not captured on purpose. The screen says « Les données sont conservées au
  Canada », which describes the hosted design; nothing is hosted yet.
- **Voice:** Kokoro’s only French voice (`ff_siwis`) has a European accent. For a Franco-Ontarian
  audience, record a human voice, or credit the synthetic voice as v1 does.
- **French typography:** in captions and on-screen text, use no-break spaces inside « » and before
  « : », narrow no-break spaces before « ; », « ! » and « ? », and no-break spaces in times
  (« 7 h 45 »).
- **English wording:** say "the principal", not "the direction"; keep "substitute" to match the
  app; "report cards" for the « Bulletins » tab, and « Info-parents » as the feature’s name.
- **Music, style and captions:** reuse the v1 pipeline (`make_promo.py`, `promo_art.py`,
  `promo_audio.py`); only the scene list and the lines change.

## Not in this video, on purpose

- « Créer une banque de commentaires avec l’IA », « Traduire en anglais (IA) », « Texte
  différencié » and every other AI feature (fake provider only): no AI output, no quality or
  time-saved claim.
- The library and class mode (v4’s scenes 5 and 6), the board’s screens (v4’s scene 7), and the
  board-hosted install.
- Hosting in Canada in the present tense; « une seule touche »; « moins de 60 secondes » (a test
  goal); pricing, board names or logos, testimonials, certifications; a parent portal (none
  exists: « Info-parents » is a message the teacher sends herself); « couverture du curriculum
  complète » (the demo curriculum is a partial sample).
