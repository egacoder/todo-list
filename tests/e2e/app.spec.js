import { test as base, expect } from '@playwright/test';

/** Каждый тест дополнительно проверяет, что в консоли нет ошибок. */
const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await use(page);
    expect(errors, 'ошибки в консоли').toEqual([]);
  },
});

const STORAGE_KEY = 'todo-list:tasks:v1';
const task = (page, title) => page.locator('.task', { has: page.locator('.task__title', { hasText: title }) });
const titles = (page) => page.locator('.task__title').allTextContents();

async function add(page, ...items) {
  for (const t of items) {
    await page.getByPlaceholder('Что нужно сделать?').fill(t);
    await page.keyboard.press('Enter');
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test.describe('основной функционал', () => {
  test('пустое состояние', async ({ page }) => {
    await expect(page.getByText('Задач пока нет')).toBeVisible();
    await expect(page.locator('#footer')).toBeHidden();
  });

  test('добавление: Enter и кнопка, новые сверху', async ({ page }) => {
    await add(page, 'Первая');
    await page.getByPlaceholder('Что нужно сделать?').fill('Вторая');
    await page.getByRole('button', { name: 'Добавить задачу' }).click();
    expect(await titles(page)).toEqual(['Вторая', 'Первая']);
    await expect(page.getByPlaceholder('Что нужно сделать?')).toHaveValue('');
  });

  test('пустой ввод не добавляет задачу и показывает подсказку', async ({ page }) => {
    await add(page, '    ');
    await expect(page.locator('.task')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveText('Введите текст задачи');
    await page.getByPlaceholder('Что нужно сделать?').pressSequentially('а');
    await expect(page.getByRole('alert')).toHaveText('');
  });

  test('отметка выполненной и возврат в работу', async ({ page }) => {
    await add(page, 'Задача');
    await task(page, 'Задача').locator('.checkbox').click();
    await expect(task(page, 'Задача')).toHaveClass(/task--done/);
    await expect(page.locator('#items-left')).toHaveText('Все задачи выполнены');
    await task(page, 'Задача').locator('.checkbox').click();
    await expect(task(page, 'Задача')).not.toHaveClass(/task--done/);
    await expect(page.locator('#items-left')).toHaveText('Осталось 1 задача');
  });

  test('удаление и отмена', async ({ page }) => {
    await add(page, 'A', 'B', 'C');
    await task(page, 'B').getByRole('button', { name: 'Удалить: B' }).click();
    await expect(page.locator('.task')).toHaveCount(2);
    await page.getByRole('button', { name: 'Отменить' }).click();
    expect(await titles(page)).toEqual(['C', 'B', 'A']);
  });

  test('сохранение после перезагрузки', async ({ page }) => {
    await add(page, 'Остаётся', 'Выполнена');
    await task(page, 'Выполнена').locator('.checkbox').click();
    await task(page, 'Остаётся').getByRole('button', { name: /Отметить как важную/ }).click();
    await page.reload();
    expect(await titles(page)).toEqual(['Выполнена', 'Остаётся']);
    await expect(task(page, 'Выполнена')).toHaveClass(/task--done/);
    await expect(task(page, 'Остаётся')).toHaveClass(/task--important/);
  });
});

test.describe('регрессии', () => {
  test('удаление не теряется, если сразу совершить другое действие', async ({ page }) => {
    await add(page, 'A', 'B', 'C');
    await task(page, 'C').getByRole('button', { name: 'Удалить: C' }).click();
    await task(page, 'B').locator('.checkbox').click(); // во время анимации удаления
    await page.reload();
    expect(await titles(page)).toEqual(['B', 'A']);
  });

  test('отмена удаления не стирает изменения, сделанные после него', async ({ page }) => {
    await add(page, 'A', 'B');
    await task(page, 'A').getByRole('button', { name: 'Удалить: A' }).click();
    await add(page, 'Новая');
    await page.getByRole('button', { name: 'Отменить' }).click();
    expect(await titles(page)).toEqual(['Новая', 'B', 'A']);
  });

  test('работает при заблокированном localStorage', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Доступ запрещён', 'SecurityError');
        },
      });
    });
    await page.reload();
    await expect(page.locator('#toast')).toContainText('Хранилище браузера недоступно');
    await add(page, 'В памяти');
    await expect(page.locator('.task')).toHaveCount(1);
  });

  test('повреждённые данные в хранилище не ломают приложение', async ({ page }) => {
    await page.evaluate((key) => localStorage.setItem(key, '{сломано'), STORAGE_KEY);
    await page.reload();
    await expect(page.getByText('Задач пока нет')).toBeVisible();
    await add(page, 'Работает');
    await expect(page.locator('.task')).toHaveCount(1);
  });

  test('XSS: HTML в тексте задачи выводится как текст', async ({ page }) => {
    const payload = '<img src=x onerror="window.__xss=1">';
    await add(page, payload);
    await expect(page.locator('.task__title')).toHaveText(payload);
    await expect(page.locator('.task__title img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe('редактирование', () => {
  test('двойной клик, Enter сохраняет', async ({ page }) => {
    await add(page, 'Старый текст');
    await page.locator('.task__title', { hasText: 'Старый текст' }).dblclick();
    await page.getByRole('textbox', { name: 'Изменить текст задачи' }).fill('Новый текст');
    await page.keyboard.press('Enter');
    await expect(page.locator('.task__title')).toHaveText('Новый текст');
  });

  test('Esc отменяет', async ({ page }) => {
    await add(page, 'Не трогать');
    await task(page, 'Не трогать').getByRole('button', { name: /Редактировать/ }).click();
    await page.getByRole('textbox', { name: 'Изменить текст задачи' }).fill('Изменено');
    await page.keyboard.press('Escape');
    await expect(page.locator('.task__title')).toHaveText('Не трогать');
  });

  test('пустой текст удаляет задачу с возможностью отмены', async ({ page }) => {
    await add(page, 'Временная');
    await page.locator('.task__title', { hasText: 'Временная' }).dblclick();
    await page.getByRole('textbox', { name: 'Изменить текст задачи' }).fill('');
    await page.keyboard.press('Enter');
    await expect(page.locator('.task')).toHaveCount(0);
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.locator('.task__title')).toHaveText('Временная');
  });
});

test.describe('фильтры и массовые действия', () => {
  test('фильтры со счётчиками, выбор запоминается', async ({ page }) => {
    await add(page, 'A', 'B', 'C');
    await task(page, 'A').locator('.checkbox').click();
    await page.getByRole('button', { name: /Активные/ }).click();
    expect(await titles(page)).toEqual(['C', 'B']);
    await page.getByRole('button', { name: /Выполненные/ }).click();
    expect(await titles(page)).toEqual(['A']);
    await expect(page.locator('[data-count="completed"]')).toHaveText('1');
    await page.reload();
    await expect(page.getByRole('button', { name: /Выполненные/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('«Отметить все» и праздник при выполнении всех задач', async ({ page }) => {
    await add(page, 'A', 'B');
    await page.getByRole('button', { name: 'Отметить все' }).click();
    await expect(page.locator('.task--done')).toHaveCount(2);
    await expect(page.locator('#toast')).toContainText('Все задачи выполнены');
    await page.getByRole('button', { name: 'Снять отметки' }).click();
    await expect(page.locator('.task--done')).toHaveCount(0);
  });

  test('удаление выполненных с отменой', async ({ page }) => {
    await add(page, 'A', 'B', 'C');
    await task(page, 'A').locator('.checkbox').click();
    await task(page, 'C').locator('.checkbox').click();
    await page.getByRole('button', { name: 'Удалить выполненные' }).click();
    expect(await titles(page)).toEqual(['B']);
    await expect(page.locator('#toast')).toContainText('Удалено: 2 задачи');
    await page.keyboard.press('Control+z');
    expect(await titles(page)).toEqual(['C', 'B', 'A']);
  });
});

test.describe('порядок задач', () => {
  test('перетаскивание мышью', async ({ page }) => {
    await add(page, 'A', 'B', 'C'); // C, B, A
    const handle = task(page, 'C').locator('.task__handle');
    await task(page, 'C').hover();
    const from = await handle.boundingBox();
    const to = await task(page, 'A').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 5, to.y + to.height - 4, { steps: 12 });
    await page.mouse.up();
    expect(await titles(page)).toEqual(['B', 'A', 'C']);
    await page.reload();
    expect(await titles(page)).toEqual(['B', 'A', 'C']);
  });

  test('клавиатура: Alt+стрелки и стрелки на ручке', async ({ page }) => {
    await add(page, 'A', 'B', 'C'); // C, B, A
    await task(page, 'C').locator('.checkbox__input').focus();
    await page.keyboard.press('Alt+ArrowDown');
    expect(await titles(page)).toEqual(['B', 'C', 'A']);
    await expect(task(page, 'C').locator('.checkbox__input')).toBeFocused();
    await task(page, 'A').locator('.task__handle').focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect(await titles(page)).toEqual(['A', 'B', 'C']);
    await expect(page.locator('#announcer')).toHaveText('Задача перемещена: позиция 1 из 3');
  });
});

test.describe('прочее', () => {
  test('горячая клавиша / фокусирует поле ввода', async ({ page }) => {
    await page.locator('body').click();
    await page.keyboard.press('/');
    await expect(page.getByPlaceholder('Что нужно сделать?')).toBeFocused();
  });

  test('смена темы запоминается', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByRole('button', { name: 'Включить тёмную тему' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#theme-color')).toHaveAttribute('content', '#0f1117');
  });

  test('синхронизация между вкладками', async ({ page, context }) => {
    const other = await context.newPage();
    await other.goto('./');
    await add(page, 'Из первой вкладки');
    await expect(other.locator('.task__title')).toHaveText('Из первой вкладки');
  });

  test('работает офлайн', async ({ page, context }) => {
    await add(page, 'Офлайн-задача');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // теперь страница под управлением сервис-воркера
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.task__title')).toHaveText('Офлайн-задача');
    await context.setOffline(false);
  });
});

test.describe('мобильная версия @mobile', () => {
  test('без горизонтальной прокрутки, кнопки видны без наведения @mobile', async ({ page }) => {
    await add(page, 'Очень длинная задача, которая точно не поместится в одну строку на телефоне', 'Короткая');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBe(0);
    await expect(task(page, 'Короткая').getByRole('button', { name: /Удалить/ })).toHaveCSS('opacity', '1');
    await task(page, 'Короткая').getByRole('button', { name: /Удалить/ }).tap();
    await expect(page.locator('.task')).toHaveCount(1);
  });
});
