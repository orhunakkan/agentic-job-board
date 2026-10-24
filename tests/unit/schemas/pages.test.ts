import { describe, expect, it } from 'vitest';
import {
  BoardQuerySchema,
  NotesFormSchema,
  safeReturnPath,
  StatusFormSchema,
  withoutEmpty,
} from '../../../src/schemas/pages.ts';

describe('page inputs', () => {
  it('FR-07: the board defaults to the New tab, page 1, and parses numbers', () => {
    expect(BoardQuerySchema.parse({})).toEqual({ origin: 'linkedin', tab: 'new', page: 1 });
    expect(BoardQuerySchema.parse({ tab: 'closed', minScore: '75', page: '3', changed: '9', sort: 'changed' })).toEqual(
      {
        origin: 'linkedin',
        tab: 'closed',
        minScore: 75,
        page: 3,
        changed: 9,
        sort: 'changed',
      },
    );
  });

  it('FR-07: the board drops unknown keys instead of failing', () => {
    expect(BoardQuerySchema.parse({ fbclid: 'x' })).toEqual({ origin: 'linkedin', tab: 'new', page: 1 });
  });

  it('FR-17: the board shows LinkedIn jobs unless other sources are asked for', () => {
    expect(BoardQuerySchema.parse({ origin: 'other', tab: 'saved' })).toMatchObject({ origin: 'other', tab: 'saved' });
    expect(BoardQuerySchema.safeParse({ origin: 'greenhouse' }).success).toBe(false);
  });

  it('FR-07: empty values are "not set"', () => {
    expect(withoutEmpty({ tab: 'new', minScore: '', q: '' })).toEqual({ tab: 'new' });
  });

  it('NFR-09: the status form is strict', () => {
    expect(StatusFormSchema.safeParse({ status: 'saved', return: '/' }).success).toBe(true);
    expect(StatusFormSchema.safeParse({ status: 'saved', x: '1' }).success).toBe(false);
    expect(StatusFormSchema.safeParse({ status: 'nope' }).success).toBe(false);
  });

  it('FR-09: notes turn CRLF into LF before the 5,000-character limit is checked', () => {
    expect(NotesFormSchema.parse({ notes: 'a\r\nb\rc' })).toEqual({ notes: 'a\nb\nc' });
    expect(NotesFormSchema.safeParse({ notes: '\r\n'.repeat(5000) }).success).toBe(true);
    expect(NotesFormSchema.safeParse({ notes: 'x'.repeat(5001) }).success).toBe(false);
  });

  describe('safeReturnPath', () => {
    it.each([
      ['/', '/'],
      ['/?tab=saved&q=qa', '/?tab=saved&q=qa'],
      ['/jobs/12', '/jobs/12'],
      ['/jobs/12#notes', '/jobs/12'],
      ['/a/../b', '/b'],
    ])('NFR-07: keeps the local path %j as %j', (value, expected) => {
      expect(safeReturnPath(value, '/fallback')).toBe(expected);
    });

    it.each([
      undefined,
      '',
      'jobs/12',
      'https://evil.example/',
      '//evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      '/with space',
      '/tab\tchar',
      '/new\nline',
      // Dot segments that collapse into a protocol-relative path once parsed.
      '/.//evil.example',
      '/a/..//evil.example',
      '/%2e%2e//evil.example',
    ])('NFR-07: refuses %j', (value) => {
      expect(safeReturnPath(value, '/fallback')).toBe('/fallback');
    });
  });
});
