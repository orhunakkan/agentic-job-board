import { z } from 'zod';

// The profile every score is based on (PLAN.md §5.2, FR-01, DEC-065). It is the only place a line of work, a role, a
// skill or a location preference comes from, so no field has a default. Objects are strict so a typo fails loudly
// instead of being ignored.

const Text = z.string().trim().min(1).max(200);
const TextList = z.array(Text).max(50);

export const SENIORITIES = ['entry', 'mid', 'senior', 'lead', 'manager', 'director', 'executive'] as const;

export type Seniority = (typeof SENIORITIES)[number];

export const LOCATIONS_NEEDED = 'Give at least one: a remote region, a hybrid area or an on-site area';

export const ProfileSchema = z.strictObject({
  field: Text,
  summary: z.string().trim().max(1000),
  targetRoles: TextList.min(1),
  seniority: z.enum(SENIORITIES),
  yearsExperience: z.number().int().min(0).max(60),
  coreSkills: TextList.min(1),
  secondarySkills: TextList,
  credentials: TextList,
  locations: z
    .strictObject({
      /** Countries or regions the user can work remotely from; empty: not open to remote work. */
      remote: TextList,
      hybridAreas: TextList,
      onsiteAreas: TextList,
      relocate: z.boolean(),
    })
    // Otherwise no job could ever fit.
    .refine((where) => where.remote.length + where.hybridAreas.length + where.onsiteAreas.length > 0, {
      message: LOCATIONS_NEEDED,
    }),
  workAuthorization: Text,
  dealBreakers: TextList,
  excludedCompanies: TextList,
});

export type Profile = z.infer<typeof ProfileSchema>;
