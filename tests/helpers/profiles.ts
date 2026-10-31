import type { Profile } from '../../src/schemas/profile.ts';

// Fictional profiles for every Vitest project and the BDD steps: test data never holds the owner's real details, and
// no test assumes a line of work (NFR-14), so the sample is a dispatcher, not anyone's real job hunt.

export const SAMPLE_PROFILE: Profile = {
  field: 'Freight and logistics dispatch',
  summary: 'Dispatcher for a regional carrier; looking for a lead role on a larger fleet.',
  targetRoles: ['Truck Dispatcher', 'Logistics Coordinator'],
  seniority: 'senior',
  yearsExperience: 8,
  coreSkills: ['Load planning', 'Route optimization'],
  secondarySkills: ['Spanish'],
  credentials: ['CDL-A'],
  locations: { remote: ['United States'], hybridAreas: ['Austin, TX'], onsiteAreas: [], relocate: false },
  workAuthorization: 'US, no sponsorship needed',
  dealBreakers: ['overnight shifts only'],
  excludedCompanies: ['Example Freight Co'],
};
