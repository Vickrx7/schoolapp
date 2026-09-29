'use client';

import { useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/field';
import { parseWhole } from './question-ops';

/**
 * A whole-number field the teacher can empty and retype: what she types stays as typed, the form
 * gets each number that fits, and only when she leaves the field does an empty one become its
 * minimum (a field that cannot be empty) and a number out of range its nearest limit. Clearing
 * « 1 » to type « 2 » gives 2, never 12.
 */
export function NumberInput({
  value,
  onValue,
  min,
  max,
  nullable = false,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & {
  value: number | null;
  onValue: (value: number | null) => void;
  min: number;
  max?: number;
  /** Empty is a value of its own (null), kept when the field is left. */
  nullable?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [shown, setShown] = useState(value);
  // The form changed from outside (a draft brought back): show its value.
  if (value !== shown) {
    setShown(value);
    if (parseWhole(text) !== value) setText(value === null ? '' : String(value));
  }
  const fits = (n: number) => n >= min && (max === undefined || n <= max);
  const clamp = (n: number) => Math.max(min, max === undefined ? n : Math.min(max, n));

  return (
    <Input
      {...props}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = parseWhole(raw);
        if (n === null) {
          if (nullable && raw.trim() === '') onValue(null);
        } else if (fits(n)) {
          onValue(n);
        }
      }}
      onBlur={(e) => {
        const n = parseWhole(text);
        const next = n === null ? (nullable ? null : min) : clamp(n);
        setText(next === null ? '' : String(next));
        if (next !== value) onValue(next);
        props.onBlur?.(e);
      }}
    />
  );
}
