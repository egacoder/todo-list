import {
  addTask,
  toggleTask,
  toggleImportant,
  setAllCompleted,
  renameTask,
  removeTask,
  clearCompleted,
  snapshotRemoval,
  restoreTasks,
  moveTask,
  filterTasks,
  getStats,
  loadTasks,
  saveTasks,
  resolveStorage,
  pluralize,
  STORAGE_KEY,
} from './store.js';
import { makeSortable } from './sortable.js';
import { celebrate } from './confetti.js';

const THEME_KEY = 'todo-list:theme';
const FILTER_KEY = 'todo-list:filter';
const TASK_FORMS = ['задача', 'задачи', 'задач'];
const THEME_COLORS = { light: '#f5f6fa', dark: '#0f1117' };

const $ = (sel) => document.querySelector(sel);

const els = {
  form: $('#new-task-form'),
  input: $('#new-task-input'),
  error: $('#new-task-error'),
  list: $('#task-list'),
  template: $('#task-template'),
  empty: $('#empty-state'),
  emptyTitle: $('#empty-title'),
  emptyText: $('#empty-text'),
  filters: $('#filters'),
  footer: $('#footer'),
  itemsLeft: $('#items-left'),
  toggleAll: $('#toggle-all'),
  clearCompleted: $('#clear-completed'),
  progress: $('#progress'),
  progressBar: $('#progress-bar'),
  progressFill: $('#progress-fill'),
  progressLabel: $('#progress-label'),
  progressValue: $('#progress-value'),
  themeToggle: $('#theme-toggle'),
  themeColor: $('#theme-color'),
  today: $('#today'),
  toast: $('#toast'),
  announcer: $('#announcer'),
};

// localStorage может быть недоступен (запрет cookies, особые режимы браузера) —
// тогда работаем в памяти и честно предупреждаем пользователя.
const { storage, persistent } = resolveStorage(() => window.localStorage);

const state = {
  tasks: loadTasks(storage),
  filter: readPref(FILTER_KEY, ['all', 'active', 'completed'], 'all'),
  justAddedId: null,
  editingId: null,
};

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const todayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

/* ---------- Состояние ---------- */

function persist(nextTasks) {
  state.tasks = nextTasks;
  if (!saveTasks(storage, state.tasks)) {
    showToast('Не удалось сохранить: в хранилище браузера закончилось место');
  }
}

function commit(nextTasks) {
  persist(nextTasks);
  render();
}

/** Как commit, но с праздником, если этим действием закрыты все задачи. */
function commitCompletion(nextTasks) {
  const before = getStats(state.tasks);
  commit(nextTasks);
  const after = getStats(state.tasks);
  if (before.active > 0 && after.active === 0 && after.total > 0) {
    celebrate();
    showToast('Все задачи выполнены! 🎉');
  }
}

function readPref(key, allowed, fallback) {
  try {
    const v = storage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    /* не критично */
  }
}

function findTask(id) {
  return state.tasks.find((t) => t.id === id);
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Сообщение для скринридеров (визуально скрыто). */
function announce(message) {
  els.announcer.textContent = '';
  requestAnimationFrame(() => {
    els.announcer.textContent = message;
  });
}

/* ---------- Отрисовка ---------- */

function renderTask(task) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  node.dataset.id = task.id;
  node.classList.toggle('task--done', task.completed);
  node.classList.toggle('task--important', task.important);
  if (task.id === state.justAddedId) node.classList.add('task--enter');

  // textContent — защита от XSS: пользовательский текст никогда не попадает в innerHTML
  const title = node.querySelector('.task__title');
  title.textContent = task.title;
  title.title = `Создано ${dateFormat.format(task.createdAt)}`;

  const checkbox = node.querySelector('.checkbox__input');
  checkbox.checked = task.completed;
  checkbox.setAttribute('aria-label', task.completed ? `Вернуть в работу: ${task.title}` : `Отметить выполненной: ${task.title}`);

  node.querySelector('.task__handle').setAttribute(
    'aria-label',
    `Переместить «${task.title}». Перетащите или используйте стрелки вверх и вниз`,
  );

  const star = node.querySelector('[data-action="important"]');
  star.setAttribute('aria-pressed', String(task.important));
  star.setAttribute('aria-label', task.important ? `Убрать из важных: ${task.title}` : `Отметить как важную: ${task.title}`);
  star.title = task.important ? 'Убрать из важных' : 'Важная задача';

  const editBtn = node.querySelector('[data-action="edit"]');
  editBtn.setAttribute('aria-label', `Редактировать: ${task.title}`);
  editBtn.title = 'Редактировать';

  const deleteBtn = node.querySelector('[data-action="delete"]');
  deleteBtn.setAttribute('aria-label', `Удалить: ${task.title}`);
  deleteBtn.title = 'Удалить';

  return node;
}

function render() {
  if (sortable.active) sortable.cancel();
  state.editingId = null;

  const visible = filterTasks(state.tasks, state.filter);
  const stats = getStats(state.tasks);

  els.list.replaceChildren(...visible.map(renderTask));
  state.justAddedId = null;

  const hasTasks = stats.total > 0;
  els.filters.hidden = !hasTasks;
  els.footer.hidden = !hasTasks;
  els.progress.hidden = !hasTasks;

  // Пустое состояние зависит от фильтра
  els.empty.hidden = visible.length > 0;
  if (!hasTasks) {
    els.emptyTitle.textContent = 'Задач пока нет';
    els.emptyText.textContent = 'Добавьте первую задачу — она сохранится даже после перезагрузки страницы.';
  } else if (state.filter === 'active') {
    els.emptyTitle.textContent = 'Всё сделано!';
    els.emptyText.textContent = 'Активных задач не осталось. Отличная работа.';
  } else {
    els.emptyTitle.textContent = 'Пока ничего не выполнено';
    els.emptyText.textContent = 'Отметьте задачу галочкой, и она появится здесь.';
  }

  for (const btn of els.filters.querySelectorAll('[data-filter]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.filter === state.filter));
  }
  for (const badge of els.filters.querySelectorAll('[data-count]')) {
    badge.textContent = stats[badge.dataset.count === 'all' ? 'total' : badge.dataset.count];
  }

  els.progressLabel.textContent = `Выполнено ${stats.completed} из ${stats.total}`;
  els.progressValue.textContent = `${stats.progress}%`;
  els.progressFill.style.width = `${stats.progress}%`;
  els.progressBar.setAttribute('aria-valuenow', String(stats.progress));
  els.progress.classList.toggle('progress--done', hasTasks && stats.active === 0);

  els.itemsLeft.textContent =
    stats.active === 0 ? 'Все задачи выполнены' : `Осталось ${stats.active} ${pluralize(stats.active, TASK_FORMS)}`;
  els.toggleAll.textContent = stats.active > 0 ? 'Отметить все' : 'Снять отметки';
  els.clearCompleted.hidden = stats.completed === 0;
}

/** Ставит фокус на элемент задачи после перерисовки (для клавиатурной навигации). */
function focusTask(id, selector = '.checkbox__input') {
  const item = id && els.list.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
  item?.querySelector(selector)?.focus();
  return Boolean(item);
}

/* ---------- Добавление ---------- */

function showInputError(message) {
  els.error.textContent = message;
  els.input.setAttribute('aria-invalid', 'true');
  els.form.classList.remove('new-task--shake');
  void els.form.offsetWidth; // перезапуск анимации
  els.form.classList.add('new-task--shake');
}

function clearInputError() {
  els.error.textContent = '';
  els.input.removeAttribute('aria-invalid');
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const next = addTask(state.tasks, els.input.value);
  if (next === state.tasks) {
    els.input.value = '';
    showInputError('Введите текст задачи');
    els.input.focus();
    return;
  }
  clearInputError();
  state.justAddedId = next[0].id;
  // Новая задача активна — если открыт фильтр «Выполненные», показываем все
  if (state.filter === 'completed') {
    state.filter = 'all';
    writePref(FILTER_KEY, state.filter);
  }
  els.input.value = '';
  commit(next);
  announce(`Задача добавлена: ${next[0].title}`);
});

els.input.addEventListener('input', clearInputError);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    els.input.value = '';
    clearInputError();
  }
});

/* ---------- Редактирование ---------- */

function startEditing(item) {
  if (item.classList.contains('task--editing')) return;
  const task = findTask(item.dataset.id);
  if (!task) return;

  const title = item.querySelector('.task__title');
  const input = item.querySelector('.task__edit');
  item.classList.add('task--editing');
  state.editingId = task.id;
  title.hidden = true;
  input.hidden = false;
  input.value = task.title;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const value = input.value;
    if (!save || !findTask(task.id)) {
      render();
      focusTask(task.id, '[data-action="edit"]');
      return;
    }
    if (!value.trim()) {
      // Пустой текст = удаление, с возможностью отмены
      const removed = snapshotRemoval(state.tasks, (t) => t.id === task.id);
      commit(removeTask(state.tasks, task.id));
      offerUndo(removed, `Задача «${truncate(task.title, 28)}» удалена`);
      els.input.focus();
      return;
    }
    commit(renameTask(state.tasks, task.id, value));
    focusTask(task.id, '[data-action="edit"]');
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true), { once: true });
}

/* ---------- Удаление и отмена ---------- */

let toastTimer;
let toastDuration = 0;
let pendingUndo = null;

function showToast(message, action, duration = 5000) {
  clearTimeout(toastTimer);
  pendingUndo = null;
  els.toast.replaceChildren(document.createTextNode(message));
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast__action';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    els.toast.append(btn);
  }
  els.toast.classList.add('toast--visible');
  toastDuration = duration;
  toastTimer = setTimeout(hideToast, duration);
}

function hideToast() {
  clearTimeout(toastTimer);
  els.toast.classList.remove('toast--visible');
  pendingUndo = null;
}

// Пока курсор или фокус на уведомлении — не прячем его (WCAG 2.2.1)
for (const [type, pause] of [['pointerenter', true], ['pointerleave', false], ['focusin', true], ['focusout', false]]) {
  els.toast.addEventListener(type, () => {
    if (!els.toast.classList.contains('toast--visible')) return;
    clearTimeout(toastTimer);
    if (!pause) toastTimer = setTimeout(hideToast, Math.min(toastDuration, 3000));
  });
}

/**
 * Показывает уведомление с кнопкой «Отменить».
 * Отмена возвращает только удалённые задачи на их места — изменения,
 * сделанные уже после удаления, сохраняются.
 */
function offerUndo(removed, message) {
  if (!removed.length) return;
  showToast(message, { label: 'Отменить', onClick: undoRemoval });
  pendingUndo = removed;
}

function undoRemoval() {
  if (!pendingUndo) return;
  const removed = pendingUndo;
  hideToast();
  commit(restoreTasks(state.tasks, removed));
  announce(`Восстановлено: ${removed.length} ${pluralize(removed.length, TASK_FORMS)}`);
  focusTask(removed[0].task.id);
}

function deleteTask(item) {
  const id = item.dataset.id;
  const task = findTask(id);
  if (!task || item.classList.contains('task--leave')) return;

  const hadFocus = item.contains(document.activeElement);
  const neighborId = (item.nextElementSibling ?? item.previousElementSibling)?.dataset.id;
  const removed = snapshotRemoval(state.tasks, (t) => t.id === id);

  // Данные меняются сразу — анимация только визуальная и не может «потерять» удаление
  persist(removeTask(state.tasks, id));
  offerUndo(removed, `Задача «${truncate(task.title, 28)}» удалена`);

  const finish = () => {
    if (!item.isConnected) return; // список уже перерисован другим действием
    render();
    if (hadFocus && !focusTask(neighborId, '[data-action="delete"]')) els.input.focus();
  };

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
  item.classList.add('task--leave');
  item.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 400); // запасной вариант, если animationend не придёт
}

/* ---------- Перемещение ---------- */

function announceMove(id) {
  const visible = filterTasks(state.tasks, state.filter);
  const position = visible.findIndex((t) => t.id === id) + 1;
  if (position > 0) announce(`Задача перемещена: позиция ${position} из ${visible.length}`);
}

function moveBy(id, delta, focusSelector) {
  const visible = filterTasks(state.tasks, state.filter);
  const index = visible.findIndex((t) => t.id === id);
  const neighbor = visible[index + delta];
  if (index < 0 || !neighbor) return;
  commit(moveTask(state.tasks, id, neighbor.id, delta > 0 ? 'after' : 'before'));
  focusTask(id, focusSelector);
  announceMove(id);
}

const sortable = makeSortable(els.list, {
  handle: '.task__handle',
  item: '.task',
  onDrop(el, anchor, place) {
    commit(moveTask(state.tasks, el.dataset.id, anchor.dataset.id, place));
    announceMove(el.dataset.id);
  },
});

els.list.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  if (e.target.matches('.task__edit')) return;
  const onHandle = e.target.matches('.task__handle');
  if (!onHandle && !e.altKey) return;
  e.preventDefault();
  const id = e.target.closest('.task').dataset.id;
  moveBy(id, e.key === 'ArrowUp' ? -1 : 1, onHandle ? '.task__handle' : '.checkbox__input');
});

/* ---------- Действия со списком ---------- */

els.list.addEventListener('change', (e) => {
  if (!e.target.matches('[data-action="toggle"]')) return;
  const id = e.target.closest('.task').dataset.id;
  commitCompletion(toggleTask(state.tasks, id));
  // При фильтре задача может исчезнуть — фокус остаётся в списке, если это возможно
  if (!focusTask(id)) els.list.querySelector('.checkbox__input')?.focus();
});

els.list.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const item = btn.closest('.task');
  switch (btn.dataset.action) {
    case 'delete':
      deleteTask(item);
      break;
    case 'edit':
      startEditing(item);
      break;
    case 'important':
      commit(toggleImportant(state.tasks, item.dataset.id));
      focusTask(item.dataset.id, '[data-action="important"]');
      break;
  }
});

els.list.addEventListener('dblclick', (e) => {
  const title = e.target.closest('.task__title');
  if (title) startEditing(title.closest('.task'));
});

els.filters.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  state.filter = btn.dataset.filter;
  writePref(FILTER_KEY, state.filter);
  render();
});

els.toggleAll.addEventListener('click', () => {
  const { active } = getStats(state.tasks);
  commitCompletion(setAllCompleted(state.tasks, active > 0));
});

els.clearCompleted.addEventListener('click', () => {
  const removed = snapshotRemoval(state.tasks, (t) => t.completed);
  commit(clearCompleted(state.tasks));
  offerUndo(removed, `Удалено: ${removed.length} ${pluralize(removed.length, TASK_FORMS)}`);
});

/* ---------- Горячие клавиши ---------- */

function isTyping(target) {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input[type="text"], textarea'));
}

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
    e.preventDefault();
    els.input.focus();
  } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && pendingUndo && !isTyping(e.target)) {
    e.preventDefault();
    undoRemoval();
  }
});

/* ---------- Тема ---------- */

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function currentTheme() {
  return document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light');
}

function syncThemeUI() {
  const theme = currentTheme();
  els.themeColor.content = THEME_COLORS[theme];
  els.themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
}

els.themeToggle.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  writePref(THEME_KEY, next);
  syncThemeUI();
});

darkQuery.addEventListener('change', syncThemeUI);

/* ---------- Синхронизация между вкладками ---------- */

window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY && e.key !== null) return;
  state.tasks = loadTasks(storage);
  // Не сбиваем редактирование: изменения применятся после его завершения
  if (!state.editingId) render();
});

/* ---------- Старт ---------- */

function updateToday() {
  els.today.textContent = todayFormat.format(new Date());
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') updateToday();
});

updateToday();
syncThemeUI();
render();
document.documentElement.classList.add('is-ready');

if (!persistent) {
  showToast('Хранилище браузера недоступно — задачи не сохранятся после перезагрузки', null, 8000);
}

// Офлайн-режим: сервис-воркер кэширует приложение
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* офлайн-режим необязателен */
    });
  });
}
