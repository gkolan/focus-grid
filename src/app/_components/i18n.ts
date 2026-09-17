/**
 * Interface copy. Shell-level strings in four languages; task data is
 * never translated. Missing keys fall back to English.
 * ponytail: only the shell/nav/dialog chrome is translated; deep settings copy
 * stays English until someone asks for a full pass.
 */
export type Lang = "en" | "es" | "de" | "fr";
export const LANGS: Array<[Lang, string]> = [["en", "English"], ["es", "Español"], ["de", "Deutsch"], ["fr", "Français"]];

const en = {
  grid: "Grid",
  focus: "Focus",
  inbox: "Inbox",
  calendar: "Calendar",
  settings: "Settings",
  addTask: "Add task",
  addATask: "Add a task",
  editTask: "Edit task",
  save: "Save",
  cancel: "Cancel",
  title: "Title",
  notes: "Notes",
  deadline: "Deadline",
  noDeadline: "No deadline",
  aDay: "A day",
  aDayAndTime: "A day & time",
  estimate: "Estimate (minutes)",
  context: "Context",
  importance: "Importance",
  startDate: "Start date",
  repeats: "Repeats",
  never: "Never",
  parent: "Part of",
  blockedBy: "Waiting on",
  assignee: "Delegated to",
  tags: "Tags",
  template: "From template",
  saveTemplate: "Save as template",
  complete: "Complete",
  reopen: "Reopen",
  block: "Block",
  unblock: "Unblock",
  archive: "Archive",
  restore: "Restore",
  tasks: "tasks",
  task: "task",
  undoLast: "Undo last change",
  bulkAdd: "Bulk add",
  search: "Search title, notes, #tag, @person",
  language: "Language",
  menu: "Menu",
  all: "All",
};
export type Key = keyof typeof en;

const es: Partial<Record<Key, string>> = {
  grid: "Cuadrícula", focus: "Enfoque", inbox: "Bandeja", calendar: "Calendario", settings: "Ajustes",
  addTask: "Añadir tarea", addATask: "Añadir una tarea", editTask: "Editar tarea", save: "Guardar", cancel: "Cancelar",
  title: "Título", notes: "Notas", deadline: "Fecha límite", noDeadline: "Sin fecha límite", aDay: "Un día", aDayAndTime: "Día y hora",
  estimate: "Estimación (minutos)", context: "Contexto", importance: "Importancia", startDate: "Fecha de inicio", repeats: "Se repite", never: "Nunca",
  parent: "Parte de", blockedBy: "Esperando a", assignee: "Delegado a", tags: "Etiquetas", template: "Desde plantilla", saveTemplate: "Guardar como plantilla",
  complete: "Completar", reopen: "Reabrir", block: "Bloquear", unblock: "Desbloquear", archive: "Archivar", restore: "Restaurar",
  tasks: "tareas", task: "tarea", undoLast: "Deshacer el último cambio", bulkAdd: "Añadir varias", search: "Buscar título, notas, #etiqueta, @persona",
  language: "Idioma", menu: "Menú", all: "Todas",
};
const de: Partial<Record<Key, string>> = {
  grid: "Raster", focus: "Fokus", inbox: "Eingang", calendar: "Kalender", settings: "Einstellungen",
  addTask: "Aufgabe hinzufügen", addATask: "Eine Aufgabe hinzufügen", editTask: "Aufgabe bearbeiten", save: "Speichern", cancel: "Abbrechen",
  title: "Titel", notes: "Notizen", deadline: "Frist", noDeadline: "Keine Frist", aDay: "Ein Tag", aDayAndTime: "Tag & Uhrzeit",
  estimate: "Schätzung (Minuten)", context: "Kontext", importance: "Wichtigkeit", startDate: "Startdatum", repeats: "Wiederholt sich", never: "Nie",
  parent: "Teil von", blockedBy: "Wartet auf", assignee: "Delegiert an", tags: "Schlagwörter", template: "Aus Vorlage", saveTemplate: "Als Vorlage speichern",
  complete: "Erledigen", reopen: "Wieder öffnen", block: "Blockieren", unblock: "Freigeben", archive: "Archivieren", restore: "Wiederherstellen",
  tasks: "Aufgaben", task: "Aufgabe", undoLast: "Letzte Änderung rückgängig", bulkAdd: "Mehrere hinzufügen", search: "Titel, Notizen, #Tag, @Person suchen",
  language: "Sprache", menu: "Menü", all: "Alle",
};
const fr: Partial<Record<Key, string>> = {
  grid: "Grille", focus: "Focus", inbox: "Boîte", calendar: "Calendrier", settings: "Réglages",
  addTask: "Ajouter une tâche", addATask: "Ajouter une tâche", editTask: "Modifier la tâche", save: "Enregistrer", cancel: "Annuler",
  title: "Titre", notes: "Notes", deadline: "Échéance", noDeadline: "Sans échéance", aDay: "Un jour", aDayAndTime: "Jour et heure",
  estimate: "Estimation (minutes)", context: "Contexte", importance: "Importance", startDate: "Date de début", repeats: "Se répète", never: "Jamais",
  parent: "Fait partie de", blockedBy: "En attente de", assignee: "Délégué à", tags: "Étiquettes", template: "Depuis un modèle", saveTemplate: "Enregistrer comme modèle",
  complete: "Terminer", reopen: "Rouvrir", block: "Bloquer", unblock: "Débloquer", archive: "Archiver", restore: "Restaurer",
  tasks: "tâches", task: "tâche", undoLast: "Annuler la dernière modification", bulkAdd: "Ajout multiple", search: "Rechercher titre, notes, #tag, @personne",
  language: "Langue", menu: "Menu", all: "Toutes",
};

const DICT: Record<Lang, Partial<Record<Key, string>>> = { en, es, de, fr };

export function translate(lang: Lang, key: Key): string {
  return DICT[lang][key] ?? en[key];
}
