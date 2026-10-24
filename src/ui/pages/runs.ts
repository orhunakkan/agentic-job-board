import type { EmailRecord } from '../../db/repositories/emails.ts';
import type { RunRecord } from '../../db/repositories/runs.ts';
import { formatDateTime } from '../format.ts';
import { html, type SafeHtml } from '../html.ts';

// Run history and unrecognized emails (FR-11, FR-12). Listings are the jobs other sources sent (FR-15).

export interface RunsView {
  runs: readonly RunRecord[];
  unrecognized: readonly EmailRecord[];
}

export function runsPage(view: RunsView): SafeHtml {
  return html`
    <h1>Runs</h1>
    ${
      view.runs.length === 0
        ? html`<p class="empty">No runs yet. Run <code>/find-jobs</code> in Claude Code.</p>`
        : html`<div class="table-scroll" role="region" aria-labelledby="runs-caption" tabindex="0">
            <table>
              <caption id="runs-caption">
                Every /find-jobs run, newest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Started</th>
                  <th scope="col">Finished</th>
                  <th scope="col" class="num">Emails</th>
                  <th scope="col" class="num">New emails</th>
                  <th scope="col" class="num">Duplicates</th>
                  <th scope="col" class="num">Unrecognized</th>
                  <th scope="col" class="num">Listings</th>
                  <th scope="col" class="num">New jobs</th>
                  <th scope="col" class="num">Seen again</th>
                  <th scope="col" class="num">Scored</th>
                </tr>
              </thead>
              <tbody>
                ${view.runs.map(
                  (run) =>
                    html`<tr>
                      <th scope="row">${run.id}</th>
                      <td><time datetime="${run.startedAt}">${formatDateTime(run.startedAt)}</time></td>
                      <td>
                        ${
                          run.finishedAt === null
                            ? 'Not finished'
                            : html`<time datetime="${run.finishedAt}">${formatDateTime(run.finishedAt)}</time>`
                        }
                      </td>
                      <td class="num">${run.emailsSeen}</td>
                      <td class="num">${run.emailsNew}</td>
                      <td class="num">${run.emailsDuplicate}</td>
                      <td class="num">${run.emailsUnrecognized}</td>
                      <td class="num">${run.listingsSeen}</td>
                      <td class="num">${run.jobsNew}</td>
                      <td class="num">${run.jobsSeenAgain}</td>
                      <td class="num">${run.jobsScored}</td>
                    </tr>`,
                )}
              </tbody>
            </table>
          </div>`
    }

    <h2>Unrecognized emails</h2>
    ${
      view.unrecognized.length === 0
        ? html`<p class="empty">None. Every email so far was read.</p>`
        : html`<p>
              The parser could not read these emails, so their jobs are missing. A LinkedIn format change is the usual
              cause.
            </p>
            <div class="table-scroll" role="region" aria-labelledby="unrecognized-caption" tabindex="0">
              <table>
                <caption id="unrecognized-caption">
                  Unrecognized emails, newest first
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Received</th>
                    <th scope="col">From</th>
                    <th scope="col">Subject</th>
                    <th scope="col">Reason</th>
                    <th scope="col" class="num">Run</th>
                  </tr>
                </thead>
                <tbody>
                  ${view.unrecognized.map(
                    (email) =>
                      html`<tr>
                        <td><time datetime="${email.receivedAt}">${formatDateTime(email.receivedAt)}</time></td>
                        <td>${email.sender}</td>
                        <td>${email.subject}</td>
                        <td>${email.unrecognizedReason}</td>
                        <td class="num">${email.runId}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>`
    }
  `;
}
