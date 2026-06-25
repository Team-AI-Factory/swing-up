import { NextRequest, NextResponse } from "next/server";
import { articleIdentity, latestArticleSignals, readArticleForMemory } from "@/lib/article-reader";

function bool(v: unknown) { return v === true || v === "true"; }
function num(v: unknown, fallback: number) { const n=Number(v); return Number.isFinite(n)?n:fallback; }
function safeMessage(e: unknown) { return e instanceof Error ? e.message.replace(/[A-Za-z0-9_\-]{24,}/g,"[redacted]").slice(0,160) : "article_reader_test_failed"; }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(()=>({})) as Record<string, unknown>;
    const dryRun = body.dryRun !== false;
    const confirmRun = bool(body.confirmRun);
    const maxArticles = Math.max(1, Math.min(num(body.maxArticles, 5), 10));
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ ok: true, dryRun, confirmRun, warnings: ["DATABASE_URL is not configured; article-reader test could not load newest raw signal URLs in this environment."], articleReadAttemptedCount: 0, articleReadSuccessCount: 0, articleReadFailedCount: 0, articleMemoryReusedCount: 0, articleDuplicateSkippedCount: 0, articleSummariesCreatedCount: 0, articleMemoryProofUsedCount: 0, openAiCalled: false, published: false, sentToTelegram: false, table: [] });
    }
    const signals = await latestArticleSignals(maxArticles);
    const seen = new Map<string, Awaited<ReturnType<typeof readArticleForMemory>>>();
    const table = [] as Record<string, unknown>[];
    let duplicateSkipped = 0;
    for (const signal of signals) {
      const input = { articleUrl: signal.sourceUrl, title: signal.title, snippet: signal.summary, source: signal.source, ticker: signal.ticker, receivedAt: signal.receivedAt, confirmRun, dryRun, duplicateArticleSourceId: signal.id };
      const identity = articleIdentity(input);
      let result;
      if (identity.articleUrlHash && seen.has(identity.articleUrlHash)) {
        duplicateSkipped += 1;
        result = { ...seen.get(identity.articleUrlHash)!, duplicateArticleInRun: true, duplicateArticleSourceId: signal.id, duplicateArticleReuseReason: "same articleUrlHash already processed in this test run", articleReadAttempted: false };
      } else {
        result = await readArticleForMemory(input);
        if (identity.articleUrlHash) seen.set(identity.articleUrlHash, result);
      }
      table.push({ title: signal.title, source: signal.source, ticker: signal.ticker, hasUrl: Boolean(signal.sourceUrl), articleUrlHash: result.articleUrlHash, alreadySeen: result.articleAlreadySeen, readAttempted: result.articleReadAttempted, textAvailable: result.articleTextAvailable, summaryCreated: result.articleSummaryAvailable, memoryStored: result.articleTextStored || result.articleMemoryAvailable, memoryReused: result.articleMemoryUsed, errorCategory: result.errorCategory, errorMessageSafe: result.errorMessageSafe });
    }
    return NextResponse.json({ ok:true, dryRun, confirmRun, openAiCalled:false, published:false, sentToTelegram:false, articleReadAttemptedCount: table.filter(r=>r.readAttempted).length, articleReadSuccessCount: table.filter(r=>r.textAvailable).length, articleReadFailedCount: table.filter(r=>r.readAttempted && r.textAvailable !== true).length, articleMemoryReusedCount: table.filter(r=>r.memoryReused).length, articleDuplicateSkippedCount: duplicateSkipped, articleSummariesCreatedCount: table.filter(r=>r.summaryCreated).length, articleMemoryProofUsedCount: 0, table });
  } catch (e) {
    return NextResponse.json({ ok:false, errorCategory:"article_reader_test_failed", errorMessageSafe:safeMessage(e), openAiCalled:false, published:false, sentToTelegram:false }, { status: 500 });
  }
}
