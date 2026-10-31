// Load test (PLAN.md Phase 7 task 2, NFR-05): board and API p95 < 200 ms with 5,000 jobs, on the owner's machine.
// Needs a running app on a seeded database (see docs/test-strategy.md §5):
//   node scripts/seed.ts --count 5000 --db data/perf.db
//   PORT=3000 DB_PATH=data/perf.db LOG_LEVEL=warn node src/main.ts
//   npm run test:perf                  (BASE_URL=http://127.0.0.1:3000 by default)
// It only reads: no request changes the database, so the run can be repeated on the same data.
import { check, group, sleep } from 'k6';
import http from 'k6/http';
import type { Options } from 'k6/options';

const BASE_URL = __ENV['BASE_URL'] ?? 'http://127.0.0.1:3000';

export const options: Options = {
  scenarios: {
    owner_browsing: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 20 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
    // Per area too, so a fast API can't hide a slow board.
    'http_req_duration{area:board}': ['p(95)<200'],
    'http_req_duration{area:api}': ['p(95)<200'],
    'http_req_duration{area:detail}': ['p(95)<200'],
    checks: ['rate>0.99'],
  },
};

interface SetupData {
  jobIds: number[];
}

const BOARD_PATHS = [
  '/',
  '/?tab=new&sort=recent',
  '/?tab=new&minScore=75',
  '/?tab=new&q=spanish',
  '/?tab=new&page=20',
  '/?tab=saved',
  '/?tab=in-progress',
  '/?tab=dismissed',
  '/?origin=other',
];

const API_PATHS = [
  '/api/jobs',
  '/api/jobs?tab=new&limit=100',
  '/api/jobs?tab=new&minScore=60&q=dispatcher',
  '/api/jobs?sort=recent&offset=1000&limit=50',
  '/api/jobs?unscored=true',
];

export function setup(): SetupData {
  const health = http.get(`${BASE_URL}/api/health`);
  if (health.status !== 200) throw new Error(`the app is not running at ${BASE_URL}`);

  const list = http.get(`${BASE_URL}/api/jobs?limit=100`);
  const body = list.json() as { items: { id: number }[]; total: number };
  if (body.total < 5000) throw new Error(`seed at least 5,000 jobs first (found ${String(body.total)})`);
  return { jobIds: body.items.map((job) => job.id) };
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

export default function (data: SetupData): void {
  group('board', () => {
    const response = http.get(`${BASE_URL}${pick(BOARD_PATHS)}`, { tags: { area: 'board', name: 'board' } });
    check(response, {
      'board is 200': (result) => result.status === 200,
      'board is HTML': (result) => String(result.headers['Content-Type']).startsWith('text/html'),
    });
  });

  group('api', () => {
    const response = http.get(`${BASE_URL}${pick(API_PATHS)}`, { tags: { area: 'api', name: 'api-jobs' } });
    check(response, { 'api is 200': (result) => result.status === 200 });
  });

  group('detail', () => {
    const id = pick(data.jobIds);
    const page = http.get(`${BASE_URL}/jobs/${String(id)}`, { tags: { area: 'detail', name: 'job-page' } });
    const api = http.get(`${BASE_URL}/api/jobs/${String(id)}`, { tags: { area: 'detail', name: 'api-job' } });
    check(page, { 'job page is 200': (result) => result.status === 200 });
    check(api, { 'job API is 200': (result) => result.status === 200 });
  });

  sleep(0.5 + Math.random());
}
