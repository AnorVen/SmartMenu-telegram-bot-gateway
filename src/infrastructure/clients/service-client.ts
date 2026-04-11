import type { FastifyInstance } from "fastify";
import type { InlineKeyboard } from "../../domain/types.js";

export async function callService(
  app: FastifyInstance,
  url: string,
  options: {
    method: "GET" | "POST";
    body?: unknown;
  }
): Promise<unknown> {
  try {
    const response = await fetch(url, {
      method: options.method,
      headers: {
        "content-type": "application/json"
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (!response.ok) {
      app.log.warn({ url, status: response.status }, "Внутренний сервис вернул ошибку");
      return null;
    }

    return await response.json();
  } catch (error) {
    app.log.warn({ url, error }, "Внутренний сервис временно недоступен");
    return null;
  }
}

export async function sendMessage(
  app: FastifyInstance,
  telegramBotToken: string,
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboard
): Promise<void> {
  if (telegramBotToken === "change-me") {
    app.log.info({ chatId, text, replyMarkup }, "Telegram token не задан, сообщение записано в лог");
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: replyMarkup
    })
  });

  if (!response.ok) {
    app.log.warn({ chatId, status: response.status }, "Не удалось отправить сообщение в Telegram");
  }
}
