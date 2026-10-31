import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RUBRICS, rubricFor, SCORE_LABELS } from '../../src/domain/score.ts';
import { WORKPLACES } from '../../src/domain/workplace.ts';
import { ProfileSchema } from '../../src/schemas/profile.ts';

// The calibration set of the scoring rubrics (FR-20, DEC-067): invented jobs across three sample profiles from clearly
// different fields, each with the label it should get. Claude's scoring itself isn't run in tests; at a checkpoint the
// agent scores these jobs and reports how many land on their label.

const CalibrationSchema = z.strictObject({
  about: z.string().min(1),
  profiles: z.record(z.string().regex(/^[a-z]+(?:-[a-z]+)*$/), ProfileSchema),
  jobs: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z]+(?:-[a-z]+)*$/),
        profile: z.string(),
        rubric: z.enum(RUBRICS),
        title: z.string().min(1).max(200),
        company: z.string().min(1).max(200),
        location: z.string().min(1).max(200),
        workplace: z.enum(WORKPLACES).nullable(),
        salary: z.string().min(1).nullable(),
        description: z.string().min(1).nullable(),
        expectedLabel: z.enum(SCORE_LABELS),
      }),
    )
    .min(10),
});

const calibration = CalibrationSchema.parse(
  JSON.parse(readFileSync(new URL('../fixtures/calibration/calibration.json', import.meta.url), 'utf8')),
);

describe('the calibration fixtures', () => {
  it('FR-20: hold three sample profiles from different fields, each a valid profile', () => {
    expect(Object.keys(calibration.profiles).sort()).toEqual(['backend-developer', 'icu-nurse', 'staff-accountant']);
    expect(new Set(Object.values(calibration.profiles).map((profile) => profile.field)).size).toBe(3);
  });

  it('FR-20: every job names a sample profile that exists and has its own id', () => {
    const ids = calibration.jobs.map((job) => job.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const job of calibration.jobs) expect(Object.keys(calibration.profiles), job.id).toContain(job.profile);
  });

  it('FR-20: every profile has jobs to calibrate on, and every label is expected somewhere', () => {
    for (const profile of Object.keys(calibration.profiles)) {
      expect(calibration.jobs.filter((job) => job.profile === profile).length, profile).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(calibration.jobs.map((job) => job.expectedLabel))).toEqual(new Set(SCORE_LABELS));
  });

  it('FR-20: each job names the rubric the scoring queue would give it, and both rubrics are calibrated', () => {
    for (const job of calibration.jobs) expect(job.rubric, job.id).toBe(rubricFor(job.description));
    expect(new Set(calibration.jobs.map((job) => job.rubric))).toEqual(new Set(RUBRICS));
  });

  it('FR-20: every company is made up, so no real employer is scored', () => {
    for (const job of calibration.jobs) expect(job.company, job.id).toMatch(/\b(?:Example|Sample)\b/);
  });
});
