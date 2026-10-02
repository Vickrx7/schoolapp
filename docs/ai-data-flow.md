# What the AI sees: data flow for AI features

This page describes exactly what goes to the AI provider, written to help answer a school board's
privacy questionnaire. `PRIVACY.md` (Phase 6) points here as its annex. Decisions: DECISIONS.md,
D-037 to D-046, D-052 for the substitute plan, D-072 to D-074 for the resource bank, and D-132 for
report card comment banks.

No AI feature receives a report card comment about a student; the composer runs in the browser.

## The rule

The rule we design to: nothing personal leaves Canada. Everything the app stores stays in the
Canadian database. Only text the app has de-identified is sent to the AI provider, and it may be
processed outside Canada. The app replaces the names it knows (below); a name it does not know (a
parent's, a sibling's) can only be removed by the teacher, who sees the exact text before it is
sent (« Known limits »).

## Who uses AI

Only staff: teachers, principals and vice-principals, at schools where the principal has turned AI
on and whose board allows it. Students never use AI features and never send anything to them.

## What happens when a teacher asks for a differentiated text

1. **Preview, in the browser.** The teacher pastes a text and clicks « Vérifier avant d'envoyer ».
   The server cleans the text (below), replaces the names it knows with markers and shows the
   teacher exactly what would be sent. Personal details it detects (below) block the request until
   the teacher removes them.
2. **Queue.** On « Envoyer », the request is stored in the Canadian database (`ai_jobs`) with the
   teacher's text as typed. Only the teacher who made it can read it.
3. **De-identification, again, on the server.** The background worker, which alone holds the
   provider key, replaces every student and staff member of every school where the teacher works,
   and the staff of those boards, with a marker (« Élève A », « Adulte B »). It knows at least
   everyone the preview knew. It then checks the final text one last time and refuses to send it
   if a known name or a personal detail remains. This last check does not rely on the first pass:
   it cleans its own copy of the text again and also looks for names split by punctuation
   (« Lé.a », « Marie.Ève »).
4. **The call.** The worker sends, over HTTPS (TLS):
   - the system prompt (a fixed file from the code repository, `prompts/differentiate/v1.md`),
   - the de-identified text, its title and learning goal,
   - the grade (« 3e année »), the subject name and the names and descriptions of the language
     levels chosen.

   It sends **no** names of the students and staff the app knows, no email addresses or other
   details it detects, no user, school, board or account identifiers, and no alerts. A name it
   does not know goes out unless the teacher removed it at the preview.

5. **The answer comes back** to the worker in Canada, which puts the real names back in place of
   the markers and stores the result for the teacher.

## Plan de suppléance: « Consignes détaillées »

A teacher who is away can ask the AI to detail her substitute plan: timed steps with short
« Dites : » lines, instructions for each language-level group, an activity when a lesson is
missing or thin, and one sentence linking the day's faith moment to the topic. The plan is
complete without it: this is an optional step, never automatic, and never part of reporting an
absence at 6 a.m.

1. **Preview, in the browser.** On the plan page, « Ajouter des consignes détaillées (IA) » first
   saves any edit still pending, then opens « Vérifier avant d'envoyer ». The server builds the
   request from the plan as the teacher sees it (with her edits), replaces the names she can see
   with markers and shows her exactly the text that would be sent, with the replaced names
   highlighted.
2. **Fields left out instead of a blocked request.** A field that holds a personal detail (a phone
   number in a note for the substitute, an email in the materials...) is not sent at all, and the
   preview lists it as « Non envoyé », with where it comes from and why. The rest of the plan is
   still sent. This is the one difference from « Texte différencié », where such a detail blocks
   the request until the teacher removes it (D-038 as amended by D-052).
3. **Queue.** On « Envoyer à l'IA », the request is stored in the Canadian database (`ai_jobs`,
   feature `sub_plan`), only for a plan that has not changed since the preview and that no
   substitute has opened yet (a plan changed since is not sent: the preview opens again with the
   new text). The same school switch, budget and limits per person apply.
4. **De-identification, again, on the server.** The worker replaces every student and staff member
   of every school where the teacher works with a marker, leaves out any field with a personal
   detail again, and runs the same last check on the exact outbound text.
5. **The call.** The worker sends the system prompt (`prompts/sub_plan/v1.md`) and, for the
   teaching periods of the day (at most 10):
   - the weekday and the grades (« 3e année »);
   - the language-level groups as keys, level names, level descriptions and **numbers of
     students** (« G1 : Débutant, 3 élèves »), never who is in them;
   - per period: its times and minutes to plan, whether an event shortens or interrupts it (and
     the event's title), the subject, the unit title, the room (« Gymnase »), which groups are
     there, and the teacher's lesson (title, learning goal, materials, content, note for the
     substitute), or the class's « Activités de rechange » when there is no lesson. When the
     period uses a library resource (Phase 4, D-077), the note for the substitute also names it
     (« Activité prévue : « Le huard, oiseau des lacs » (Texte de lecture). ») and no activity is
     asked for; the resource's content itself is not sent;
   - the faith moment already chosen for the day (its title and text).

   It sends **no** student or staff names, no class or school names, no alerts, no « Gestion de
   classe », no arrival or dismissal notes, no absence note, no report content, and no ids: the
   ids of the timetable block, the lesson and the faith reference stay in Canada, to put the
   answer in the right place.

6. **The answer comes back** to the worker, which puts the real names back. The database adds it
   to the plan as its AI layer only if no substitute has opened the plan in the meantime. The
   teacher's own edits always come first, and each period's AI part is shown only while the
   period still has the lesson it was written for. The teacher can remove it at any time, and
   « Voir exactement ce qui a été envoyé » shows the exact text sent.

Once released, the AI layer is part of the plan: the substitute, the direction and the office read
it with the rest of the plan (D-056), and the plan PDF prints it. Instructions by group name the
level for adults; what students receive never names a level. The students' activities print as a
separate PDF, « Activités pour les élèves », in French: one page per group for each activity, with
only the group's number in a corner. Before printing, any student's first name or level name still
in the activity text is replaced by « … », since the answer came back with real names and a level
may have been renamed after the answer was checked.

## Banque de ressources: « Créer avec l'IA »

A teacher (or a principal or vice-principal) at a school with the Library module can ask the AI to
write a new resource for the bank: a worksheet, a reading passage, a quiz, an experiment and 21
other types, with a version for each language level if she wants, and a link with the faith if
she wants. The result is her private draft, which she reviews before using or sharing it. It is
never automatic.

1. **Choices, not text.** The form sends ids and choices only: the type, one or two grades, the
   subject, up to five attentes, the levels, a Catholic reference, the duration, whether it is for
   a substitute, and an optional note (« Précisions »), the only text she types.
2. **The request is built by the database.** From those ids, the database reads the French labels
   itself: the grades (« 3e année »), the subject, the domaine, the attentes' codes and texts, the
   levels' names and descriptions, and the reference's title and text. A browser cannot put other
   text in them. It also checks that each id belongs to her board and fits the others.
3. **Preview, in the browser.** « Vérifier avant d'envoyer » shows exactly the text that would be
   sent, with the names it replaced highlighted, and the board-approved resources that already fit
   the attente, before anything is spent. A personal detail in the note (below) blocks the request
   until she removes it.
4. **Queue, then de-identification again on the server,** as for every AI request: the same school
   switch, budget and limits per person, and the worker replaces every student and staff member of
   every school where she works with a marker, then checks the final text one last time.
5. **The call.** The worker sends the system prompt (`prompts/library_item/v1.md`, only its common
   part and the section for the chosen type) and the request: the type, grades, subject, domaine,
   attentes, duration, whether it is for a substitute, the levels' names and descriptions, the
   reference, a list of fictional first names for characters, and the de-identified note.

   It sends **no** ids, no school, board, class or staff names, no students, no alerts and no other
   resources. The list of fictional first names leaves out any name that belongs to someone the
   request knows (a student named Jules removes « Jules »).

6. **The answer comes back** to the worker. A resource is reusable, so the answer may name no one:
   an answer that contains a marker (« Élève A ») is refused and asked again, and so no student's
   name can come back into it. The database then stores it as her private draft, with the prompt
   version and model it came from. Sharing it later runs the check for students' first names
   (D-066).

## Banque de ressources: « Créer les versions manquantes avec l'IA »

On a resource she may edit, a teacher can ask the AI for the versions of the language levels it
does not have yet, from its base version.

1. **Preview.** She chooses the levels and « Vérifier avant d'envoyer » shows exactly what would be
   sent, names highlighted. A personal detail anywhere in the resource blocks the request.
2. **The request is built by the database** from the resource she may edit: its type, grades and
   subject, the levels' names and descriptions, and its base version and answer key. A resource
   whose base version would make the answer too long is refused.
3. **De-identification and the call,** as above, with `prompts/library_levels/v1.md`. Every string
   of the base version and its key is de-identified; ids of questions and choices stay as they are,
   and so do the resource's and levels' ids, which never leave Canada.
4. **The answer comes back** to the worker, which puts the names back (the answer may only repeat
   the markers the base version had). The database adds the versions only if the resource has not
   changed since the request; otherwise nothing is added and she asks again. A reviewed resource
   that gains versions becomes her private draft again: nobody else uses what the AI wrote before
   she has read it, marked it reviewed and shared it again (the first-name check runs again).

## Banque de ressources: « Génération en lot » (bulk generation)

The platform operator (IP Lynx, or a board's IT for an install the board hosts) can have the AI
write many resources for one board at once: for example quizzes and worksheets for every attente
of 3e année Mathématiques that the board has no resource for yet (D-095 to D-098). It is run from
the admin tool (`pnpm admin bulk-plan`, then `bulk-start`), never from the app. The results are
the board's own private drafts, which the board's designated reviewers read, edit and approve
(« Brouillons du conseil ») before any teacher sees them.

1. **Choices, not text.** The operator chooses the board, one or two grades, the subject, the
   types, a cost cap, and optionally a domaine, attente codes and a short note (at most 1,000
   characters, the only text typed). Faith reflections and Enseignement religieux are never
   generated in bulk.
2. **The requests are built by the database,** one per attente and type, exactly as for « Créer
   avec l'IA »: the French labels, the attente's code and text, and the board's levels, read from
   the tables. The note holds the operator's note and the **titles of the board's own or
   board-wide resources** already written for that attente and type (« Ressources existantes à ne
   pas reprendre : … »), so the AI does not write the same thing again. Titles of resources shared
   with one school only are never sent. An attente and type that the board already covers is left
   out.
3. **De-identification with everyone of the board.** Before anything is sent, the worker
   de-identifies each request with **every student of the board's schools and every person with a
   role at the board or its schools**, refuses a request that holds a personal detail (an e-mail
   address, a phone number…), and checks the final text one last time, with the same code as
   every other AI request. A refused request is simply not sent.
4. **The call: one batch.** The worker sends the requests as one batch through Anthropic's Message
   Batches API, with the same system prompt (`prompts/library_item/v1.md`, the section for each
   type) and the same content as « Créer avec l'IA »: the type, grade, subject, domaine, attente,
   duration, the levels' names and descriptions, a list of fictional first names for characters
   (leaving out every name the board knows), and the de-identified note. Each request carries a
   random id (`custom_id`, a request uuid) and nothing else about the board.

   It sends **no** ids of the board, schools, classes or people, no names of the board's staff or
   students, no alerts and no teacher's text.

5. **At the provider.** A batch is processed within 24 hours (usually within the hour). The worker
   reads the answers as soon as the batch has ended, then **deletes the batch and its results from
   the provider**; a batch that is never read is kept there for at most 29 days. The
   zero-data-retention request to Anthropic should ask whether batches are covered.
6. **The answers come back** to the worker. Before using an answer, it prepares its request again:
   if what it would send is no longer exactly what was sent (a person joined or left the board
   since, so the markers differ), the answer is not used. Otherwise the answer is checked like any
   other (normalized, validated: an answer with a marker is refused), the names are put back, and
   the database stores it as the board's private draft with the prompt version, the model and the
   batch id. An answer that contains a first name of a student of the board (a coincidence: the
   characters take the allowed fictional names) is flagged « Prénom d'élève possible » for the
   reviewer; only the flag is stored, never the name.
7. **Cost.** A run has a hard cap: requests are sent only while the sum of their worst cases (the
   counted input and the most the answer may be) stays within it, at batch prices (half). Costs are
   recorded per board, outside every school's budget, and the operator sees them in
   `pnpm admin ai-usage`.

## Banque de commentaires de bulletin : « Créer une banque avec l'IA »

A teacher (or a principal or vice-principal) at a school with the Library module can ask the AI to
write a report card comment bank (« Banque de commentaires de bulletin », D-129): points forts
and prochaines étapes, for each level of the report card or each mark of the progress report, that
she later picks from and adapts for each student. The AI writes from curriculum labels only: **it
never sees a student or anything about one**. The result is her private draft, which she reviews
before using or sharing it (D-132). It is never automatic.

1. **Choices, not text.** The form sends ids and choices only: what the bank is for (a subject,
   the learning skills and work habits, or Enseignement religieux), the report (« Bulletin de
   progrès » or « Bulletin scolaire »), one grade (1re to 8e année), the subject, up to 12
   attentes, the length of the entries (250 or 400 characters), and an optional note
   (« Précisions », at most 500 characters), the only text she types.
2. **The request is built by the database.** From those ids, the database reads the French labels
   itself: the grade (« 3e année »), the subject, the attentes' codes, texts, kinds and domaines.
   A browser cannot put other text in them. It also checks that each id belongs to her board and
   fits the others (the attentes of that subject and grade; Enseignement religieux only for a
   religion bank; no subject for the learning skills).
3. **Preview, in the browser.** « Vérifier avant d'envoyer » shows exactly the text that would be
   sent, with the names it replaced highlighted, under « Aucun renseignement sur vos élèves n'est
   envoyé : seulement l'année, la matière et les attentes choisies. » A personal detail in the
   note (below) blocks the request until she removes it.
4. **Queue, then de-identification again on the server,** as for every AI request: the same school
   switch, budget and limits per person (the school's monthly budget pays for it), and the worker
   replaces every student and staff member of every school where she works with a marker, then
   checks the final text one last time.
5. **The call.** The worker sends the system prompt (`prompts/report_comment_bank/v1.md`: its
   common part, the section for the scope and, for a subject or religion, the section for the
   report) and the request: the grade, the subject, the report and its marks, the attentes with
   their keys (« E1 »), codes and texts, the length of the entries, and the de-identified note.

   It sends **no** ids, no school, board, class or staff names, no students, no alerts, no
   report card comment and no other resource.

6. **The answer comes back** to the worker. Every text names the student only with the
   placeholder `{prénom}`; an answer with any other placeholder, a marker (« Élève A »), a
   curriculum code in a text, a qualifier of another level or a text over the chosen length is
   refused and asked again, and so no name can come back into a bank. The database then stores it
   as her private draft (`app.library_item_from_ai_result`, as « Créer avec l'IA »), with the
   prompt version and model it came from. In the composer, the student's first name replaces
   `{prénom}` on the device only.

## How names are found

- **The text is cleaned first.** Text pasted from web pages, PDFs or Word often carries invisible
  characters (soft hyphens, zero-width spaces and joiners) that would split a name in two. They
  are removed, and odd hyphens inside words (such as the non-breaking hyphen in « Marie‑Ève »)
  become plain hyphens. The cleaned text is exactly what is checked and sent.
- **Every known person, in any spelling.** Names are matched with or without accents and in any
  case. Letters such as ł, ø, đ, ı, æ, œ and ß also match their plain form (« Łukasz » and
  « Lukasz »), and names in any alphabet are matched (« Анна », « 李明 »). The words of a name may
  be separated by spaces, any kind of hyphen or dash, apostrophes or underscores.
- **Staff by any part of their name.** « Mme Tremblay », « Madame Isabelle », « Tremblay » or
  « Isabelle » alone, and each half of a compound name: « Mme Gagnon » or « Roy » for Anne
  Gagnon-Roy, « Jean » for Jean-François Bélanger.
- **Names that are everyday words** (Pierre, Claire, Rose, Aimé, or staff surnames such as Côté,
  Parent or Plante) are matched only when capitalized, or after an honorific (« Mme parent »).
- **Particles and very short parts.** « De », « Des », « Du », « La », « Le », « D' »,
  « Saint », « Van »... in a staff name are everyday words, never a name on their own. They stay
  with what follows (« De Grandpré », « La Salle », « D'Amour »), and the part after them is
  matched alone only when capitalized (« Salle », but not « la salle de classe »). Particles and
  parts shorter than three letters (« Lê », « Au », « Tạ ») are matched alone only after an
  honorific: « Mme Lê », « M. Au ».
- **Never the wrong person.** When a name could be several people (two staff members named Roy,
  a student and a teacher both named Isabelle), it is still replaced, and it comes back in the
  answer exactly as the teacher wrote it, never as a guess at who it was. The same goes for a
  staff name written in lowercase, which could be an ordinary word.
- **The teacher's own labels stay generic.** If the text already says « l'élève A » (in a math
  problem, for example), real people get other letters, and « l'élève A » is never turned into a
  real name in the answer.

## Personal details that block a request

- Emails.
- Phone numbers, including ones written with other dashes, spaces or a slash
  (« 613‑555‑1234 », « 613 - 555 - 1234 », « 613/555-1234 »).
- Long identification numbers, such as an OEN or a health card number.
- Postal codes, including ones with a non-breaking space or a dash in the middle.
- Street addresses, in French or English order (« 12, rue des Érables », « 1500 prom. Riverside »,
  « 450 Elgin Street », « 123 Bank St. »).
- A child's birth date: a date near « née », « naissance », « anniversaire », « born » or
  « birthday », in French or English order (« 3 mai 2017 », « May 3, 2017 »), without a year or
  with a recent one; or a record-style date with a recent year (2017-05-03, 2017/05/03,
  2017.05.03, 03/05/2017).

The teacher removes them and checks again. The app never blanks them out itself to send the rest
of the text.

## What is kept, where and for how long

| Data                                                                                                | Where             | Kept                                                   |
| --------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------ |
| The teacher's text, the answer, and the exact de-identified text sent (`ai_jobs`)                   | Canadian database | 30 days, then deleted                                  |
| Saved differentiated texts (library drafts)                                                         | Canadian database | Until the teacher deletes them                         |
| Resources written with the AI, and versions added by it (library items, private drafts)             | Canadian database | Until the teacher deletes them                         |
| Comment banks written with the AI (library items, private drafts; `{prénom}`, no student data)      | Canadian database | Until the teacher deletes them                         |
| Bulk runs and their requests: the de-identified text sent (`library_bulk_requests.sent_text`)       | Canadian database | 30 days, then only its SHA-256 (runs: 1 year)          |
| The board's drafts from bulk generation (library items, private until approved)                     | Canadian database | Until a reviewer deletes them                          |
| A bulk batch and its answers                                                                        | The AI provider   | Deleted as soon as read (otherwise at most 29 days)    |
| A substitute plan's AI layer (`sub_plans.ai`: the answer with names back, and block and lesson ids) | Canadian database | With the plan (1 year, D-059), or until removed        |
| Usage records: date, feature, prompt version, model, token counts, cost, status (`ai_generations`)  | Canadian database | 730 days by default (per board, 365 to 3,650); no text |
| Request log for the hourly limit: job id, user id, time (`ai_request_log`)                          | Canadian database | 1 day (no text)                                        |
| What the provider receives                                                                          | The AI provider   | Under the provider's own retention terms (see below)   |

## The provider

Claude, by Anthropic, through the Anthropic API. By default Anthropic retains API inputs and
outputs for a limited period under its commercial terms; a zero-data-retention arrangement can be
requested from Anthropic before production use. That request has not been sent yet: it is a
go-live gate (`DEPLOYMENT.md` § 3.11). The provider is set by configuration, so a board
can require its own approved cloud account or a model hosted in Canada instead (see D-041).

## Controls

- Per school: AI is off until the principal or vice-principal turns it on (audited).
- Per board: AI can be forbidden for all schools.
- Budgets: monthly spending caps per school and per board, set only by the platform operator
  (boards cannot change them). They are checked when a request is made and again just before it
  is sent.
- Limits per person: 3 requests at a time and 40 per hour.
- Every request's usage is logged; the direction sees the month's totals per school on
  « Tableau de bord de la direction » and the École page, board admins on « Utilisation de
  l'IA ». Nobody sees per-person figures (D-104).

## Known limits

- A name the app doesn't know (a parent, a sibling, a student from a school where the teacher
  doesn't work) can only be caught by the teacher at the preview step. The preview reminds them to
  check.
- A resource written from scratch names no one, but a character's fictional first name can still
  be the name of a student elsewhere in the board. Before a resource is shared, the app checks it
  for the first names of the students of the author's schools (D-066); the author confirms each
  name that is not a student's.
- A historical figure who shares a student's first name (« Samuel de Champlain » when a student is
  named Samuel) is also replaced, then restored in the answer.
- A name that is also an everyday word and is typed in lowercase (« pierre » for a student named
  Pierre) is not replaced; the preview shows it unhighlighted.
- A name disguised with punctuation (« Lé.a ») is not replaced in the preview, but the last check
  refuses to send it.
- Very short names that match a French word once accents are removed (« Tú » and « tu », « Lê »
  and « le ») also replace that word everywhere. A student named « Tú » would make the last check
  refuse every request from that school, because the instructions sent to the AI begin with
  « Tu aides ».
- A very short part of a staff name used alone, without an honorific (« Lê » for Minh Lê), is not
  replaced: alone it is an everyday word. The teacher sees it unhighlighted in the preview.
- The detectors can occasionally block an ordinary text (an English title such as « 9 Supreme
  Court », a version number that looks like a recent date). The teacher rewords it. Street types
  that are also French words (court, place, square) count only when capitalized, so « En 1980,
  Terry Fox court » goes through.
