import { NextRequest, NextResponse } from "next/server";
import {
  latestArticleSignals,
  runPriorityArticleReader,
} from "@/lib/article-reader";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const dryRun = body.dryRun !== false;
  const confirmRun = body.confirmRun === true;
  const maxArticles = Math.max(
    0,
    Math.min(Number(body.maxArticles ?? 10) || 10, 20),
  );
  try {
    const signals = await latestArticleSignals(Math.max(maxArticles * 4, 20));
    const result = await runPriorityArticleReader({
      signals: signals.map((signal) => ({
        id: signal.id,
        source: signal.source,
        ticker: signal.ticker,
        title: signal.title,
        summary: signal.summary,
        sourceUrl: signal.sourceUrl,
        receivedAt: signal.receivedAt,
      })),
      dryRun,
      confirmRun,
      maxArticles,
      macroShockReservedReads: Number(body.macroShockReservedReads ?? 3) || 3,
      normalCandidateReservedReads:
        Number(body.normalCandidateReservedReads ?? 5) || 5,
    });
    return NextResponse.json(
      withRedactionMetadata({
        ok: true,
        dryRun,
        confirmRun,
        priorityMode: body.priorityMode !== false,
        articlesConsidered: result.summary.articlesConsidered,
        articlesRead: result.summary.articlesReadCount,
        macroShockArticlesRead: result.summary.macroShockArticlesReadCount,
        duplicatesSkipped: result.summary.duplicatesSkipped,
        skippedDueToLimit: result.summary.articlesSkippedDueToLimit,
        topReadArticles: result.summary.topReadArticles,
        topSkippedArticles: result.summary.topSkippedArticles,
        noOpenAI: true,
        noPublish: true,
        noTelegram: true,
        secretsRedacted: true,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "priority_article_reader_failed";
    const databaseUnavailable =
      /DATABASE_URL|Environment variable not found|Prisma/.test(message);
    return NextResponse.json(
      withRedactionMetadata({
        ok: databaseUnavailable,
        dryRun,
        confirmRun,
        articlesConsidered: 0,
        articlesRead: 0,
        macroShockArticlesRead: 0,
        duplicatesSkipped: 0,
        skippedDueToLimit: 0,
        topReadArticles: [],
        topSkippedArticles: [],
        warning: databaseUnavailable
          ? "Database is not configured in this environment, so no stored article signals could be loaded."
          : null,
        errorCategory: databaseUnavailable
          ? "database_unavailable_for_priority_article_reader"
          : "priority_article_reader_failed_safe",
        errorMessageSafe: databaseUnavailable
          ? "Database unavailable for priority article reader."
          : message.slice(0, 160),
        noOpenAI: true,
        noPublish: true,
        noTelegram: true,
        secretsRedacted: true,
      }),
      { status: 200 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    withRedactionMetadata({
      ok: true,
      methodRequired: "POST",
      exampleBody: {
        dryRun: true,
        confirmRun: false,
        maxArticles: 10,
        priorityMode: true,
      },
      noOpenAI: true,
      noPublish: true,
      noTelegram: true,
      secretsRedacted: true,
    }),
  );
}
