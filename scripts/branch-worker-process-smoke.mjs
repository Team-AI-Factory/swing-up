import { fork } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";

const token = "scheduler-process-smoke-token";
let runCount = 0;
let workerStartedAt = null;
const sequences = [];

const server = createServer((request, response) => {
  if (request.url === "/api/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.url === "/api/internal/railway-branch-signal-lab" && request.method === "POST") {
    if (request.headers["x-swing-up-branch-lab-token"] !== token) throw new Error("Dedicated worker did not send the runtime token.");
    if (request.headers["x-swing-up-branch-lab-scheduler"] !== "dedicated_worker") throw new Error("Dedicated worker identity header is missing.");
    workerStartedAt ??= request.headers["x-swing-up-branch-lab-worker-started-at"];
    if (request.headers["x-swing-up-branch-lab-worker-started-at"] !== workerStartedAt) throw new Error("Worker identity changed during one process run.");
    sequences.push(Number(request.headers["x-swing-up-branch-lab-worker-sequence"]));
    runCount += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, status: "no_qualified_signal", stopped: false, repairEligible: false }));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: false }));
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Scheduler smoke server did not bind a port.");

const worker = fork(new URL("./railway-branch-worker.mjs", import.meta.url), [], {
  env: {
    ...process.env,
    PORT: String(address.port),
    SWING_UP_BRANCH_LAB_RUNTIME_TOKEN: token,
    SWING_UP_BRANCH_LAB_EFFECTIVE_INTERVAL_SECONDS: "0.1",
    SWING_UP_BRANCH_LAB_EFFECTIVE_TECHNICAL_RETRY_SECONDS: "0.05",
    SWING_UP_BRANCH_LAB_WORKER_SMOKE: "true",
  },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});

const deadline = Date.now() + 8_000;
while (runCount < 3 && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
worker.kill("SIGTERM");
await Promise.race([once(worker, "exit"), new Promise((_, reject) => setTimeout(() => reject(new Error("Dedicated worker did not stop cleanly.")), 2_000))]);
server.close();
await once(server, "close");

if (runCount < 3) throw new Error(`Dedicated worker produced only ${runCount} scheduled requests.`);
if (sequences.some((value, index) => value !== index + 1)) throw new Error(`Dedicated worker sequences were not monotonic: ${sequences.join(",")}`);

console.log(JSON.stringify({ ok: true, schedulerMechanicsOnly: true, simulatedMarketPerformance: false, supervisedWorkerRequests: runCount, sequences }, null, 2));
