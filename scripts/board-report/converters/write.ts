// What every converter hands back, and how it is written: labelled (labels.ts), its attachments named after the
// result and kept as files next to it (result-schema.ts).
import { labelResult, type ResultDraft } from '../labels.ts';
import {
  attachmentSource,
  writeResult,
  type AttachmentFile,
  type Step,
  type TestResult,
  type TestStep,
} from '../result-schema.ts';

export interface ConvertedAttachment {
  name: string;
  type: string;
  body: string | Buffer;
  /** The step it belongs to (one of the draft's steps); the test itself when missing. */
  step?: TestStep;
}

export interface Converted {
  draft: ResultDraft;
  attachments: ConvertedAttachment[];
}

export function converted(draft: ResultDraft, attachments: ConvertedAttachment[] = []): Converted {
  return { draft, attachments };
}

export function writeConverted(dir: string, step: Step, results: readonly Converted[]): TestResult[] {
  return results.map(({ draft, attachments }) => {
    const result = labelResult(draft, step);
    const files = new Map<string, AttachmentFile>();
    attachments.forEach((attachment, index) => {
      const source = attachmentSource(result.id, index, attachment.name, attachment.type);
      files.set(source, { body: attachment.body });
      (attachment.step?.attachments ?? result.attachments).push({
        name: attachment.name,
        type: attachment.type,
        source,
      });
    });
    writeResult(dir, result, files);
    return result;
  });
}

/**
 * A result for something that has no test file of its own: a static check, a coverage threshold, a k6 threshold.
 * Its parameters are what the run measured, so they are marked as such and stay out of its history ID.
 */
export function plainDraft(
  fields: Pick<ResultDraft, 'name' | 'status' | 'start' | 'stop' | 'suites' | 'error'> & Partial<ResultDraft>,
): ResultDraft {
  return {
    fullName: [...fields.suites, fields.name].join(' > '),
    duration: Math.max(0, fields.stop - fields.start),
    file: null,
    line: null,
    steps: [],
    attachments: [],
    stdout: [],
    stderr: [],
    retries: [],
    labels: { tags: [], browser: null, worker: null },
    ...fields,
    parameters: (fields.parameters ?? []).map((parameter) => ({ ...parameter, measured: true as const })),
  };
}
