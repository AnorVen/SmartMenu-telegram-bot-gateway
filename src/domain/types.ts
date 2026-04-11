export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type TelegramMessage = {
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

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: TelegramMessage;
};

export type ProfileDraft = {
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

export type ProfileStep =
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

export type DialogState = {
  step: ProfileStep;
  profile: ProfileDraft;
};

export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};
