/**
 * Generates packages/db/src/database.types.ts by introspecting Postgres directly.
 *
 * Output matches the shape of `supabase gen types typescript` so supabase-js is fully typed.
 * Use it where the Supabase CLI cannot run its Docker-based generator:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm db:types:direct
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const SCHEMA = 'public';
const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(here, '../packages/db/src/database.types.ts');

// Helper types copied from the Supabase generator's output.
const HELPERS = `type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never
`;

type Column = {
  table_name: string;
  column_name: string;
  udt_name: string;
  data_type: string;
  is_nullable: boolean;
  has_default: boolean;
  is_identity_always: boolean;
  is_generated: boolean;
  ordinal: number;
};

type Relationship = {
  table_name: string;
  constraint_name: string;
  columns: string[];
  referenced_table: string;
  referenced_columns: string[];
  is_one_to_one: boolean;
};

type Fn = {
  name: string;
  arg_names: string[] | null;
  arg_types: string[];
  arg_modes: string[] | null;
  num_defaults: number;
  returns_set: boolean;
  return_type: string;
  table_columns: { name: string; type: string }[] | null;
};

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const enums = (
  await client.query<{ name: string; values: string[] }>(
    `select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder)::text[] as values
     from pg_type t join pg_enum e on e.enumtypid = t.oid
     join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = $1 group by t.typname order by t.typname`,
    [SCHEMA],
  )
).rows;
const enumNames = new Set(enums.map((e) => e.name));

const tables = (
  await client.query<{ name: string }>(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relkind in ('r', 'p') order by c.relname`,
    [SCHEMA],
  )
).rows.map((r) => r.name);

const views = (
  await client.query<{ name: string }>(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relkind in ('v', 'm') order by c.relname`,
    [SCHEMA],
  )
).rows.map((r) => r.name);

const columns = (
  await client.query<Column>(
    `select c.relname as table_name, a.attname as column_name, t.typname as udt_name,
       format_type(a.atttypid, a.atttypmod) as data_type,
       not a.attnotnull as is_nullable,
       a.atthasdef as has_default,
       a.attidentity = 'a' as is_identity_always,
       a.attgenerated <> '' as is_generated,
       a.attnum as ordinal
     from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace
     join pg_type t on t.oid = a.atttypid
     where n.nspname = $1 and c.relkind in ('r', 'p', 'v', 'm') and a.attnum > 0 and not a.attisdropped
     order by c.relname, a.attnum`,
    [SCHEMA],
  )
).rows;

const relationships = (
  await client.query<Relationship>(
    `select c.relname as table_name, con.conname as constraint_name,
       array(select a.attname from unnest(con.conkey) with ordinality k(attnum, i)
             join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum order by k.i)::text[] as columns,
       rc.relname as referenced_table,
       array(select a.attname from unnest(con.confkey) with ordinality k(attnum, i)
             join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum order by k.i)::text[] as referenced_columns,
       exists (
         select 1 from pg_constraint u
         where u.conrelid = con.conrelid and u.contype in ('p', 'u')
           and (select array_agg(x order by x) from unnest(u.conkey) x) = (select array_agg(x order by x) from unnest(con.conkey) x)
       ) as is_one_to_one
     from pg_constraint con
     join pg_class c on c.oid = con.conrelid
     join pg_namespace n on n.oid = c.relnamespace
     join pg_class rc on rc.oid = con.confrelid
     join pg_namespace rn on rn.oid = rc.relnamespace
     where con.contype = 'f' and n.nspname = $1 and rn.nspname = $1
     order by c.relname, con.conname`,
    [SCHEMA],
  )
).rows;

// Functions in the public schema (like the Supabase generator), excluding trigger functions.
const functions = (
  await client.query<Fn>(
    `select p.proname as name, p.proargnames as arg_names,
       array(select format_type(t, null) from unnest(p.proargtypes) t)::text[] as arg_types,
       p.proargmodes::text[] as arg_modes,
       p.pronargdefaults as num_defaults, p.proretset as returns_set,
       format_type(p.prorettype, null) as return_type,
       case when p.proargmodes is not null then (
         select json_agg(json_build_object('name', p.proargnames[i], 'type', format_type(p.proallargtypes[i], null)) order by i)
         from generate_subscripts(p.proallargtypes, 1) i where p.proargmodes[i] = 't'
       ) end as table_columns
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = $1 and p.prokind = 'f'
       and format_type(p.prorettype, null) <> 'trigger'
     order by p.proname`,
    [SCHEMA],
  )
).rows;

await client.end();

const scalar = (udt: string): string => {
  const base = udt.startsWith('_') ? udt.slice(1) : udt;
  let ts: string;
  if (enumNames.has(base)) ts = `Database["public"]["Enums"]["${base}"]`;
  else if (['int2', 'int4', 'int8', 'float4', 'float8', 'numeric', 'oid'].includes(base))
    ts = 'number';
  else if (base === 'bool') ts = 'boolean';
  else if (['json', 'jsonb'].includes(base)) ts = 'Json';
  else ts = 'string';
  return udt.startsWith('_') ? `${ts}[]` : ts;
};

const typeFromFormatted = (formatted: string): string => {
  const isArray = formatted.endsWith('[]');
  const base = formatted.replace(/\[\]$/, '').replace(/^public\./, '');
  const map: Record<string, string> = {
    uuid: 'string',
    text: 'string',
    'character varying': 'string',
    date: 'string',
    'time without time zone': 'string',
    'timestamp with time zone': 'string',
    'timestamp without time zone': 'string',
    smallint: 'number',
    integer: 'number',
    bigint: 'number',
    numeric: 'number',
    'double precision': 'number',
    real: 'number',
    boolean: 'boolean',
    json: 'Json',
    jsonb: 'Json',
    void: 'undefined',
  };
  const ts = enumNames.has(base)
    ? `Database["public"]["Enums"]["${base}"]`
    : (map[base] ?? 'unknown');
  return isArray ? `${ts}[]` : ts;
};

const q = (s: string) => JSON.stringify(s);
const lines: string[] = [];
const emit = (s: string) => lines.push(s);

emit('// Generated by tools/gen-db-types.ts (same shape as `supabase gen types typescript`).');
emit('// Do not edit by hand: run `pnpm db:types` or `pnpm db:types:direct`.');
emit('');
emit(
  'export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]',
);
emit('');
emit('export type Database = {');
emit('  __InternalSupabase: { PostgrestVersion: "12" }');
emit('  public: {');

const tableBlock = (name: string, isView: boolean) => {
  const cols = columns.filter((c) => c.table_name === name);
  emit(`      ${name}: {`);
  emit('        Row: {');
  for (const c of cols)
    emit(`          ${c.column_name}: ${scalar(c.udt_name)}${c.is_nullable ? ' | null' : ''}`);
  emit('        }');
  if (!isView) {
    emit('        Insert: {');
    for (const c of cols) {
      if (c.is_identity_always || c.is_generated) {
        emit(`          ${c.column_name}?: never`);
        continue;
      }
      const optional = c.is_nullable || c.has_default;
      emit(
        `          ${c.column_name}${optional ? '?' : ''}: ${scalar(c.udt_name)}${c.is_nullable ? ' | null' : ''}`,
      );
    }
    emit('        }');
    emit('        Update: {');
    for (const c of cols) {
      if (c.is_identity_always || c.is_generated) {
        emit(`          ${c.column_name}?: never`);
        continue;
      }
      emit(`          ${c.column_name}?: ${scalar(c.udt_name)}${c.is_nullable ? ' | null' : ''}`);
    }
    emit('        }');
  }
  const rels = relationships.filter((r) => r.table_name === name);
  if (rels.length === 0) {
    emit('        Relationships: []');
  } else {
    emit('        Relationships: [');
    for (const r of rels) {
      emit('          {');
      emit(`            foreignKeyName: ${q(r.constraint_name)}`);
      emit(`            columns: [${r.columns.map(q).join(', ')}]`);
      emit(`            isOneToOne: ${r.is_one_to_one}`);
      emit(`            referencedRelation: ${q(r.referenced_table)}`);
      emit(`            referencedColumns: [${r.referenced_columns.map(q).join(', ')}]`);
      emit('          },');
    }
    emit('        ]');
  }
  emit('      }');
};

emit('    Tables: {');
for (const t of tables) tableBlock(t, false);
emit('    }');
if (views.length === 0) emit('    Views: { [_ in never]: never }');
else {
  emit('    Views: {');
  for (const v of views) tableBlock(v, true);
  emit('    }');
}

if (functions.length === 0) emit('    Functions: { [_ in never]: never }');
else {
  emit('    Functions: {');
  for (const f of functions) {
    const inArgs = (f.arg_names ?? [])
      .map((n, i) => ({ name: n, mode: f.arg_modes?.[i] ?? 'i' }))
      .filter((a) => a.mode === 'i' || a.mode === 'b');
    const firstDefault = inArgs.length - f.num_defaults;
    const args = inArgs.map(
      (a, i) =>
        `${a.name}${i >= firstDefault ? '?' : ''}: ${typeFromFormatted(f.arg_types[i] ?? 'text')}`,
    );
    emit(`      ${f.name}: {`);
    emit(`        Args: ${args.length ? `{ ${args.join('; ')} }` : 'never'}`);
    let returns: string;
    if (f.table_columns && f.table_columns.length > 0) {
      returns = `{ ${f.table_columns.map((c) => `${c.name}: ${typeFromFormatted(c.type)}`).join('; ')} }[]`;
    } else {
      returns = typeFromFormatted(f.return_type) + (f.returns_set ? '[]' : '');
    }
    emit(`        Returns: ${returns}`);
    emit('      }');
  }
  emit('    }');
}

if (enums.length === 0) emit('    Enums: { [_ in never]: never }');
else {
  emit('    Enums: {');
  for (const e of enums) emit(`      ${e.name}: ${e.values.map(q).join(' | ')}`);
  emit('    }');
}
emit('    CompositeTypes: { [_ in never]: never }');
emit('  }');
emit('}');
emit('');
emit(HELPERS);
emit('export const Constants = {');
emit('  public: {');
emit('    Enums: {');
for (const e of enums) emit(`      ${e.name}: [${e.values.map(q).join(', ')}],`);
emit('    },');
emit('  },');
emit('} as const');

writeFileSync(outFile, lines.join('\n') + '\n');
console.log(
  `wrote ${path.relative(process.cwd(), outFile)} (${tables.length} tables, ${functions.length} functions, ${enums.length} enums)`,
);
