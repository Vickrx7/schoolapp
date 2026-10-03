# Promo script v3: « Deux touches, et la suite » (60 s, French and English)

Replaces v2 (`script-v2.md`), which predates the library and class mode. v3 keeps the sick-day
story, shortens it, and adds the « Banque de ressources » and the « Mode classe ». It drops
« Texte différencié » to stay at 60 s (v2's scene 7 is still accurate for a longer cut).

**Rule: claims only what ships.** Every line below is « Disponible (version pilote) »: built and
covered by automated tests in the development build (Phases 1 to 5), not a live service, and not
yet used by a real teacher, substitute or class. Sources are listed per scene.

Status as of 2026-10-01. Target length 60 s for English; the French cut may run a few seconds
longer (scene lengths follow the voice).

## Scenes

### 1. 6 h 05 (0:00–0:05)

- **Picture:** a dark kitchen, a phone lights up on the counter. The clock reads 6:05. Papercraft
  style as in v1.
- **On screen:** FR « 6 h 05 » / EN « 6:05 a.m. »
- **VO FR:** « 6 h 05. Vous êtes malade, et votre classe vous attend quand même. »
- **VO EN:** "6:05 a.m. You’re sick, and your class is still waiting for you."
- **Claim:** none (scene setting).

### 2. Deux touches (0:05–0:11)

- **Picture:** `site/assets/today-phone.webp`, then `site/assets/absence-phone.webp`. A finger taps
  « Je suis absent·e », then « Envoyer ». A small « 1 » and « 2 » in chalk next to each tap.
- **On screen:** FR « Deux touches » / EN « Two taps ». Tag: FR « Disponible (version pilote) »,
  EN « Available (pilot build) ».
- **VO FR:** « Deux touches : Je suis absente, puis Envoyer. » (The speaker reads the button in
  their own gender. The screen shows « Je suis absent·e ».)
- **VO EN:** "Two taps: I’m absent, then Send."
- **Claim:** two taps from Aujourd’hui (D-047, D-055; `docs/phase-3.md`).

### 3. Le plan est prêt (0:11–0:20)

- **Picture:** `site/assets/plan-desktop.webp`: the Français period, its timed steps and « Ressource
  de la banque : Le huard, oiseau des lacs » with one version per group.
- **On screen:** FR « Complet sans IA » / EN « Complete without AI ».
- **VO FR:** « Votre plan de suppléance est prêt. Il reprend là où chaque classe est rendue, avec
  une ressource de la banque pour chaque groupe. Complet, sans IA. »
- **VO EN:** "Your substitute plan is ready. It picks up where each class left off, with a resource
  from the bank for each group. Complete, without AI."
- **Claims:** plan built at once from each class’s progress, complete without AI (D-047, D-052);
  reviewed, substitute-friendly library resources with each group’s version and never the key
  (D-077; `docs/phase-4.md` « Substitute plans »).

### 4. Le code, puis « Maintenant » (0:20–0:29)

- **Picture:** `site/assets/office-desktop.webp` (the office board, « Générer un code »), then
  `site/assets/substitute-phone.webp` (« Maintenant » / « Ensuite »). Show no alert text: the
  captures have none.
- **On screen:** FR « Un code d’une journée, aucun compte » / EN « A one-day code, no account ».
- **VO FR:** « Le secrétariat remet un code d’une journée. La personne suppléante voit
  « Maintenant » et « Ensuite », puis vous envoie son suivi. »
- **VO EN:** "The office hands out a one-day code. The substitute sees Now and Next, then sends you
  a report."
- **Claims:** codes last one day and are shown once (D-050); no substitute account (D-049); « Maintenant
  » / « Ensuite » (D-056); end-of-day report (D-054).

### 5. La banque de ressources (0:29–0:40)

- **Picture:** `site/assets/library-search.webp` (search « huard »), then
  `site/assets/library-item.webp` (the five versions). Zoom on « Les noms des niveaux ne sont
  jamais imprimés ».
- **On screen:** FR « Des versions par niveau de langue » / EN « Versions by language level ».
  (Not every resource has them: 19 of the 78 demo resources do.)
- **VO FR:** « Pour demain, cherchez dans la banque de ressources : des versions par niveau de
  langue, et aucun nom de niveau sur la feuille de l’élève. »
- **VO EN:** "For tomorrow, search the resource bank: versions for each language level, and no
  level name on the student’s sheet."
- **Claims:** search in French with or without accents (D-068); versions per level, no level name
  printed, no key on student sheets (D-062, D-075); `docs/phase-4.md` « What was built ».

### 6. Le mode classe (0:40–0:52)

- **Picture:** `site/assets/projector.webp` (the projector after « Afficher la réponse »), then
  `site/assets/tablet-join.webp` (« Tu es l’appareil 1. Ton équipe : Les Castors »).
- **On screen:** FR « Aucun compte d’élève » / EN « No student accounts ».
- **VO FR:** « En classe, projetez la ressource. Les tablettes se joignent sans compte d’élève, et
  les réponses sont effacées à la fin. »
- **VO EN:** "In class, project the resource. Tablets join with no student accounts, and the
  answers are erased at the end."
- **Claims:** « Présenter à la classe » and « Quiz sur les appareils » (D-082); joining by class
  link or code, no accounts (D-084, D-088); answers and devices deleted when the session ends
  (D-089); `docs/phase-5.md`.

### 7. Carte de fin (0:52–1:00)

- **Picture:** the app icon on a chalkboard.
- **On screen:** FR « Lynx École · Version pilote · Projet pilote gratuit prévu », then small:
  « Nom de travail · Données fictives · Rien n’est encore en ligne ». EN « Lynx École · Pilot build ·
  Free pilot planned », then small: « Working name · Fictional data · Nothing is online yet ».
- **VO FR:** « Lynx École. Version pilote : projet pilote gratuit prévu. »
- **VO EN:** "Lynx École. Pilot build. Free pilot planned."
- **Claims:** nothing is hosted and the pilot has not started (`docs/HANDOFF.md` §2, §6); the name
  is a placeholder (D-002).

## Production notes

- **Screens:** use the captures in `marketing/site/assets/` (taken 2026-09-30 from the
  development build with the demo seed; see `marketing/README.md`). They show demo first names
  only, no alert text and no AI output. The projector’s lobby (« Rejoignez la partie ») is not
  among them because it shows the development address; retake it with a neutral address before
  using it.
- **Alerts:** show the hidden state and the button at most, never an alert’s text.
- **AI:** no result screen and no AI output anywhere (fake provider). No quality claim and no
  time-saved figure.
- **Class mode:** it has not been tried on a real classroom’s projector or tablets. Film the screens
  as captures, not as a class using them.
- **Voice:** Kokoro’s only French voice (`ff_siwis`) has a European accent. For a Franco-Ontarian
  audience, record a human voice, or credit the synthetic voice as v1 does.
- **French typography:** in captions and on-screen text, use non-breaking spaces inside « » and
  before « : », and in times (« 7 h 30 »).
- **English wording:** English-language Ontario boards say "occasional teacher"; the app and this
  script say "substitute". Keep "substitute" on screen to match the app.
- **Music, style and captions:** reuse the v1 pipeline (`make_promo.py`, `promo_art.py`,
  `promo_audio.py`); only the scene list and the lines change.

## Not in this video, on purpose

- « Texte différencié » (AI, fake provider only): v2’s scene 7 if a longer cut is wanted.
- Hosting in Canada in the present tense, a board-hosted install, the principal’s dashboard, the
  audit log viewer: all « Bientôt » (Phase 6).
- « Une seule touche », « moins de 60 secondes » (a test goal, not a measurement), pricing, board
  names or logos, testimonials, certifications, PA or door integrations, a number of resources
  (the 78 resources were written for the demo).
