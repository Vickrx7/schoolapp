# Running the pilot

For Mike, as the pilot boards' administrator. It says what to do before the first teacher signs
in, how to invite people, what teachers should know on day 1, what to look at each week, what to
test, and how to end the pilot. The technical setup is in `DEPLOYMENT.md`; what the app does with
personal information is in `PRIVACY.md`. Your open questions are at the end of `docs/phase-6.md`.

## 1. Before the pilot

These are the steps that must be done before real teachers use the app. The ones marked "you"
need your decision or your account; the others are ours.

1. **The name** (you). « Lynx École » is a placeholder. Once you choose, we change it in one
   setting and in the sign-in e-mail.
2. **Accounts** (you, with our help, about 55 USD a month before AI):
   - Supabase Pro in Canada (the database and sign-in);
   - an AWS account for a server in Montréal, the sign-in e-mails and backup storage;
   - a domain for the app's address (for example `app.<your domain>`);
   - a free uptime monitor;
   - your Anthropic account for AI, with a monthly spending limit.
3. **Two people** (you): a privacy contact address shown in the app (for example
   `confidentialite@iplynx.ca`), and the technical person who gets outage alerts (not you).
4. **A privacy lawyer** (you): one or two hours of an Ontario privacy lawyer's time on the pilot
   terms, a short notice to parents, and our minimum retention periods. Until then, teachers use
   invented names (section 3).
5. **AI** (you): send Anthropic the zero-data-retention request; we will give you the wording.
6. **Our checks** (us): a test restore of a backup, Supabase's written answer on where its logs
   and backups are kept, and the external monitors. `DEPLOYMENT.md` § 3.11 lists them.
7. **Each pilot board** (us): we create the board, its schools and school year, and your
   administrator account. You receive a sign-in message like your teachers will.
8. **Your first sign-in:** open the app's address, type your e-mail, type the 6-digit code from the
   e-mail. « Bienvenue » asks you to accept the pilot terms. You land on « Conseil », where « Pour
   bien démarrer le conseil » lists what is left to set up:
   - « Année scolaire créée »
   - « Coordonnées et heures des écoles » (the office phone that substitute plans show)
   - « Personnel invité »
   - « Journées pédagogiques et congés au calendrier » (in « Calendrier », « Tout le conseil »)
   - « Personnes qui approuvent les ressources »

## 2. Inviting teachers

1. « Conseil » → « Personnel » → « Inviter une personne ».
2. Fill in « Courriel », « Nom complet », « Titre (Mme, M., Mx…) », « Rôle », « École » and
   « Langue du message ».
3. « Inviter ». The page says « Préparation du compte… » for a few seconds, then « Le compte est
   prêt. Envoyez ce message à … ».
4. Send the message with « Courriel » or « Texto » (they open your own e-mail or texting app), or
   « Copier le message ». **The app sends no invitation e-mail itself.** The message tells the
   person the app's address, the e-mail to type, and that a 6-digit code will arrive.

Other things you can do on a person's page (« Personnel », then their name): add or remove a role,
« Retirer l'accès » (they can no longer sign in, at once) and « Rétablir l'accès ». To delete
someone's account and data, write to IP Lynx (the link is on the page).

If the page says « Cette adresse est déjà utilisée ailleurs dans l'application », the person
already works for another board in the app: write to us and we sort it out.

## 3. Day 1 for teachers

Tell each teacher, in the message or in person:

- **Use invented first names or initials** until their principal agrees in writing. The terms
  they accept at the first sign-in say so.
- **« Essayer avec une classe exemple »** on « Aujourd'hui » builds a sample class with 20 made-up
  names, a timetable and two units, to try everything. It is never in a substitute plan and is
  deleted after 60 days.
- **Alerts stay off** during the pilot (the principal's switch in « École »).
- **« Commentaires »**, at the top of every page, sends you a problem, an idea or a question.
  The app checks the message for students' first names and asks before sending one.
- **« Pour bien commencer »** (four steps) is on « Aujourd'hui »: create the class, add the
  students (first names only), enter the timetable, create a unit with lessons.

What they see at the first sign-in: « Bienvenue », five short privacy points, a link to
« Confidentialité et conditions », the box to accept the pilot terms, then their display name and
how students address them (Mme, M., Mx), used in substitute plans.

## 4. Each week

- **« Commentaires reçus »** (« Conseil »): read new feedback, mark it « Lu » or « Traité ». You see
  the sender's name only when they agreed to be contacted.
- **« État du système »** (« Conseil »): « Tout fonctionne normalement » is what you want. If it
  says a problem was detected for more than a day, tell us.
- **« Utilisation de l'IA »:** the month's requests and cost per school (no per-person figures).
- **« Journal d'audit »** (« Conseil », last tab): administrative changes, approvals, and every time
  IP Lynx accessed the board's data and why. You never see sick days or alert reads there: those
  are the principals'.

## 5. What to test with the pilot teachers

1. **From your message to her first class.** How long from your text on her phone until she is
   signed in (target: under 3 minutes)? Is anything about the 6-digit code confusing?
2. **« Bienvenue ».** Does she read the five privacy points? Do they reassure or worry her? Is
   « Comment les élèves vous appellent-ils? » clear?
3. **Setting up her real class:** class, students, timetable, one unit. Time it (target: under 20
   minutes on a laptop). Where does she stop?
4. **The sample class.** Does it help her understand « Aujourd'hui » and « Planification »? Does the
   notice that it is left out of substitute plans make sense? Does she delete it herself?
5. **« Commentaires ».** Does she find it and use it? Is the first-name check helpful or annoying?
6. **With a principal:** is « Tableau de bord de la direction » useful at 7:45? Is anything missing,
   or does anything feel like monitoring teachers? Does she understand « Journal d'audit » and
   « Code émis par le secrétariat »? Would she export it?
7. **You, as board admin, on your phone:** invite three people, remove one person's access, then
   restore it; set a school's office phone; add a PA day; find their feedback. Is anything too
   technical?
8. **« Nouveautés » and « Confidentialité ».** Would she read them? Is the French natural for
   Ontario?
9. **Trust.** After a week: would she enter real first names if her principal approved? What
   would make her more comfortable?

## 6. Ending the pilot

- **A person leaves:** « Retirer l'accès » on their page, then, if they want their data deleted,
  write to us: we delete the account (their private resources and classes they alone led go too).
- **A board stops:** export « Journal d'audit » (CSV) first; ask us for the library as a file if
  you want to keep it. We then delete the board and everything in it within 30 days, and confirm
  in writing. Backups that still hold it expire within 30 days more.

## 7. Later

- **A public demo site** would run on its own small server with invented data only, never on the
  pilot's server (which holds the pilot's keys). Until then, demos run on a laptop with the demo
  data (`docs/demo-script.md`).
- **Paid boards:** an independent security test (penetration test) is recommended before the first
  contract.
