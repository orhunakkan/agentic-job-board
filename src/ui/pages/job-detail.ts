import type { JobRecord } from '../../db/repositories/jobs.ts';
import type { ListingSightingRecord } from '../../db/repositories/listing-sightings.ts';
import type { SightingRecord } from '../../db/repositories/sightings.ts';
import type { StatusChange } from '../../db/repositories/status-history.ts';
import { SOURCE_LABELS } from '../../domain/job-source.ts';
import { nextStatuses } from '../../domain/status.ts';
import { flags, listingFacts, notice, scoreBadge, sourceLink } from '../components.ts';
import { formatDateTime, STATUS_LABELS } from '../format.ts';
import { html, type SafeHtml } from '../html.ts';

// Job detail (FR-08 to FR-10, FR-17, PLAN.md §6.3): every field, score and reason, status form (only allowed
// transitions are offered), notes, the description a feed gave, status history and sightings.

export interface JobDetailView {
  job: JobRecord;
  description: string | null;
  sightings: readonly SightingRecord[];
  listingSightings: readonly ListingSightingRecord[];
  history: readonly StatusChange[];
  backHref: string;
  statusChanged: boolean;
  notesSaved: boolean;
}

export const NOTES_MAX = 5000;

export function jobDetailPage(view: JobDetailView): SafeHtml {
  const { job } = view;
  const next = nextStatuses(job.status);

  return html`
    <p class="back"><a href="${view.backHref}">← Board</a></p>
    ${view.statusChanged && notice(`Status changed to ${STATUS_LABELS[job.status]}.`)}
    ${view.notesSaved && notice('Notes saved.')}
    <div class="job-header">
      <h1>${job.title}</h1>
      ${scoreBadge(job)}
    </div>
    <p class="job-meta">
      ${job.company}${job.location !== '' && html` · ${job.location}`}${flags(job)}${listingFacts(job)}
    </p>
    <p class="job-reason">
      ${job.scoreReason === null ? 'Not scored yet: the next /find-jobs run scores it.' : html`Reason: ${job.scoreReason}`}
    </p>

    <section class="panel" aria-labelledby="status-heading">
      <h2 id="status-heading">Status</h2>
      <p>
        <span class="status">${STATUS_LABELS[job.status]}</span> since
        <time datetime="${job.statusChangedAt}">${formatDateTime(job.statusChangedAt)}</time>
      </p>
      ${
        next.length === 0
          ? html`<p>${STATUS_LABELS[job.status]} is a final status, so it can't change any more.</p>`
          : html`<form class="status-form" method="post" action="/jobs/${job.id}/status">
              <input type="hidden" name="return" value="/jobs/${job.id}" />
              <label for="status">Change to</label>
              <select id="status" name="status">
                ${next.map((status) => html`<option value="${status}">${STATUS_LABELS[status]}</option>`)}
              </select>
              <button type="submit" class="button">Update</button>
            </form>`
      }
      <p>${sourceLink(job)}</p>
    </section>

    ${
      view.description !== null &&
      html`<section class="panel" aria-labelledby="description-heading">
        <h2 id="description-heading">Description</h2>
        <p class="hint">As ${SOURCE_LABELS[job.source]} lists it.</p>
        <div class="description">${view.description}</div>
      </section>`
    }

    <section class="panel" aria-labelledby="notes-heading">
      <h2 id="notes-heading">Notes</h2>
      <form method="post" action="/jobs/${job.id}/notes">
        <label for="notes" class="visually-hidden">Notes</label>
        ${notesField(job.notes)}
        <p id="notes-hint" class="hint">Up to 5,000 characters. Only you see them.</p>
        <button type="submit" class="button">Save notes</button>
      </form>
    </section>

    <div class="columns">
      <section class="panel" aria-labelledby="history-heading">
        <h2 id="history-heading">Status history</h2>
        <ol class="timeline">
          ${view.history.map(
            (change) =>
              html`<li>
                <time datetime="${change.changedAt}">${formatDateTime(change.changedAt)}</time>
                ${
                  change.fromStatus === null
                    ? html`Created as ${STATUS_LABELS[change.toStatus]}`
                    : html`${STATUS_LABELS[change.fromStatus]} → ${STATUS_LABELS[change.toStatus]}`
                }
              </li>`,
          )}
        </ol>
      </section>
      <section class="panel" aria-labelledby="sightings-heading">
        <h2 id="sightings-heading">Sightings</h2>
        <ol class="timeline">
          ${view.sightings.map(
            (sighting) =>
              html`<li>
                <time datetime="${sighting.receivedAt}">${formatDateTime(sighting.receivedAt)}</time>
                ${sighting.savedSearch === null ? 'LinkedIn recommendations' : html`Alert: ${sighting.savedSearch}`}
              </li>`,
          )}
          ${view.listingSightings.map(
            (sighting) =>
              html`<li>
                <time datetime="${sighting.seenAt}">${formatDateTime(sighting.seenAt)}</time>
                Listed on ${SOURCE_LABELS[job.source]} · <a href="/runs">run ${sighting.runId}</a>
              </li>`,
          )}
        </ol>
      </section>
    </div>

    <section class="panel" aria-labelledby="details-heading">
      <h2 id="details-heading">Details</h2>
      <dl class="details">
        <dt>Source</dt>
        <dd>${SOURCE_LABELS[job.source]}</dd>
        <dt>${SOURCE_LABELS[job.source]} job ID</dt>
        <dd>${job.sourceJobId}</dd>
        ${
          job.postedAt !== null &&
          html`<dt>Posted</dt>
            <dd><time datetime="${job.postedAt}">${formatDateTime(job.postedAt)}</time></dd>`
        }
        ${
          job.salary !== null &&
          html`<dt>Salary</dt>
            <dd>${job.salary}</dd>`
        }
        <dt>First seen</dt>
        <dd><time datetime="${job.firstSeenAt}">${formatDateTime(job.firstSeenAt)}</time></dd>
        <dt>Last seen</dt>
        <dd><time datetime="${job.lastSeenAt}">${formatDateTime(job.lastSeenAt)}</time></dd>
        <dt>Times seen</dt>
        <dd>${job.seenCount}</dd>
        <dt>Scored</dt>
        <dd>
          ${
            job.scoredAt === null
              ? 'Not yet'
              : html`<time datetime="${job.scoredAt}">${formatDateTime(job.scoredAt)}</time> with rubric
                  ${job.rubricVersion}`
          }
        </dd>
      </dl>
    </section>
  `;
}

// A textarea keeps every character between its tags, except one newline right after the opening tag, which the
// browser drops. So exactly one newline goes there, and Prettier must not reflow it.
// prettier-ignore
function notesField(notes: string): SafeHtml {
  return html`<textarea id="notes" name="notes" rows="6" maxlength="${NOTES_MAX}" aria-describedby="notes-hint">
${notes}</textarea>`;
}
