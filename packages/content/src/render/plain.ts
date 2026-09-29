/**
 * A document as readable plain text: for lesson outlines, substitute-plan AI input and logs of
 * what a page shows. Blocks are separated by a blank line.
 */
import type { DocBlock, LeafBlock, RenderedDoc } from './doc';
import { DOC_LABELS_FR as L, labelled } from './labels-fr';

const indent = (text: string) => `   ${text}`;

function leafToText(block: LeafBlock): string {
  switch (block.type) {
    case 'heading':
      return block.level === 1 ? block.text.toUpperCase() : block.text;
    case 'paragraph':
      return block.text;
    case 'list':
      return block.items
        .map((item, i) => (block.ordered ? `${i + 1}. ${item}` : `- ${item}`))
        .join('\n');
    case 'steps':
      return block.items
        .map((step, i) => {
          const minutes = step.minutes ? `(${L.minutes(step.minutes)}) ` : '';
          const first = `${i + 1}. ${minutes}${step.text}`;
          return step.detail ? `${first}\n${indent(step.detail)}` : first;
        })
        .join('\n');
    case 'glossary':
      return block.entries
        .map((e) => (e.definition ? labelled(e.term, e.definition) : e.term))
        .join('\n');
    case 'question': {
      const points = block.points ? ` (${L.points(block.points)})` : '';
      const lines = [`${block.number}. ${block.prompt}${points}`];
      if (block.hint) lines.push(indent(labelled(L.hint, block.hint)));
      for (const c of block.choices)
        lines.push(indent(c.label ? `${c.label}) ${c.text}` : `[ ] ${c.text}`));
      for (const l of block.left) lines.push(indent(`${l.label}. ${l.text}`));
      for (const r of block.right) lines.push(indent(`${r.label}) ${r.text}`));
      for (let i = 0; i < block.lines; i++) lines.push(indent('____________________'));
      return lines.join('\n');
    }
    case 'table': {
      const rows = [block.columns, ...block.rows].map((row) => row.join(' | '));
      return [block.caption, ...rows].filter(Boolean).join('\n');
    }
    case 'lines':
      return Array.from({ length: block.count }, () => '____________________').join('\n');
    case 'callout':
      return [
        block.text ? labelled(block.title, block.text) : block.title,
        ...block.items.map((item) => `- ${item}`),
      ].join('\n');
    case 'rubric':
      return [
        block.caption,
        ...block.rows.map(
          (row) =>
            `${row.category} — ${row.criterion}\n${row.cells
              .map((cell, i) => indent(labelled(block.levels[i] ?? '', cell)))
              .join('\n')}`,
        ),
      ].join('\n');
    case 'answer': {
      const lines = [`${block.number}. ${block.text}`];
      for (const d of block.details) lines.push(indent(d));
      if (block.explanation) lines.push(indent(labelled(L.explanation, block.explanation)));
      return lines.join('\n');
    }
    case 'poem':
      return [block.title, ...block.lines].filter(Boolean).join('\n');
  }
}

function blockToText(block: DocBlock): string {
  if (block.type === 'section') {
    return [block.title.toUpperCase(), ...block.blocks.map(leafToText)].join('\n\n');
  }
  return leafToText(block);
}

export function docToPlainText(doc: RenderedDoc): string {
  const head = [doc.title, doc.subtitle].filter(Boolean).join('\n');
  return [head, ...doc.blocks.map(blockToText)].filter(Boolean).join('\n\n');
}
