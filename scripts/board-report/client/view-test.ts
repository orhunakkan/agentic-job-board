// A test's page: status, type, requirements, browser, tags and duration at the top; its last results as dots; the
// error with expected and actual side by side and the stack folded; the steps as a tree; screenshots (full size in a
// dialog), videos in place, text and JSON readable, the trace with the command that opens it; stdout and stderr; and
// the source line on GitHub.
import type { AttachmentView, StepView, TestDetail, TestEntry } from '../build/data-shape.ts';
import type { ErrorInfo } from '../result-schema.ts';
import { browserChip, chip, flakyChip, statusBadge, statusIcon, STATUS_WORD, typeChip } from './badges.ts';
import { historyDots } from './charts.ts';
import { el, externalLink, pre, srOnly } from './dom.ts';
import { loadDetail } from './detail.ts';
import { formatDuration } from './format.ts';
import { href, type Route } from './route.ts';
import { card, emptyState, viewHeader } from './shell.ts';
import { report, typeTitle } from './state.ts';

function errorBlock(error: ErrorInfo, heading: 'h2' | 'h3' = 'h3'): HTMLElement {
  const parts: (Node | null)[] = [pre(error.message, 'error-message')];
  if (error.expected !== null || error.actual !== null) {
    parts.push(
      el(
        'div',
        { class: 'diff' },
        el(
          'div',
          { class: 'diff-side diff-expected' },
          el(heading, { class: 'diff-title', text: 'Expected' }),
          pre(error.expected ?? '(nothing)'),
        ),
        el(
          'div',
          { class: 'diff-side diff-actual' },
          el(heading, { class: 'diff-title', text: 'Actual' }),
          pre(error.actual ?? '(nothing)'),
        ),
      ),
    );
  }
  if (error.stack !== null && error.stack.trim() !== '') {
    parts.push(el('details', { class: 'stack' }, el('summary', { text: 'Stack trace' }), pre(error.stack)));
  }
  return el('div', { class: 'error-block' }, ...parts);
}

function dataTable(rows: readonly string[][]): HTMLElement {
  const [head, ...body] = rows;
  const table = el('table', { class: 'data-table' });
  if (head !== undefined) {
    table.appendChild(el('thead', {}, el('tr', {}, ...head.map((cell) => el('th', { scope: 'col', text: cell })))));
  }
  table.appendChild(
    el('tbody', {}, ...body.map((row) => el('tr', {}, ...row.map((cell) => el('td', { text: cell }))))),
  );
  return el('div', { class: 'table-scroll', tabindex: 0, role: 'region', 'aria-label': 'Data table' }, table);
}

/**
 * Runs once the page has loaded. A browser that can't play a video may hold the page's load event while the video
 * waits (WebKit on Windows does), so videos join the page only after it has loaded.
 */
function afterPageLoad(run: () => void): void {
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
}

let lightbox: HTMLDialogElement | null = null;

function openImage(path: string, name: string): void {
  if (lightbox === null) {
    const image = el('img', { class: 'lightbox-image', alt: '' });
    const caption = el('p', { class: 'lightbox-caption' });
    const close = el('button', { type: 'button', class: 'button', text: 'Close' });
    const open = el('a', {
      class: 'button button-ghost',
      target: '_blank',
      rel: 'noopener noreferrer',
      text: 'Open the file',
    });
    lightbox = el(
      'dialog',
      { class: 'lightbox', 'aria-label': 'Screenshot' },
      el('div', { class: 'lightbox-bar' }, caption, el('div', { class: 'lightbox-actions' }, open, close)),
      el('div', { class: 'lightbox-body' }, image),
    );
    const dialog = lightbox;
    close.addEventListener('click', () => {
      dialog.close();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.body.appendChild(dialog);
  }
  const image = lightbox.querySelector('img');
  const caption = lightbox.querySelector('.lightbox-caption');
  const open = lightbox.querySelector('a');
  image?.setAttribute('src', path);
  image?.setAttribute('alt', name);
  if (caption !== null) caption.textContent = name;
  open?.setAttribute('href', path);
  lightbox.setAttribute('aria-label', name);
  lightbox.showModal();
}

function attachmentView(attachment: AttachmentView): HTMLElement {
  const title = el(
    'p',
    { class: 'attachment-name' },
    el('span', { text: attachment.name }),
    el('span', { class: 'muted', text: attachment.type }),
  );
  switch (attachment.kind) {
    case 'image': {
      const button = el(
        'button',
        { type: 'button', class: 'thumb', 'aria-label': `Open ${attachment.name} full size` },
        el('img', { src: attachment.path, alt: attachment.name, loading: 'lazy' }),
      );
      button.addEventListener('click', () => {
        openImage(attachment.path, attachment.name);
      });
      return el(
        'figure',
        { class: 'attachment attachment-image' },
        button,
        el(
          'figcaption',
          {},
          title,
          el('a', { href: attachment.path, target: '_blank', rel: 'noopener noreferrer', text: 'Open the image file' }),
        ),
      );
    }
    case 'video': {
      const frame = el('div', { class: 'video-frame' });
      const figure = el(
        'figure',
        { class: 'attachment attachment-video' },
        frame,
        el('figcaption', {}, title, el('a', { href: attachment.path, text: 'Download the video' })),
      );
      afterPageLoad(() => {
        frame.appendChild(
          el('video', { src: attachment.path, controls: true, preload: 'metadata', 'aria-label': attachment.name }),
        );
      });
      return figure;
    }
    case 'text':
    case 'json':
      return el(
        'div',
        { class: 'attachment attachment-text' },
        el(
          'details',
          { open: (attachment.text ?? '').length < 4000 },
          el('summary', {}, title),
          pre(attachment.text ?? ''),
          attachment.truncated
            ? el(
                'p',
                { class: 'muted' },
                'Cut at 200 KB. ',
                el('a', { href: attachment.path, text: 'Open the whole file' }),
              )
            : null,
        ),
      );
    case 'trace':
      return el(
        'div',
        { class: 'attachment attachment-trace' },
        title,
        el('p', { text: 'Open the Playwright trace from the report folder with:' }),
        pre(`npx playwright show-trace ${attachment.path}`, 'command'),
        el('a', { href: attachment.path, text: 'Download the trace' }),
      );
    case 'file':
      return el(
        'div',
        { class: 'attachment attachment-file' },
        title,
        el('a', { href: attachment.path, text: `Download ${attachment.name}` }),
      );
  }
}

function attachments(list: readonly AttachmentView[]): HTMLElement {
  return el('div', { class: 'attachments' }, ...list.map(attachmentView));
}

function hasBody(step: StepView): boolean {
  return (
    step.steps.length > 0 ||
    step.error !== null ||
    step.parameters.length > 0 ||
    step.dataTable !== null ||
    step.docString !== null ||
    step.attachments.length > 0
  );
}

function stepItem(step: StepView): HTMLLIElement {
  const line = el(
    'span',
    { class: 'step-line' },
    el(
      'span',
      { class: `step-status status-${step.status}` },
      statusIcon(step.status),
      srOnly(STATUS_WORD[step.status]),
    ),
    el('span', { class: 'step-name', text: step.name }),
    step.category === null ? null : el('span', { class: 'step-category', text: step.category }),
    el('span', { class: 'duration', text: step.duration === null ? '' : formatDuration(step.duration) }),
  );
  if (!hasBody(step)) return el('li', { class: `step step-${step.status}` }, el('div', { class: 'step-leaf' }, line));
  const body = el('div', { class: 'step-body' });
  if (step.parameters.length > 0) body.appendChild(parametersTable(step.parameters));
  if (step.dataTable !== null) body.appendChild(dataTable(step.dataTable));
  if (step.docString !== null) body.appendChild(pre(step.docString, 'doc-string'));
  if (step.error !== null) body.appendChild(errorBlock(step.error, 'h3'));
  if (step.attachments.length > 0) body.appendChild(attachments(step.attachments));
  if (step.steps.length > 0) body.appendChild(stepList(step.steps));
  const open = step.status === 'failed' || step.status === 'broken' || step.dataTable !== null;
  return el('li', { class: `step step-${step.status}` }, el('details', { open }, el('summary', {}, line), body));
}

function stepList(steps: readonly StepView[]): HTMLOListElement {
  return el('ol', { class: 'steps' }, ...steps.map(stepItem));
}

function parametersTable(parameters: readonly { name: string; value: string }[]): HTMLElement {
  return el(
    'div',
    { class: 'table-scroll', tabindex: 0, role: 'region', 'aria-label': 'Parameters' },
    el(
      'table',
      { class: 'kv-table' },
      el(
        'tbody',
        {},
        ...parameters.map((parameter) =>
          el(
            'tr',
            {},
            el('th', { scope: 'row', text: parameter.name }),
            el('td', { class: 'mono', text: parameter.value }),
          ),
        ),
      ),
    ),
  );
}

function summary(test: TestEntry): HTMLElement {
  const data = report();
  const meta = el(
    'ul',
    { class: 'test-meta', 'aria-label': 'About this test' },
    el('li', {}, statusBadge(test.status, 'large')),
    el('li', {}, typeChip(test.type)),
    test.browser === null ? null : el('li', {}, browserChip(test)),
    el('li', {}, chip(`Severity: ${test.severity}`, test.severity === 'critical' ? 'chip-critical' : '')),
    el('li', {}, chip(`Duration: ${formatDuration(test.duration)}`)),
    test.flaky ? el('li', {}, flakyChip(test)) : null,
  );
  for (const requirement of test.requirements) {
    meta.appendChild(
      el(
        'li',
        {},
        el('a', {
          class: 'chip chip-link chip-requirement',
          href: href('requirements', { req: requirement }),
          title: data.requirementInfo.get(requirement)?.title ?? requirement,
          text: requirement,
        }),
      ),
    );
  }
  for (const tag of test.tags) {
    meta.appendChild(
      el('li', {}, el('a', { class: 'chip chip-link chip-tag', href: href('types', { tag }), text: tag })),
    );
  }
  const source =
    test.file === null
      ? null
      : test.sourceUrl === null
        ? el('span', { class: 'mono', text: `${test.file}${test.line === null ? '' : `:${String(test.line)}`}` })
        : externalLink(test.sourceUrl, `${test.file}${test.line === null ? '' : `:${String(test.line)}`}`, {
            class: 'mono',
          });
  const facts = el('dl', { class: 'facts' });
  const fact = (name: string, value: Node | string | null): void => {
    if (value === null) return;
    facts.append(el('dt', { text: name }), el('dd', {}, value));
  };
  fact('Source', source);
  fact('Suites', test.suites.length === 0 ? null : test.suites.join(' › '));
  fact('Step', test.step);
  fact('Worker', test.worker);
  fact('Started', new Date(test.start).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' }));
  for (const parameter of test.parameters) fact(parameter.name, el('span', { class: 'mono', text: parameter.value }));
  return el(
    'div',
    { class: 'test-summary' },
    meta,
    el(
      'section',
      { class: 'card history-card', 'aria-labelledby': 'history-title' },
      el('h2', { class: 'card-title', id: 'history-title', text: 'Recent results' }),
      historyDots(test.history),
      el('p', {
        class: 'muted',
        text: `Oldest first, this run last${test.flaky ? '. Switched between pass and fail lately, so it is marked flaky.' : '.'}`,
      }),
    ),
    card('Details', '', facts),
  );
}

function detailSections(detail: TestDetail): HTMLElement[] {
  const sections: HTMLElement[] = [];
  if (detail.error !== null) sections.push(card('Error', 'error-card', errorBlock(detail.error)));
  if (detail.steps.length > 0) sections.push(card('Steps', 'steps-card', stepList(detail.steps)));
  if (detail.attachments.length > 0) sections.push(card('Attachments', '', attachments(detail.attachments)));
  const stdout = detail.stdout.join('');
  const stderr = detail.stderr.join('');
  if (stdout !== '' || stderr !== '') {
    sections.push(
      card(
        'Output',
        '',
        stdout === '' ? null : el('div', {}, el('h3', { class: 'output-title', text: 'stdout' }), pre(stdout)),
        stderr === ''
          ? null
          : el('div', {}, el('h3', { class: 'output-title', text: 'stderr' }), pre(stderr, 'stderr')),
      ),
    );
  }
  if (detail.retries.length > 0) {
    sections.push(
      card(
        'Retries',
        '',
        el(
          'ol',
          { class: 'retries' },
          ...detail.retries.map((retry) =>
            el(
              'li',
              {},
              statusBadge(retry.status),
              el('span', { class: 'duration', text: formatDuration(retry.duration) }),
              retry.message === null ? null : el('code', { class: 'error-line', text: retry.message }),
            ),
          ),
        ),
      ),
    );
  }
  if (sections.length === 0) sections.push(emptyState('This test recorded no error, steps, attachments or output.'));
  return sections;
}

let drawing = 0;

export function renderTest(main: HTMLElement, route: Route): void {
  const id = route.id ?? '';
  const test = report().byId.get(id);
  if (test === undefined) {
    main.replaceChildren(
      viewHeader('Test not found', 'This report has no test with that ID. The link may be from another run.'),
      el('p', {}, el('a', { href: href('types'), text: 'See every test by type' })),
    );
    return;
  }
  drawing += 1;
  const mine = drawing;
  const detailHolder = el(
    'div',
    { class: 'detail', 'aria-busy': 'true' },
    el('p', { class: 'loading', text: 'Loading the details…' }),
  );
  const crumbs = el(
    'nav',
    { class: 'crumbs', 'aria-label': 'Breadcrumb' },
    el(
      'ol',
      {},
      el('li', {}, el('a', { href: href('types'), text: 'By test type' })),
      el('li', {}, el('a', { href: href('types', { type: test.type }), text: typeTitle(test.type) })),
      el('li', {}, el('span', { 'aria-current': 'page', text: test.file ?? test.suites[0] ?? test.name })),
    ),
  );
  main.replaceChildren(
    crumbs,
    viewHeader(test.name, test.fullName === test.name ? null : test.fullName),
    summary(test),
    detailHolder,
  );
  loadDetail(test.id).then(
    (detail) => {
      if (mine !== drawing) return;
      detailHolder.removeAttribute('aria-busy');
      detailHolder.replaceChildren(...detailSections(detail));
    },
    (error: unknown) => {
      if (mine !== drawing) return;
      detailHolder.removeAttribute('aria-busy');
      detailHolder.replaceChildren(
        el('p', {
          class: 'notice notice-error',
          role: 'alert',
          text: `Couldn't load this test's details: ${error instanceof Error ? error.message : String(error)}.`,
        }),
      );
    },
  );
}
