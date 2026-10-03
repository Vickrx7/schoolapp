import { lines, parseGlossary, type EditableVersion } from './result-lines';

/**
 * Headings on the student copy. The handout is in the content's language, French, whatever
 * the interface language (D-033: only the interface is translated).
 */
const HEADINGS = { glossary: 'Glossaire', questions: 'Questions' } as const;

/**
 * Printed student copies, one level per page. No level name on the page, only a small neutral
 * number for the teacher, so no student sees themselves labelled "Débutant".
 */
export function StudentCopies({
  versions,
  printing,
}: {
  versions: readonly EditableVersion[];
  printing: readonly number[];
}) {
  return (
    <div lang="fr-CA" className="hidden text-black print:block">
      {printing.map((index) => {
        const x = versions[index];
        if (!x) return null;
        const glossary = parseGlossary(x.glossary);
        const questions = lines(x.questions);
        return (
          <section key={x.languageLevelId} className="break-after-page space-y-4 font-serif">
            <p className="text-right text-xs text-gray-400">{index + 1}</p>
            <h1 className="text-2xl font-bold">{x.title}</h1>
            <div className="text-lg leading-relaxed whitespace-pre-wrap">{x.text}</div>
            {glossary.length ? (
              <div>
                <h2 className="text-lg font-bold">{HEADINGS.glossary}</h2>
                <dl className="mt-1 space-y-1">
                  {glossary.map((g, i) => (
                    <div key={i}>
                      <dt className="inline font-bold">{g.term}</dt>
                      {g.definition ? <dd className="inline"> : {g.definition}</dd> : null}
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
            {questions.length ? (
              <div>
                <h2 className="text-lg font-bold">{HEADINGS.questions}</h2>
                <ol className="mt-1 list-decimal space-y-6 pl-6">
                  {questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
