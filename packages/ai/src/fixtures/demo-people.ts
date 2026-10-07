import type { KnownPerson } from '../privacy';

/**
 * The people of the demo database (`supabase/seed.sql`): the 40 students of the two demo classes
 * and the 6 staff accounts. Tests use it as a stand-in for a real board's roster; a test keeps it
 * equal to the seed. Nothing here is a real person.
 */
export const DEMO_PEOPLE: readonly KnownPerson[] = [
  ...[
    // 3e année (Mme Tremblay)
    'Léa',
    'Nathan',
    'Chloé',
    'Mathis',
    'Zoé',
    'Samuel',
    'Emma',
    'Liam',
    'Rosalie',
    'Adam',
    'Maëlle',
    'Olivier',
    'Aïcha',
    'Youssef',
    'Florence',
    'Gabriel',
    'Mia',
    'Noah',
    'Jade',
    'Félix',
    // 5e année (M. Gagnon)
    'Charlotte',
    'Thomas',
    'Béatrice',
    'William',
    'Camille',
    'Antoine',
    'Sofia',
    'Jacob',
    'Alice',
    'Ethan',
    'Amélie',
    'Hugo',
    'Fatou',
    'Ali',
    'Juliette',
    'Xavier',
    'Nour',
    'Malik',
    'Laurence',
    'Édouard',
  ].map((name) => ({ name, kind: 'student' as const })),
  ...[
    'Isabelle Tremblay',
    'Marc Gagnon',
    'Paul Leblanc',
    'Sophie Lavoie',
    'Julie Bergeron',
    'Nathalie Roy',
  ].map((name) => ({ name, kind: 'staff' as const })),
];
