import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ProfileSchema } from '../../src/schemas/profile.ts';

// NFR-14 (DEC-068): the board assumes no line of work. The profile is the only place a field, role, skill or location
// preference comes from, so no tracked file may name the field the board was first built for, and the profile schema,
// the scoring rubric and the agent instructions give no default role, skill, field or location. This file is the one
// exception to the term list below, which lives only here. The app's own test tools are not job-field terms.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const THIS_FILE = 'tests/contract/no-line-of-work.test.ts';

/** The old field's terms: whole words, any case. */
const OLD_FIELD =
  /\b(?:sdet|qa|quality assurance|software engineer in test|test automation engineer|quality engineer)\b/i;

/** Files that aren't text: their bytes would match by chance, and none of them holds words a reader sees as text. */
const BINARY = /\.(?:png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz)$/i;

function trackedTextFiles(): string[] {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0');
  return files.filter(
    (file) => file !== '' && file !== 'package-lock.json' && file !== THIS_FILE && !BINARY.test(file),
  );
}

function read(file: string): string {
  return readFileSync(new URL(file, new URL('../../', import.meta.url)), 'utf8');
}

/** Markdown without its fenced code blocks: the prose that tells a reader, or the agent, what to do. */
function prose(markdown: string): string {
  return markdown.replace(/^```[\s\S]*?^```/gm, '');
}

/** A rubric's guidance: everything except its worked examples and its calibration, which are sample data. */
function guidance(rubric: string): string {
  return prose(rubric)
    .split(/^(?=#{2,3} )/m)
    .filter((section) => !/^#{2,3} (?:Worked examples|Calibration)/.test(section))
    .join('');
}

/** A country, region or workplace the text would assume for every user. */
const PLACE = /\b(?:United States|USA|U\.S\.|US|remote[- ]US|North America|Europe|Canada|UK)\b/;
/** A sentence that hands every user a default role, skill, field or location ("assumes no …" says the opposite). */
const DEFAULT =
  /\b(?:default|assume)\w*\b(?!\s+(?:no|nothing)\b)[^.\n]*\b(?:role|skill|field|line of work|location|country|region)s?\b/i;

describe('NFR-14: no line of work is assumed', () => {
  it('NFR-14: no tracked text file names the old field (git ls-files, minus package-lock.json and binary files)', () => {
    const files = trackedTextFiles();
    expect(files.length).toBeGreaterThan(200);

    const hits = files.flatMap((file) =>
      read(file)
        .split('\n')
        .flatMap((line, index) => (OLD_FIELD.test(line) ? [`${file}:${String(index + 1)}: ${line.trim()}`] : [])),
    );

    expect(hits).toEqual([]);
  });

  it('NFR-14: the guard sees every term, as a whole word, in any case', () => {
    for (const text of [
      'Senior SDET',
      'a qa role',
      'Quality Assurance',
      'Software Engineer in Test',
      'QUALITY ENGINEER',
    ]) {
      expect(OLD_FIELD.test(text), text).toBe(true);
    }
    for (const text of ['Qatar', 'aqua', 'quality engineering manual', 'test automation']) {
      expect(OLD_FIELD.test(text), text).toBe(false);
    }
  });

  it('NFR-14: the profile schema gives no field a default: an empty profile names every one as missing', () => {
    const missing = ProfileSchema.safeParse({}).error?.issues.map((issue) => issue.path.join('.')) ?? [];
    expect(missing.sort()).toEqual(Object.keys(ProfileSchema.shape).sort());

    const where = ProfileSchema.safeParse({
      ...Object.fromEntries(Object.keys(ProfileSchema.shape).map((key) => [key, null])),
      locations: {},
    });
    const locations =
      where.error?.issues.map((issue) => issue.path.join('.')).filter((path) => path.startsWith('locations.')) ?? [];
    expect(locations.sort()).toEqual([
      'locations.hybridAreas',
      'locations.onsiteAreas',
      'locations.relocate',
      'locations.remote',
    ]);
    expect(read('src/schemas/profile.ts')).not.toMatch(/\.(?:default|catch|prefault)\(/);
  });

  it('NFR-14: the scoring rubric’s guidance names no place and hands out no default; only its examples do', () => {
    const text = guidance(read('agent/scoring-rubric.md'));

    expect(text).toContain('**The profile is the only yardstick.**');
    expect(PLACE.exec(text)).toBeNull();
    expect(DEFAULT.exec(text)).toBeNull();
  });

  it('NFR-14: the agent instructions name no place and hand out no default outside their JSON examples', () => {
    const text = prose(read('agent/find-jobs.md'));

    expect(text).toContain('**Any line of work.**');
    expect(PLACE.exec(text)).toBeNull();
    expect(DEFAULT.exec(text)).toBeNull();
  });
});
