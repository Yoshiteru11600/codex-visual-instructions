import type { Locale } from "../types";
import { en } from "./en";
import { fr } from "./fr";
import { ja } from "./ja";
import { ru } from "./ru";

export type Messages = Record<keyof typeof en, string>;
const messages: Record<Exclude<Locale, "auto">, Messages> = { en, ja, fr, ru };

export function resolveLocale(locale: Locale, browserLocale = navigator.language): Exclude<Locale, "auto"> {
  if (locale !== "auto") return locale;
  const normalized = browserLocale.toLowerCase();
  if (normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("fr")) return "fr";
  if (normalized.startsWith("ru")) return "ru";
  return "en";
}

export function getMessages(locale: Locale, browserLocale?: string): Messages {
  return messages[resolveLocale(locale, browserLocale)];
}
