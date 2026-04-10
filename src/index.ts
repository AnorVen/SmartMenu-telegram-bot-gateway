import Fastify from "fastify";

const serviceName = process.env.SERVICE_NAME ?? "telegram-bot-gateway";
const port = Number(process.env.PORT ?? 3007);
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? "change-me";

const aiOrchestratorUrl = process.env.AI_ORCHESTRATOR_URL ?? "http://localhost:3001";
const inventoryServiceUrl = process.env.INVENTORY_SERVICE_URL ?? "http://localhost:3002";
const logisticsServiceUrl = process.env.LOGISTICS_SERVICE_URL ?? "http://localhost:3004";
const recipeServiceUrl = process.env.RECIPE_SERVICE_URL ?? "http://localhost:3005";
const retailServiceUrl = process.env.RETAIL_SERVICE_URL ?? "http://localhost:3003";
const userProfileServiceUrl = process.env.USER_PROFILE_SERVICE_URL ?? "http://localhost:3006";

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type TelegramMessage = {
  message_id: number;
  chat: {
    id: number;
  };
  text?: string;
  photo?: Array<{
    file_id: string;
    width: number;
    height: number;
  }>;
  location?: {
    latitude: number;
    longitude: number;
  };
};

type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: TelegramMessage;
};

type ProfileDraft = {
  budget?: string;
  maxWeightKg?: string;
  householdSize?: string;
  transport?: string;
  cookingTimeMinutes?: string;
  cookingSlots?: string;
  appliances?: string;
  diet?: string;
  allergies?: string;
  routeAreas?: string;
  mealsPerDay?: string;
  familyNotes?: string;
};

type DialogState = {
  step: ProfileStep;
  profile: ProfileDraft;
};

type ProfileStep =
  | "budget"
  | "maxWeightKg"
  | "householdSize"
  | "transport"
  | "cookingTimeMinutes"
  | "cookingSlots"
  | "appliances"
  | "diet"
  | "allergies"
  | "routeAreas"
  | "mealsPerDay"
  | "familyNotes";

type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

const profileSteps: Array<{
  key: ProfileStep;
  question: string;
}> = [
  {
    key: "budget",
    question: "Какой бюджет на еду в неделю? Например: 3000 руб."
  },
  {
    key: "maxWeightKg",
    question: "Сколько килограммов покупок комфортно нести за раз? Например: 3 кг."
  },
  {
    key: "householdSize",
    question: "На сколько человек планируем меню?"
  },
  {
    key: "transport",
    question: "Как обычно добираешься до магазинов: пешком, автобус, машина?"
  },
  {
    key: "cookingTimeMinutes",
    question: "Сколько времени готовки комфортно на один прием пищи? Например: 30 минут."
  },
  {
    key: "cookingSlots",
    question: "Когда удобно готовить? Например: пн, ср, сб с 15:00 до 17:30."
  },
  {
    key: "appliances",
    question: "Какая техника есть дома? Например: плита, микроволновка, без духовки."
  },
  {
    key: "diet",
    question: "Есть диета или стиль питания? Например: всеядное, вегетарианское."
  },
  {
    key: "allergies",
    question: "Есть аллергии или нежелательные продукты? Если нет, напиши: нет."
  },
  {
    key: "routeAreas",
    question: "Какие районы или маршруты удобны для покупок? Например: студгородок, центр, дорога с учебы."
  },
  {
    key: "mealsPerDay",
    question: "Сколько приемов пищи в день планировать?"
  },
  {
    key: "familyNotes",
    question: "Есть особенности семьи или участников? Например: парень не ест орехи. Если нет, напиши: нет."
  }
];

const dialogs = new Map<number, DialogState>();
const profiles = new Map<number, ProfileDraft>();
const lastLocations = new Map<number, { latitude: number; longitude: number }>();

const app = Fastify({ logger: true });

app.get("/health", async () => ({
  status: "ok",
  service: serviceName
}));

app.post<{ Body: TelegramUpdate }>("/telegram/webhook", async (request) => {
  const update = request.body;

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return { status: "accepted", service: serviceName };
  }

  if (update.message) {
    await handleMessage(update.message);
    return { status: "accepted", service: serviceName };
  }

  return {
    status: "ignored",
    service: serviceName,
    reason: "unsupported-update"
  };
});

app.post<{
  Body: {
    chatId: number;
    text: string;
    action?: "suggest_recipe" | "weekly_summary";
    payload?: unknown;
  };
}>("/notifications", async (request) => {
  const keyboard =
    request.body.action === "suggest_recipe"
      ? {
          inline_keyboard: [[{ text: "Предложить рецепт", callback_data: "suggest_recipe:expiring" }]]
        }
      : request.body.action === "weekly_summary"
        ? {
            inline_keyboard: [[{ text: "Показать сводку", callback_data: "weekly_summary" }]]
          }
        : undefined;

  await sendMessage(request.body.chatId, request.body.text, keyboard);

  return {
    status: "accepted",
    service: serviceName,
    action: "send-user-notification"
  };
});

async function handleMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;

  if (message.location) {
    await handleLocation(chatId, message.location);
    return;
  }

  if (message.photo?.length) {
    await handleReceiptPhoto(chatId, message.photo.at(-1)?.file_id ?? "unknown");
    return;
  }

  const text = message.text?.trim();

  if (!text) {
    await sendMessage(chatId, "Пока я понимаю текстовые команды, кнопки, фото чеков и геолокацию.");
    return;
  }

  if (dialogs.has(chatId) && !text.startsWith("/")) {
    await handleProfileAnswer(chatId, text);
    return;
  }

  const normalizedText = text.toLowerCase();

  if (text.startsWith("купила") || text.startsWith("купил")) {
    await handlePurchasedProducts(chatId, text);
    return;
  }

  if (normalizedText.startsWith("цена ")) {
    await handleManualPrice(chatId, text);
    return;
  }

  if (normalizedText.includes("пропускаю") || normalizedText.includes("пропустить")) {
    await handleMealSkipped(chatId, text);
    return;
  }

  if (normalizedText.includes("гости") || normalizedText.includes("придут")) {
    await handleGuestsPlan(chatId, text);
    return;
  }

  if (normalizedText.startsWith("хочу ")) {
    await handleDishWish(chatId, text);
    return;
  }

  if (normalizedText.startsWith("замени ") || normalizedText.startsWith("заменить ")) {
    await handleIngredientReplacement(chatId, text);
    return;
  }

  if (normalizedText.includes("приготов")) {
    await handleCookedMeal(chatId, text);
    return;
  }

  if (normalizedText.includes("предложи рецепт") || normalizedText.includes("предложить рецепт")) {
    await suggestRecipe(chatId, text);
    return;
  }

  if (normalizedText.includes("сводка") || normalizedText.includes("итоги недели")) {
    await showWeeklySummary(chatId);
    return;
  }

  if (normalizedText.includes("я в магазине") || normalizedText.includes("зашла в магазин") || normalizedText.includes("зашел в магазин")) {
    await handleUnexpectedStoreVisit(chatId, text);
    return;
  }

  switch (text.split(" ")[0]) {
    case "/start":
      await startOnboarding(chatId);
      return;
    case "/profile":
      await startOnboarding(chatId);
      return;
    case "/generate":
      await generateMenu(chatId);
      return;
    case "/route":
      await requestLocationForRoute(chatId);
      return;
    case "/inventory":
      await showInventory(chatId);
      return;
    case "/summary":
      await showWeeklySummary(chatId);
      return;
    case "/help":
      await sendHelp(chatId);
      return;
    default:
      await sendMessage(chatId, "Я рядом. Напиши /help, чтобы увидеть доступные команды и примеры фраз.");
  }
}

async function handleCallbackQuery(callbackQuery: TelegramCallbackQuery): Promise<void> {
  const chatId = callbackQuery.message?.chat.id;
  const data = callbackQuery.data;

  if (!chatId || !data) {
    return;
  }

  if (data === "generate_menu") {
    await generateMenu(chatId);
    return;
  }

  if (data === "build_route") {
    await requestLocationForRoute(chatId);
    return;
  }

  if (data === "show_inventory") {
    await showInventory(chatId);
    return;
  }

  if (data === "restart_profile") {
    await startOnboarding(chatId);
    return;
  }

  if (data === "weekly_summary") {
    await showWeeklySummary(chatId);
    return;
  }

  if (data === "mark_cooked") {
    await handleCookedMeal(chatId, "я приготовила текущее блюдо");
    return;
  }

  if (data === "suggest_recipe:expiring") {
    await suggestRecipe(chatId, "предложи рецепт из истекающих продуктов");
    return;
  }

  if (data.startsWith("skip_meal:")) {
    await handleMealSkipped(chatId, data.replace("skip_meal:", ""));
  }
}

async function startOnboarding(chatId: number): Promise<void> {
  const firstStep = profileSteps[0];
  dialogs.set(chatId, {
    step: firstStep.key,
    profile: {}
  });

  await sendMessage(
    chatId,
    `Привет! Я SmartMenu. Соберу ограничения и подготовлю меню без лишних покупок.\n\n${firstStep.question}`
  );
}

async function handleProfileAnswer(chatId: number, answer: string): Promise<void> {
  const dialog = dialogs.get(chatId);

  if (!dialog) {
    return;
  }

  dialog.profile[dialog.step] = answer;

  const currentStepIndex = profileSteps.findIndex((step) => step.key === dialog.step);
  const nextStep = profileSteps[currentStepIndex + 1];

  if (nextStep) {
    dialogs.set(chatId, {
      step: nextStep.key,
      profile: dialog.profile
    });
    await sendMessage(chatId, nextStep.question);
    return;
  }

  dialogs.delete(chatId);
  profiles.set(chatId, dialog.profile);
  await saveProfile(chatId, dialog.profile);

  await sendMessage(chatId, buildProfileSummary(dialog.profile), mainKeyboard());
}

async function generateMenu(chatId: number): Promise<void> {
  const profile = profiles.get(chatId);

  if (!profile) {
    await sendMessage(chatId, "Сначала нужно заполнить профиль. Напиши /start.");
    return;
  }

  await callService(`${aiOrchestratorUrl}/generate`, {
    method: "POST",
    body: {
      chatId,
      profile,
      source: "telegram-generate"
    }
  });

  await sendMessage(chatId, buildMenuResult(profile), {
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

async function requestLocationForRoute(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    "Пришли геолокацию, и я соберу маршрут по магазинам с учетом веса покупок, транспорта и привычного района."
  );
}

async function handleLocation(
  chatId: number,
  location: { latitude: number; longitude: number }
): Promise<void> {
  lastLocations.set(chatId, location);

  await callService(`${logisticsServiceUrl}/routes`, {
    method: "POST",
    body: {
      chatId,
      location,
      source: "telegram-location"
    }
  });

  await sendMessage(
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

async function handlePurchasedProducts(chatId: number, text: string): Promise<void> {
  await callService(`${inventoryServiceUrl}/items`, {
    method: "POST",
    body: {
      chatId,
      rawText: text
    }
  });

  await sendMessage(
    chatId,
    "Записала покупку в инвентарь. Скоропортящиеся продукты будут первыми попадать в ближайшие блюда.",
    {
      inline_keyboard: [[{ text: "Показать инвентарь", callback_data: "show_inventory" }]]
    }
  );
}

async function handleManualPrice(chatId: number, text: string): Promise<void> {
  await callService(`${retailServiceUrl}/prices/manual`, {
    method: "POST",
    body: {
      chatId,
      rawText: text
    }
  });

  await sendMessage(
    chatId,
    "Приняла цену. Обновлю агрегированную стоимость и учту ее в следующих списках покупок."
  );
}

async function handleReceiptPhoto(chatId: number, fileId: string): Promise<void> {
  await callService(`${retailServiceUrl}/prices/manual`, {
    method: "POST",
    body: {
      chatId,
      source: "receipt-photo",
      telegramFileId: fileId
    }
  });

  await sendMessage(
    chatId,
    "Фото чека получила. В MVP сохраню его как источник цен, а OCR распознавание подключим отдельным шагом."
  );
}

async function handleMealSkipped(chatId: number, reason: string): Promise<void> {
  await callService(`${aiOrchestratorUrl}/meal-skipped`, {
    method: "POST",
    body: {
      chatId,
      reason
    }
  });

  await sendMessage(
    chatId,
    "Ок, перепланировала оставшиеся приемы пищи. Свежую зелень лучше использовать завтра: добавила ее в быстрый сэндвич.",
    {
      inline_keyboard: [[{ text: "Предложить рецепт", callback_data: "suggest_recipe:expiring" }]]
    }
  );
}

async function handleGuestsPlan(chatId: number, text: string): Promise<void> {
  await callService(`${userProfileServiceUrl}/guests`, {
    method: "POST",
    body: {
      chatId,
      rawText: text
    }
  });

  await callService(`${aiOrchestratorUrl}/generate`, {
    method: "POST",
    body: {
      chatId,
      event: "guests-planned",
      rawText: text
    }
  });

  await sendMessage(
    chatId,
    [
      "Гостей учла.",
      "На нужный прием пищи увеличу порции, спрошу ограничения гостей и пересчитаю бюджет, вес и список покупок.",
      "Если гости вегетарианцы или есть аллергии, напиши это отдельным сообщением."
    ].join("\n")
  );
}

async function handleDishWish(chatId: number, text: string): Promise<void> {
  await callService(`${aiOrchestratorUrl}/generate`, {
    method: "POST",
    body: {
      chatId,
      event: "dish-wish",
      rawText: text
    }
  });

  await sendMessage(
    chatId,
    "Поняла пожелание. Проверю блюдо по бюджету, технике и zero-waste, затем заменю подходящий прием пищи."
  );
}

async function handleIngredientReplacement(chatId: number, text: string): Promise<void> {
  await callService(`${recipeServiceUrl}/substitutions`, {
    method: "POST",
    body: {
      chatId,
      rawText: text
    }
  });

  await callService(`${aiOrchestratorUrl}/generate`, {
    method: "POST",
    body: {
      chatId,
      event: "ingredient-replacement",
      rawText: text
    }
  });

  await sendMessage(
    chatId,
    "Замену приняла. Проверю, куплен ли старый ингредиент, найду ему другое применение и обновлю рецепт со списком покупок."
  );
}

async function handleCookedMeal(chatId: number, text: string): Promise<void> {
  await callService(`${inventoryServiceUrl}/consume`, {
    method: "POST",
    body: {
      chatId,
      rawText: text
    }
  });

  await callService(`${userProfileServiceUrl}/profiles`, {
    method: "POST",
    body: {
      chatId,
      event: "meal-cooked",
      rawText: text
    }
  });

  await sendMessage(
    chatId,
    "Отметила приготовление. Списала ингредиенты по сроку годности: сначала те, которые портятся раньше."
  );
}

async function handleUnexpectedStoreVisit(chatId: number, text: string): Promise<void> {
  await callService(`${logisticsServiceUrl}/routes`, {
    method: "POST",
    body: {
      chatId,
      event: "unexpected-store-visit",
      rawText: text,
      lastLocation: lastLocations.get(chatId)
    }
  });

  await sendMessage(
    chatId,
    "Проверила будущий список. Если тут дешевле гречка или курица, можно купить сейчас, а маршрут на неделю я пересоберу."
  );
}

async function suggestRecipe(chatId: number, text: string): Promise<void> {
  await callService(`${recipeServiceUrl}/recipes/search-by-leftovers`, {
    method: "POST",
    body: {
      chatId,
      rawText: text
    }
  });

  await sendMessage(
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

async function showInventory(chatId: number): Promise<void> {
  await callService(`${inventoryServiceUrl}/remaining?chatId=${chatId}`, {
    method: "GET"
  });

  await sendMessage(
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

async function showWeeklySummary(chatId: number): Promise<void> {
  await callService(`${aiOrchestratorUrl}/generate`, {
    method: "POST",
    body: {
      chatId,
      event: "weekly-summary"
    }
  });

  await sendMessage(
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

async function sendHelp(chatId: number): Promise<void> {
  await sendMessage(
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

async function saveProfile(chatId: number, profile: ProfileDraft): Promise<void> {
  await callService(`${userProfileServiceUrl}/profiles`, {
    method: "POST",
    body: {
      chatId,
      profile
    }
  });
}

function buildProfileSummary(profile: ProfileDraft): string {
  return [
    "Профиль собран:",
    `- бюджет: ${profile.budget}`,
    `- вес покупки: ${profile.maxWeightKg}`,
    `- человек: ${profile.householdSize}`,
    `- транспорт: ${profile.transport}`,
    `- время готовки: ${profile.cookingTimeMinutes}`,
    `- слоты готовки: ${profile.cookingSlots}`,
    `- техника: ${profile.appliances}`,
    `- питание: ${profile.diet}`,
    `- аллергии: ${profile.allergies}`,
    `- удобные районы: ${profile.routeAreas}`,
    `- приемов пищи в день: ${profile.mealsPerDay}`,
    `- семья: ${profile.familyNotes}`,
    "",
    "Теперь можно генерировать меню."
  ].join("\n");
}

function buildMenuResult(profile: ProfileDraft): string {
  return [
    "Меню на неделю готово:",
    "",
    "Пн: овсянка с молоком, гречка с курицей и салатом.",
    "Вт: омлет с зеленью, суп с курицей.",
    "Ср: рис с овощами, быстрый сэндвич с остатками зелени.",
    "",
    `Держу бюджет около ${profile.budget}, вес закупки около ${profile.maxWeightKg}, техника: ${profile.appliances}.`,
    "Список покупок разбит по дням, чтобы скоропортящиеся продукты использовались первыми."
  ].join("\n");
}

function mainKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "Сгенерировать меню", callback_data: "generate_menu" },
        { text: "Маршрут покупок", callback_data: "build_route" }
      ],
      [
        { text: "Инвентарь", callback_data: "show_inventory" },
        { text: "Сводка недели", callback_data: "weekly_summary" }
      ],
      [{ text: "Заполнить заново", callback_data: "restart_profile" }]
    ]
  };
}

async function callService(
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

async function sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboard): Promise<void> {
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

await app.listen({ host: "0.0.0.0", port });
