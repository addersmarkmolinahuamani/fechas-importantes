(() => {
  'use strict';

  const STORAGE_KEY = 'fechas_importantes_v1';
  const SETTINGS_KEY = 'fechas_importantes_settings_v1';
  const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MONTHS_FULL = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  const TYPE_META = {
    birthday: {
      label: 'Cumpleaños',
      plural: 'Cumpleaños',
      emoji: '🎂',
      turnLabel: 'cumplirá',
      avatarClass: 'avatar-birthday'
    },
    anniversary: {
      label: 'Aniversario',
      plural: 'Aniversarios',
      emoji: '💍',
      turnLabel: 'cumplirán',
      avatarClass: 'avatar-anniversary'
    },
    other: {
      label: 'Fecha especial',
      plural: 'Otras fechas',
      emoji: '⭐',
      turnLabel: 'serán',
      avatarClass: 'avatar-other'
    }
  };

  /** @type {Array<object>} */
  let events = [];
  let settings = {
    theme: 'auto',
    leadDays: 3,
    notificationsEnabled: false,
    lastNotifiedDate: ''
  };

  let activeFilter = 'all';
  let searchQuery = '';
  let editingId = null;
  let currentDetailId = null;
  let clearAllArmed = false;
  let deferredInstallPrompt = null;

  const formDraft = {
    type: 'birthday',
    customLabel: '',
    emoji: '',
    photo: '',
    day: 1,
    month: 1,
    year: 1995,
    noYear: false
  };

  // DOM References
  const $ = (id) => document.getElementById(id);
  const eventsListEl = $('events-list');
  const emptyStateEl = $('empty-state');
  const emptyTitleEl = $('empty-title');
  const emptyDescEl = $('empty-desc');
  const btnLoadDemo = $('btn-load-demo');
  const headerTitleEl = $('header-title');
  const headerCountEl = $('header-count');
  const upcomingBannerEl = $('upcoming-banner');

  const filterBarEl = $('filter-bar');
  const btnFilterToggle = $('btn-filter-toggle');
  const filterBtnLabel = $('filter-btn-label');

  const searchBarEl = $('search-bar');
  const searchInputEl = $('search-input');
  const btnSearchToggle = $('btn-search-toggle');
  const btnClearSearch = $('btn-clear-search');

  const typeDialog = $('type-dialog');
  const formDialog = $('form-dialog');
  const detailDialog = $('detail-dialog');
  const backupDialog = $('backup-dialog');
  const settingsDialog = $('settings-dialog');

  const eventForm = $('event-form');
  const formDialogTitle = $('form-dialog-title');
  const inputName = $('input-name');
  const customLabelRow = $('custom-label-row');
  const inputCustomLabel = $('input-custom-label');
  const inputNoYear = $('input-no-year');
  const inputNotes = $('input-notes');
  const formErrorEl = $('form-error');
  const btnFormSubmit = $('btn-form-submit');

  const formAvatarPreview = $('form-avatar-preview');
  const emojiStrip = $('emoji-strip');
  const emojiChoices = $('emoji-choices');
  const avatarFileInput = $('avatar-file-input');
  const btnRemovePhoto = $('btn-remove-photo');

  const wheelColYear = $('wheel-col-year');
  const wheelYearLabel = $('wheel-year-label');

  const toastEl = $('toast');
  let toastTimer = null;

  // --- Date & Calculation Helpers ---

  function getTodayParts() {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate()
    };
  }

  function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  function daysInMonth(month, year) {
    if (month === 2) return isLeapYear(year) ? 29 : 28;
    if ([4, 6, 9, 11].includes(month)) return 30;
    return 31;
  }

  function pad2(num) {
    return String(num).padStart(2, '0');
  }

  function resolveDayForYear(month, day, targetYear) {
    if (month === 2 && day === 29 && !isLeapYear(targetYear)) {
      return 28;
    }
    return Math.min(day, daysInMonth(month, targetYear));
  }

  function getOccurrenceInfo(ev, today = getTodayParts()) {
    const todayUtc = Date.UTC(today.year, today.month - 1, today.day);

    let targetYear = today.year;
    let resolvedDay = resolveDayForYear(ev.month, ev.day, targetYear);
    let targetUtc = Date.UTC(targetYear, ev.month - 1, resolvedDay);

    if (targetUtc < todayUtc) {
      targetYear += 1;
      resolvedDay = resolveDayForYear(ev.month, ev.day, targetYear);
      targetUtc = Date.UTC(targetYear, ev.month - 1, resolvedDay);
    }

    const daysRemaining = Math.round((targetUtc - todayUtc) / 86400000);
    let nextAge = null;
    if (typeof ev.year === 'number' && !Number.isNaN(ev.year)) {
      nextAge = targetYear - ev.year;
    }

    return {
      daysRemaining,
      targetYear,
      nextAge
    };
  }

  function formatDisplayDate(ev) {
    const base = `${ev.day} ${MONTHS_SHORT[ev.month - 1]}`;
    return typeof ev.year === 'number' ? `${base} ${ev.year}` : base;
  }

  function formatCountdown(days) {
    if (days === 0) return '¡Es hoy! 🎉';
    if (days === 1) return '¡Mañana! (1 día)';
    return `quedan ${days} días`;
  }

  function getTypeDisplayName(ev) {
    if (ev.type === 'other' && ev.customLabel && ev.customLabel.trim()) {
      return ev.customLabel.trim();
    }
    return (TYPE_META[ev.type] || TYPE_META.other).label;
  }

  function getDefaultEmoji(ev) {
    if (ev.emoji) return ev.emoji;
    return (TYPE_META[ev.type] || TYPE_META.other).emoji;
  }

  // --- Storage ---

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          events = parsed.filter(isValidEvent);
        }
      }
    } catch {
      events = [];
    }

    try {
      const rawSettings = localStorage.getItem(SETTINGS_KEY);
      if (rawSettings) {
        settings = { ...settings, ...JSON.parse(rawSettings) };
      }
    } catch {
      // Keep default settings
    }
  }

  function saveEvents() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch {
      showToast('No se pudo guardar en el almacenamiento local');
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage error
    }
  }

  function isValidEvent(item) {
    return (
      item &&
      typeof item === 'object' &&
      typeof item.name === 'string' &&
      item.name.trim().length > 0 &&
      Number.isInteger(item.month) &&
      item.month >= 1 &&
      item.month <= 12 &&
      Number.isInteger(item.day) &&
      item.day >= 1 &&
      item.day <= 31
    );
  }

  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // --- Theme & Notifications ---

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', settings.theme || 'auto');
  }

  function updateNotificationStatusUI() {
    const statusText = $('notif-status-text');
    const btnEnable = $('btn-enable-notif');

    if (!('Notification' in window)) {
      statusText.textContent = 'Tu navegador no soporta notificaciones';
      btnEnable.disabled = true;
      btnEnable.textContent = 'No disponible';
      return;
    }

    if (Notification.permission === 'granted') {
      statusText.textContent = settings.notificationsEnabled
        ? 'Activadas (avisa al abrir el app)'
        : 'Permiso concedido (desactivadas)';
      btnEnable.textContent = settings.notificationsEnabled ? 'Desactivar' : 'Activar';
      btnEnable.disabled = false;
    } else if (Notification.permission === 'denied') {
      statusText.textContent = 'Bloqueadas en la configuración del navegador';
      btnEnable.textContent = 'Bloqueadas';
      btnEnable.disabled = true;
    } else {
      statusText.textContent = 'Recibe un aviso al abrir el app';
      btnEnable.textContent = 'Activar';
      btnEnable.disabled = false;
    }
  }

  function checkDueNotifications() {
    if (!settings.notificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }
    const today = getTodayParts();
    const todayStr = `${today.year}-${pad2(today.month)}-${pad2(today.day)}`;
    if (settings.lastNotifiedDate === todayStr) return;

    const lead = Number(settings.leadDays) || 0;
    const dueToday = [];
    const dueSoon = [];

    for (const ev of events) {
      const info = getOccurrenceInfo(ev, today);
      if (info.daysRemaining === 0) {
        dueToday.push(ev.name);
      } else if (info.daysRemaining > 0 && info.daysRemaining <= lead) {
        dueSoon.push(`${ev.name} (en ${info.daysRemaining} d)`);
      }
    }

    if (dueToday.length === 0 && dueSoon.length === 0) return;

    const lines = [];
    if (dueToday.length > 0) lines.push(`Hoy: ${dueToday.join(', ')}`);
    if (dueSoon.length > 0) lines.push(`Próximamente: ${dueSoon.join(', ')}`);

    try {
      new Notification('Fechas Importantes', {
        body: lines.join('\n'),
        icon: 'icon.svg'
      });
      settings.lastNotifiedDate = todayStr;
      saveSettings();
    } catch {
      // Ignore if notification constructor fails in restricted context
    }
  }

  // --- Toast ---

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 2600);
  }

  // --- Avatar Rendering ---

  function renderAvatarInto(container, ev) {
    container.textContent = '';
    const meta = TYPE_META[ev.type] || TYPE_META.other;
    container.className = container.className
      .split(' ')
      .filter((c) => !c.startsWith('avatar-'))
      .join(' ');
    container.classList.add(meta.avatarClass);

    if (ev.photo) {
      const img = document.createElement('img');
      img.src = ev.photo;
      img.alt = '';
      container.appendChild(img);
    } else {
      container.textContent = getDefaultEmoji(ev);
    }
  }

  // --- Main List Rendering ---

  function renderList() {
    const today = getTodayParts();
    const leadDays = Number(settings.leadDays) || 0;
    const query = searchQuery.trim().toLowerCase();

    const enriched = events.map((ev) => ({
      ev,
      info: getOccurrenceInfo(ev, today)
    }));

    // Sort by days remaining ascending, then alphabetically
    enriched.sort((a, b) => {
      if (a.info.daysRemaining !== b.info.daysRemaining) {
        return a.info.daysRemaining - b.info.daysRemaining;
      }
      return a.ev.name.localeCompare(b.ev.name, 'es');
    });

    // Count upcoming across all events for banner
    const todayEvents = enriched.filter((x) => x.info.daysRemaining === 0);
    const soonEvents = enriched.filter((x) => x.info.daysRemaining > 0 && x.info.daysRemaining <= Math.max(1, leadDays));

    if (todayEvents.length > 0) {
      const names = todayEvents.map((x) => x.ev.name).join(', ');
      upcomingBannerEl.textContent = `🎉 ¡Hoy celebras a: ${names}!`;
      upcomingBannerEl.hidden = false;
    } else if (soonEvents.length > 0 && leadDays > 0) {
      const first = soonEvents[0];
      const extra = soonEvents.length > 1 ? ` y ${soonEvents.length - 1} más` : '';
      upcomingBannerEl.textContent = `🔔 Próximo: ${first.ev.name} (${formatCountdown(first.info.daysRemaining)})${extra}`;
      upcomingBannerEl.hidden = false;
    } else {
      upcomingBannerEl.hidden = true;
    }

    // Filter by type & search query
    const filtered = enriched.filter(({ ev }) => {
      if (activeFilter !== 'all' && ev.type !== activeFilter) {
        return false;
      }
      if (!query) return true;
      const monthShort = MONTHS_SHORT[ev.month - 1];
      const monthFull = MONTHS_FULL[ev.month - 1];
      const typeLabel = getTypeDisplayName(ev).toLowerCase();
      return (
        ev.name.toLowerCase().includes(query) ||
        (ev.notes && ev.notes.toLowerCase().includes(query)) ||
        typeLabel.includes(query) ||
        monthShort.includes(query) ||
        monthFull.includes(query)
      );
    });

    // Update header title & counter
    const filterLabels = {
      all: 'Fechas importantes',
      birthday: 'Cumpleaños',
      anniversary: 'Aniversarios',
      other: 'Otras fechas'
    };
    const shortLabels = {
      all: 'Todos',
      birthday: 'Cumpleaños',
      anniversary: 'Aniversarios',
      other: 'Otros'
    };

    headerTitleEl.textContent = filterLabels[activeFilter] || 'Fechas importantes';
    filterBtnLabel.textContent = `Filtrar: ${shortLabels[activeFilter] || 'Todos'}`;
    headerCountEl.textContent =
      filtered.length === 1 ? '1 fecha' : `${filtered.length} fechas`;

    eventsListEl.textContent = '';

    if (filtered.length === 0) {
      emptyStateEl.hidden = false;
      if (events.length === 0) {
        emptyTitleEl.textContent = 'Sin fechas registradas';
        emptyDescEl.textContent =
          'Guarda cumpleaños, aniversarios y fechas especiales para saber cuántos días faltan y qué edad o año cumplen.';
        btnLoadDemo.hidden = false;
      } else {
        emptyTitleEl.textContent = 'Sin coincidencias';
        emptyDescEl.textContent =
          'No hay fechas que coincidan con tu búsqueda o filtro actual.';
        btnLoadDemo.hidden = true;
      }
      return;
    }

    emptyStateEl.hidden = true;
    const fragment = document.createDocumentFragment();

    for (const { ev, info } of filtered) {
      const li = document.createElement('li');
      const rowBtn = document.createElement('button');
      rowBtn.type = 'button';
      rowBtn.className = 'event-row';
      if (info.daysRemaining === 0) {
        rowBtn.classList.add('is-today');
      }
      rowBtn.addEventListener('click', () => openDetailDialog(ev.id));

      // Avatar
      const avatarDiv = document.createElement('div');
      avatarDiv.className = 'event-avatar';
      renderAvatarInto(avatarDiv, ev);
      rowBtn.appendChild(avatarDiv);

      // Middle Info
      const infoDiv = document.createElement('div');
      infoDiv.className = 'event-info';

      const nameLine = document.createElement('div');
      nameLine.className = 'event-name-line';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'event-name';
      nameSpan.textContent = ev.name;
      nameLine.appendChild(nameSpan);

      if (ev.type !== 'birthday') {
        const tagSpan = document.createElement('span');
        tagSpan.className = 'event-tag';
        tagSpan.textContent = getTypeDisplayName(ev);
        nameLine.appendChild(tagSpan);
      }

      const dateSpan = document.createElement('span');
      dateSpan.className = 'event-date';
      dateSpan.textContent = formatDisplayDate(ev);

      const countdownSpan = document.createElement('span');
      countdownSpan.className = 'event-countdown';
      if (info.daysRemaining === 0) {
        countdownSpan.classList.add('is-today-text');
      } else if (info.daysRemaining <= Math.max(1, leadDays)) {
        countdownSpan.classList.add('is-soon-text');
      }
      countdownSpan.textContent = formatCountdown(info.daysRemaining);

      infoDiv.appendChild(nameLine);
      infoDiv.appendChild(dateSpan);
      infoDiv.appendChild(countdownSpan);
      rowBtn.appendChild(infoDiv);

      // Right Side ("cumplirá 31")
      if (info.nextAge !== null && info.nextAge >= 0) {
        const rightDiv = document.createElement('div');
        rightDiv.className = 'event-right';

        const turnLabel = document.createElement('span');
        turnLabel.className = 'event-turn-label';
        turnLabel.textContent = (TYPE_META[ev.type] || TYPE_META.other).turnLabel;

        const turnNum = document.createElement('span');
        turnNum.className = 'event-turn-number';
        turnNum.textContent = String(info.nextAge);

        rightDiv.appendChild(turnLabel);
        rightDiv.appendChild(turnNum);
        rowBtn.appendChild(rightDiv);
      }

      li.appendChild(rowBtn);
      fragment.appendChild(li);
    }

    eventsListEl.appendChild(fragment);
  }

  // --- Wheel Date Picker ---

  const MIN_YEAR = 1900;
  function getMaxYear() {
    return new Date().getFullYear() + 50;
  }

  function clampDraftDay() {
    const refYear = formDraft.noYear ? 2000 : formDraft.year;
    const maxDay = daysInMonth(formDraft.month, refYear);
    if (formDraft.day > maxDay) {
      formDraft.day = maxDay;
    }
    if (formDraft.day < 1) {
      formDraft.day = 1;
    }
  }

  function stepWheel(kind, delta) {
    if (kind === 'day') {
      const refYear = formDraft.noYear ? 2000 : formDraft.year;
      const maxDay = daysInMonth(formDraft.month, refYear);
      formDraft.day = ((formDraft.day - 1 + delta + maxDay) % maxDay) + 1;
    } else if (kind === 'month') {
      formDraft.month = ((formDraft.month - 1 + delta + 12) % 12) + 1;
      clampDraftDay();
    } else if (kind === 'year' && !formDraft.noYear) {
      const maxYear = getMaxYear();
      formDraft.year = Math.min(maxYear, Math.max(MIN_YEAR, formDraft.year + delta));
      clampDraftDay();
    }
    renderWheel();
  }

  function renderWheel() {
    const refYear = formDraft.noYear ? 2000 : formDraft.year;
    const maxDay = daysInMonth(formDraft.month, refYear);
    const maxYear = getMaxYear();

    // Day column
    const dayCol = document.querySelector('[data-wheel="day"]');
    const prevDay = ((formDraft.day - 2 + maxDay) % maxDay) + 1;
    const nextDay = (formDraft.day % maxDay) + 1;
    dayCol.querySelector('[data-dir="-1"]').textContent = pad2(prevDay);
    dayCol.querySelector('.wheel-value').textContent = pad2(formDraft.day);
    dayCol.querySelector('[data-dir="1"]').textContent = pad2(nextDay);

    // Month column
    const monthCol = document.querySelector('[data-wheel="month"]');
    const prevMonth = ((formDraft.month - 2 + 12) % 12) + 1;
    const nextMonth = (formDraft.month % 12) + 1;
    monthCol.querySelector('[data-dir="-1"]').textContent = MONTHS_SHORT[prevMonth - 1];
    monthCol.querySelector('.wheel-value').textContent = MONTHS_SHORT[formDraft.month - 1];
    monthCol.querySelector('[data-dir="1"]').textContent = MONTHS_SHORT[nextMonth - 1];

    // Year column
    const prevYear = formDraft.year > MIN_YEAR ? String(formDraft.year - 1) : '';
    const nextYear = formDraft.year < maxYear ? String(formDraft.year + 1) : '';
    wheelColYear.querySelector('[data-dir="-1"]').textContent = prevYear;
    wheelColYear.querySelector('.wheel-value').textContent = String(formDraft.year);
    wheelColYear.querySelector('[data-dir="1"]').textContent = nextYear;

    wheelColYear.classList.toggle('is-disabled', formDraft.noYear);
    wheelYearLabel.style.opacity = formDraft.noYear ? '0.35' : '1';
  }

  function setupWheels() {
    document.querySelectorAll('.wheel-col').forEach((col) => {
      const kind = col.dataset.wheel;

      col.querySelectorAll('.wheel-step').forEach((btn) => {
        btn.addEventListener('click', () => {
          stepWheel(kind, Number(btn.dataset.dir));
        });
      });

      col.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          stepWheel(kind, e.deltaY > 0 ? 1 : -1);
        },
        { passive: false }
      );

      col.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          stepWheel(kind, -1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          stepWheel(kind, 1);
        }
      });

      // Touch drag support
      let startY = null;
      col.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') {
          startY = e.clientY;
        }
      });
      col.addEventListener('pointermove', (e) => {
        if (startY === null) return;
        const diff = e.clientY - startY;
        if (Math.abs(diff) >= 24) {
          stepWheel(kind, diff < 0 ? 1 : -1);
          startY = e.clientY;
        }
      });
      col.addEventListener('pointerup', () => {
        startY = null;
      });
      col.addEventListener('pointercancel', () => {
        startY = null;
      });
    });
  }

  // --- Form & Type Dialogs ---

  function openAddFlow() {
    editingId = null;
    typeDialog.showModal();
  }

  function updateFormAvatarUI() {
    renderAvatarInto(formAvatarPreview, {
      type: formDraft.type,
      emoji: formDraft.emoji,
      photo: formDraft.photo
    });
    btnRemovePhoto.hidden = !formDraft.photo;

    emojiChoices.querySelectorAll('.emoji-choice').forEach((btn) => {
      btn.classList.toggle('is-selected', !formDraft.photo && btn.dataset.emoji === formDraft.emoji);
    });
  }

  function openFormDialog(type, existingEvent = null) {
    formErrorEl.hidden = true;
    emojiStrip.hidden = true;

    const today = getTodayParts();

    if (existingEvent) {
      editingId = existingEvent.id;
      formDraft.type = existingEvent.type;
      formDraft.customLabel = existingEvent.customLabel || '';
      formDraft.emoji = existingEvent.emoji || '';
      formDraft.photo = existingEvent.photo || '';
      formDraft.day = existingEvent.day;
      formDraft.month = existingEvent.month;
      formDraft.noYear = typeof existingEvent.year !== 'number';
      formDraft.year = typeof existingEvent.year === 'number' ? existingEvent.year : 1995;

      formDialogTitle.textContent = `Editar ${getTypeDisplayName(existingEvent).toLowerCase()}`;
      btnFormSubmit.textContent = 'Guardar';
      inputName.value = existingEvent.name;
      inputCustomLabel.value = existingEvent.customLabel || '';
      inputNotes.value = existingEvent.notes || '';
    } else {
      editingId = null;
      formDraft.type = type;
      formDraft.customLabel = '';
      formDraft.emoji = '';
      formDraft.photo = '';
      formDraft.day = today.day;
      formDraft.month = today.month;
      formDraft.year = type === 'birthday' ? 1995 : today.year;
      formDraft.noYear = false;

      const titles = {
        birthday: 'Nuevo cumpleaños',
        anniversary: 'Nuevo aniversario',
        other: 'Nueva fecha importante'
      };
      formDialogTitle.textContent = titles[type] || 'Elegir la fecha';
      btnFormSubmit.textContent = 'Añadir';
      inputName.value = '';
      inputCustomLabel.value = '';
      inputNotes.value = '';
    }

    customLabelRow.hidden = formDraft.type !== 'other';
    inputNoYear.checked = formDraft.noYear;
    updateFormAvatarUI();
    renderWheel();

    formDialog.showModal();
    setTimeout(() => inputName.focus(), 40);
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    const name = inputName.value.trim();
    if (!name) {
      formErrorEl.textContent = 'Por favor escribe un nombre o título.';
      formErrorEl.hidden = false;
      inputName.focus();
      return;
    }

    const noYear = inputNoYear.checked;
    const payload = {
      id: editingId || generateId(),
      type: formDraft.type,
      customLabel: formDraft.type === 'other' ? inputCustomLabel.value.trim() : '',
      name,
      day: formDraft.day,
      month: formDraft.month,
      year: noYear ? null : formDraft.year,
      emoji: formDraft.emoji,
      photo: formDraft.photo,
      notes: inputNotes.value.trim()
    };

    if (editingId) {
      const idx = events.findIndex((item) => item.id === editingId);
      if (idx !== -1) {
        events[idx] = payload;
      }
      showToast('Fecha actualizada');
    } else {
      events.push(payload);
      showToast('Fecha añadida');
    }

    saveEvents();
    renderList();
    formDialog.close();
  }

  // Resize photo via Canvas so localStorage remains lightweight
  function handlePhotoUpload(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast('Selecciona una imagen válida');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 160;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;

        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        formDraft.photo = canvas.toDataURL('image/jpeg', 0.8);
        updateFormAvatarUI();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // --- Detail Dialog ---

  function buildGreetingMessage(ev, info) {
    if (ev.type === 'birthday') {
      const agePart = info.nextAge && info.nextAge > 0 ? ` por tus ${info.nextAge} años` : '';
      return `¡Feliz cumpleaños, ${ev.name}! 🎉🎂 Te deseo lo mejor${agePart}.`;
    }
    if (ev.type === 'anniversary') {
      return `¡Feliz aniversario, ${ev.name}! 💍🥂`;
    }
    return `¡Feliz ${getTypeDisplayName(ev)}, ${ev.name}! ⭐`;
  }

  function openDetailDialog(id) {
    const ev = events.find((item) => item.id === id);
    if (!ev) return;

    currentDetailId = id;
    const info = getOccurrenceInfo(ev);
    const meta = TYPE_META[ev.type] || TYPE_META.other;

    const detailAvatar = $('detail-avatar');
    detailAvatar.className = 'detail-avatar';
    renderAvatarInto(detailAvatar, ev);

    $('detail-type-badge').textContent = getTypeDisplayName(ev);
    $('detail-name').textContent = ev.name;
    $('detail-date').textContent = `${ev.day} de ${MONTHS_FULL[ev.month - 1]}${typeof ev.year === 'number' ? ` de ${ev.year}` : ''}`;
    $('detail-countdown').textContent = formatCountdown(info.daysRemaining);

    const ageCard = $('detail-age-card');
    if (info.nextAge !== null && info.nextAge >= 0) {
      ageCard.hidden = false;
      $('detail-age-label').textContent = meta.turnLabel.charAt(0).toUpperCase() + meta.turnLabel.slice(1);
      $('detail-age-value').textContent = `${info.nextAge} ${info.nextAge === 1 ? 'año' : 'años'}`;
    } else {
      ageCard.hidden = true;
    }

    const notesEl = $('detail-notes');
    if (ev.notes) {
      notesEl.textContent = `📝 ${ev.notes}`;
      notesEl.hidden = false;
    } else {
      notesEl.hidden = true;
    }

    const greeting = buildGreetingMessage(ev, info);
    $('btn-whatsapp').href = `https://wa.me/?text=${encodeURIComponent(greeting)}`;
    $('delete-confirm-box').hidden = true;

    detailDialog.showModal();
  }

  // --- Backup & ICS Export ---

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportJsonBackup() {
    if (events.length === 0) {
      showToast('No hay fechas para exportar');
      return;
    }
    const today = getTodayParts();
    const stamp = `${today.year}-${pad2(today.month)}-${pad2(today.day)}`;
    downloadFile(
      `fechas-importantes-${stamp}.json`,
      JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), events }, null, 2),
      'application/json'
    );
    showToast('Copia .json descargada');
  }

  function mergeImportedEvents(list) {
    const valid = list.filter(isValidEvent);
    if (valid.length === 0) return { added: 0, skipped: 0 };

    const existingIds = new Set(events.map((e) => e.id));
    const existingFingerprints = new Set(
      events.map((e) => `${e.name.trim().toLowerCase()}|${e.month}|${e.day}|${e.year ?? ''}`)
    );

    let added = 0;
    let skipped = 0;

    for (const item of valid) {
      const year = typeof item.year === 'number' ? item.year : null;
      const fp = `${item.name.trim().toLowerCase()}|${item.month}|${item.day}|${year ?? ''}`;
      if ((item.id && existingIds.has(item.id)) || existingFingerprints.has(fp)) {
        skipped += 1;
        continue;
      }

      const id = item.id || generateId();
      existingIds.add(id);
      existingFingerprints.add(fp);
      events.push({
        id,
        type: ['birthday', 'anniversary', 'other'].includes(item.type) ? item.type : 'other',
        customLabel: typeof item.customLabel === 'string' ? item.customLabel : '',
        name: item.name.trim(),
        day: item.day,
        month: item.month,
        year,
        emoji: typeof item.emoji === 'string' ? item.emoji : '',
        photo: typeof item.photo === 'string' ? item.photo : '',
        notes: typeof item.notes === 'string' ? item.notes : ''
      });
      added += 1;
    }

    if (added > 0) {
      saveEvents();
      renderList();
    }
    return { added, skipped };
  }

  function encodeBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeBase64Url(encoded) {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((encoded.length + 3) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function shareSyncLink() {
    if (events.length === 0) {
      showToast('No hay fechas para enviar');
      return;
    }

    // Omit large base64 photos from URL payload to keep link compact
    const compactEvents = events.map((e) => ({
      id: e.id,
      type: e.type,
      customLabel: e.customLabel || '',
      name: e.name,
      day: e.day,
      month: e.month,
      year: e.year,
      emoji: e.emoji || '',
      notes: e.notes || ''
    }));

    const encoded = encodeBase64Url(JSON.stringify(compactEvents));
    const baseUrl = `${location.origin}${location.pathname}`;
    const syncUrl = `${baseUrl}#sync=${encoded}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Mis Fechas Importantes',
          text: 'Abre este enlace en tu otro dispositivo para sincronizar tus fechas:',
          url: syncUrl
        });
        backupDialog.close();
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(syncUrl);
      backupDialog.close();
      showToast('Enlace de sincronización copiado');
    } catch {
      window.open(`https://wa.me/?text=${encodeURIComponent(syncUrl)}`, '_blank', 'noopener,noreferrer');
    }
  }

  function checkUrlSyncImport() {
    if (!location.hash.startsWith('#sync=')) return;
    const raw = location.hash.slice('#sync='.length);
    try {
      const parsed = JSON.parse(decodeBase64Url(raw));
      if (Array.isArray(parsed)) {
        const { added, skipped } = mergeImportedEvents(parsed);
        if (added > 0) {
          showToast(`${added} ${added === 1 ? 'fecha sincronizada' : 'fechas sincronizadas'}`);
        } else if (skipped > 0) {
          showToast('Tus fechas ya estaban sincronizadas');
        }
      }
    } catch {
      showToast('El enlace de sincronización no es válido');
    } finally {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
  }

  function importJsonBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const list = Array.isArray(parsed) ? parsed : parsed.events;
        if (!Array.isArray(list)) {
          showToast('Archivo JSON inválido');
          return;
        }
        const { added, skipped } = mergeImportedEvents(list);
        if (added === 0 && skipped === 0) {
          showToast('No se encontraron fechas válidas');
          return;
        }

        backupDialog.close();
        showToast(added > 0 ? `${added} fechas importadas` : 'Todas las fechas ya existían');
      } catch {
        showToast('No se pudo leer el archivo JSON');
      }
    };
    reader.readAsText(file);
  }

  function escapeIcsText(text) {
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  function exportIcsCalendar() {
    if (events.length === 0) {
      showToast('No hay fechas para exportar');
      return;
    }

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Fechas Importantes//ES',
      'CALSCALE:GREGORIAN'
    ];

    const today = getTodayParts();
    for (const ev of events) {
      const info = getOccurrenceInfo(ev, today);
      const startYear = typeof ev.year === 'number' ? ev.year : info.targetYear;
      const startDay = resolveDayForYear(ev.month, ev.day, startYear);
      const dtStart = `${startYear}${pad2(ev.month)}${pad2(startDay)}`;
      const summary = `${getDefaultEmoji(ev)} ${getTypeDisplayName(ev)}: ${ev.name}`;

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${ev.id}@fechas-importantes`);
      lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
      lines.push('RRULE:FREQ=YEARLY');
      lines.push(`SUMMARY:${escapeIcsText(summary)}`);
      if (ev.notes) {
        lines.push(`DESCRIPTION:${escapeIcsText(ev.notes)}`);
      }
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    downloadFile('fechas-importantes.ics', lines.join('\r\n'), 'text/calendar;charset=utf-8');
    showToast('Calendario .ics descargado');
  }

  // --- Demo Data ---

  function loadDemoEvents() {
    const today = getTodayParts();
    const soonDate = new Date(today.year, today.month - 1, today.day + 6);

    const demos = [
      {
        id: generateId(),
        type: 'birthday',
        customLabel: '',
        name: 'Renato Proleon',
        day: soonDate.getDate(),
        month: soonDate.getMonth() + 1,
        year: 1995,
        emoji: '🎂',
        photo: '',
        notes: 'Le gustan los libros de ciencia ficción'
      },
      {
        id: generateId(),
        type: 'birthday',
        customLabel: '',
        name: 'Baltazar Aguilar',
        day: 20,
        month: 1,
        year: 1996,
        emoji: '',
        photo: '',
        notes: ''
      },
      {
        id: generateId(),
        type: 'anniversary',
        customLabel: '',
        name: 'Aniversario de bodas',
        day: today.day,
        month: today.month,
        year: 2021,
        emoji: '💍',
        photo: '',
        notes: 'Reservar cena especial'
      },
      {
        id: generateId(),
        type: 'birthday',
        customLabel: '',
        name: 'Lesly Herrera',
        day: 23,
        month: 4,
        year: null,
        emoji: '🥳',
        photo: '',
        notes: ''
      },
      {
        id: generateId(),
        type: 'other',
        customLabel: 'Graduación',
        name: 'Graduación Universitaria',
        day: 12,
        month: 12,
        year: 2019,
        emoji: '🎓',
        photo: '',
        notes: ''
      }
    ];

    events = [...events, ...demos];
    saveEvents();
    renderList();
    showToast('Ejemplos cargados');
  }

  // --- Dialog Backdrop Light-Dismiss ---

  function setupDialogs() {
    document.querySelectorAll('dialog.holo-dialog').forEach((dlg) => {
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg) {
          dlg.close();
        }
      });
    });

    document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = $(btn.dataset.closeDialog);
        if (target) target.close();
      });
    });
  }

  // --- Event Listeners ---

  function bindEvents() {
    $('btn-add').addEventListener('click', openAddFlow);
    $('btn-empty-add').addEventListener('click', openAddFlow);
    btnLoadDemo.addEventListener('click', loadDemoEvents);

    // Type chooser
    document.querySelectorAll('.type-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        typeDialog.close();
        openFormDialog(btn.dataset.type);
      });
    });

    // Avatar & Emoji picker
    $('btn-pick-avatar').addEventListener('click', () => {
      emojiStrip.hidden = !emojiStrip.hidden;
    });

    $('btn-upload-photo').addEventListener('click', () => {
      avatarFileInput.click();
    });

    avatarFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handlePhotoUpload(file);
      avatarFileInput.value = '';
    });

    btnRemovePhoto.addEventListener('click', () => {
      formDraft.photo = '';
      updateFormAvatarUI();
    });

    emojiChoices.querySelectorAll('.emoji-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        formDraft.photo = '';
        formDraft.emoji = btn.dataset.emoji;
        updateFormAvatarUI();
      });
    });

    inputNoYear.addEventListener('change', () => {
      formDraft.noYear = inputNoYear.checked;
      clampDraftDay();
      renderWheel();
    });

    eventForm.addEventListener('submit', handleFormSubmit);

    // Filter bar
    btnFilterToggle.addEventListener('click', () => {
      const willShow = filterBarEl.hidden;
      filterBarEl.hidden = !willShow;
      btnFilterToggle.setAttribute('aria-pressed', String(willShow));
    });

    document.querySelectorAll('.filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        activeFilter = chip.dataset.filter;
        document.querySelectorAll('.filter-chip').forEach((c) => {
          const selected = c === chip;
          c.classList.toggle('is-active', selected);
          c.setAttribute('aria-selected', String(selected));
        });
        renderList();
      });
    });

    // Search bar
    btnSearchToggle.addEventListener('click', () => {
      const willShow = searchBarEl.hidden;
      searchBarEl.hidden = !willShow;
      btnSearchToggle.setAttribute('aria-pressed', String(willShow));
      if (willShow) {
        searchInputEl.focus();
      } else {
        searchQuery = '';
        searchInputEl.value = '';
        btnClearSearch.hidden = true;
        renderList();
      }
    });

    searchInputEl.addEventListener('input', () => {
      searchQuery = searchInputEl.value;
      btnClearSearch.hidden = searchQuery.length === 0;
      renderList();
    });

    btnClearSearch.addEventListener('click', () => {
      searchQuery = '';
      searchInputEl.value = '';
      btnClearSearch.hidden = true;
      searchInputEl.focus();
      renderList();
    });

    // Detail actions
    $('btn-copy-greeting').addEventListener('click', async () => {
      const ev = events.find((item) => item.id === currentDetailId);
      if (!ev) return;
      const msg = buildGreetingMessage(ev, getOccurrenceInfo(ev));
      try {
        await navigator.clipboard.writeText(msg);
        showToast('Felicitación copiada');
      } catch {
        showToast(msg);
      }
    });

    $('btn-detail-edit').addEventListener('click', () => {
      const ev = events.find((item) => item.id === currentDetailId);
      if (!ev) return;
      detailDialog.close();
      openFormDialog(ev.type, ev);
    });

    $('btn-detail-delete').addEventListener('click', () => {
      $('delete-confirm-box').hidden = false;
    });

    $('btn-cancel-delete').addEventListener('click', () => {
      $('delete-confirm-box').hidden = true;
    });

    $('btn-confirm-delete').addEventListener('click', () => {
      events = events.filter((item) => item.id !== currentDetailId);
      saveEvents();
      renderList();
      detailDialog.close();
      showToast('Fecha eliminada');
    });

    // Backup dialog
    $('btn-sync').addEventListener('click', () => backupDialog.showModal());
    $('btn-share-sync-link').addEventListener('click', shareSyncLink);
    $('btn-export-json').addEventListener('click', exportJsonBackup);
    $('import-json-input').addEventListener('change', (e) => {
      importJsonBackup(e.target.files[0]);
      e.target.value = '';
    });
    $('btn-export-ics').addEventListener('click', exportIcsCalendar);

    // Settings dialog
    $('btn-settings').addEventListener('click', () => {
      clearAllArmed = false;
      $('btn-clear-all').textContent = 'Borrar';
      $('setting-theme').value = settings.theme;
      $('setting-lead-days').value = String(settings.leadDays);
      updateNotificationStatusUI();
      updateInstallUI();
      settingsDialog.showModal();
    });

    $('btn-install').addEventListener('click', triggerInstallApp);
    $('btn-settings-install').addEventListener('click', triggerInstallApp);

    $('setting-theme').addEventListener('change', (e) => {
      settings.theme = e.target.value;
      saveSettings();
      applyTheme();
    });

    $('setting-lead-days').addEventListener('change', (e) => {
      settings.leadDays = Number(e.target.value);
      saveSettings();
      renderList();
    });

    $('btn-enable-notif').addEventListener('click', async () => {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') {
        settings.notificationsEnabled = !settings.notificationsEnabled;
        saveSettings();
        updateNotificationStatusUI();
        if (settings.notificationsEnabled) {
          settings.lastNotifiedDate = '';
          checkDueNotifications();
        }
        return;
      }

      const result = await Notification.requestPermission();
      if (result === 'granted') {
        settings.notificationsEnabled = true;
        settings.lastNotifiedDate = '';
        saveSettings();
        checkDueNotifications();
        showToast('Notificaciones activadas');
      }
      updateNotificationStatusUI();
    });

    $('btn-settings-demo').addEventListener('click', () => {
      loadDemoEvents();
      settingsDialog.close();
    });

    $('btn-clear-all').addEventListener('click', () => {
      if (events.length === 0) {
        showToast('No hay fechas para borrar');
        return;
      }
      if (!clearAllArmed) {
        clearAllArmed = true;
        $('btn-clear-all').textContent = '¿Confirmar?';
        return;
      }
      events = [];
      saveEvents();
      renderList();
      settingsDialog.close();
      showToast('Todas las fechas fueron eliminadas');
    });
  }

  // --- PWA Install ---

  function isStandaloneMode() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  function updateInstallUI() {
    const btnHeaderInstall = $('btn-install');
    const btnSettingsInstall = $('btn-settings-install');
    const statusText = $('install-status-text');

    if (isStandaloneMode()) {
      btnHeaderInstall.hidden = true;
      btnSettingsInstall.disabled = true;
      btnSettingsInstall.textContent = 'Instalada';
      statusText.textContent = 'Ya estás usando la app instalada';
      return;
    }

    if (deferredInstallPrompt) {
      btnHeaderInstall.hidden = false;
      btnSettingsInstall.disabled = false;
      btnSettingsInstall.textContent = 'Instalar';
      statusText.textContent = 'Lista para instalar en este dispositivo';
      return;
    }

    btnHeaderInstall.hidden = true;
    btnSettingsInstall.disabled = false;
    btnSettingsInstall.textContent = 'Cómo instalar';
    statusText.textContent = 'Úsala como app nativa en laptop o celular';
  }

  async function triggerInstallApp() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      updateInstallUI();
      if (choice.outcome === 'accepted') {
        showToast('Aplicación instalada');
      }
      return;
    }

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      showToast('En Safari: pulsa Compartir ↑ y "Añadir a pantalla de inicio"');
    } else if (!location.protocol.startsWith('http')) {
      showToast('Abre la app desde su enlace web (GitHub Pages) para instalarla');
    } else {
      showToast('En el menú del navegador (⋮), elige "Instalar aplicación"');
    }
  }

  function setupPwaInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      updateInstallUI();
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      updateInstallUI();
      showToast('Aplicación instalada en tu dispositivo');
    });

    updateInstallUI();
  }

  // --- Init ---

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  loadState();
  applyTheme();
  setupWheels();
  setupDialogs();
  bindEvents();
  setupPwaInstall();
  checkUrlSyncImport();
  renderList();
  checkDueNotifications();
  registerServiceWorker();
})();

