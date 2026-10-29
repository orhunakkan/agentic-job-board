// board-report's browser code (PLAN.md Phase 14 tasks 5 to 7). app.js runs first and defines window.boardReport;
// data/index.js then hands it the index, and each data/tests/<id>.js a test's details when that test is opened.
import type { ReportIndex, TestDetail } from '../build/data-shape.ts';
import { receiveDetail } from './detail.ts';
import { el } from './dom.ts';
import { parseRoute, type Route } from './route.ts';
import { buildShell, type Shell } from './shell.ts';
import { loadReport } from './state.ts';
import { applyStoredTheme } from './theme.ts';
import { renderEnvironment } from './view-environment.ts';
import { renderFailures } from './view-failures.ts';
import { renderOverview } from './view-overview.ts';
import { renderRequirements } from './view-requirements.ts';
import { renderTest } from './view-test.ts';
import { renderTimeline } from './view-timeline.ts';
import { renderTypes } from './view-types.ts';

declare global {
  interface Window {
    boardReport: { index: (data: ReportIndex) => void; test: (id: string, detail: TestDetail) => void };
  }
}

function renderRoute(shell: Shell, route: Route): void {
  shell.setActive(route.view);
  switch (route.view) {
    case 'overview':
      renderOverview(shell.main);
      break;
    case 'types':
      renderTypes(shell.main, route);
      break;
    case 'requirements':
      renderRequirements(shell.main, route);
      break;
    case 'failures':
      renderFailures(shell.main, route);
      break;
    case 'timeline':
      renderTimeline(shell.main, route);
      break;
    case 'environment':
      renderEnvironment(shell.main);
      break;
    case 'test':
      renderTest(shell.main, route);
      break;
  }
}

function start(data: ReportIndex): void {
  const root = document.getElementById('app');
  if (root === null) return;
  try {
    loadReport(data);
    const shell = buildShell(root);
    renderRoute(shell, parseRoute(window.location.hash));
    window.addEventListener('hashchange', () => {
      renderRoute(shell, parseRoute(window.location.hash));
      window.scrollTo(0, 0);
      shell.main.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    });
  } catch (error) {
    root.replaceChildren(
      el('p', {
        class: 'br-loading',
        role: 'alert',
        text: `board-report could not show this run: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }
}

applyStoredTheme();

window.boardReport = {
  index(data) {
    start(data);
  },
  test(id, detail) {
    receiveDetail(id, detail);
  },
};
