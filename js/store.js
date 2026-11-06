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
  return { id: generateId(), title, completed: false, important: false, createdAt: now };
}

/** Добавляет задачу в начало списка. Пустые строки игнорируются. */
export function addTask(tasks, rawTitle) {
  const title = normalizeTitle(rawTitle);
  if (!title) return tasks;
  return [createTask(title), ...tasks];
}

function updateTask(tasks, id, patch) {
  return tasks.map((t) => (t.id === id ? { ...t, ...patch(t) } : t));
}

export function toggleTask(tasks, id) {
  return updateTask(tasks, id, (t) => ({ completed: !t.completed }));
}

export function toggleImportant(tasks, id) {
  return updateTask(tasks, id, (t) => ({ important: !t.important }));
}

/** Отмечает все задачи выполненными (или снимает отметку со всех). */
export function setAllCompleted(tasks, completed) {
  return tasks.map((t) => (t.completed === completed ? t : { ...t, completed }));
}

/** Переименовывает задачу. Пустой текст означает удаление (как в TodoMVC). */
export function renameTask(tasks, id, rawTitle) {
  const title = normalizeTitle(rawTitle);
  if (!title) return removeTask(tasks, id);
  return updateTask(tasks, id, () => ({ title }));
}

export function removeTask(tasks, id) {
  return tasks.filter((t) => t.id !== id);
}

export function clearCompleted(tasks) {
  return tasks.filter((t) => !t.completed);
}

/**
 * Запоминает, какие задачи будут удалены и между какими соседями они стояли,
 * чтобы потом точечно вернуть их на место (см. restoreTasks).
 */
export function snapshotRemoval(tasks, predicate) {
  return tasks.flatMap((task, index) =>
    predicate(task)
      ? [{ task, index, prevId: tasks[index - 1]?.id ?? null, nextId: tasks[index + 1]?.id ?? null }]
      : [],
  );
}

/**
 * Возвращает удалённые задачи на прежние места, не трогая изменения,
 * сделанные после удаления. Место ищется по соседям (после прежнего
 * предыдущего или перед прежним следующим), а если их уже нет — по индексу.
 * Уже существующие id пропускаются.
 */
export function restoreTasks(tasks, removed) {
  const result = [...tasks];
  const ids = new Set(tasks.map((t) => t.id));
  for (const { task, index, prevId, nextId } of [...removed].sort((a, b) => a.index - b.index)) {
    if (ids.has(task.id)) continue;
    let at = Math.min(index, result.length);
    if (prevId && ids.has(prevId)) at = result.findIndex((t) => t.id === prevId) + 1;
    else if (nextId && ids.has(nextId)) at = result.findIndex((t) => t.id === nextId);
    result.splice(at, 0, task);
    ids.add(task.id);
  }
  return result;
}

/**
 * Перемещает задачу id до или после задачи targetId.
 * Работает по id, а не по индексам — поэтому корректно и в отфильтрованном виде.
 */
export function moveTask(tasks, id, targetId, place = 'before') {
  if (id === targetId) return tasks;
  const task = tasks.find((t) => t.id === id);
  if (!task || !tasks.some((t) => t.id === targetId)) return tasks;
  const rest = tasks.filter((t) => t.id !== id);
  const targetIndex = rest.findIndex((t) => t.id === targetId);
  rest.splice(place === 'after' ? targetIndex + 1 : targetIndex, 0, task);
  return rest;
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
    t.id !== '' &&
    typeof t.title === 'string' &&
    t.title.trim() !== '' &&
    typeof t.completed === 'boolean'
  );
}

/** Разбирает сохранённые данные; повреждённые записи и дубликаты отбрасываются. */
export function parseTasks(json) {
  if (!json) return [];
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const seen = new Set();
  const tasks = [];
  for (const t of data) {
    if (!isValidTask(t) || seen.has(t.id)) continue;
    seen.add(t.id);
    tasks.push({
      id: t.id,
      title: normalizeTitle(t.title),
      completed: t.completed,
      important: t.important === true,
      createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
    });
  }
  return tasks;
}

export function loadTasks(storage) {
  try {
    return parseTasks(storage.getItem(STORAGE_KEY));
  } catch {
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

/** Хранилище в памяти — запасной вариант, когда localStorage недоступен. */
export function createMemoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
}

/**
 * Безопасно получает localStorage. В некоторых браузерах при запрете cookies
 * даже обращение к window.localStorage выбрасывает SecurityError.
 */
export function resolveStorage(getNative) {
  try {
    const storage = getNative();
    const probe = '__todo-list-probe__';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return { storage, persistent: true };
  } catch {
    return { storage: createMemoryStorage(), persistent: false };
  }
}

/** Русское склонение: pluralize(5, ['задача', 'задачи', 'задач']) → 'задач'. */
export function pluralize(n, [one, few, many]) {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
