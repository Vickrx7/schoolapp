# « Commentaires de bulletin »: comment banks, « Créer une banque avec l'IA » and « Bulletins »

Feature #2 after the pilot build (`beyond.md`'s second shortlist item). Decisions: `DECISIONS.md`
« Commentaires de bulletin », D-129 to D-135, and the amendments written into D-044, D-061, D-067,
D-071, D-072, D-076, D-077, D-080, D-082, D-094, D-100, D-105, D-110 and D-117. Built in three
slices on PR #2; the fourth (AI on one student's comment, D-133) is designed only and not built.
Never call this feature « Commentaires » alone: that word is the feedback button (D-116).

| Slice | Commit    | What                                                                                      |
| ----- | --------- | ----------------------------------------------------------------------------------------- |
| S1    | `2ce92a8` | The comment bank as library type 26 (`report_comments`), its editor and three demo banks  |
| S2    | `454e58b` | « Créer une banque avec l'IA » (`report_comment_bank`), its prompt, evaluation and checks |
| S3    | (latest)  | « Bulletins », the reminder on « Aujourd'hui », terms `2026-10-pilote-3`, the docs        |

## What was built

**In the library** (S1, D-129, D-131)

- « Nouvelle ressource » → Évaluer → « Banque de commentaires de bulletin »: « Pour » (a subject,
  the learning skills and work habits, or religion), « Bulletin » (progress report, report card or
  both) and « Entrées »: grouped by attente (or learning skill), then « Points forts », « Prochaines
  étapes » and general comments, each for a level, a progress mark or a rating, with a neutral text
  (at most 400 characters), optional feminine and masculine texts, a category and attente codes.
  Texts name the student `{prénom}` only. No duration, materials or formats; never in a lesson,
  class mode, the projector or a substitute plan. Review, sharing, approval, faith review and
  « Adapter » work as for any resource. The demo pack has three approved banks: 3e Mathématiques
  (report card), 3e Français (progress report) and the learning skills (3e to 5e).

**« Créer une banque avec l'IA »** (S2, D-132, `/library/generate/comments`)

- One grade, a subject (none for the learning skills), the report, 0 to 12 attentes (none: general
  comments), the length and a note. « Vérifier avant d'envoyer » shows exactly what is sent
  (curriculum labels and the de-identified note, nothing about students); the answer is a private
  draft with `{prénom}`. Also linked from the library hub, « Créer avec l'IA » and « Bulletins ».

**« Bulletins »** (S3, D-130, D-135, `/classes/[id]/bulletins`), a class tab for its homeroom and
subject teachers at a school with the Library module

- **The notice, always shown:** « Vos commentaires restent sur cet appareil. Ils ne sont jamais
  envoyés à nos serveurs ni à l'intelligence artificielle. Ils seront effacés quand vous vous
  déconnecterez, ou au plus tard le 13 avril 2027. Copiez-les dans le bulletin officiel. » and
  « Sur un ordinateur partagé, déconnectez-vous quand vous avez terminé. »
- **Filters** (the address, filters only): « Période » (the board's periods with their dates and
  « saisie », or « Dates choisies » with « Type de bulletin »), « Matière » (my subjects, the
  learning skills first for the homeroom teacher, then the class's other subjects) and « Banque »
  (approved banks first, « Approuvée par le conseil » or « Brouillon — à relire », « Voir la
  banque »; without one, « Créer une banque avec l'IA », prefilled, and « Créer une banque »).
  « Attentes enseignées pendant la période (2) » lists what the class's units and lessons taught.
- **Students:** a list with each student's status (« À faire », « Commencé », « Prêt · 612 /
  1 000 », « Dépasse de 112 caractères ») beside one student's comment on larger screens; two
  screens on a phone (the address's fragment, so Back returns to the list). « Élève suivant » and
  the previous and next names move along the class.
- **One student:** « Formulation » (neutre, féminin, masculin; device only), « Année d'études » in a
  combined class, the mark (« Niveau de rendement » 1 to 4, « Progrès », or E, T, S, N for each
  learning skill), then the bank's entries for that mark as cards to tick, already filled in
  (« Aïcha… », « d'Aïcha », « de Youssef »): taught attentes first, then entries about no
  attente; the others folded away (« Autres entrées de la banque (attentes non enseignées pendant
  la période) »); « Autre formulation » when the bank says the same thing another way.
  « Commentaire » is built from the cards and freely editable (a text edited by hand is never
  replaced without asking), with « 360 / 1 000 caractères » read out politely after a pause and
  the excess said in words; « Copier », « Tout copier pour cet élève », « Imprimer », « Effacer le
  commentaire »; « Mes notes (sur cet appareil) », whose words put matching entries first (« D'après
  vos notes »; no AI).
- **« Réglages et impression »:** « Limite de caractères » (1,000 by default), « Espaces simples à
  la copie (recommandé pour le bulletin officiel) » (on), « Imprimer tous les commentaires » (the
  browser's print, one student per page) and « Effacer mes commentaires de cette période sur cet
  appareil » (« Effacer les commentaires de 2 élèves sur cet appareil? Cette action est
  définitive. »). « Comment ça marche » explains it all, enhanced spell-check included.
- **« Aujourd'hui »:** from 21 days before a period's « saisie » until that day, « Bulletin scolaire
  — 1re étape : saisie au plus tard le 5 févr. » with « Préparer mes commentaires » for each class.
- **Nouveautés:** « Version 0.8 · Commentaires de bulletin ».

## How to run it

```bash
tools/lite-stack/stack.sh reset
pnpm dev                      # or: pnpm --filter @lynx/web build && (cd apps/web && pnpm start)
```

Demo logins (codes in Mailpit, `http://127.0.0.1:54324`): `isabelle.tremblay@demo.lynx.test`
(Classes → 3e année → « Bulletins »; choose « Bulletin scolaire — 1re étape » and Mathématiques for
the demo bank; B1.1 and B1.2 are taught in the demo), `paul.leblanc@demo.lynx.test` (subject
teacher: Éducation physique et santé first, no bank yet). « Créer une banque avec l'IA » needs the
school's AI on (« École » → Intelligence artificielle) and the fake worker:
`(cd apps/worker && set -a && . ../web/.env.local; set +a && AI_PROVIDER=fake pnpm start)`.

## Data and privacy

- **Comments never leave the browser** (D-130). The device draft is `localStorage`
  `lynx-draft:report:{userId}:{classId}:{periodKey}`: per student id, the wording, marks, chosen
  entries, notes and comment, with the first name written `{prénom}`, so the device holds no
  first name. It is removed at sign-out, by « Effacer », when another account signs in on that
  browser (the janitor in the app's shell), and 60 days after the « remise » at the latest.
- The page has no server action, route handler, form or PDF that carries a comment; its address
  holds filters only and the student is the fragment. A unit test checks the composer's files
  (no server action, no `server-only` module, no request of their own, no `name` on a comment
  field); the browser test types « ZZSENTINELLE » in every field, presses Enter, changes subject
  and reloads, and finds it in no request's address, headers or body.
- No AI reads a comment about a student (D-133). Banks hold curriculum phrases with `{prénom}`;
  the AI request for a bank carries curriculum labels and the de-identified note only (D-132,
  `docs/ai-data-flow.md`).
- The terms changed (`2026-10-pilote-3`, D-134): the notice, the terms and « Bienvenue » say that
  report card comments stay on the device. `PRIVACY.md` § 1, 3, 4 (« On the teacher's device (never
  sent) »), 5, 9, 13 and 16.
- Known limits, for the lawyer and the boards: what the browser holds is exposed to what acts on
  the browser (enhanced spell-check, writing extensions, cloud clipboards); on a computer nobody
  signs out of, comments stay (as templates) until another account signs in or they expire. The
  working copies are transitory; the record is the board's report card (Q5).

## Tests

- Unit (`pnpm test`): `@lynx/content` (S1: the schema, `{prénom}` and elision, `unfillComment`,
  counting, plain spaces, qualifiers, the catalogue, readiness, packs); `@lynx/ai` (S2: the feature,
  its normalizing and validation, the fake answer, the prompt's sections and privacy); the domain's
  `report-comments` (S3: period keys, report of a period, the 60-day expiry, the reminder window,
  the subjects' order for Paul and for a homeroom teacher, resolving attente codes per grade, the
  scope through overall and specific attentes, the proposals for each mark and with notes,
  « Autre formulation », building the comment, the draft's schema, stale picks, statuses); the
  web's `report-comments/view-model` (periods, banks, the addresses, the AI link with ids only),
  `draft-storage` (the janitor: another account's, expired and unreadable drafts; nothing written
  after a sign-out), `components/report-comments/no-server.test.ts`; the catalogues' parity and the
  terms (`legal.test.ts`: the seed accepts `2026-10-pilote-3`).
- pgTAP `35_report_comments` (S1 and S2).
- Integration: the worker turns a fake answer into a draft bank (S2).
- Browser: `e2e/report-comments.spec.ts` (S2's two steps; S3: the tab, the filters, the demo bank,
  Aïcha's comment and its counter, « Copier » read back from the clipboard with plain spaces,
  « Féminin », « d'Aïcha » and « de Youssef », the statuses, over the limit, « Garder mon texte »,
  the sentinel in no request and `{prénom}` but no first name on the device, the confirmation
  dialog, sign-out erasing the drafts, the janitor, Paul's subjects and « Créer une banque », the
  reminder on « Aujourd'hui »; axe on each), `e2e/report-comments-mobile.spec.ts` (360 × 740: list,
  student, Back, « Tous les élèves », 44 px targets, no sideways scroll, axe), the CSP loop in
  `operations.spec.ts`, and `library-authoring`, `library-item` and `onboarding` (the new « Ce qui
  a changé »).

## Deviations from the plan

- The draft's period key is the board period's kind (`term1`), not its row id: a board that
  re-enters its periods keeps the teachers' drafts (a class has one school year).
- A comment keeps `level` and `progress` apart instead of one `mark`; « Autre formulation » groups
  only entries about the same attentes or learning skill (general entries are each their own).
- The counter is shown at once and read out after a short pause rather than at every keystroke; an
  over-limit text is also flagged as invalid for screen readers.
- « Commentaires généraux » (the bank's general entries) are a third group of cards; « Effacer le
  commentaire » also clears the mark and the chosen entries.
- Before a mark is chosen, only the entries for every mark are shown.
- Nothing was cut: « Suggestions à partir de mes notes », « Tout copier pour cet élève », the
  other-tab warning and the class-wide print are all built.

## Known limits

- **No curriculum in production** (D-030): without attentes, every entry of a bank is offered and
  the page says so; the AI writes general banks.
- **One device:** comments do not follow a teacher to another computer (Q2), and a full device or
  cleared browser data loses what was not copied (the page says to copy early).
- The bank list reads at most 50 banks per grade and subject.
- No file export or import of the composer; no view across classes; kindergarten, IEP and
  English-language comments are out of scope.
- AI on one student's comment is designed only (D-133).

## Questions (answered by the lead for Mike, 2026-10-02; we built on these answers)

1. AI on one student's comment: no for the pilot (S4 designed, not built).
2. Comments stay on the device; nothing is stored on our servers.
3. 1,000 characters by default and plain spaces on copy, both adjustable; to confirm with a pilot
   teacher which report card system the boards use.
4. General banks are allowed when no attentes are loaded, marked as drafts to read.
5. Comments are erased when another account signs in on the browser and 60 days after the report
   goes home; the lawyer confirms that these working copies may go (the record is the board's).

## What to test with pilot teachers

1. **In January (1re étape, saisie 5 February 2027):** a homeroom teacher writes the comments of a
   whole class: how long per student? Are the cards' texts usable as they are? Is « Autre
   formulation » useful, and are the neutral texts natural? Does the wording per student
   (neutral, feminine, masculine) feel right?
2. **Pasting into the board's system:** do the counts match (code points, a line break as one)? Do
   no-break spaces cause trouble when « Espaces simples à la copie » is off? Is 1,000 the right
   default?
3. **Banks:** a teacher creates one with the AI for a subject without a demo bank (from the empty
   state, prefilled with the attentes taught), then reads and fixes it. A colleague adapts the
   board's learning-skills bank.
4. **A shared computer:** sign out and check that nothing is left; sign in as someone else without
   signing out first and check the same.
5. **A subject teacher (EPS, music):** are his own subjects first, and are learning skills where
   he expects them?
