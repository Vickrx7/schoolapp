# Marketing

Promotional material for the platform (working name « Lynx École », set by
`NEXT_PUBLIC_APP_NAME`; D-002). French first (Canadian French, Ontario school usage, inclusive
writing), with a complete English version.

## The rule: claims only what ships

Every sentence must be true of the development build today. Use these labels, and nothing
stronger:

| Label (FR / EN)                                             | Use it for                                                                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| « Disponible (version pilote) » / "Available (pilot build)" | Phases 1–3: built and covered by automated tests. Not a live service, and no real teacher has used it yet (`docs/HANDOFF.md` §2). |
| « En construction » / "In construction"                     | Phase 4, the « Banque de ressources »: some screens exist, the feature is not finished (D-061 to D-081).                          |
| « Bientôt » / "Coming soon"                                 | Phase 5 (« Mode classe », library growth) and Phase 6 (pilot readiness): planned, not built (SPEC §13).                           |
| « Vision » / "Later"                                        | SPEC §12 modules. Never give a date.                                                                                              |

Privacy claims must match `DECISIONS.md` and `docs/ai-data-flow.md` exactly:

- Say what the product does. Claim no certification or compliance, and never say « 100 %
  sécuritaire », « chiffrement de bout en bout » or « toutes les données sont chiffrées »: the
  app encrypts alerts and report notes only.
- Nothing is hosted yet. Say « conçu pour être hébergé au Canada », never « vos données sont au
  Canada ».
- The de-identified AI text may be processed outside Canada (Claude, by Anthropic). The real AI
  has never been called: make no quality or time-saved claims and show no AI output.
- No board is a client and the pilot has not started. Name no board and show no board logo.
- The absence takes two taps, not one.

Before changing any claim, check it against `docs/HANDOFF.md` §2, the phase notes and
`DECISIONS.md`, and relabel it when a feature ships.

## Files

| Path                   | What                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site/index.html`      | Bilingual landing page for pilot teachers and school-board decision makers. FR/EN toggle (remembered in the browser), pilot form that sends nothing. |
| `one-pager/index.html` | Board fact sheet: French, then English. Print styles for a letter-size PDF later; despite the folder name, it prints to 7 letter pages.              |
| `promo/script-v2.md`   | 60-second promo script, French and English, scene by scene. Replaces the v1 story.                                                                   |
| `promo/`               | v1 stop-motion promo sources (Phase 1 claims; its sick-day scene is out of date, see its README).                                                    |

## The two HTML pages

- They are written to be published as claude.ai Artifacts: no `<!doctype>`, `<html>`, `<head>`
  or `<body>` (the host adds them), fonts from Google Fonts only, everything else inline, light
  and dark themes, no horizontal scroll at 360 px. They also open directly in a browser.
- No print button (Artifacts can’t print). The one-pager’s `@media print` rules are for a PDF
  made later from a browser.
- **Before sharing:**
  - The contact address `pilote@iplynx.ca` is a placeholder. Nobody has confirmed that mailbox.
    Change `CONTACT_EMAIL` in `site/index.html` and the two `.contact` lines in
    `one-pager/index.html`.
  - To rename the product, change `APP_NAME` in `site/index.html` (every `[data-app-name]`
    follows) and the name in `one-pager/index.html`.
- Both files pass `prettier --check`. French text uses non-breaking spaces inside « » and before
  « : », in times (« 8 h 45 ») and in markers (« Élève A »). Keep them when editing.
- Wording traps found in review:
  - « Activités pour les élèves » exists only when « Consignes détaillées (IA) » add an activity.
  - Only alerts and report notes are encrypted by the app, and a code works for whoever holds it,
    alerts included. Keep both next to any encryption or alert claim.
  - Only known names become markers; the detectors block emails, phone numbers, identification
    numbers, addresses and a child’s birth date, not "any personal detail".
  - In English, write "the principal" (or "principal or vice-principal"), not "the direction".
