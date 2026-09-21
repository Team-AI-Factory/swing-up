import { setTimeout as delay } from "node:timers/promises";

// The route persists each batch checkpoint. Retrying resumes that checkpoint.
export async function retryFoundationRequest(request, { pause = delay, onRetry = () => {}, attempts = 3 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await request();
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) return response;
      await response.body?.cancel().catch(() => {});
      onRetry({ attempt, status: response.status });
    } catch (error) {
      if (attempt === attempts) throw error;
      onRetry({ attempt, status: "transport_failure" });
    }
    await pause(attempt * 2000);
  }
}
