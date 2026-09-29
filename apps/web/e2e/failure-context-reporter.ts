import { readFileSync } from 'node:fs';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

const MAX_LINES = 150;

/**
 * Prints the page snapshot Playwright saves for a failed test (its "error-context" attachment)
 * to the log. CI's report artifact can't always be downloaded where the failure is fixed, so
 * the job log alone should show what the page looked like.
 */
export default class FailureContextReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === 'passed' || result.status === 'skipped') return;
    for (const attachment of result.attachments) {
      if (attachment.name !== 'error-context') continue;
      let text: string;
      try {
        text = attachment.body
          ? attachment.body.toString('utf8')
          : attachment.path
            ? readFileSync(attachment.path, 'utf8')
            : '';
      } catch {
        continue;
      }
      if (!text) continue;
      const lines = text.split('\n');
      const shown = lines.slice(0, MAX_LINES).join('\n');
      const more = lines.length > MAX_LINES ? `\n… (${lines.length - MAX_LINES} more lines)` : '';
      console.log(
        `\n----- Page at failure: ${test.titlePath().slice(1).join(' › ')} (attempt ${result.retry + 1}) -----\n${shown}${more}\n----- end -----\n`,
      );
    }
  }
}
