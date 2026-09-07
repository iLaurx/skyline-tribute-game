/* ==========================================================================
   Skyline Tribute — Leaderboard global (Supabase REST + fetch)
   --------------------------------------------------------------------------
   Expone Leaderboard.getTopScores() y Leaderboard.saveScore().
   Los modales de Usuario y Stats viven fuera del canvas para no interferir.
   ========================================================================== */

(() => {
  'use strict';

  const SUPABASE_URL = 'https://wmsxnclfndkutinsrriq.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_AjcuzXYP5uyz_uG066nyjQ_1h0NuQKP';

  const USERNAME_KEY = 'player_username';
  const USERNAME_MAX = 16;

  const restHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };

  async function getTopScores() {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/leaderboard?select=username,score&order=score.desc&limit=10`,
      { headers: restHeaders },
    );

    if (!response.ok) {
      throw new Error('No se pudo cargar la clasificación');
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  async function saveScore(username, score) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/leaderboard`, {
      method: 'POST',
      headers: {
        ...restHeaders,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ username, score }),
    });

    if (!response.ok) {
      throw new Error('No se pudo guardar la puntuación');
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readUsername() {
    try {
      return (localStorage.getItem(USERNAME_KEY) || '').trim();
    } catch {
      return '';
    }
  }

  function writeUsername(username) {
    localStorage.setItem(USERNAME_KEY, username);
  }

  const modalUser = document.getElementById('modal-user');
  const modalStats = document.getElementById('modal-stats');
  const inputUsername = document.getElementById('input-username');
  const formUser = document.getElementById('form-user');
  const userStatus = document.getElementById('user-save-status');
  const leaderboardList = document.getElementById('leaderboard-list');
  const btnUser = document.getElementById('btn-user');
  const btnStats = document.getElementById('btn-stats');

  function isModalOpen() {
    return Boolean(document.querySelector('.hud-modal:not(.hidden)'));
  }

  function closeModals() {
    modalUser?.classList.add('hidden');
    modalStats?.classList.add('hidden');
    if (userStatus) userStatus.textContent = '';
  }

  function openModal(modal) {
    closeModals();
    modal?.classList.remove('hidden');
  }

  function openUserModal() {
    openModal(modalUser);
    if (userStatus) userStatus.textContent = '';
    if (inputUsername) {
      inputUsername.value = readUsername();
      inputUsername.focus();
      inputUsername.select();
    }
  }

  async function openStatsModal() {
    openModal(modalStats);
    if (!leaderboardList) return;

    leaderboardList.innerHTML = '<p class="leaderboard-empty">Cargando...</p>';

    try {
      const rows = await getTopScores();
      renderScores(rows);
    } catch {
      leaderboardList.innerHTML = '<p class="leaderboard-empty">No se pudo cargar la clasificación</p>';
    }
  }

  function renderScores(rows) {
    if (!rows.length) {
      leaderboardList.innerHTML = '<p class="leaderboard-empty">Aún no hay puntuaciones</p>';
      return;
    }

    leaderboardList.innerHTML = rows.map((row, index) => {
      const name = escapeHtml(row.username);
      const score = Number(row.score) || 0;
      return (
        `<div class="leaderboard-row">` +
          `<span class="leaderboard-rank">${index + 1}</span>` +
          `<span class="leaderboard-name">${name}</span>` +
          `<span class="leaderboard-score">${score}</span>` +
        `</div>`
      );
    }).join('');
  }

  function bindHud() {
    btnUser?.addEventListener('click', (event) => {
      event.preventDefault();
      openUserModal();
    });

    btnStats?.addEventListener('click', (event) => {
      event.preventDefault();
      void openStatsModal();
    });

    formUser?.addEventListener('submit', (event) => {
      event.preventDefault();
      const username = (inputUsername?.value || '').trim().slice(0, USERNAME_MAX);
      if (!username) {
        if (userStatus) userStatus.textContent = 'Escribe un nombre';
        inputUsername?.focus();
        return;
      }

      try {
        writeUsername(username);
      } catch {
        if (userStatus) userStatus.textContent = 'No se pudo guardar';
        return;
      }

      if (inputUsername) inputUsername.value = username;
      closeModals();
    });

    document.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', () => closeModals());
    });

    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape' && isModalOpen()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeModals();
      }
    });
  }

  bindHud();

  window.Leaderboard = {
    getTopScores,
    saveScore,
    isModalOpen,
    closeModals,
  };
})();
