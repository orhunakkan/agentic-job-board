import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ProfileSchema, type Profile } from '../../schemas/profile.ts';

// The single-row profile (FR-01), stored as JSON and validated both ways. A row saved in an older shape reads as
// outdated, with its old values, so the form can be filled in again from what still fits (DEC-065).

export type ProfileState =
  { status: 'missing' } | { status: 'outdated'; old: unknown } | { status: 'saved'; profile: Profile };

export interface ProfileRepository {
  state(): ProfileState;
  /** The saved profile, or null while it is missing or outdated. */
  get(): Profile | null;
  put(profile: Profile, updatedAt: string): void;
}

const Row = z.object({ data: z.string() });

export function createProfileRepository(db: DatabaseSync): ProfileRepository {
  const select = db.prepare('SELECT data FROM profile WHERE id = 1');
  const upsert = db.prepare(
    `INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  );

  function state(): ProfileState {
    const row = select.get();
    if (row === undefined) return { status: 'missing' };
    let old: unknown = null;
    try {
      old = JSON.parse(Row.parse(row).data);
    } catch {
      return { status: 'outdated', old };
    }
    const parsed = ProfileSchema.safeParse(old);
    return parsed.success ? { status: 'saved', profile: parsed.data } : { status: 'outdated', old };
  }

  return {
    state,
    get() {
      const current = state();
      return current.status === 'saved' ? current.profile : null;
    },
    put(profile, updatedAt) {
      upsert.run(JSON.stringify(ProfileSchema.parse(profile)), updatedAt);
    },
  };
}
