import assert from 'node:assert/strict';
import { ErrorResponseSchema } from '../../../../src/schemas/api.ts';
import type { ApiResponse } from '../../../helpers/test-app.ts';
import type { BoardWorld } from '../../support/world.ts';

// Reading the app's answers in the API steps: the last response, refusals, and the words a board page shows.

export function lastResponse(world: BoardWorld): ApiResponse {
  assert.ok(world.response, 'the scenario has not called the app yet');
  return world.response;
}

/** The app refused the request with this status and error code; returns the error's details. */
export function refusal(world: BoardWorld, status: number, code: string): unknown {
  const response = lastResponse(world);
  assert.equal(response.status, status, response.text);
  const { error } = ErrorResponseSchema.parse(response.body);
  assert.equal(error.code, code);
  return error.details;
}

/** A refusal that explains itself: a 400 that says what was wrong and where. */
export function explainedRefusal(world: BoardWorld): void {
  const details = refusal(world, 400, 'validation_failed');
  assert.ok(Array.isArray(details) && details.length > 0, 'the refusal names no problem');
}

/** The text of the element with this id on a board page, without its markup. */
export function textOf(page: string, id: string): string {
  const element = new RegExp(`<p [^>]*id="${id}"[^>]*>([\\s\\S]*?)</p>`).exec(page)?.[1];
  assert.ok(element !== undefined, `the page has no #${id}`);
  return element
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
