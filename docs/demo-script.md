# Demo script

A 15-minute demo for a school board (pedagogy, privacy or IT staff), and a 5-minute version. It
runs on a laptop with the demo data; nothing is hosted. `apps/web/e2e/demo.spec.ts` clicks through
steps 1 to 10 on every change, so the script stays true (DECISIONS D-120).

The people (all invented, in `supabase/seed.sql`): Isabelle Tremblay (3e année teacher), Julie
Bergeron (office), Sophie Lavoie (principal), Nathalie Roy (board admin), and a substitute who has
no account.

## Before the demo

1. Reset the demo data and start everything (`docs/HANDOFF.md` § 3):

   ```bash
   tools/lite-stack/stack.sh reset
   pnpm --filter @lynx/web build && (cd apps/web && pnpm start)        # http://localhost:3000
   (cd apps/worker && set -a && . ../web/.env.local; set +a && AI_PROVIDER=fake pnpm start)
   ```

   The worker must run with the fake AI provider: nothing leaves the laptop.

2. As Sophie, « École » → « Activer l'IA » (AI is off until the principal turns it on).
3. As Isabelle, « Classes » → 3e année → « Élèves » → « Alerte de sécurité ou médicale » → add an
   alert for Samuel (« Allergie aux arachides, auto-injecteur dans le sac »).
4. Open four browser windows, signed in as Isabelle, Julie, Sophie and Nathalie (codes arrive in
   Mailpit, `http://127.0.0.1:54324`), plus a private window for the substitute. A phone-sized
   window for Isabelle and the substitute makes the point that it works on a phone.
5. Have the hosting slide ready (step 11).

## The 15-minute demo

### 1. The privacy promise (1 min)

**Say:** "Before features: students are first names only, and the data is stored in Canada. Before
anything goes to the AI, the app replaces the names of the school's students and staff. A name it
doesn't know, a parent's for example, the teacher removes herself: she sees exactly what is sent.
This page is what every teacher reads before they start."

**Click:** the login page → « Confidentialité et conditions ». Show « Ce que l'application
recueille », « L'intelligence artificielle » (with its limit: « Elle ne reconnaît pas les autres
noms ») and « Où sont les données ».

### 2. Isabelle's « Aujourd'hui » (1 min)

**Say:** "This is the teacher's day: each period with the next lesson of her unit, from her own
planning. One tap marks a lesson taught."

**Click:** Isabelle → « Aujourd'hui ». Point at « Entrée, prière du matin et O Canada », the
Français period with « Prochaine leçon », and the « Je suis absent·e » button. The footer has
« Confidentialité », « Nouveautés » and the version.

### 3. 6 a.m.: Isabelle is sick (2 min)

**Say:** "At 6 a.m. she reports her absence from her phone. The substitute plan builds itself from
her planning: no one types a plan at dawn."

**Click:** « Je suis absent·e » → (the day) → « Envoyer ». The page shows « Prêt · publié
automatiquement … à 7 h 30 ». « Réviser le plan »: the day's periods with the lessons, the groups
by first name (Samuel, Adam and Aïcha in Débutant), the office phone. « Publier maintenant ».

### 4. The office gives a code; the substitute arrives (2 min)

**Say:** "The substitute has no account. The office gives a code for that day only; every view is
logged with who issued the code."

**Click:** Julie → « Suppléances » → Isabelle's day → « Générer un code ». Show « Texto »,
« Courriel » and « Imprimer la feuille d'accueil », then « Fermer ».

In the private window: `/s` → the line « En utilisant ce code, vous accédez à des renseignements
confidentiels réservés à cette journée ; chaque consultation est enregistrée. » → type the code
(lower case is fine) → « Commencer ». The schedule, the office phone. « Élèves » → « Alertes de
sécurité ou médicales »: Samuel's alert appears only when tapped, and that reveal is logged.
« Masquer les alertes ».

### 5. The end-of-day report (1 min)

**Say:** "At the end of the day the substitute says what was done. The office only sees that it
arrived; the teacher reads it the next morning."

**Click:** substitute → « Fin de journée » → « Remplir le suivi de la journée » → a lesson
« Terminé », a line in « Comportement et événements » → « Envoyer le suivi » → « Merci! ». Julie's
board shows « Suivi reçu ». Isabelle → « Aujourd'hui »: the banner « Le suivi de la suppléance du …
est arrivé. » → « Voir le suivi » → « Confirmer le suivi » is hers to press.

### 6. « Ressources » and « Texte différencié » (2 min)

**Say:** "The board's resource bank, reviewed by people the board designates. And AI that adapts a
text to each language level: the names of the school's students go out as markers."

**Click:** Isabelle → « Ressources » → search « nombres 1000 » → « Quiz : les nombres jusqu'à 1 000 ».
Back on « Ressources », « Texte différencié »: a title, a text with « Zoé » in it → « Vérifier avant
d'envoyer »: Zoé is highlighted as « Élève A » → « Envoyer à l'IA ». The levels appear (the demo
uses local answers, no real AI). « Voir exactement ce qui a été envoyé »: « Élève A », never Zoé.

### 7. « Présenter à la classe » (1 min)

**Say:** "The same quiz on the classroom projector, one question at a time. The answer comes only
when the teacher asks. Students can also answer on class tablets, with no accounts."

**Click:** on the quiz → « Présenter à la classe » → → (« Question 1 sur … ») → « Afficher la
réponse »: « Bonne réponse » on 407. Optional: « Lancer un quiz sur les appareils » with a tablet
(`docs/phase-5.md`, demo script).

### 8. « Tableau de bord de la direction » (1 min)

**Say:** "What a principal needs at 7:45: who is away, whether the day is covered, and who read
alerts. Never the teachers' planning."

**Click:** Sophie (she lands here) → « Absences aujourd'hui » (or « Prochain jour d'école »):
Isabelle's day, « Publié », « 1 code actif », « 1 appareil », « Suivi reçu ». « Accès aux alertes
(7 derniers jours) », « Contributions à la banque de ressources », « Utilisation de l'IA ce
mois-ci ».

### 9. « Journal d'audit » (1 min)

**Say:** "Every access to sensitive information is logged. A code the office issued is flagged,
because whoever holds a code sees the day's plan. The log never holds a student's name."

**Click:** « Voir le journal d'audit » (or `/audit`) → « Catégorie » « Alertes » → « Afficher »: the
substitute's entry « Alertes de sécurité ou médicales consultées », « code émis par Julie Bergeron », with
the badge « Code émis par le secrétariat ». « Télécharger (CSV) »: the export
is itself logged.

### 10. « Conseil » (2 min)

**Say:** "The board's administrator invites staff, without IP Lynx and without our servers sending
any invitation e-mail. The teacher's first sign-in starts with the privacy points and the pilot
terms, then a sample class to try the app."

**Click:** Nathalie → « Conseil »: « Pour bien démarrer le conseil », « État du système » (the
background service, the last backup, the last clean-up), « Conservation des données ».
« Personnel » → « Inviter une personne » → an address, « Mme », a name, « Enseignant·e » →
« Inviter » → « Le compte est prêt. Envoyez ce message à … » with « Courriel », « Texto », « Copier
le message ».

In another private window, sign in as the new teacher (her code is in Mailpit): « Bienvenue », the
five points, the box, « Commencer » → « Pour bien commencer » → « Essayer avec une classe exemple
(3e) » → the class page: « Classe exemple : elle n'est jamais incluse dans un plan de suppléance et
sera supprimée le … ».

### 11. Hosting and residency (1 min, a slide)

**Say:** "Planned hosting by IP Lynx in Canada, not live yet: the database and sign-in in Montréal,
the app's server in Montréal, and our own backups, encrypted, in Montréal. Before go-live we get
Supabase's written answer on where its own backups and logs are kept. Only the text a teacher sends
to the AI goes to the United States, with the names the app knows replaced. Or the board runs the
same thing on its own servers."

**Show:** the residency table of `PRIVACY.md` § 6 and the diagram of `DEPLOYMENT.md` § 1.

## The 5-minute demo

1. **The promise** (30 s): step 1, one sentence.
2. **6 a.m.** (1 min): step 3, report the absence and show the plan.
3. **The substitute** (1.5 min): step 4, the code and the alert revealed on tap.
4. **The principal** (1 min): steps 8 and 9, the dashboard, then the audit entry flagged
   « Code émis par le secrétariat ».
5. **The board** (1 min): step 10, the invitation message, and step 11 in one sentence.

## After the demo

`tools/lite-stack/stack.sh reset` puts the demo data back as it was (the alert, the absence, the
invited teacher and her sample class go).

## Questions boards often ask

- "Where is the data?" `PRIVACY.md` § 6.
- "Can the principal see my planning?" No: the dashboard shows absences and contributions, never
  units, lessons or progress (D-102).
- "Can the board see sick days?" No: board admins see administrative entries only (D-103).
- "What does the AI provider receive?" `docs/ai-data-flow.md`; the « Voir exactement ce qui a été
  envoyé » box shows it for each request.
- "Can we host it ourselves?" Yes: `DEPLOYMENT.md` § 4.
