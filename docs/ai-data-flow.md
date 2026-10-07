# What the AI sees: data flow for AI features

This page describes exactly what goes to the AI provider, written to help answer a school board's
privacy questionnaire. It will become part of `PRIVACY.md` in Phase 6. Decisions: DECISIONS.md,
D-037 to D-043.

## The rule

Nothing personal leaves Canada. Everything the app stores stays in the Canadian database. Only
de-identified text is sent to the AI provider, and that text may be processed outside Canada.

## Who uses AI

Only staff: teachers, principals and vice-principals, at schools where the principal has turned AI
on and whose board allows it. Students never use AI features and never send anything to them.

## What happens when a teacher asks for a differentiated text

1. **Preview, in the browser.** The teacher pastes a text and clicks « Vérifier avant d'envoyer ».
   The server replaces the names it knows with markers and shows the teacher exactly what would be
   sent. Personal details it detects (below) block the request until the teacher removes them.
2. **Queue.** On « Envoyer », the request is stored in the Canadian database (`ai_jobs`) with the
   teacher's text as typed. Only the teacher who made it can read it.
3. **De-identification, again, on the server.** The background worker, which alone holds the
   provider key, replaces every student of the school and every staff member of the school and
   board with a marker (« Élève A », « Adulte B »). It then checks the final text one last time and
   refuses to send it if a known name or a personal detail remains.
4. **The call.** The worker sends, over HTTPS (TLS):
   - the system prompt (a fixed file from the code repository, `prompts/differentiate/v1.md`),
   - the de-identified text, its title and learning goal,
   - the grade (« 3e année »), the subject name and the names and descriptions of the language
     levels chosen.

   It sends **no** student or staff names, no email addresses, no user, school, board or account
   identifiers, and no alerts.

5. **The answer comes back** to the worker in Canada, which puts the real names back in place of
   the markers and stores the result for the teacher.

## Personal details that block a request

Emails, phone numbers, long identification numbers (such as an OEN or a health card number),
postal codes, street addresses, and a child's birth date. The teacher removes them and checks
again. The app never sends a "cleaned" version of a text that contained them.

## What is kept, where and for how long

| Data                                                                                               | Where             | Kept                                                 |
| -------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------- |
| The teacher's text, the answer, and the exact de-identified text sent (`ai_jobs`)                  | Canadian database | 30 days, then deleted                                |
| Saved differentiated texts (library drafts)                                                        | Canadian database | Until the teacher deletes them                       |
| Usage records: date, feature, prompt version, model, token counts, cost, status (`ai_generations`) | Canadian database | Kept (no text)                                       |
| What the provider receives                                                                         | The AI provider   | Under the provider's own retention terms (see below) |

## The provider

Claude, by Anthropic, through the Anthropic API. By default Anthropic retains API inputs and
outputs for a limited period under its commercial terms; a zero-data-retention arrangement can be
requested from Anthropic before production use. The provider is set by configuration, so a board
can require its own approved cloud account or a model hosted in Canada instead (see D-041).

## Controls

- Per school: AI is off until the principal or vice-principal turns it on (audited).
- Per board: AI can be forbidden for all schools.
- Budgets: monthly spending caps per school and per board, set by the platform operator.
- Every request's usage is logged; the principal sees the month's usage on the École page.

## Known limits

- A name the app doesn't know (a parent, a sibling, a student from another school) can only be
  caught by the teacher at the preview step. The preview reminds them to check.
- A historical figure who shares a student's first name (« Samuel de Champlain » when a student is
  named Samuel) is also replaced, then restored in the answer.
