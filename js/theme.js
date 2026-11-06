// Подключается синхронно в <head>: применяет сохранённую тему до первой отрисовки,
// чтобы при тёмной теме не мелькал светлый фон.
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem('todo-list:theme');
  } catch (e) {
    /* хранилище недоступно — используем системную тему */
  }
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  }
})();
