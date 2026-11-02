import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const child = spawn("go", ["run", "./cmd/server"], {
  cwd: `${root}/server`,
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? "",
    REDIS_URL: process.env.REDIS_URL ?? "",
    WEB_DIR: process.env.WEB_DIR ?? `${root}/dist`,
    PORT: process.env.PORT ?? "5599",
    HOST: process.env.HOST ?? "127.0.0.1",
    STUDIO_STATE_DIR:
      process.env.STUDIO_STATE_DIR ?? `${root}/output/studio-state`,
  },
});
child.on("error", () => {
  console.error("Потрібен Go 1.24+.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
process.on("SIGINT", () => child.kill("SIGINT"));
