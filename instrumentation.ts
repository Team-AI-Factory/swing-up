export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBranchSignalLabRuntimeScheduler } = await import("@/lib/branch-signal-lab-runtime-scheduler");
  startBranchSignalLabRuntimeScheduler();
}
