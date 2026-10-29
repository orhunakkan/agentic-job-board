import { After, setDefaultTimeout } from '@cucumber/cucumber';
import type { BoardWorld } from './world.ts';

// Browser steps and Find Now runs take longer than Cucumber's 5-second default; 30 seconds still stops a hung step.
setDefaultTimeout(30_000);

// Every scenario leaves nothing behind: its page, its app and its temporary database go with it (PLAN.md §8.2).
// Cucumber runs After hooks in the reverse order they are defined, and support/ loads first, so this runs last.
After(async function (this: BoardWorld) {
  await this.cleanUp();
});
