import cohort from "@/config/simple-alert-pilot.json";

type CohortConfig = { cohortId?: unknown };

/** Stable identity for measurements; configuration changes never reset money. */
export function pilotCohortId(config: CohortConfig = cohort as CohortConfig) {
  if (config.cohortId === undefined) return "legacy-25-20260928";
  if (typeof config.cohortId !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(config.cohortId)) {
    throw new Error("simple_pilot_cohort_id_invalid");
  }
  return config.cohortId;
}

export function pilotCohortStoragePrefix(base: string, config: CohortConfig = cohort as CohortConfig) {
  // Preserve legacy storage until an explicitly versioned replacement is set.
  return config.cohortId === undefined ? base : `${base}cohorts/${pilotCohortId(config)}/`;
}
