# Promo script v4: « Deux touches, et toute l’école suit » (60 s, French and English)

v4 keeps v3's sick-day story (`script-v3.md`, kept as is) and adds one beat for principals and
school boards, now that Phase 6 has built the « Tableau de bord de la direction », the « Journal
d’audit » and « Conseil ». To stay at 60 s, the plan, library and class-mode scenes are shorter
than in v3.

**Rule: claims only what ships.** Every scene below is « Disponible (version pilote) »: built and
covered by automated tests in the development build (Phases 1 to 6), not a live service, and not
yet used in a real school. Nothing is hosted, no board is a client, the pilot has not started, and
the real AI has never been called. Sources are listed per scene; the labels are in
`marketing/README.md`.

Status as of 2026-10-02. Target length 60 s for English; the French cut may run a few seconds
longer (scene lengths follow the voice). The full voice-over, French then English, is at the end.

## Scenes

### 1. 6 h 05 (0:00–0:04)

- **Picture:** a dark kitchen, a phone lights up on the counter. The clock reads 6:05. Papercraft
  style as in v1.
- **On screen:** FR « 6 h 05 » / EN « 6:05 a.m. »
- **VO FR:** « 6 h 05. Vous êtes malade, et votre classe vous attend quand même. »
- **VO EN:** "6:05 a.m. You’re sick, and your class is still waiting for you."
- **Claim:** none (scene setting).

### 2. Deux touches (0:04–0:09)

- **Picture:** `site/assets/today-phone.webp`, then `site/assets/absence-phone.webp`. A finger taps
  « Je suis absent·e », then « Envoyer ». A small « 1 » and « 2 » in chalk next to each tap.
- **On screen:** FR « Deux touches » / EN « Two taps ». Tag: FR « Disponible (version pilote) »,
  EN « Available (pilot build) ».
- **VO FR:** « Deux touches : Je suis absente, puis Envoyer. » (The speaker reads the button in
  their own gender. The screen shows « Je suis absent·e ».)
- **VO EN:** "Two taps: I’m absent, then Send."
- **Claim:** two taps from « Aujourd’hui » (D-047, D-055; `docs/phase-3.md`).

### 3. Le plan est prêt (0:09–0:17)

- **Picture:** `site/assets/plan-desktop.webp`: the Français period, its timed steps and « Le huard,
  oiseau des lacs » with one version per group.
- **On screen:** FR « Complet sans IA » / EN « Complete without AI ».
- **VO FR:** « Votre plan de suppléance est prêt. Il reprend là où chaque classe est rendue.
  Complet, sans IA. »
- **VO EN:** "Your substitute plan is ready. It picks up where each class left off. Complete,
  without AI."
- **Claims:** plan built at once from each class’s progress, complete without AI (D-047, D-052);
  the library resource in the picture: D-077, `docs/phase-4.md` « Substitute plans ».

### 4. Le code, puis « Maintenant » (0:17–0:25)

- **Picture:** `site/assets/office-desktop.webp` (the office board, « Générer un code »), then
  `site/assets/substitute-phone.webp` (« Maintenant » / « Ensuite »). No alert text: the captures
  have none.
- **On screen:** FR « Un code d’une journée, aucun compte » / EN « A one-day code, no account ».
- **VO FR:** « Le secrétariat remet un code d’une journée. La personne suppléante voit Maintenant et
  Ensuite, puis vous envoie son suivi. »
- **VO EN:** "The office hands out a one-day code. The substitute sees Now and Next, then sends you
  a report."
- **Claims:** codes last one day and are shown once (D-050); no substitute account (D-049);
  « Maintenant » / « Ensuite » (D-056); end-of-day report (D-054).

### 5. La banque de ressources (0:25–0:32)

- **Picture:** `site/assets/library-search.webp` (search « huard »), then
  `site/assets/library-item.webp` (the five versions). Zoom on « Les noms des niveaux ne sont
  jamais imprimés ».
- **On screen:** FR « Des versions par niveau de langue » / EN « Versions by language level ».
  (Not every resource has them: 19 of the 78 demo resources do.)
- **VO FR:** « Pour demain, la banque de ressources : des versions par niveau de langue, sans nom de
  niveau sur la feuille. »
- **VO EN:** "For tomorrow, the resource bank: versions for each language level, with no level
  name on the sheet."
- **Claims:** versions per level, no level name printed (D-062, D-075); `docs/phase-4.md` « What
  was built ».

### 6. Le mode classe (0:32–0:39)

- **Picture:** `site/assets/projector.webp` (the projector after « Afficher la réponse »), then
  `site/assets/tablet-join.webp` (« Tu es l’appareil 1. Ton équipe : Les Castors »).
- **On screen:** FR « Aucun compte d’élève » / EN « No student accounts ».
- **VO FR:** « En classe, projetez la ressource. Les tablettes se joignent sans compte d’élève. »
- **VO EN:** "In class, project the resource. Tablets join with no student accounts."
- **Claims:** « Présenter à la classe » and « Quiz sur les appareils » (D-082); joining by class
  link or code, no accounts (D-084, D-088); `docs/phase-5.md`.

### 7. La direction et le conseil (0:39–0:53), new in v4

- **Picture:** `site/assets/direction-desktop.webp` (« Absences aujourd’hui »: « Publié »,
  « 1 code actif », « 1 appareil », « Suivi reçu »), then `site/assets/audit-desktop.webp` with a
  zoom on « Code émis par le secrétariat », then `site/assets/staff-desktop.webp` (« Personnel »,
  « Inviter une personne »; the e-mail column is blurred in the capture, keep it blurred).
- **On screen:** FR « Pour la direction et le conseil » / EN « For principals and boards ». Tag:
  FR « Disponible (version pilote) », EN « Available (pilot build) ».
- **VO FR:** « La direction voit les absences du jour et chaque consultation d’alerte, jamais votre
  planification. Le conseil invite son personnel et choisit qui approuve les ressources. »
- **VO EN:** "The principal sees today’s absences and every alert read, never your planning. The
  board invites its staff and chooses who approves resources."
- **Claims:** the dashboard shows absences, plan status, codes, devices, reports and the last 7
  days of alert entries, never units, lessons or progress (D-102; `docs/phase-6.md` « What was
  built »); the audit log flags codes the office issued (D-103); « Inviter une personne » and
  « Approbation des ressources » in « Conseil » (D-107, D-108). Not yet tried with a real
  principal or board.

### 8. Carte de fin (0:53–1:00)

- **Picture:** the app icon on a chalkboard.
- **On screen:** FR « Lynx École · Version pilote · Projet pilote gratuit prévu », then small:
  « Nom de travail · Données fictives · Rien n’est encore en ligne ». EN « Lynx École · Pilot build
  · Free pilot planned », then small: « Working name · Fictional data · Nothing is online yet ».
- **VO FR:** « Lynx École. Version pilote : projet pilote gratuit prévu. »
- **VO EN:** "Lynx École. Pilot build. Free pilot planned."
- **Claims:** nothing is hosted and the pilot has not started (`docs/HANDOFF.md` §2, §6); the name
  is a placeholder (D-002).

## Full voice-over

About 120 words in French and 110 in English, read over the scene timings above (not yet timed
with a voice).

### French

« 6 h 05. Vous êtes malade, et votre classe vous attend quand même. Deux touches : Je suis absente,
puis Envoyer. Votre plan de suppléance est prêt. Il reprend là où chaque classe est rendue.
Complet, sans IA. Le secrétariat remet un code d’une journée. La personne suppléante voit
Maintenant et Ensuite, puis vous envoie son suivi. Pour demain, la banque de ressources : des
versions par niveau de langue, sans nom de niveau sur la feuille. En classe, projetez la ressource. Les
tablettes se joignent sans compte d’élève. La direction voit les absences du jour et chaque
consultation d’alerte, jamais votre planification. Le conseil invite son personnel et choisit qui
approuve les ressources. Lynx École. Version pilote : projet pilote gratuit prévu. »

### English

"6:05 a.m. You’re sick, and your class is still waiting for you. Two taps: I’m absent, then Send.
Your substitute plan is ready. It picks up where each class left off. Complete, without AI. The
office hands out a one-day code. The substitute sees Now and Next, then sends you a report. For
tomorrow, the resource bank: versions for each language level, with no level name on the sheet. In
class, project it. Tablets join with no student accounts. The principal sees today’s absences and
every alert read, never your planning. The board invites its staff and chooses who approves
resources. Lynx École. Pilot build. Free pilot planned."

## Production notes

- **Screens:** use the captures in `marketing/site/assets/` (see `marketing/README.md`): the
  2026-09-30 set for scenes 2 to 6, the 2026-10-02 set for scene 7. They show demo names only, no
  alert text, no AI output, and no e-mail address (blurred on « Personnel »).
- **« Bienvenue »:** not captured on purpose. The screen says « Les données sont conservées au
  Canada », which describes the hosted design; nothing is hosted yet.
- **Alerts:** show the hidden state, the audit entry and the badge at most, never an alert’s text.
- **AI:** no result screen and no AI output anywhere (fake provider). No quality claim and no
  time-saved figure.
- **Class mode:** not tried on a real classroom’s projector or tablets. Film the screens as
  captures, not as a class using them.
- **Voice:** Kokoro’s only French voice (`ff_siwis`) has a European accent. For a Franco-Ontarian
  audience, record a human voice, or credit the synthetic voice as v1 does.
- **French typography:** in captions and on-screen text, use no-break spaces inside « » and before
  « : », narrow no-break spaces before « ; », « ! » and « ? », and no-break spaces in times
  (« 7 h 45 »).
- **English wording:** English-language Ontario boards say "occasional teacher"; the app and this
  script say "substitute". Keep "substitute" on screen to match the app. Say "the principal", not
  "the direction".
- **Music, style and captions:** reuse the v1 pipeline (`make_promo.py`, `promo_art.py`,
  `promo_audio.py`); only the scene list and the lines change.

## Not in this video, on purpose

- « Texte différencié » and every AI feature (fake provider only): v2’s scene 7 if a longer cut is
  wanted.
- Hosting in Canada in the present tense, and the board-hosted install (no picture to show; the
  site and the fact sheet describe it).
- « Une seule touche », « moins de 60 secondes » (a test goal, not a measurement), pricing, board
  names or logos, testimonials, certifications, PA or door integrations, a number of resources
  (the 78 resources were written for the demo).
