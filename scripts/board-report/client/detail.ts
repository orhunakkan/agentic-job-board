// Loads one test's details: its data file (data/tests/<id>.js) is a script that calls window.boardReport.test, so it
// loads from disk (file://) where fetch can't. Each file is loaded once.
import type { TestDetail } from '../build/data-shape.ts';

export class DetailLoadError extends Error {
  override name = 'DetailLoadError';
}

interface Waiting {
  resolve: (detail: TestDetail) => void;
  reject: (error: DetailLoadError) => void;
}

const details = new Map<string, TestDetail>();
const waiting = new Map<string, Waiting[]>();
const TEST_ID = /^[0-9a-f]{16}$/;

/** Called by a test's data file. */
export function receiveDetail(id: string, detail: TestDetail): void {
  details.set(id, detail);
  for (const waiter of waiting.get(id) ?? []) waiter.resolve(detail);
  waiting.delete(id);
}

export function loadDetail(id: string): Promise<TestDetail> {
  const known = details.get(id);
  if (known !== undefined) return Promise.resolve(known);
  if (!TEST_ID.test(id)) return Promise.reject(new DetailLoadError(`"${id}" is not a test ID`));
  return new Promise<TestDetail>((resolve, reject) => {
    const queue = waiting.get(id);
    if (queue !== undefined) {
      queue.push({ resolve, reject });
      return;
    }
    waiting.set(id, [{ resolve, reject }]);
    const script = document.createElement('script');
    script.src = `data/tests/${id}.js`;
    script.async = true;
    const fail = (message: string): void => {
      for (const waiter of waiting.get(id) ?? []) waiter.reject(new DetailLoadError(message));
      waiting.delete(id);
    };
    script.onload = () => {
      script.remove();
      if (!details.has(id)) fail(`data/tests/${id}.js loaded but held no details for this test`);
    };
    script.onerror = () => {
      script.remove();
      fail(`data/tests/${id}.js could not be loaded; the report may be incomplete`);
    };
    document.head.appendChild(script);
  });
}
