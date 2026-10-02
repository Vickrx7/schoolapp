/**
 * CSV files people open in a spreadsheet (« Télécharger (CSV) »): UTF-8 with a byte order mark so
 * Excel reads the accents; `;` between cells and a decimal comma in French (as Excel expects in a
 * French setting), `,` and a decimal point in English. A cell that starts like a formula
 * (`= + - @`, a tab or a carriage return) gets a `'` in front so a spreadsheet never runs it
 * (D-103). Pure, so it is unit tested; the board's AI usage export uses it, and so can the audit
 * log's.
 */
export type CsvValue = string | number | null | undefined;

export function csvSeparator(locale: string): ';' | ',' {
  return locale.startsWith('fr') ? ';' : ',';
}

export function csvCell(value: CsvValue, separator: ';' | ','): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (typeof value === 'number') {
    text = Number.isFinite(value) ? String(value) : '';
    if (separator === ';') text = text.replace('.', ',');
  } else {
    text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  }
  return /["\r\n]/.test(text) || text.includes(separator) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole file: a header row then the rows, lines ending in CRLF, with a byte order mark. */
export function csvDocument(rows: readonly (readonly CsvValue[])[], locale: string): string {
  const separator = csvSeparator(locale);
  return `\uFEFF${rows.map((row) => row.map((v) => csvCell(v, separator)).join(separator)).join('\r\n')}\r\n`;
}
