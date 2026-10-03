# « Info-parents »: the week's message to families, in French and English

Feature #3 after the pilot build (`beyond.md`'s third shortlist item). Decisions: `DECISIONS.md`
« Info-parents (post-MVP 3) », D-136 to D-143, and the amendments written into D-013, D-033,
D-036, D-038, D-052, D-053, D-072, D-105, D-110, D-117 and D-118. Built in three slices on PR #2.
The app sends nothing to families: it stores no parent data and has no parent accounts. The
teacher copies or prints the message herself, through her board's own channels.

| Slice | Commit    | What                                                                                     |
| ----- | --------- | ---------------------------------------------------------------------------------------- |
| S1    | `192366d` | The table, the first draft from the class's data, the editor, copying, the names check   |
| S2    | `20cd996` | The PDF (French, English or both) and the reminder on « Aujourd'hui »                    |
| S3    | `ed24e01` | « Traduire en anglais (IA) », terms `2026-10-pilote-4`, the docs, the seed's school mass |

## What was built

**The class tab « Info-parents »** (S1, D-136, D-142, `/classes/[id]/info-parents`), for the class
team with a teacher role at a school with the Teaching module (never the direction, the office or
the board)

- The list of the class's messages, newest week first (« Brouillon · modifié le 8 oct. par Mme
  Tremblay », « Envoyé le 9 oct. »), and « Préparer la semaine du … » for this week and the next
  when they have none; « Comment ça marche ».
- **Preparing a week** (`/classes/[id]/info-parents/[weekOf]`, `weekOf` a Monday of the class's
  school year): « Inclure les matières enseignées par mes collègues » (off), « Inclure un moment de
  foi » (on), « Inclure des conseils des guides pour les familles » (on, Library module only), then
  « Préparer le message ». Nothing is sent: the teacher reads everything first.
- **The first draft** (D-137), in both languages, from the class's own data and the app's own
  sentences (`newsletterText` in both catalogues): the greeting; this week's lessons per subject and
  unit; next week's (the timetable's slots, across days off); a planned unit starting next week
  (« Mon année »); the dates to remember (days off, early dismissals and late starts with their
  times, masses, liturgies, assemblies, field trips, a report card going home, a liturgical season
  starting) up to two weeks ahead; up to two family guides of the library with three « À la maison »
  tips each, with their English; a faith moment (the reference's English when it has one); the
  closing. Never an event's notes, an attente, the coverage, a level, an alert or anything about a
  student.

**The editor** (S1, D-137, D-138, D-140)

- The header (school, class, « Semaine du 5 octobre 2026 ») is shown and copied, never stored; the
  signature (« Mme Tremblay ») is kept apart from the paragraphs.
- The notice, always shown: « Ce message ira à toutes les familles de la classe. Ne nommez un élève
  que pour une nouvelle à partager avec tout le monde ; jamais un comportement, la santé ou une
  évaluation. »
- Eight fixed sections (« Message », « Cette semaine en classe », « La semaine prochaine », « Dates
  à retenir », « Rappels », « Pour aider à la maison », « Moment de foi », the closing), each with
  its paragraphs in French and English side by side (a « Français · English » switch per section on
  phones), « Ajouter un paragraphe », « Monter », « Descendre », « Retirer » and « Retirer la
  section ».
- Each paragraph says where its English stands, in words: « English : à écrire », « préparé par
  l'application », « traduit par l'IA — à relire », « à mettre à jour (le français a changé) » or
  « écrit par vous ».
- « Préremplir à nouveau » (the app's paragraphs from today's data; typed ones kept), « Corriger la
  typographie » (no AI: French spacing and apostrophes, words unchanged, words to change by hand
  listed), and, where the school's AI is on, « Traduire en anglais (IA) » (S3, below).
- « Enregistrer » with a device draft as a crash backup; a colleague's save in between is detected
  (« Récupérer mes modifications »).
- **« Partager »** (S1, S2, D-141): « Copier le français », « Copy the English », « Copier les
  deux », « Imprimer le français (PDF) », « Print the English (PDF) », « Imprimer les deux (PDF) »,
  then « Marquer comme envoyé » (read-only until « Remettre en brouillon »; the database refuses
  any change of a sent message's text, `LXN07`). All wait for a save, then « Des élèves sont
  nommés » lists the class's students the message names, the personal details it holds, and, for
  the English, how many paragraphs will appear in French.

**« Traduire en anglais (IA) »** (S3, D-139), for the saved message, where the school's AI is on

- « Vérifier avant d'envoyer »: « Seulement les paragraphes sans traduction à jour (3) » or « Tout
  retraduire (12) » (when every paragraph already has up-to-date English, the dialog says so and
  preselects nothing: a retranslation is sent only if the teacher picks « Tout retraduire »);
  exactly the text sent, with the names the app knows replaced and highlighted; « Non envoyé —
  traduisez-le vous-même » for a paragraph with a personal detail or a title not followed by a
  name the app knows (« Merci à Mme Dupuis », « Mme Noël »), with the reason; « Mots avec
  majuscule à vérifier : Montfort. »; the box « J'ai vérifié : le texte ne nomme aucune autre
  personne que l'application ne connaît pas. »; « Envoyer à l'IA ».
- While the AI translates, the message is read-only (« L'IA traduit votre message… »); then the
  English shows on its paragraphs (« English : traduit par l'IA — à relire ») with « L'IA a traduit
  2 paragraphes : relisez leur anglais… ». A message saved meanwhile takes nothing (« Le message a
  changé pendant la traduction. Relancez la traduction. »).
- The PDF's English page says "Some parts of this English version were translated automatically."

**« Aujourd'hui »** (S2, D-142): « Info-parents : préparez le message de la semaine pour {classe}. »
on the week's last two school days, for a homeroom class that already has a message, until the
week's message is marked sent.

## How to run it

- Sign in as `isabelle.tremblay@demo.lynx.test` (3e année), open the class, then « Info-parents ».
- The translation needs the school's AI on (« École » → the AI switch, as the principal) and the
  worker running; locally it uses the fake provider (`AI_PROVIDER=fake`), whose English reads
  "Demo translation: …" with the paragraph's dates, times, numbers and names.
- `pnpm ai:eval --feature newsletter_translate --provider fake` runs the ten evaluation cases for
  free; one real case, once the key is set and Mike agrees:
  `pnpm ai:eval --feature newsletter_translate --case semaine-3e-complete --yes` (under $0.10).

## Data and privacy

- **Stored:** `class_newsletters` (one row per class and week): the paragraphs in French and
  English with how each English was written, the status, the signature, who created and last
  edited it. Read and written by the class team only (row level security).
- **Kept:** until deleted; erased with the students' first names a year after the school year
  (`app.purge_class_students`), with the class, the sample class or the board; no new message after
  a purge (`LXN02`). No audit (D-103): drafting is the teacher's professional activity.
- **Never sent to families by the app.** Copying uses the browser's clipboard; the PDF is rendered
  on demand, never stored, `private, no-store`.
- **AI** (D-139, `docs/ai-data-flow.md`): only the French paragraphs to translate, with the names
  the app knows replaced and the class's grade; no class, school, signature or id. A paragraph with
  a detected detail, or a title not followed by a name the app knows, is never sent; the teacher
  checks the capitalized words and confirms (the rule's limits are under « Known limits »). The
  answer comes back to Canada, where names are put back, and is written into the message only
  while it is unchanged. The school's budget pays.
- **Terms** `2026-10-pilote-4` (D-143), then `2026-10-pilote-5` after the post-MVP review (D-144,
  about report card comments), and `PRIVACY.md` release 0.9.

## Tests

- Unit (`pnpm test`): the domain's `newsletter/` (the content schema, English states, refill,
  typography, the facts and the draft, the plain text, the reminder); the web's
  `server/newsletter/` (phrases with the real catalogues, names, view model, the translation
  preview: exactly the message the request sends, the paragraphs left out, the capitalized words),
  the PDF model and render; `@lynx/ai`: `unknown-names.test.ts` (the title rule and the
  capitalized words, with every example of the post-MVP review), « Mx », the feature (input, the
  paragraphs left out and the confirmed ones, the markers kept from the preview, the last check,
  normalizing, every validation rule, the fake answer), `capitalizedWords`, the evaluation checks
  and the prompt's privacy; `errors.test.ts`, `session-gate.test.ts`, `legal.test.ts`
  (`2026-10-pilote-4`).
- pgTAP `36_class_newsletters` (S1), `37_class_newsletters_ai` (S3: the request, who may ask,
  the scopes and limits, LXN03 to LXN06 and LXA01, the answer written back, newsletterChanged,
  invalidOutput, newsletterTooLargeForAi, the grants) and `38_post_mvp_review` (a sent message's
  text is locked, LXN07).
- Integration: `apps/worker/src/newsletter-ai.int.test.ts` (the English written back with Samuel
  put back; « Mme Dupuis » never in what was sent, even when asked; a message saved during the
  translation takes nothing); `retention.int.test.ts` (the purge).
- Browser: `e2e/info-parents.spec.ts` (the draft, editing, copying, « Traduire en anglais (IA) »
  with AI off then on, the PDF, « Aujourd'hui », « Marquer comme envoyé »; axe on each),
  `e2e/info-parents-mobile.spec.ts` (360 × 740), the CSP loop in `operations.spec.ts`, and
  `legal.spec.ts`, `onboarding.spec.ts` (the new terms).

## Deviations from the plan

- **S3:** the request also carries the keys of the paragraphs the preview showed as sent
  (`sendKeys`, `request_newsletter_translation`'s fourth argument), so the worker sends exactly the
  paragraphs the teacher saw; the server refuses a request whose preview changed since
  (`newsletterStale`), not only a new revision. Sections the teacher removed are never sent, and a
  message marked sent is never translated. The title rule also knows « Dr », « Dre », « Mgr » and
  the religious and family titles (« le père Gagnon », « mon frère Lucas »), and up to two words
  between the title and the name (« M. le maire Watson »). The feature has its own part of the last
  check (`outboundFindings`), and the eval's fake answer carries the school's words (« PA day »,
  "Grade 3", the days and months) so every check runs on it. A translation that would make the
  message too large for the app fails (`newsletterTooLargeForAi`). pgTAP for S3 is its own file,
  `37_class_newsletters_ai`. (The post-MVP review widened the title rule again; see below.)
- **The seed** (S3, lead decision): the demo's « Messe de l'école » goes on the first Friday, by the
  school's date (America/Toronto), that is not a seeded day off, so the demo never shows a mass on a
  PA day (`supabase/seed.sql`; `e2e/helpers.ts` `comingSchoolFriday`; `absence.spec.ts` checks it;
  `year-plan.spec.ts` expects the mass in the Thanksgiving week when the reset puts it there).

## Post-MVP review (2026-10-03)

The review of the three features changed this one in commits `627ce0a`, `401f593` and `8f07a60`
(D-137, D-139 and D-144 have the details):

- **The title rule fails closed** (`packages/ai/src/unknown-names.ts`, one implementation for the
  preview, the worker and its last check): after a title, no allowed word applies (« Mme Noël »,
  « Mme St-Pierre » and « le père Noël » are left out); more titles (plural, religious,
  professional, English, family); any space or a line break between the title and the name; up
  to three words between them; after an honorific, a lowercase name too (« madame dupuis »).
- **« Mots avec majuscule à vérifier »** lists capitalized words at a sentence's start and after
  « : », « ( », « « » and a dash too; Grace, April, May, June and August are no longer treated as
  words that never name a person.
- **The first draft:** prepared during the week before, that week's remaining lessons stay in it;
  no lesson before the school year starts or after it ends; a unit too long for a paragraph lists
  its first lessons and « et 6 autres leçons »; the app's lines end with a period; the faith moment
  names the virtue and quotes the reflection; « Message » shows once.
- **A sent message keeps its text** (`LXN07`) until « Remettre en brouillon »; class-wide reads go
  page by page past PostgREST's 1,000-row cap; the class tabs scroll the current one into view on
  phones.

## Known limits

- **Names the title rule does not catch.** A name the app does not know is caught only by the
  teacher, who reads the exact text before she confirms (the preview says so), when it has no
  title (« Merci à Sophie » is listed, not blocked), when it is lowercase without a title, when it
  is also a word the app treats as common (« Noël » alone, or a little word at the start of a
  sentence), when it is lowercase after a title that is also an everyday word (« le curé
  gagnon »), or when it follows a word the app does not take for a title (« la directrice
  Dupuis »).
- **The rule also leaves out some paragraphs that name no one** (« le père Noël », « la mère de
  Dieu »): the teacher writes their English herself.
- English only (other languages after the pilot, Q4); no « Améliorer le texte (IA) » (Q3).
- The AI's English is reviewed by the teacher (« à relire »); the prompt's glossary covers the usual
  Ontario school words, not a board's own names for its programs.
- Nothing is sent by the app: read receipts, scheduling and parent contacts are out of scope.

## Questions (answered by the lead for Mike, 2026-10-03; we built on these answers)

Mike has not confirmed these answers yet: `docs/HANDOFF.md` « Decisions waiting for Mike » lists
them for him.

1. The app sends nothing: copy or print only; no parent data, no parent accounts.
2. « Traduire en anglais (IA) » in v1 with the stricter rules; off wherever AI is off; the preview
   shows exactly what is sent.
3. No « Améliorer le texte (IA) » in v1: « Corriger la typographie » instead.
4. Other languages after the pilot.
5. Messages are kept with the students' first names and deletable at any time.
6. « Moment de foi » included by default; one click removes it.

## What to test with pilot teachers

- Is the first draft close enough to what they write each week? Which sections do they remove?
- Do they translate, and does the « Non envoyé » rule catch the names they write (parents,
  volunteers, guests)? Are the capitalized words to check useful or noisy?
- Where does the message go (the board's e-mail, a portal, paper)? Is the copied text's layout
  right there?
