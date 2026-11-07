import type {
  AgentBeforeSettleEvent,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {spawn} from "node:child_process";

const NOTIFIER = "agent-notify";

export default function (pi: ExtensionAPI) {
  let outcome: AgentBeforeSettleEvent["outcome"] | undefined;

  pi.on("agent_before_settle", (event) => {
    outcome = event.outcome;
  });

  pi.on("agent_settled", (event) => {
    if (event.aborted || outcome !== "completed") return;
    notify("Pi", "Task completed");
    outcome = undefined;
  });
}

function notify(title: string, body: string): void {
  const child = spawn(NOTIFIER, [title, body], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
}
