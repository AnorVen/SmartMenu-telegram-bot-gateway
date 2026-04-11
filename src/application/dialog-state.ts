import type { DialogState, InlineKeyboard, ProfileDraft, ProfileStep } from "../domain/types.js";

export const profileSteps: Array<{
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

export const dialogs = new Map<number, DialogState>();
export const profiles = new Map<number, ProfileDraft>();
export const lastLocations = new Map<number, { latitude: number; longitude: number }>();

export function buildProfileSummary(profile: ProfileDraft): string {
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

export function buildMenuResult(profile: ProfileDraft): string {
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

export function mainKeyboard(): InlineKeyboard {
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
