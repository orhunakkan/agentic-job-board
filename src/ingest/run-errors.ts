// A run that listings or scores are sent to must exist and still be open (FR-11).

export class RunNotFoundError extends Error {
  override name = 'RunNotFoundError';

  constructor(runId: number) {
    super(`run ${String(runId)} does not exist`);
  }
}

export class RunFinishedError extends Error {
  override name = 'RunFinishedError';

  constructor(runId: number) {
    super(`run ${String(runId)} is already finished`);
  }
}
