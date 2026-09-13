import type { PartialDeep, VisualReviewConfig } from "../types";

export const DEFAULT_CONFIG: VisualReviewConfig = {
  version: 1,
  locale: "auto",
  shortcuts: {
    "review.toggle": "Alt+Shift+R",
    "selection.parent": "Alt+Shift+ArrowUp",
    "selection.firstChild": "Alt+Shift+ArrowDown",
    "selection.previousSibling": "Alt+Shift+ArrowLeft",
    "selection.nextSibling": "Alt+Shift+ArrowRight",
    "compare.next": "Alt+Shift+C",
  },
  review: {
    navigationPolicy: "block-all",
    defaultViewport: "desktop",
    defaultCompareMode: "side-by-side",
    scrollSync: "ratio",
  },
  privacy: { telemetry: false },
};

export function mergeConfig(
  localPreferences: PartialDeep<VisualReviewConfig> = {},
  projectConfig: PartialDeep<VisualReviewConfig> = {},
): VisualReviewConfig {
  const localReview = localPreferences.review ?? {};
  const projectReview = projectConfig.review ?? {};
  const shortcuts = Object.fromEntries(
    Object.entries({
      ...DEFAULT_CONFIG.shortcuts,
      ...localPreferences.shortcuts,
      ...projectConfig.shortcuts,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return {
    ...DEFAULT_CONFIG,
    ...localPreferences,
    ...projectConfig,
    version: 1,
    shortcuts,
    review: {
      ...DEFAULT_CONFIG.review,
      ...localReview,
      ...projectReview,
    },
    privacy: { telemetry: false },
  };
}
