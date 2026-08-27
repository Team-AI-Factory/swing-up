import { DurableObject } from "cloudflare:workers";
import worker, { SensorCoordinatorCore } from "./pr262-sensor-core.mjs";

/**
 * Cloudflare's current SQLite Durable Object base class wraps the testable core
 * coordinator. Keeping the platform adapter this small prevents Node-only test
 * shims from accidentally entering the deployed bundle.
 */
export class SensorCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new SensorCoordinatorCore(ctx, env);
  }

  fetch(request) {
    return this.core.fetch(request);
  }
}

export default worker;
