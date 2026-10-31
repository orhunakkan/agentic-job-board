import { describe, expect, it } from 'vitest';
import {
  InvalidScoreError,
  isLabelConsistent,
  isValidScore,
  labelForScore,
  MATCH_RUBRIC,
  RESCORE_STATUSES,
  RUBRICS,
  rubricFor,
  SCORE_LABELS,
  TRIAGE_RUBRIC,
  type ScoreLabel,
} from '../../../src/domain/score.ts';

describe('score labels', () => {
  it.each<[number, ScoreLabel]>([
    [0, 'weak'],
    [49, 'weak'],
    [50, 'possible'],
    [74, 'possible'],
    [75, 'strong'],
    [100, 'strong'],
  ])('FR-06: score %i is %s', (score, label) => {
    expect(labelForScore(score)).toBe(label);
  });

  it.each([-1, 101, 49.5, Number.NaN, Number.POSITIVE_INFINITY])('FR-06: score %s is rejected', (score) => {
    expect(isValidScore(score)).toBe(false);
    expect(() => labelForScore(score)).toThrow(InvalidScoreError);
  });

  it('FR-06: the error names the bad score', () => {
    expect(() => labelForScore(101)).toThrow('A score must be a whole number from 0 to 100, got 101');
  });

  it('FR-06: InvalidScoreError is a typed Error', () => {
    const error = new InvalidScoreError(-1);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InvalidScoreError');
  });

  it.each<[number, ScoreLabel, boolean]>([
    [80, 'strong', true],
    [80, 'weak', false],
    [80, 'possible', false],
    [75, 'strong', true],
    [74, 'strong', false],
    [74, 'possible', true],
    [50, 'possible', true],
    [49, 'possible', false],
    [49, 'weak', true],
    [0, 'weak', true],
    [-1, 'weak', false],
    [101, 'strong', false],
  ])('FR-06: score %i with label %s is consistent = %s', (score, label, consistent) => {
    expect(isLabelConsistent(score, label)).toBe(consistent);
  });

  it('FR-06: labels are strong, possible and weak', () => {
    expect(SCORE_LABELS).toEqual(['strong', 'possible', 'weak']);
  });
});

describe('rubrics', () => {
  it('FR-20: a job with a description is scored with match-v2, one without it with triage-v2', () => {
    expect(rubricFor('About the job…')).toBe(MATCH_RUBRIC);
    expect(rubricFor(null)).toBe(TRIAGE_RUBRIC);
    expect(RUBRICS).toEqual(['match-v2', 'triage-v2']);
  });

  it('FR-20: jobs in New and Saved are scored again once they have a description (DEC-044)', () => {
    expect(RESCORE_STATUSES).toEqual(['new', 'saved']);
  });
});
