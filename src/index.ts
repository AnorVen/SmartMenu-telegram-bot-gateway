import Fastify from "fastify";
import { buildProfileSummary, dialogs, mainKeyboard, profileSteps, profiles, lastLocations } from "./application/dialog-state.js";
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "./domain/types.js";
import {
  type BotDeps,
  generateMenu,
  handleCookedMeal,
  handleDishWish,
  handleGuestsPlan,
  handleIngredientReplacement,
  handleLocation,
  handleManualPrice,
  handleMealSkipped,
  handlePurchasedProducts,
  handleReceiptPhoto,
  handleUnexpectedStoreVisit,
  requestLocationForRoute,
  saveProfile,
  sendHelp,
  showInventory,
  showWeeklySummary,
  suggestRecipe
} from "./application/bot-actions.js";
import { sendMessage as sendTelegramMessage } from "./infrastructure/clients/service-client.js";

const serviceName = process.env.SERVICE_NAME ?? "telegram-bot-gateway";
const port = Number(process.env.PORT ?? 3007);
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? "change-me";

const aiOrchestratorUrl = process.env.AI_ORCHESTRATOR_URL ?? "http://localhost:3001";
const inventoryServiceUrl = process.env.INVENTORY_SERVICE_URL ?? "http://localhost:3002";
const logisticsServiceUrl = process.env.LOGISTICS_SERVICE_URL ?? "http://localhost:3004";
const recipeServiceUrl = process.env.RECIPE_SERVICE_URL ?? "http://localhost:3005";
const retailServiceUrl = process.env.RETAIL_SERVICE_URL ?? "http://localhost:3003";
const userProfileServiceUrl = process.env.USER_PROFILE_SERVICE_URL ?? "http://localhost:3006";

const app = Fastify({ logger: true });

const deps: BotDeps = {
  app,
  telegramBotToken,
  aiOrchestratorUrl,
  inventoryServiceUrl,
  logisticsServiceUrl,
  recipeServiceUrl,
  retailServiceUrl,
  userProfileServiceUrl,
  profiles,
  lastLocations
};

async function sendMessage(chatId: number, text: string, replyMarkup?: { inline_keyboard: { text: string; callback_data: string }[][] }): Promise<void> {
  await sendTelegramMessage(app, telegramBotToken, chatId, text, replyMarkup);
}

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
    await handleLocation(deps, chatId, message.location);
    return;
  }

  if (message.photo?.length) {
    await handleReceiptPhoto(deps, chatId, message.photo.at(-1)?.file_id ?? "unknown");
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
    await handlePurchasedProducts(deps, chatId, text);
    return;
  }

  if (normalizedText.startsWith("цена ")) {
    await handleManualPrice(deps, chatId, text);
    return;
  }

  if (normalizedText.includes("пропускаю") || normalizedText.includes("пропустить")) {
    await handleMealSkipped(deps, chatId, text);
    return;
  }

  if (normalizedText.includes("гости") || normalizedText.includes("придут")) {
    await handleGuestsPlan(deps, chatId, text);
    return;
  }

  if (normalizedText.startsWith("хочу ")) {
    await handleDishWish(deps, chatId, text);
    return;
  }

  if (normalizedText.startsWith("замени ") || normalizedText.startsWith("заменить ")) {
    await handleIngredientReplacement(deps, chatId, text);
    return;
  }

  if (normalizedText.includes("приготов")) {
    await handleCookedMeal(deps, chatId, text);
    return;
  }

  if (normalizedText.includes("предложи рецепт") || normalizedText.includes("предложить рецепт")) {
    await suggestRecipe(deps, chatId, text);
    return;
  }

  if (normalizedText.includes("сводка") || normalizedText.includes("итоги недели")) {
    await showWeeklySummary(deps, chatId);
    return;
  }

  if (normalizedText.includes("я в магазине") || normalizedText.includes("зашла в магазин") || normalizedText.includes("зашел в магазин")) {
    await handleUnexpectedStoreVisit(deps, chatId, text);
    return;
  }

  switch (text.split(" ")[0]) {
    case "/start":
    case "/profile":
      await startOnboarding(chatId);
      return;
    case "/generate":
      await generateMenu(deps, chatId);
      return;
    case "/route":
      await requestLocationForRoute(deps, chatId);
      return;
    case "/inventory":
      await showInventory(deps, chatId);
      return;
    case "/summary":
      await showWeeklySummary(deps, chatId);
      return;
    case "/help":
      await sendHelp(deps, chatId);
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
    await generateMenu(deps, chatId);
    return;
  }

  if (data === "build_route") {
    await requestLocationForRoute(deps, chatId);
    return;
  }

  if (data === "show_inventory") {
    await showInventory(deps, chatId);
    return;
  }

  if (data === "restart_profile") {
    await startOnboarding(chatId);
    return;
  }

  if (data === "weekly_summary") {
    await showWeeklySummary(deps, chatId);
    return;
  }

  if (data === "mark_cooked") {
    await handleCookedMeal(deps, chatId, "я приготовила текущее блюдо");
    return;
  }

  if (data === "suggest_recipe:expiring") {
    await suggestRecipe(deps, chatId, "предложи рецепт из истекающих продуктов");
    return;
  }

  if (data.startsWith("skip_meal:")) {
    await handleMealSkipped(deps, chatId, data.replace("skip_meal:", ""));
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
  await saveProfile(deps, chatId, dialog.profile);

  await sendMessage(chatId, buildProfileSummary(dialog.profile), mainKeyboard());
}

await app.listen({ host: "0.0.0.0", port });
