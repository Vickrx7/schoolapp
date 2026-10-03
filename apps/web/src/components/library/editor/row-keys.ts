'use client';

import { useState } from 'react';
import { move, removeAt, type Direction } from './question-ops';

interface RowKeys {
  keys: number[];
  next: number;
}

/** Keys for `count` rows: the current ones in order, new ones at the end, extra ones dropped. */
export function fitRowKeys(state: RowKeys, count: number): RowKeys {
  if (state.keys.length === count) return state;
  if (state.keys.length > count) return { ...state, keys: state.keys.slice(0, count) };
  const added = Array.from({ length: count - state.keys.length }, (_, i) => state.next + i);
  return { keys: [...state.keys, ...added], next: state.next + added.length };
}

/**
 * Stable React keys for the rows of a list whose elements have no id of their own (success
 * criteria, steps, rubric rows): a key follows its row when the row moves or a row above it is
 * removed, so a moved row keeps its fields and its focus instead of taking another row's place.
 * Call `move` and `remove` together with the list's own change. Rows added or dropped from
 * outside (« Ajouter », a draft brought back) get new keys at the end.
 */
export function useRowKeys(count: number) {
  const [state, setState] = useState<RowKeys>(() => fitRowKeys({ keys: [], next: 0 }, count));
  const fitted = fitRowKeys(state, count);
  // Adjusting state from the previous render (React's documented pattern), once per change.
  if (fitted !== state) setState(fitted);
  return {
    keys: fitted.keys,
    move: (index: number, direction: Direction) =>
      setState((s) => ({ ...s, keys: move(s.keys, index, direction) })),
    remove: (index: number) => setState((s) => ({ ...s, keys: removeAt(s.keys, index) })),
  };
}

/**
 * React keys for questions: their id, which is stable and unique in a list (the schemas and the
 * answer key require it); a repeated id (content not yet valid) falls back to its position.
 */
export function questionKeys(questions: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  return questions.map((q, i) => {
    const key = seen.has(q.id) ? `${q.id}#${i}` : q.id;
    seen.add(q.id);
    return key;
  });
}
