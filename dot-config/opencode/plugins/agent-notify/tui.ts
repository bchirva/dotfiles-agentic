import {spawn} from "node:child_process";
import {Plugin} from "@opencode/plugin/tui";

const NOTIFIER = "agent-notify";

export default Plugin.define({
  id: "agent-notify",
  setup(context) {
    const sessions = new Set<string>();

    const stopStarted = context.data.on("session.execution.started", (event) => {
      const route = context.ui.router.current();
      if (route.type === "session" && route.sessionID === event.data.sessionID) {
        sessions.add(event.data.sessionID);
      }
    });

    const stopSucceeded = context.data.on("session.execution.succeeded", (event) => {
      const route = context.ui.router.current();
      const ownsSession = sessions.delete(event.data.sessionID)
        || (route.type === "session" && route.sessionID === event.data.sessionID);
      if (ownsSession) notify("OpenCode", "Task completed");
    });

    return () => {
      stopStarted();
      stopSucceeded();
    };
  },
});

function notify(title: string, body: string): void {
  const child = spawn(NOTIFIER, [title, body], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
}
