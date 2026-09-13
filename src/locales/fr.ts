import type { en } from "./en";
export const fr: Record<keyof typeof en, string> = {
  title: "Instructions visuelles", start: "Démarrer la revue", stop: "Arrêter la revue",
  noSelection: "Sélectionnez un élément de la page", selected: "Élément sélectionné",
  clear: "Effacer la sélection", undo: "Annuler", redo: "Rétablir", hide: "Masquer",
  remove: "Supprimer", editText: "Remplacer le texte", applyText: "Appliquer le texte",
  comment: "Commentaire", intent: "Pourquoi ?", precision: "Précision", scope: "Portée",
  compare: "Comparer", viewport: "Fenêtre", alignLeft: "Aligner à gauche",
  equalSpacing: "Espacement égal", sessionCount: "instructions",
  requestChanges: "Demander les modifications dans Codex", editInstructions: "Modifier les instructions",
  handoffReady: "✓ Prêt pour Codex",
  removeWarning: "Cet élément peut être référencé par JavaScript, des gestionnaires d'événements, des relations ARIA, des formulaires ou l'état du framework. L'aperçu ne garantit pas le comportement après suppression. Codex doit inspecter les dépendances source avant l'implémentation.",
};
