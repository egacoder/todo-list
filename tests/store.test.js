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
