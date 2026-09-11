import { sleep } from "workflow";
import { advance, fail } from "./steps.mjs";
export async function runCloudSession(id, generation) {
  "use workflow";
  try {
    for (let step = 0; step < 1500; step++) {
      const state = await advance(id, generation);
      if (state === "done") return;
      if (state === "wait") await sleep("5s");
    }
    await fail(id, generation);
  } catch {
    await fail(id, generation);
  }
}
