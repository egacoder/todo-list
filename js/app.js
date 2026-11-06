import {
  addTask,
  toggleTask,
  renameTask,
  removeTask,
  clearCompleted,
  filterTasks,
  getStats,
  loadTasks,
  saveTasks,
  pluralize,
  STORAGE_KEY,
} from './store.js';

const THEME_KEY = 'todo-list:theme';
const FILTER_KEY = 'todo-list:filter';

const $ = (sel) => document.querySelector(sel);

const els = {
  form: $('#new-task-form'),
  input: $('#new-task-input'),
  list: $('#task-list'),
  template: $('#task-template'),
  empty: $('#empty-state'),
  emptyTitle: $('#empty-title'),
  emptyText: $('#empty-text'),
  filters: $('#filters'),
  footer: $('#footer'),
  itemsLeft: $('#items-left'),
  clearCompleted: $('#clear-completed'),
  progress: $('#progress'),
  progressBar: $('#progress-bar'),
  progressFill: $('#progress-fill'),
  progressLabel: $('#progress-label'),
  progressValue: $('#progress-value'),
  themeToggle: $('#theme-toggle'),
  today: $('#today'),
  toast: $('#toast'),
};

const state = {
  tasks: loadTasks(localStorage),
  filter: readPref(FILTER_KEY, ['all', 'active', 'completed'], 'all'),
  justAddedId: null,
};

/* ---------- Состояние ---------- */

function commit(nextTasks) {
  state.tasks = nextTasks;
  if (!saveTasks(localStorage, state.tasks)) {
    showToast('Не удалось сохранить: хранилище браузера недоступно');
  }
  render();
}

function readPref(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* не критично */
  }
}

/* ---------- Отрисовка ---------- */

function renderTask(task) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  node.dataset.id = task.id;
  node.classList.toggle('task--done', task.completed);
  if (task.id === state.justAddedId) node.classList.add('task--enter');

  const checkbox = node.querySelector('.checkbox__input');
  checkbox.checked = task.completed;
  checkbox.setAttribute(
    'aria-label',
    task.completed ? `Вернуть в работу: ${task.title}` : `Отметить выполненной: ${task.title}`,
  );

  // textContent — защита от XSS: пользовательский текст никогда не попадает в innerHTML
  node.querySelector('.task__title').textContent = task.title;

  const editBtn = node.querySelector('[data-action="edit"]');
  editBtn.setAttribute('aria-label', `Редактировать: ${task.title}`);
  editBtn.title = 'Редактировать';

  const deleteBtn = node.querySelector('[data-action="delete"]');
  deleteBtn.setAttribute('aria-label', `Удалить: ${task.title}`);
  deleteBtn.title = 'Удалить';

  return node;
}

function render() {
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

  // Фильтры и счётчики
  for (const btn of els.filters.querySelectorAll('[data-filter]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.filter === state.filter));
  }
  for (const badge of els.filters.querySelectorAll('[data-count]')) {
    badge.textContent = stats[badge.dataset.count === 'all' ? 'total' : badge.dataset.count];
  }

  // Прогресс
  els.progressLabel.textContent = `Выполнено ${stats.completed} из ${stats.total}`;
  els.progressValue.textContent = `${stats.progress}%`;
  els.progressFill.style.width = `${stats.progress}%`;
  els.progressBar.setAttribute('aria-valuenow', String(stats.progress));

  // Подвал
  els.itemsLeft.textContent = `Осталось ${stats.active} ${pluralize(stats.active, ['задача', 'задачи', 'задач'])}`;
  els.clearCompleted.hidden = stats.completed === 0;
}

/* ---------- Редактирование ---------- */

function startEditing(item) {
  if (item.classList.contains('task--editing')) return;
  const task = state.tasks.find((t) => t.id === item.dataset.id);
  if (!task) return;

  const title = item.querySelector('.task__title');
  const input = item.querySelector('.task__edit');
  item.classList.add('task--editing');
  title.hidden = true;
  input.hidden = false;
  input.value = task.title;
  input.setAttribute('aria-label', 'Изменить текст задачи');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  let finished = false;
  const snapshot = state.tasks;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    if (save) {
      const wasRemoved = !input.value.trim();
      commit(renameTask(state.tasks, task.id, input.value));
      if (wasRemoved) showUndoToast(task, snapshot);
    } else {
      render();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true), { once: true });
}

/* ---------- Удаление с отменой ---------- */

let toastTimer;

function showToast(message, action) {
  clearTimeout(toastTimer);
  els.toast.replaceChildren(document.createTextNode(message));
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast__action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      action.onClick();
      hideToast();
    });
    els.toast.append(btn);
  }
  els.toast.classList.add('toast--visible');
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  els.toast.classList.remove('toast--visible');
}

function showUndoToast(task, snapshot) {
  showToast(`Задача «${truncate(task.title, 28)}» удалена`, {
    label: 'Отменить',
    onClick: () => commit(snapshot),
  });
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function deleteTask(item) {
  const id = item.dataset.id;
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const snapshot = state.tasks;

  const done = () => {
    commit(removeTask(state.tasks, id));
    showUndoToast(task, snapshot);
  };

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
  item.classList.add('task--leave');
  item.addEventListener('animationend', done, { once: true });
}

/* ---------- Тема ---------- */

function currentTheme() {
  return (
    document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  writePref(THEME_KEY, next);
}

/* ---------- События ---------- */

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const before = state.tasks;
  const next = addTask(state.tasks, els.input.value);
  if (next === before) {
    els.input.value = '';
    els.form.classList.remove('new-task--shake');
    void els.form.offsetWidth; // перезапуск анимации
    els.form.classList.add('new-task--shake');
    return;
  }
  state.justAddedId = next[0].id;
  // Новая задача активна — если открыт фильтр «Выполненные», переключаемся на «Все»
  if (state.filter === 'completed') {
    state.filter = 'all';
    writePref(FILTER_KEY, state.filter);
  }
  els.input.value = '';
  commit(next);
});

els.list.addEventListener('change', (e) => {
  if (e.target.matches('[data-action="toggle"]')) {
    const id = e.target.closest('.task').dataset.id;
    commit(toggleTask(state.tasks, id));
  }
});

els.list.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const item = btn.closest('.task');
  if (btn.dataset.action === 'delete') deleteTask(item);
  if (btn.dataset.action === 'edit') startEditing(item);
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

els.clearCompleted.addEventListener('click', () => {
  const snapshot = state.tasks;
  const { completed } = getStats(snapshot);
  commit(clearCompleted(state.tasks));
  showToast(`Удалено ${completed} ${pluralize(completed, ['задача', 'задачи', 'задач'])}`, {
    label: 'Отменить',
    onClick: () => commit(snapshot),
  });
});

els.themeToggle.addEventListener('click', toggleTheme);

// Синхронизация между вкладками
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) {
    state.tasks = loadTasks(localStorage);
    render();
  }
});

/* ---------- Старт ---------- */

els.today.textContent = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
}).format(new Date());

render();
