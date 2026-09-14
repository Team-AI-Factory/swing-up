-- CreateTable
CREATE TABLE "EarlyAccessLead" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "planIntent" TEXT NOT NULL DEFAULT 'free',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "source" TEXT NOT NULL DEFAULT 'direct',
    "content" TEXT NOT NULL DEFAULT '',
    "consentVersion" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "manageHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarlyAccessLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthVisit" (
    "id" TEXT NOT NULL,
    "visitKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthRateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthRateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "GrowthRuntime" (
    "key" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL DEFAULT '',
    "leaseUntil" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'starting',
    "detail" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "GrowthRuntime_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SocialSignal" (
    "id" TEXT NOT NULL,
    "scheduleKey" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialDelivery" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_connection',
    "providerPostId" TEXT,
    "externalUrl" TEXT,
    "failure" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EarlyAccessLead_email_key" ON "EarlyAccessLead"("email");

-- CreateIndex
CREATE UNIQUE INDEX "EarlyAccessLead_manageHash_key" ON "EarlyAccessLead"("manageHash");

-- CreateIndex
CREATE INDEX "EarlyAccessLead_source_createdAt_idx" ON "EarlyAccessLead"("source", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthVisit_visitKey_key" ON "GrowthVisit"("visitKey");

-- CreateIndex
CREATE INDEX "GrowthVisit_source_createdAt_idx" ON "GrowthVisit"("source", "createdAt");

-- CreateIndex
CREATE INDEX "GrowthRateLimit_expiresAt_idx" ON "GrowthRateLimit"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialSignal_scheduleKey_key" ON "SocialSignal"("scheduleKey");

-- CreateIndex
CREATE INDEX "SocialSignal_createdAt_idx" ON "SocialSignal"("createdAt");

-- CreateIndex
CREATE INDEX "SocialSignal_ticker_scheduledAt_idx" ON "SocialSignal"("ticker", "scheduledAt");

-- CreateIndex
CREATE INDEX "SocialDelivery_status_updatedAt_idx" ON "SocialDelivery"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialDelivery_signalId_channel_key" ON "SocialDelivery"("signalId", "channel");

-- AddForeignKey
ALTER TABLE "SocialDelivery" ADD CONSTRAINT "SocialDelivery_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "SocialSignal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

