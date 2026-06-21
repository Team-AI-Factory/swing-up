CREATE TABLE "ai_committee_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "candidate_alert_id" UUID,
  "alert_id" UUID,
  "status" TEXT NOT NULL,
  "run_mode" TEXT NOT NULL,
  "dry_run" BOOLEAN NOT NULL DEFAULT true,
  "agent_ids" JSONB NOT NULL DEFAULT '[]',
  "final_recommendation" TEXT,
  "selected_action_label" TEXT,
  "score_outputs" JSONB NOT NULL DEFAULT '{}',
  "risk_level" TEXT,
  "compliance_warnings" JSONB NOT NULL DEFAULT '[]',
  "missing_data" JSONB NOT NULL DEFAULT '[]',
  "model_provider" TEXT NOT NULL DEFAULT 'unknown',
  "model_names" JSONB NOT NULL DEFAULT '[]',
  "token_estimate" INTEGER,
  "estimated_cost_cents" INTEGER NOT NULL DEFAULT 0,
  "output" JSONB NOT NULL DEFAULT '{}',
  "request" JSONB NOT NULL DEFAULT '{}',
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  "error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_committee_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_committee_agent_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "agent_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "verdict" TEXT,
  "confidence" INTEGER,
  "missing_data" JSONB NOT NULL DEFAULT '[]',
  "key_findings" JSONB NOT NULL DEFAULT '[]',
  "concerns" JSONB NOT NULL DEFAULT '[]',
  "suggested_action_label" TEXT,
  "model_provider" TEXT NOT NULL DEFAULT 'unknown',
  "model_name" TEXT,
  "token_estimate" INTEGER,
  "estimated_cost_cents" INTEGER NOT NULL DEFAULT 0,
  "output" JSONB NOT NULL DEFAULT '{}',
  "error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_committee_agent_results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_committee_runs_created_at_idx" ON "ai_committee_runs"("created_at" DESC);
CREATE INDEX "ai_committee_runs_candidate_alert_id_created_at_idx" ON "ai_committee_runs"("candidate_alert_id", "created_at" DESC);
CREATE INDEX "ai_committee_runs_alert_id_created_at_idx" ON "ai_committee_runs"("alert_id", "created_at" DESC);
CREATE INDEX "ai_committee_agent_results_run_id_idx" ON "ai_committee_agent_results"("run_id");
CREATE INDEX "ai_committee_agent_results_agent_id_idx" ON "ai_committee_agent_results"("agent_id");
ALTER TABLE "ai_committee_runs" ADD CONSTRAINT "ai_committee_runs_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_committee_agent_results" ADD CONSTRAINT "ai_committee_agent_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_committee_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
