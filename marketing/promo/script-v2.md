# Promo script v2: « Deux touches » (60 s, French and English)

Replaces the v1 story (`voiceover-script-fr.txt`, `voiceover-script.txt`), whose last scene
labels the sick-day plan « Bientôt » and says « une seule touche ». The sick-day plan has shipped
(`docs/HANDOFF.md` §2), and reporting an absence takes **two taps**.

**Rule: claims only what ships.** Every line below is a feature marked « Disponible (version
pilote) »: built and covered by automated tests in the development build, not a live service,
and not yet used by a real teacher. Four features only: the sick-day plan, the substitute code,
the end-of-day report and « Texte différencié ». Sources are listed per scene.

Status as of 2026-09-29 (commit `166483b`). Target length 60 s for English; the French cut may
run a few seconds longer, as in v1 (scene lengths follow the voice).

## Scenes

### 1. 6 h 05 (0:00–0:06)

- **Picture:** a dark kitchen, a phone lights up on the counter. The clock reads 6:05. Papercraft
  style as in v1.
- **On screen:** FR « 6 h 05 » / EN « 6:05 a.m. »
- **VO FR:** « 6 h 05. Vous êtes malade, et votre classe vous attend quand même. »
- **VO EN:** "6:05 a.m. You’re sick, and your class still needs you."
- **Claim:** none (scene setting).

### 2. Deux touches (0:06–0:13)

- **Picture:** the real « Aujourd’hui » screen; a finger taps « Je suis absent·e », then
  « Envoyer » on the absence form. A small « 1 » and « 2 » in chalk next to each tap.
- **On screen:** FR « Deux touches » / EN « Two taps ». Tag: FR « Disponible (version pilote) »,
  EN « Available (pilot build) ».
- **VO FR:** « Deux touches : Je suis absente, puis Envoyer. » (The speaker reads the button in
  their own gender: « absente » or « absent ». The screen shows « Je suis absent·e ».)
- **VO EN:** "Two taps: I’m absent, then Send."
- **Claim:** two taps from Aujourd’hui (D-047, D-055; `docs/phase-3.md`).

### 3. Le plan est prêt (0:13–0:23)

- **Picture:** the absence page with « Prêt · publié automatiquement le … à 7 h 30 », then
  « Réviser le plan » scrolling through the day: the Français period and its next lesson, the
  school mass in the afternoon, the groups.
- **On screen:** FR « Complet sans IA » / EN « Complete without AI ».
- **VO FR:** « Votre plan de suppléance est prêt, là où chaque classe est rendue : prochaines
  leçons, horaire, messe, groupes par niveau de langue. Sans IA. »
- **VO EN:** "Your substitute plan is ready, right where each class left off: next lessons,
  timetable, the school mass, groups by language level. No AI needed."
- **Claims:** plan built at once from each class’s progress, timetable, calendar and groups by
  language level; complete without AI (D-047, D-052; `packages/domain/src/sub-plan/build.ts`).

### 4. Le code (0:23–0:31)

- **Picture:** the office’s « Suppléances » board, « Générer un code », the code dialog and the
  printed « Feuille d’accueil ». Use the demo school; blur nothing that is fictional anyway.
- **On screen:** FR « Un code d’une journée, affiché une seule fois » / EN « A one-day code,
  shown once ».
- **VO FR:** « À 7 h 30, le secrétariat génère un code d’une journée, affiché une seule fois. Pas
  de compte à créer. »
- **VO EN:** "At 7:30, the office generates a one-day code, shown once. No account to create."
- **Claims:** release at 7 h 30 by default, a board setting (D-047); codes last one day and are
  shown once (D-050); the substitute has no account (D-020, D-049).

### 5. Maintenant, Ensuite (0:31–0:39)

- **Picture:** the substitute’s phone: `…/s`, the code typed in lowercase, then « Plan de la
  journée » with « Maintenant » and « Ensuite ». A finger hovers over « Alertes de sécurité ou
  médicales »: show the button, not the alert text.
- **On screen:** FR « Alertes cachées jusqu’à ce qu’on touche » / EN « Alerts hidden until
  tapped ».
- **VO FR:** « La personne suppléante voit « Maintenant » et « Ensuite ». Les alertes médicales
  restent cachées jusqu’à ce qu’elle touche l’écran. »
- **VO EN:** "The substitute sees Now and Next. Medical alerts stay hidden until they tap."
- **Claims:** « Maintenant » / « Ensuite » (D-056; `docs/phase-3.md`); alerts on screen only
  after a tap, every view logged, never printed (D-016 amended, D-056).

### 6. Le suivi (0:39–0:47)

- **Picture:** « Suivi de la journée » (Terminé / En partie / Pas fait), « Envoyer le suivi »;
  cut to the next morning, « Suivi de la suppléance » with « Confirmer ».
- **On screen:** FR « Rien n’est marqué fait sans vous » / EN « Nothing is marked done without
  you ».
- **VO FR:** « En fin de journée, elle envoie son suivi. Le lendemain, vous confirmez chaque
  leçon : rien n’est marqué fait sans vous. »
- **VO EN:** "At the end of the day, the substitute sends a report. The next morning, you confirm
  each lesson. Nothing is marked done without you."
- **Claims:** end-of-day report and the teacher’s confirmation (D-054;
  `e2e/substitute-mobile.spec.ts`).

### 7. Texte différencié (0:47–0:55)

- **Picture:** « Texte différencié »: the form with 2 to 6 levels, then « Vérifier avant
  d’envoyer » with the names highlighted as « Élève A ». **Stop at the preview.** Never show a
  result screen: the demo uses a fake provider that truncates text.
- **On screen:** FR « Seulement si votre école active l’IA » / EN « Only if your school turns AI
  on ».
- **VO FR:** « Et si votre école active l’IA : un même texte, de deux à six niveaux de langue.
  Vous voyez exactement ce qui sera envoyé. »
- **VO EN:** "And if your school turns AI on: one text, two to six language levels. You see
  exactly what will be sent."
- **Claims:** 2 to 6 levels, preview of exactly what is sent, names become markers (D-038,
  D-042; `e2e/differentiate.spec.ts`); AI off until the direction turns it on (D-039).

### 8. Carte de fin (0:55–1:00)

- **Picture:** the app icon on a chalkboard.
- **On screen:** FR « Lynx École · En développement · Projet pilote gratuit prévu », then small:
  « Nom de travail · Données fictives · Rien n’est encore en ligne ». EN « Lynx École · In
  development · Free pilot planned », then small: « Working name · Fictional data · Nothing is
  online yet ».
- **VO FR:** « Lynx École. En développement : projet pilote gratuit prévu. »
- **VO EN:** "Lynx École. In development. Free pilot planned."
- **Claims:** nothing is hosted and the pilot has not started (`docs/HANDOFF.md` §2, §6); the name
  is a placeholder (D-002).

## Production notes

- **Screens:** retake them from the running development build with the demo data, following the
  8-minute demo in `docs/phase-3.md`. The Phase 1 screenshots in `screens/` don’t show any of
  these scenes.
- **Navigation:** since Phase 4, the bottom bar shows « Ressources » instead of « Différencier ».
  Crop it out, or label that frame « En construction ».
- **Alerts:** show the hidden state and the button, never an alert’s text.
- **AI:** no result screen and no AI output anywhere (fake provider). No quality claim and no
  time-saved figure.
- **Voice:** Kokoro’s only French voice (`ff_siwis`) has a European accent. For a Franco-Ontarian
  audience, record a human voice, or credit the synthetic voice as v1 does.
- **Music, style and captions:** reuse the v1 pipeline (`make_promo.py`, `promo_art.py`,
  `promo_audio.py`); only the scene list and the lines change.

## Not in this video, on purpose

- The library (« Banque de ressources », En construction) and class mode (« Mode classe »,
  Bientôt).
- « Une seule touche », « Bientôt » on the sick-day plan, « moins de 60 secondes » (a test goal,
  not a measurement).
- Hosting in Canada in the present tense, pricing, board names or logos, testimonials,
  certifications, PA or door integrations.
