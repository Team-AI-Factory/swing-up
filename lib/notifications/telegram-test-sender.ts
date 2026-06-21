export type TelegramTestSendResult = {
  ok: boolean;
  sent: boolean;
  status: "sent" | "dry_run" | "not_configured" | "send_not_confirmed" | "send_failed";
  chatIdConfigured: boolean;
  botTokenConfigured: boolean;
  error?: string;
};

export function telegramTestConfigStatus() {
  return {
    botTokenConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    chatIdConfigured: Boolean(process.env.TELEGRAM_TEST_CHAT_ID),
  };
}

export async function sendTelegramInternalTestMessage(input: { message: string; dryRun: boolean; confirmSend: boolean }): Promise<TelegramTestSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_TEST_CHAT_ID;
  const config = telegramTestConfigStatus();

  if (input.dryRun) return { ok: true, sent: false, status: "dry_run", ...config };
  if (!token || !chatId) return { ok: true, sent: false, status: "not_configured", ...config };
  if (!input.confirmSend) return { ok: true, sent: false, status: "send_not_confirmed", ...config };

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: input.message, disable_web_page_preview: true }),
    });
    if (!response.ok) return { ok: false, sent: false, status: "send_failed", ...config, error: `telegram_http_${response.status}` };
    return { ok: true, sent: true, status: "sent", ...config };
  } catch (error) {
    return { ok: false, sent: false, status: "send_failed", ...config, error: error instanceof Error ? error.message : "telegram_send_failed" };
  }
}
