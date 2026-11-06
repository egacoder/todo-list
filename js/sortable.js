/**
 * Перетаскивание элементов списка мышью, пальцем или пером (Pointer Events).
 * Без зависимостей: перетаскиваемый элемент двигается за курсором,
 * соседние плавно расступаются, а на отпускании вызывается onDrop.
 */

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

export function makeSortable(list, { handle, item, onDrop }) {
  let drag = null;

  function start(e) {
    const handleEl = e.target.closest(handle);
    if (!handleEl || !list.contains(handleEl)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = handleEl.closest(item);
    const items = [...list.querySelectorAll(item)];
    if (items.length < 2) return;

    e.preventDefault();
    handleEl.setPointerCapture(e.pointerId);
    const index = items.indexOf(el);
    drag = {
      el,
      handleEl,
      items,
      index,
      target: index,
      rects: items.map((node) => node.getBoundingClientRect()),
      startY: e.clientY,
      pointerId: e.pointerId,
      moved: false,
    };
  }

  function move(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { rects, index, items, el } = drag;
    const dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(dy) < 4) return; // защита от случайного сдвига при клике
      drag.moved = true;
      el.classList.add('is-dragging');
      list.classList.add('is-sorting');
    }

    const own = rects[index];
    const y = clamp(dy, rects[0].top - own.top, rects.at(-1).bottom - own.bottom);
    el.style.transform = `translateY(${y}px)`;

    // Новая позиция — сколько соседей оказалось выше центра перетаскиваемого элемента.
    // Считаем по реальному сдвигу курсора (без ограничения), иначе в самый конец
    // или начало списка встать было бы нельзя.
    const center = own.top + own.height / 2 + dy;
    let target = 0;
    rects.forEach((r, i) => {
      if (i !== index && r.top + r.height / 2 < center) target++;
    });
    drag.target = target;

    items.forEach((node, i) => {
      if (i === index) return;
      let shift = 0;
      if (index < target && i > index && i <= target) shift = -own.height;
      if (index > target && i < index && i >= target) shift = own.height;
      node.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  function reset() {
    if (!drag) return;
    for (const node of drag.items) node.style.transform = '';
    drag.el.classList.remove('is-dragging');
    list.classList.remove('is-sorting');
  }

  function end(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { el, items, index, target, moved, handleEl } = drag;
    reset();
    drag = null;
    if (handleEl.hasPointerCapture?.(e.pointerId)) handleEl.releasePointerCapture(e.pointerId);
    if (!moved || target === index || e.type === 'pointercancel') return;

    // target — позиция среди остальных элементов: встаём перед others[target]
    // или, если это конец списка, после последнего
    const others = items.filter((n) => n !== el);
    if (target < others.length) onDrop(el, others[target], 'before');
    else onDrop(el, others.at(-1), 'after');
  }

  list.addEventListener('pointerdown', start);
  list.addEventListener('pointermove', move);
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);

  return {
    get active() {
      return drag !== null;
    },
    cancel() {
      reset();
      drag = null;
    },
  };
}
