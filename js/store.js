/**
 * Чистая бизнес-логика списка задач.
 * Функции не мутируют входные данные и не трогают DOM —
 * поэтому их легко тестировать (см. tests/store.test.js).
 */

export const STORAGE_KEY = 'todo-list:tasks:v1';
export const MAX_TITLE_LENGTH = 200;

export const FILTERS = Object.freeze({
  all: () => true,
  active: (task) => !task.completed,
  completed: (task) => task.completed,
});

function generateId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Нормализует текст задачи: убирает лишние пробелы и обрезает по длине. */
export function normalizeTitle(raw) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
}

export function createTask(title, now = Date.now()) {
  return { id: generateId(), title, completed: false, createdAt: now };
}

/** Добавляет задачу в начало списка. Пустые строки игнорируются. */
export function addTask(tasks, rawTitle) {
  const title = normalizeTitle(rawTitle);
  if (!title) return tasks;
  return [createTask(title), ...tasks];
}

export function toggleTask(tasks, id) {
  return tasks.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t));
}

/** Переименовывает задачу. Пустой текст означает удаление (как в TodoMVC). */
export function renameTask(tasks, id, rawTitle) {
  const title = normalizeTitle(rawTitle);
  if (!title) return removeTask(tasks, id);
  return tasks.map((t) => (t.id === id ? { ...t, title } : t));
}

export function removeTask(tasks, id) {
  return tasks.filter((t) => t.id !== id);
}

export function clearCompleted(tasks) {
  return tasks.filter((t) => !t.completed);
}

export function filterTasks(tasks, filter) {
  return tasks.filter(FILTERS[filter] ?? FILTERS.all);
}

export function getStats(tasks) {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.completed).length;
  return {
    total,
    completed,
    active: total - completed,
    progress: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

function isValidTask(t) {
  return (
    t !== null &&
    typeof t === 'object' &&
    typeof t.id === 'string' &&
    typeof t.title === 'string' &&
    t.title.trim() !== '' &&
    typeof t.completed === 'boolean'
  );
}

/** Разбирает сохранённые данные; повреждённые записи отбрасываются. */
export function parseTasks(json) {
  if (!json) return [];
  try {
    const data = JSON.parse(json);
    if (!Array.isArray(data)) return [];
    return data.filter(isValidTask).map((t) => ({
      id: t.id,
      title: normalizeTitle(t.title),
      completed: t.completed,
      createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
    }));
  } catch {
    return [];
  }
}

export function loadTasks(storage) {
  try {
    return parseTasks(storage.getItem(STORAGE_KEY));
  } catch {
    // localStorage может быть недоступен (приватный режим, запрет cookies)
    return [];
  }
}

/** Возвращает true при успешном сохранении. */
export function saveTasks(storage, tasks) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    return true;
  } catch {
    return false;
  }
}

/** Русское склонение: pluralize(5, ['задача', 'задачи', 'задач']) → 'задач'. */
export function pluralize(n, [one, few, many]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
