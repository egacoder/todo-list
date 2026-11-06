import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  addTask,
  toggleTask,
  renameTask,
  removeTask,
  clearCompleted,
  filterTasks,
  getStats,
  parseTasks,
  loadTasks,
  saveTasks,
  normalizeTitle,
  pluralize,
  toggleImportant,
  setAllCompleted,
  snapshotRemoval,
  restoreTasks,
  moveTask,
  createMemoryStorage,
  resolveStorage,
  STORAGE_KEY,
  MAX_TITLE_LENGTH,
} from '../js/store.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    data,
  };
}

describe('addTask', () => {
  test('добавляет задачу в начало списка', () => {
    const a = addTask([], 'Первая');
    const b = addTask(a, 'Вторая');
    assert.equal(b.length, 2);
    assert.equal(b[0].title, 'Вторая');
    assert.equal(b[0].completed, false);
    assert.equal(typeof b[0].id, 'string');
  });

  test('игнорирует пустые строки и пробелы', () => {
    const tasks = [];
    assert.equal(addTask(tasks, ''), tasks);
    assert.equal(addTask(tasks, '   \n\t '), tasks);
  });

  test('не мутирует исходный массив', () => {
    const tasks = Object.freeze([]);
    assert.doesNotThrow(() => addTask(tasks, 'x'));
  });

  test('генерирует уникальные id', () => {
    let tasks = [];
    for (let i = 0; i < 100; i++) tasks = addTask(tasks, `t${i}`);
    assert.equal(new Set(tasks.map((t) => t.id)).size, 100);
  });
});

describe('normalizeTitle', () => {
  test('схлопывает пробелы и обрезает края', () => {
    assert.equal(normalizeTitle('  купить   хлеб  '), 'купить хлеб');
  });
  test('ограничивает длину', () => {
    assert.equal(normalizeTitle('a'.repeat(500)).length, MAX_TITLE_LENGTH);
  });
  test('безопасно обрабатывает null/undefined', () => {
    assert.equal(normalizeTitle(null), '');
    assert.equal(normalizeTitle(undefined), '');
  });
});

describe('toggle / rename / remove', () => {
  const base = addTask(addTask([], 'A'), 'B'); // [B, A]
  const [b, a] = base;

  test('toggleTask переключает только нужную задачу', () => {
    const next = toggleTask(base, a.id);
    assert.equal(next.find((t) => t.id === a.id).completed, true);
    assert.equal(next.find((t) => t.id === b.id).completed, false);
    assert.equal(toggleTask(next, a.id).find((t) => t.id === a.id).completed, false);
    assert.equal(base[1].completed, false, 'исходные данные не изменены');
  });

  test('renameTask меняет текст', () => {
    const next = renameTask(base, a.id, '  Новый   текст ');
    assert.equal(next.find((t) => t.id === a.id).title, 'Новый текст');
  });

  test('renameTask с пустым текстом удаляет задачу', () => {
    const next = renameTask(base, a.id, '   ');
    assert.equal(next.length, 1);
    assert.equal(next[0].id, b.id);
  });

  test('removeTask удаляет по id', () => {
    assert.deepEqual(removeTask(base, b.id).map((t) => t.id), [a.id]);
    assert.equal(removeTask(base, 'нет-такого').length, 2);
  });
});

describe('фильтры и статистика', () => {
  let tasks = ['1', '2', '3', '4'].reduce(addTask, []);
  tasks = toggleTask(tasks, tasks[0].id);

  test('filterTasks', () => {
    assert.equal(filterTasks(tasks, 'all').length, 4);
    assert.equal(filterTasks(tasks, 'active').length, 3);
    assert.equal(filterTasks(tasks, 'completed').length, 1);
    assert.equal(filterTasks(tasks, 'мусор').length, 4);
  });

  test('clearCompleted', () => {
    const next = clearCompleted(tasks);
    assert.equal(next.length, 3);
    assert.ok(next.every((t) => !t.completed));
  });

  test('getStats', () => {
    assert.deepEqual(getStats(tasks), { total: 4, completed: 1, active: 3, progress: 25 });
    assert.deepEqual(getStats([]), { total: 0, completed: 0, active: 0, progress: 0 });
  });
});

describe('сохранение в хранилище', () => {
  test('save → load возвращает те же задачи', () => {
    const storage = memoryStorage();
    let tasks = addTask(addTask([], 'A'), 'B');
    tasks = toggleTask(tasks, tasks[1].id);
    assert.equal(saveTasks(storage, tasks), true);
    assert.deepEqual(loadTasks(storage), tasks);
  });

  test('пустое хранилище → пустой список', () => {
    assert.deepEqual(loadTasks(memoryStorage()), []);
  });

  test('повреждённый JSON не ломает приложение', () => {
    assert.deepEqual(loadTasks(memoryStorage({ [STORAGE_KEY]: '{не json' })), []);
    assert.deepEqual(parseTasks('{"a":1}'), []);
  });

  test('невалидные записи отбрасываются', () => {
    const json = JSON.stringify([
      { id: '1', title: 'ok', completed: false, createdAt: 1 },
      { id: 2, title: 'плохой id', completed: false },
      { id: '3', title: '', completed: false },
      { id: '4', title: 'нет completed' },
      null,
      'строка',
    ]);
    const tasks = parseTasks(json);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, '1');
  });

  test('недоступное хранилище обрабатывается без исключений', () => {
    const broken = {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('QuotaExceededError'); },
    };
    assert.deepEqual(loadTasks(broken), []);
    assert.equal(saveTasks(broken, []), false);
  });
});

describe('pluralize', () => {
  const forms = ['задача', 'задачи', 'задач'];
  for (const [n, expected] of [
    [0, 'задач'], [1, 'задача'], [2, 'задачи'], [4, 'задачи'], [5, 'задач'],
    [11, 'задач'], [12, 'задач'], [14, 'задач'], [21, 'задача'], [22, 'задачи'], [111, 'задач'],
  ]) {
    test(`${n} ${expected}`, () => assert.equal(pluralize(n, forms), expected));
  }
});

describe('важные задачи и «отметить все»', () => {
  const tasks = ['A', 'B', 'C'].reduce(addTask, []);

  test('toggleImportant', () => {
    const next = toggleImportant(tasks, tasks[1].id);
    assert.equal(next[1].important, true);
    assert.equal(toggleImportant(next, tasks[1].id)[1].important, false);
    assert.equal(next[0].important, false);
  });

  test('setAllCompleted', () => {
    const all = setAllCompleted(tasks, true);
    assert.ok(all.every((t) => t.completed));
    assert.ok(setAllCompleted(all, false).every((t) => !t.completed));
  });

  test('setAllCompleted не пересоздаёт неизменённые задачи', () => {
    const next = setAllCompleted(tasks, false);
    assert.ok(next.every((t, i) => t === tasks[i]));
  });
});

describe('точечная отмена удаления', () => {
  const tasks = ['A', 'B', 'C', 'D'].reduce(addTask, []); // [D, C, B, A]
  const id = (list, title) => list.find((t) => t.title === title).id;

  test('возвращает задачу на прежнее место', () => {
    const removed = snapshotRemoval(tasks, (t) => t.title === 'B');
    const after = removeTask(tasks, id(tasks, 'B'));
    assert.deepEqual(restoreTasks(after, removed).map((t) => t.title), ['D', 'C', 'B', 'A']);
  });

  test('не теряет изменения, сделанные после удаления', () => {
    const removed = snapshotRemoval(tasks, (t) => t.title === 'C');
    let after = removeTask(tasks, id(tasks, 'C'));
    after = addTask(after, 'E');
    after = toggleTask(after, id(after, 'A'));
    const restored = restoreTasks(after, removed);
    assert.deepEqual(restored.map((t) => t.title), ['E', 'D', 'C', 'B', 'A']);
    assert.equal(restored.find((t) => t.title === 'A').completed, true);
  });

  test('восстанавливает несколько задач (очистка выполненных)', () => {
    let list = toggleTask(tasks, id(tasks, 'D'));
    list = toggleTask(list, id(list, 'B'));
    const removed = snapshotRemoval(list, (t) => t.completed);
    const restored = restoreTasks(clearCompleted(list), removed);
    assert.deepEqual(restored.map((t) => t.title), ['D', 'C', 'B', 'A']);
  });

  test('не дублирует уже существующие задачи', () => {
    const removed = snapshotRemoval(tasks, (t) => t.title === 'A');
    assert.equal(restoreTasks(tasks, removed).length, 4);
  });

  test('индекс за пределами списка — вставка в конец', () => {
    const removed = snapshotRemoval(tasks, (t) => t.title === 'A');
    assert.deepEqual(restoreTasks([], removed).map((t) => t.title), ['A']);
  });
});

describe('moveTask', () => {
  const tasks = ['A', 'B', 'C', 'D'].reduce(addTask, []).reverse(); // [A, B, C, D]
  const [a, b, c, d] = tasks;
  const titles = (l) => l.map((t) => t.title).join('');

  test('перемещение вниз и вверх', () => {
    assert.equal(titles(moveTask(tasks, a.id, c.id, 'after')), 'BCAD');
    assert.equal(titles(moveTask(tasks, d.id, a.id, 'before')), 'DABC');
    assert.equal(titles(moveTask(tasks, b.id, d.id, 'after')), 'ACDB');
  });

  test('некорректные аргументы не меняют список', () => {
    assert.equal(moveTask(tasks, a.id, a.id), tasks);
    assert.equal(moveTask(tasks, 'нет', a.id), tasks);
    assert.equal(moveTask(tasks, a.id, 'нет'), tasks);
  });
});

describe('надёжность хранилища', () => {
  test('дубликаты id отбрасываются', () => {
    const json = JSON.stringify([
      { id: '1', title: 'первая', completed: false },
      { id: '1', title: 'дубль', completed: true },
    ]);
    const tasks = parseTasks(json);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, 'первая');
  });

  test('старые данные без поля important читаются', () => {
    const [task] = parseTasks(JSON.stringify([{ id: '1', title: 'x', completed: false, createdAt: 5 }]));
    assert.equal(task.important, false);
    assert.equal(task.createdAt, 5);
  });

  test('resolveStorage: рабочее хранилище', () => {
    const native = createMemoryStorage();
    const { storage, persistent } = resolveStorage(() => native);
    assert.equal(storage, native);
    assert.equal(persistent, true);
  });

  test('resolveStorage: запрет доступа → память', () => {
    const { storage, persistent } = resolveStorage(() => {
      throw new Error('SecurityError');
    });
    assert.equal(persistent, false);
    storage.setItem('k', 'v');
    assert.equal(storage.getItem('k'), 'v');
  });
});
