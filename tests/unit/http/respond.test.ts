import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { errorBody, HttpError, ok, parseInput, queryObject } from '../../../src/http/respond.ts';

describe('respond helpers', () => {
  it('NFR-09: ok() is a 200 by default', () => {
    expect(ok({ a: 1 })).toEqual({ status: 200, body: { a: 1 } });
    expect(ok({ runId: 1 }, 201)).toEqual({ status: 201, body: { runId: 1 } });
  });

  it('NFR-09: errorBody() leaves out empty details', () => {
    expect(errorBody('not_found', 'gone')).toEqual({ error: { code: 'not_found', message: 'gone' } });
    expect(errorBody('x', 'y', [1])).toEqual({ error: { code: 'x', message: 'y', details: [1] } });
  });

  it('NFR-09: HttpError carries status, code and details', () => {
    const error = new HttpError(409, 'invalid_transition', 'no', { from: 'new' });

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'HttpError',
      status: 409,
      code: 'invalid_transition',
      message: 'no',
      details: { from: 'new' },
    });
  });

  describe('parseInput', () => {
    const Schema = z.strictObject({ name: z.string().min(1), tags: z.array(z.string()) });

    it('NFR-09: returns the parsed value', () => {
      expect(parseInput(Schema, { name: 'a', tags: [] })).toEqual({ name: 'a', tags: [] });
    });

    it('NFR-09: a mismatch is a 400 listing each problem with its path', () => {
      let caught: unknown;
      try {
        parseInput(Schema, { name: '', tags: [1] }, 'profile');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(HttpError);
      expect(caught).toMatchObject({
        status: 400,
        code: 'validation_failed',
        message: 'The profile is invalid',
        details: [
          { path: 'name', message: expect.any(String) as unknown },
          { path: 'tags.0', message: expect.any(String) as unknown },
        ],
      });
    });
  });

  describe('queryObject', () => {
    it('NFR-09: turns a query string into an object', () => {
      expect(queryObject(new URLSearchParams('tab=new&q=nurse%20lead'))).toEqual({ tab: 'new', q: 'nurse lead' });
    });

    it('NFR-09: a repeated key is a 400', () => {
      expect(() => queryObject(new URLSearchParams('tab=new&tab=saved'))).toThrow(HttpError);
      expect(() => queryObject(new URLSearchParams('tab=new&tab=saved'))).toThrow('The query string is invalid');
    });

    it('NFR-09: keys like __proto__ stay plain data', () => {
      const result = queryObject(new URLSearchParams('__proto__=x&constructor=y'));

      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(Object.keys(result)).toEqual(['__proto__', 'constructor']);
    });
  });
});
