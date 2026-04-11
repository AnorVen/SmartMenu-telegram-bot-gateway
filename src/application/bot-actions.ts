import type { FastifyInstance } from "fastify";
import { buildMenuResult } from "./dialog-state.js";
import type { ProfileDraft } from "../domain/types.js";
import { callService, sendMessage } from "../infrastructure/clients/service-client.js";

export type BotDeps = {
  app: FastifyInstance;
  telegramBotToken: string;
  aiOrchestratorUrl: string;
  inventoryServiceUrl: string;
  logisticsServiceUrl: string;
  recipeServiceUrl: string;
  retailServiceUrl: string;
  userProfileServiceUrl: string;
  profiles: Map<number, ProfileDraft>;
  lastLocations: Map<number, { latitude: number; longitude: number }>;
};

export async function generateMenu(deps: BotDeps, chatId: number): Promise<void> {
  const profile = deps.profiles.get(chatId);

  if (!profile) {
    await sendMessage(deps.app, deps.telegramBotToken, chatId, "Сначала нужно заполнить профиль. Напиши /start.");
    return;
  }

  await callService(deps.app, `${deps.aiOrchestratorUrl}/generate`, {
    method: "POST",
    body: {
      chatId,
      profile,
      source: "telegram-generate"
    }
  });

  await sendMessage(deps.app, deps.telegramBotToken, chatId, buildMenuResult(profile), {
    inline_keyboard: [
      [
        { text: "Построить маршрут", callback_data: "build_route" },
        { text: "Я приготовил(а)", callback_data: "mark_cooked" }
      ],
      [
        { text: "Инвентарь", callback_data: "show_inventory" },
        { text: "Пропустить ужин", callback_data: "skip_meal:сегодня ужин" }
      ],
      [{ text: "Сводка недели", callback_data: "weekly_summary" }]
    ]
  });
}

export async function requestLocationForRoute(deps: BotDeps, chatId: number): Promise<void> {
  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    "Пришли геолокацию, и я соберу маршрут по магазинам с учетом веса покупок, транспорта и привычного района."
  );
}

export async function handleLocation(
  deps: BotDeps,
  chatId: number,
  location: { latitude: number; longitude: number }
): Promise<void> {
  deps.lastLocations.set(chatId, location);

  await callService(deps.app, `${deps.logisticsServiceUrl}/routes`, {
    method: "POST",
    body: {
      chatId,
      location,
      source: "telegram-location"
    }
  });

  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    [
      "Маршрут на сегодня:",
      "1. Магнит по пути домой: молоко, курица, гречка.",
      "2. Пятерочка рядом с остановкой: хлеб, зелень.",
      "",
      "Если окажешься в другом магазине, напиши: «я в магазине Пятерочка». Проверю, можно ли купить часть будущего списка дешевле."
    ].join("\n")
  );
}

export async function handlePurchasedProducts(deps: BotDeps, chatId: number, text: string): Promise<void> {
  await callService(deps.app, `${deps.inventoryServiceUrl}/items`, {
    method: "POST",
    body: {
      chatId,
      rawText: text
    }
  });

  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    "Записала покупку в инвентарь. Скоропортящиеся продукты будут первыми попадать в ближайшие блюда.",
    {
      inline_keyboard: [[{ text: "Показать инвентарь", callback_data: "show_inventory" }]]
    }
  );
}

export async function handleManualPrice(deps: BotDeps, chatId: number, text: string): Promise<void> {
  await callService(deps.app, `${deps.retailServiceUrl}/prices/manual`, {
    method: "POST",
    body: {
      chatId,
      rawText: text
    }
  });

  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    "Приняла цену. Обновлю агрегированную стоимость и учту ее в следующих списках покупок."
  );
}

export async function handleReceiptPhoto(deps: BotDeps, chatId: number, fileId: string): Promise<void> {
  await callService(deps.app, `${deps.retailServiceUrl}/prices/manual`, {
    method: "POST",
    body: {
      chatId,
      source: "receipt-photo",
      telegramFileId: fileId
    }
  });

  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    "Фото чека получила. В MVP сохраню его как источник цен, а OCR распознавание подключим отдельным шагом."
  );
}

export async function handleMealSkipped(deps: BotDeps, chatId: number, reason: string): Promise<void> {
  await callService(deps.app, `${deps.aiOrchestratorUrl}/meal-skipped`, {
    method: "POST",
    body: {
      chatId,
      reason
    }
  });

  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    "Ок, перепланировала оставшиеся приемы пищи. Свежую зелень лучше использовать завтра: добавила ее в быстрый сэндвич.",
    {
      inline_keyboard: [[{ text: "Предложить рецепт", callback_data: "suggest_recipe:expiring" }]]
    }
  );
}

export async function handleGuestsPlan(deps: BotDeps, chatId: number, text: string): Promise<void> {
  await callService(deps.app, `${deps.userProfileServiceUrl}/guests`, {
    method: "POST",
    body: {
      chatId,
      rawText: text
    }
  });

  await callService(deps.app, `${deps.aiOrchestratorUrl}/generate`, {
    method: "POST",
    body: {
      chatId,
      event: "guests-planned",
      rawText: text
    }
  });

  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    [
      "Гостей учла.",
      "На нужный прием пищи увеличу порции, спрошу ограничения гостей и пересчитаю бюджет, вес и список покупок.",
      "Если гости вегетарианцы или есть аллергии, напиши это отдельным сообщением."
    ].join("\n")
  );
}

export async function handleDishWish(deps: BotDeps, chatId: number, text: string): Promise<void> {
  await callService(deps.app, `${deps.aiOrchestratorUrl}/generate`, {
    method: "POST",
    body: {
      chatId,
      event: "dish-wish",
      rawText: text
    }
  });

  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    "Поняла пожелание. Проверю блюдо по бюджету, технике и zero-waste, затем заменю подходящий прием пищи."
  );
}

export async function handleIngredientReplacement(deps: BotDeps, chatId: number, text: string): Promise<void> {
  await callService(deps.app, `${deps.recipeServiceUrl}/substitutions`, {
    method: "POST",
    body: {
      chatId,
      rawText: text
    }
  });

  await callService(deps.app, `${deps.aiOrchestratorUrl}/generate`, {
    method: "POST",
    body: {
      chatId,
      event: "ingredient-replacement",
      rawText: text
    }
  });

  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    "Замену приняла. Проверю, куплен ли старый ингредиент, найду ему другое применение и обновлю рецепт со списком покупок."
  );
}

export async function handleCookedMeal(deps: BotDeps, chatId: number, text: string): Promise<void> {
  await callService(deps.app, `${deps.inventoryServiceUrl}/consume`, {
    method: "POST",
    body: {
      chatId,
      rawText: text
    }
  });

  await callService(deps.app, `${deps.userProfileServiceUrl}/profiles`, {
    method: "POST",
    body: {
      chatId,
      event: "meal-cooked",
      rawText: text
    }
  });

  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    "Отметила приготовление. Списала ингредиенты по сроку годности: сначала те, которые портятся раньше."
  );
}

export async function handleUnexpectedStoreVisit(deps: BotDeps, chatId: number, text: string): Promise<void> {
  await callService(deps.app, `${deps.logisticsServiceUrl}/routes/unexpected-store`, {
    method: "POST",
    body: {
      chatId,
      rawText: text,
      lastLocation: deps.lastLocations.get(chatId)
    }
  });

  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    "Проверила будущий список. Если тут дешевле гречка или курица, можно купить сейчас, а маршрут на неделю я пересоберу."
  );
}

export async function suggestRecipe(deps: BotDeps, chatId: number, text: string): Promise<void> {
  await callService(deps.app, `${deps.recipeServiceUrl}/recipes/search-by-leftovers`, {
    method: "POST",
    body: {
      chatId,
      rawText: text
    }
  });

  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    [
      "Быстрый вариант из остатков:",
      "Омлет с молоком и зеленью.",
      "Время: 12 минут. Техника: плита или микроволновка. Использует молоко, которое скоро истекает."
    ].join("\n"),
    {
      inline_keyboard: [[{ text: "Я приготовил(а)", callback_data: "mark_cooked" }]]
    }
  );
}

export async function showInventory(deps: BotDeps, chatId: number): Promise<void> {
  await callService(deps.app, `${deps.inventoryServiceUrl}/remaining?chatId=${chatId}`, {
    method: "GET"
  });

  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    [
      "Текущий инвентарь:",
      "- молоко: 200 мл, использовать до завтра",
      "- курица: 300 г, использовать в течение 3 дней",
      "- зелень: 1 пучок, лучше использовать завтра",
      "",
      "Напиши «предложи рецепт», если хочешь использовать истекающие продукты."
    ].join("\n"),
    {
      inline_keyboard: [[{ text: "Предложить рецепт", callback_data: "suggest_recipe:expiring" }]]
    }
  );
}

export async function showWeeklySummary(deps: BotDeps, chatId: number): Promise<void> {
  await callService(deps.app, `${deps.aiOrchestratorUrl}/generate`, {
    method: "POST",
    body: {
      chatId,
      event: "weekly-summary"
    }
  });

  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    [
      "Сводка недели:",
      "- приготовлено: 9 приемов пищи",
      "- сэкономлено: примерно 850 руб.",
      "- спасено от мусорки: молоко, зелень, часть курицы",
      "- серия готовки: 4 дня",
      "",
      "На следующую неделю я учту блюда, которые ты готовила чаще всего."
    ].join("\n")
  );
}

export async function sendHelp(deps: BotDeps, chatId: number): Promise<void> {
  await sendMessage(
    deps.app,
    deps.telegramBotToken,
    chatId,
    [
      "Команды SmartMenu:",
      "/start - заполнить профиль",
      "/profile - изменить ограничения",
      "/generate - получить меню на неделю",
      "/route - построить маршрут покупок",
      "/inventory - посмотреть остатки",
      "/summary - сводка недели",
      "",
      "Можно писать обычными фразами:",
      "«купила молоко 1 л, курица 500 г»",
      "«цена молоко 70 руб, Магнит»",
      "«в пятницу придут двое гостей, ужин»",
      "«хочу борщ в четверг»",
      "«замени в среду курицу на тофу»",
      "«я приготовила ужин»",
      "«пропускаю ужин»",
      "«я в магазине Пятерочка»",
      "",
      "Еще можно отправить фото чека или геолокацию."
    ].join("\n")
  );
}

export async function saveProfile(deps: BotDeps, chatId: number, profile: ProfileDraft): Promise<void> {
  await callService(deps.app, `${deps.userProfileServiceUrl}/profiles`, {
    method: "POST",
    body: {
      chatId,
      profile
    }
  });
}
