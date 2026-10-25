import type { RunRecord } from '../../db/repositories/runs.ts';
import { formatDateTime } from '../format.ts';
import { html, type SafeHtml } from '../html.ts';

// Run history (FR-11). Listings are the jobs the LinkedIn searches and the feeds sent (FR-15, FR-18); the email
// columns keep the counts of runs from the alert-email years (DEC-041).

export interface RunsView {
  runs: readonly RunRecord[];
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
  `;
}
