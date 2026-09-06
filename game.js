/* ==========================================================================
   Skyline Tribute — lógica del juego (HTML5 Canvas, JS vanilla)
   --------------------------------------------------------------------------
   Organización del archivo:
     1. CONFIG        → todos los números ajustables del juego
     2. Sprites       → registro de imágenes opcionales (sustituye rectángulos)
     3. Player        → avión: gravedad, salto, hitbox
     4. Pipes         → obstáculos: generación, movimiento, reciclaje
     5. Physics       → detección de colisiones
     6. Score         → puntuación y récord
     7. Render        → dibujado (fondo, obstáculos, jugador, suelo)
     8. UI            → marcador y capas de inicio / Game Over
     9. Game          → máquina de estados y bucle principal
    10. Input         → teclado, ratón y táctil
   ========================================================================== */

(() => {
  'use strict';

  /* ========================================================================
     1. CONFIG — ajusta el juego desde aquí
     ======================================================================== */

  const CONFIG = {
    // Resolución lógica del lienzo. Si la cambias, actualiza --game-aspect
    // en style.css para que el marco mantenga la misma proporción.
    world: {
      width: 480,
      height: 640,
      groundHeight: 72, // franja inferior: es suelo sólido, no decoración
    },

    player: {
      x: 132,            // posición horizontal fija
      width: 46,
      height: 32,
      hitboxInset: 5,    // encoge la caja de colisión para que sea más justa
      gravity: 1500,     // px/s²
      jumpImpulse: -430, // px/s (negativo = hacia arriba)
      maxFallSpeed: 620, // px/s
      maxTiltUp: -0.45,  // radianes
      maxTiltDown: 0.85, // radianes
    },

    pipes: {
      width: 74,
      gap: 168,          // hueco vertical entre obstáculos
      spacing: 230,      // distancia horizontal entre parejas
      speed: 190,        // px/s (se mueven de derecha a izquierda)
      margin: 60,        // margen mínimo respecto al techo y al suelo
      capHeight: 26,     // altura del remate decorativo del obstáculo
    },

    // Sube la dificultad poco a poco con la puntuación
    difficulty: {
      speedPerPoint: 2.2,   // px/s extra por punto
      maxSpeedBonus: 90,    // tope del bonus de velocidad
      gapShrinkPerPoint: 1.4,
      minGap: 128,
    },

    restartDelay: 450,       // ms de bloqueo tras morir (evita reinicio accidental)
    storageKey: 'skyline-tribute-best',
  };

  const W = CONFIG.world.width;
  const H = CONFIG.world.height;
  const FLOOR_Y = H - CONFIG.world.groundHeight; // línea de suelo

  /* ========================================================================
     2. Sprites — punto único para pasar de rectángulos a imágenes
     ------------------------------------------------------------------------
     Para usar tus propias imágenes, rellena SPRITE_SOURCES con las rutas.
     Cada entrada que quede en null se dibuja como rectángulo (fallback).
     Ejemplo:
       const SPRITE_SOURCES = {
         player: 'assets/plane.png',
         pipeBody: 'assets/tower.png',
         ...
       };
     ======================================================================== */

  const SPRITE_SOURCES = {
    player: null,     // avión
    pipeBody: null,   // cuerpo del obstáculo (se repite verticalmente)
    pipeCap: null,    // remate del obstáculo
    background: null, // fondo a pantalla completa
    ground: null,     // franja de suelo
  };

  const Sprites = {
    images: {},

    /** Carga las rutas definidas. Nunca falla: si una imagen no carga, se ignora. */
    load() {
      for (const [key, src] of Object.entries(SPRITE_SOURCES)) {
        if (!src) continue;
        const img = new Image();
        img.src = src;
        img.addEventListener('load', () => { this.images[key] = img; });
        img.addEventListener('error', () => {
          console.warn(`[sprites] no se pudo cargar "${key}" desde ${src}`);
        });
      }
    },

    /** Devuelve la imagen si está lista, o null para usar el fallback. */
    get(key) {
      const img = this.images[key];
      return img && img.complete && img.naturalWidth > 0 ? img : null;
    },
  };

  /* ========================================================================
     3. Player — el avión
     ======================================================================== */

  const Player = {
    x: CONFIG.player.x,
    y: 0,
    vy: 0,
    tilt: 0,
    width: CONFIG.player.width,
    height: CONFIG.player.height,

    reset() {
      this.y = H * 0.42;
      this.vy = 0;
      this.tilt = 0;
    },

    jump() {
      this.vy = CONFIG.player.jumpImpulse;
    },

    update(dt) {
      const p = CONFIG.player;
      this.vy = Math.min(this.vy + p.gravity * dt, p.maxFallSpeed);
      this.y += this.vy * dt;

      // Inclinación proporcional a la velocidad vertical (solo estético)
      const t = this.vy / p.maxFallSpeed;
      this.tilt = t < 0
        ? p.maxTiltUp * Math.min(1, -t * 2.5)
        : p.maxTiltDown * Math.min(1, t * 1.6);
    },

    /** Flotación suave en la pantalla de inicio. */
    idle(time) {
      this.y = H * 0.42 + Math.sin(time / 260) * 9;
      this.vy = 0;
      this.tilt = Math.sin(time / 260) * 0.12;
    },

    /** Caja de colisión (algo menor que el sprite para un juego más amable). */
    hitbox() {
      const i = CONFIG.player.hitboxInset;
      return {
        left: this.x - this.width / 2 + i,
        right: this.x + this.width / 2 - i,
        top: this.y - this.height / 2 + i,
        bottom: this.y + this.height / 2 - i,
      };
    },
  };

  /* ========================================================================
     4. Pipes — parejas de obstáculos (superior + inferior)
     ------------------------------------------------------------------------
     Cada obstáculo guarda solo `x` y `gapY` (centro del hueco); las dos
     mitades se derivan de ahí, así que basta un objeto por pareja.
     ======================================================================== */

  const Pipes = {
    items: [],

    reset() {
      this.items = [];
      // Primera pareja algo más lejos para dar margen al arrancar
      this.spawn(W + 120);
    },

    spawn(x) {
      const gap = this.currentGap();
      const min = CONFIG.pipes.margin + gap / 2;
      const max = FLOOR_Y - CONFIG.pipes.margin - gap / 2;
      this.items.push({
        x,
        gapY: min + Math.random() * (max - min),
        gap,
        scored: false, // ya sumó punto al jugador
      });
    },

    /** Hueco actual: se estrecha con la puntuación hasta un mínimo. */
    currentGap() {
      const d = CONFIG.difficulty;
      return Math.max(d.minGap, CONFIG.pipes.gap - Score.current * d.gapShrinkPerPoint);
    },

    /** Velocidad actual: crece con la puntuación hasta un tope. */
    currentSpeed() {
      const d = CONFIG.difficulty;
      const bonus = Math.min(d.maxSpeedBonus, Score.current * d.speedPerPoint);
      return CONFIG.pipes.speed + bonus;
    },

    update(dt) {
      const speed = this.currentSpeed();

      for (const pipe of this.items) {
        pipe.x -= speed * dt;

        // Punto cuando el avión deja atrás el obstáculo
        if (!pipe.scored && pipe.x + CONFIG.pipes.width / 2 < Player.x) {
          pipe.scored = true;
          Score.increment();
        }
      }

      // Descarta los que ya salieron por la izquierda
      while (this.items.length && this.items[0].x + CONFIG.pipes.width / 2 < -10) {
        this.items.shift();
      }

      // Genera el siguiente cuando el último ha avanzado lo suficiente
      const last = this.items[this.items.length - 1];
      if (!last || last.x <= W - CONFIG.pipes.spacing) {
        this.spawn(W + CONFIG.pipes.width / 2);
      }
    },

    /** Rectángulos de colisión de una pareja: mitad superior e inferior. */
    rects(pipe) {
      const halfW = CONFIG.pipes.width / 2;
      const gapTop = pipe.gapY - pipe.gap / 2;
      const gapBottom = pipe.gapY + pipe.gap / 2;
      return [
        { left: pipe.x - halfW, right: pipe.x + halfW, top: 0, bottom: gapTop },
        { left: pipe.x - halfW, right: pipe.x + halfW, top: gapBottom, bottom: FLOOR_Y },
      ];
    },
  };

  /* ========================================================================
     5. Physics — colisiones
     ======================================================================== */

  const Physics = {
    /** Solape entre dos rectángulos alineados a los ejes (AABB). */
    overlaps(a, b) {
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    },

    /** ¿Ha chocado el jugador con los límites del lienzo o con un obstáculo? */
    playerCollides() {
      const box = Player.hitbox();

      // Límites del lienzo: techo y suelo
      if (box.top <= 0 || box.bottom >= FLOOR_Y) return true;

      // Obstáculos (solo los que están cerca en horizontal)
      for (const pipe of Pipes.items) {
        if (pipe.x + CONFIG.pipes.width / 2 < box.left) continue;
        if (pipe.x - CONFIG.pipes.width / 2 > box.right) break;
        for (const rect of Pipes.rects(pipe)) {
          if (this.overlaps(box, rect)) return true;
        }
      }

      return false;
    },
  };

  /* ========================================================================
     6. Score — puntuación y récord
     ======================================================================== */

  const Score = {
    current: 0,
    best: 0,
    isNewRecord: false,

    init() {
      try {
        this.best = Number(localStorage.getItem(CONFIG.storageKey)) || 0;
      } catch {
        this.best = 0; // localStorage puede estar bloqueado; no es crítico
      }
      UI.setScore(0);
      UI.setBest(this.best);
    },

    reset() {
      this.current = 0;
      this.isNewRecord = false;
      UI.setScore(0);
    },

    increment() {
      this.current += 1;
      UI.setScore(this.current);
    },

    commit() {
      if (this.current > this.best) {
        this.best = this.current;
        this.isNewRecord = true;
        try {
          localStorage.setItem(CONFIG.storageKey, String(this.best));
        } catch { /* ignorar */ }
        UI.setBest(this.best);
      }
    },
  };

  /* ========================================================================
     7. Render — dibujado
     ------------------------------------------------------------------------
     Cada elemento tiene su función `draw*`: si existe el sprite lo usa y si
     no, cae en el rectángulo. Para cambiar el aspecto, toca solo esta zona.
     ======================================================================== */

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const Render = {
    /** Ajusta la resolución real del lienzo a la pantalla (nitidez en HiDPI). */
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
    },

    frame(time) {
      ctx.clearRect(0, 0, W, H);
      this.drawBackground(time);
      for (const pipe of Pipes.items) this.drawPipe(pipe);
      this.drawGround(time);
      this.drawPlayer();
    },

    // ---- Fondo -----------------------------------------------------------
    drawBackground(time) {
      const sprite = Sprites.get('background');
      if (sprite) {
        ctx.drawImage(sprite, 0, 0, W, H);
        return;
      }

      // Cielo degradado
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#13416f');
      sky.addColorStop(0.5, '#2f83bd');
      sky.addColorStop(1, '#8ccbe6');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Skyline lejano con desplazamiento parallax (dos capas a distinta velocidad)
      this.drawSkyline(time * 0.012, 150, 'rgba(16, 42, 71, 0.45)', 61);
      this.drawSkyline(time * 0.028, 110, 'rgba(11, 29, 51, 0.7)', 37);
    },

    /**
     * Silueta de edificios generada de forma determinista a partir del índice,
     * así el patrón se repite sin necesidad de guardar estado.
     */
    drawSkyline(offset, maxHeight, color, seed) {
      const buildingW = 44;
      const total = Math.ceil(W / buildingW) + 2;
      const shift = offset % buildingW;

      ctx.fillStyle = color;
      for (let i = 0; i < total; i++) {
        const index = Math.floor(offset / buildingW) + i;
        const pseudoRandom = ((index * seed) % 100) / 100;
        const h = 46 + pseudoRandom * maxHeight;
        const x = i * buildingW - shift;
        ctx.fillRect(x, FLOOR_Y - h, buildingW - 6, h);
      }
    },

    // ---- Obstáculos ------------------------------------------------------
    drawPipe(pipe) {
      const { width, capHeight } = CONFIG.pipes;
      const x = pipe.x - width / 2;
      const gapTop = pipe.gapY - pipe.gap / 2;
      const gapBottom = pipe.gapY + pipe.gap / 2;

      // Mitad superior (crece desde el techo) y mitad inferior (hasta el suelo)
      this.drawPipeHalf(x, 0, width, gapTop, 'top');
      this.drawPipeHalf(x, gapBottom, width, FLOOR_Y - gapBottom, 'bottom');

      // Remates: en el borde interior de cada mitad
      this.drawPipeCap(x, gapTop - capHeight, width, capHeight);
      this.drawPipeCap(x, gapBottom, width, capHeight);
    },

    drawPipeHalf(x, y, w, h, side) {
      if (h <= 0) return;

      const sprite = Sprites.get('pipeBody');
      if (sprite) {
        // Voltea el sprite en la mitad superior para que el patrón case
        if (side === 'top') {
          ctx.save();
          ctx.translate(0, y + h);
          ctx.scale(1, -1);
          ctx.drawImage(sprite, x, 0, w, h);
          ctx.restore();
        } else {
          ctx.drawImage(sprite, x, y, w, h);
        }
        return;
      }

      // Fallback: rectángulo con degradado
      const grad = ctx.createLinearGradient(x, 0, x + w, 0);
      grad.addColorStop(0, '#1f4d3d');
      grad.addColorStop(0.35, '#3f9d6f');
      grad.addColorStop(0.75, '#2f7a55');
      grad.addColorStop(1, '#1a4335');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    },

    drawPipeCap(x, y, w, h) {
      const sprite = Sprites.get('pipeCap');
      if (sprite) {
        ctx.drawImage(sprite, x - 4, y, w + 8, h);
        return;
      }

      ctx.fillStyle = '#48b380';
      ctx.fillRect(x - 4, y, w + 8, h);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.fillRect(x - 4, y + h - 5, w + 8, 5);
    },

    // ---- Suelo -----------------------------------------------------------
    drawGround(time) {
      const gh = CONFIG.world.groundHeight;
      const sprite = Sprites.get('ground');

      if (sprite) {
        ctx.drawImage(sprite, 0, FLOOR_Y, W, gh);
        return;
      }

      ctx.fillStyle = '#cfa96b';
      ctx.fillRect(0, FLOOR_Y, W, gh);

      // Franjas en movimiento: dan sensación de avance
      const stripeW = 30;
      const shift = (time * 0.19) % (stripeW * 2);
      ctx.fillStyle = '#bd955a';
      for (let x = -stripeW * 2; x < W + stripeW * 2; x += stripeW * 2) {
        ctx.fillRect(x - shift, FLOOR_Y + 14, stripeW, gh - 14);
      }

      // Césped: marca visualmente la línea exacta de colisión con el suelo
      ctx.fillStyle = '#74c47c';
      ctx.fillRect(0, FLOOR_Y, W, 10);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.fillRect(0, FLOOR_Y + 10, W, 4);
    },

    // ---- Jugador ---------------------------------------------------------
    drawPlayer() {
      const { width: w, height: h } = Player;

      ctx.save();
      ctx.translate(Player.x, Player.y);
      ctx.rotate(Player.tilt);

      const sprite = Sprites.get('player');
      if (sprite) {
        ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
      } else {
        // Fallback: avión sencillo hecho con formas
        ctx.fillStyle = '#1b2436';           // contorno, para que resalte sobre el cielo
        ctx.fillRect(-w / 2 - 2, -h / 4 - 2, w + 4, h / 2 + 4);
        ctx.fillStyle = '#f4d35e';           // fuselaje
        ctx.fillRect(-w / 2, -h / 4, w, h / 2);
        ctx.fillStyle = '#ee964b';           // ala
        ctx.fillRect(-w / 6, -h / 2, w / 2.4, h);
        ctx.fillStyle = '#d1495b';           // cola
        ctx.fillRect(-w / 2, -h / 2, w / 6, h / 2.2);
        ctx.fillStyle = '#2b3a55';           // cabina
        ctx.fillRect(w / 5, -h / 8, w / 4, h / 5);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'; // sombra inferior
        ctx.fillRect(-w / 2, h / 5, w, h / 8);
      }

      ctx.restore();
    },
  };

  /* ========================================================================
     8. UI — capas de interfaz y marcador del DOM
     ======================================================================== */

  const UI = {
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    finalScore: document.getElementById('final-score'),
    newRecord: document.getElementById('new-record'),
    overlayStart: document.getElementById('overlay-start'),
    overlayOver: document.getElementById('overlay-over'),
    btnRestart: document.getElementById('btn-restart'),
    btnPause: document.getElementById('btn-pause'),

    setScore(value) { this.score.textContent = String(value); },
    setBest(value) { this.best.textContent = String(value); },

    showStart() {
      this.overlayStart.classList.remove('hidden');
      this.overlayOver.classList.add('hidden');
    },

    showGameOver() {
      this.overlayStart.classList.add('hidden');
      this.overlayOver.classList.remove('hidden');
      this.finalScore.textContent = String(Score.current);
      this.newRecord.classList.toggle('hidden', !Score.isNewRecord);
    },

    hideAll() {
      this.overlayStart.classList.add('hidden');
      this.overlayOver.classList.add('hidden');
    },

    setPaused(paused) {
      this.btnPause.textContent = paused ? 'Continuar' : 'Pausa';
    },
  };

  /* ========================================================================
     9. Game — máquina de estados y bucle principal
     ======================================================================== */

  const STATE = { READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };

  const Game = {
    state: STATE.READY,
    lastFrame: 0,
    elapsed: 0,   // tiempo acumulado, usado para las animaciones de fondo
    diedAt: 0,

    init() {
      Sprites.load();
      Render.resize();
      Score.init();
      this.toReady();

      window.addEventListener('resize', () => Render.resize());
      Input.bind();

      requestAnimationFrame((t) => {
        this.lastFrame = t;
        this.loop(t);
      });
    },

    // ---- Transiciones de estado -----------------------------------------
    toReady() {
      this.state = STATE.READY;
      // El orden importa: la dificultad del primer obstáculo depende de la
      // puntuación, así que hay que poner el contador a cero antes de generarlo.
      Score.reset();
      Player.reset();
      Pipes.reset();
      UI.showStart();
      UI.setPaused(false);
    },

    start() {
      if (this.state !== STATE.READY) return;
      this.state = STATE.PLAYING;
      UI.hideAll();
      Player.jump();
    },

    gameOver() {
      if (this.state === STATE.OVER) return;
      this.state = STATE.OVER;
      this.diedAt = performance.now();
      Score.commit();
      UI.showGameOver();
    },

    /** Reinicia y arranca de inmediato (pantalla de Game Over). */
    restart() {
      this.toReady();
      this.start();
    },

    togglePause() {
      if (this.state === STATE.PLAYING) {
        this.state = STATE.PAUSED;
        UI.setPaused(true);
      } else if (this.state === STATE.PAUSED) {
        this.state = STATE.PLAYING;
        UI.setPaused(false);
      }
    },

    pause() {
      if (this.state === STATE.PLAYING) this.togglePause();
    },

    /** ¿Ya pasó el bloqueo posterior a morir? Evita reinicios por accidente. */
    canRestart() {
      return performance.now() - this.diedAt >= CONFIG.restartDelay;
    },

    // ---- Bucle principal -------------------------------------------------
    loop(time) {
      // Delta acotado: si la pestaña estuvo en segundo plano, no damos un salto
      const dt = Math.min((time - this.lastFrame) / 1000, 1 / 30);
      this.lastFrame = time;

      if (this.state === STATE.PLAYING) {
        this.elapsed += dt * 1000;
        Player.update(dt);
        Pipes.update(dt);
        if (Physics.playerCollides()) this.gameOver();
      } else if (this.state === STATE.READY) {
        this.elapsed += dt * 1000;
        Player.idle(this.elapsed);
      }

      Render.frame(this.elapsed);
      requestAnimationFrame((t) => this.loop(t));
    },
  };

  /* ========================================================================
     10. Input — teclado, ratón y táctil
     ======================================================================== */

  const Input = {
    /** Acción principal: empezar, saltar o reiniciar según el estado. */
    primary() {
      switch (Game.state) {
        case STATE.READY:
          Game.start();
          break;
        case STATE.PLAYING:
          Player.jump();
          break;
        case STATE.PAUSED:
          Game.togglePause();
          break;
        case STATE.OVER:
          if (Game.canRestart()) Game.restart();
          break;
      }
    },

    bind() {
      // --- Teclado ---
      window.addEventListener('keydown', (event) => {
        if (event.repeat) return;

        // Espacio y flecha arriba: acción principal
        if (event.code === 'Space' || event.code === 'ArrowUp') {
          event.preventDefault();
          this.primary();
          return;
        }

        // P o Escape: pausa
        if (event.code === 'KeyP' || event.code === 'Escape') {
          event.preventDefault();
          Game.togglePause();
          return;
        }

        // En Game Over, cualquier otra tecla reinicia
        if (Game.state === STATE.OVER && Game.canRestart()) {
          Game.restart();
        }
      });

      // --- Ratón y táctil sobre el lienzo ---
      canvas.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.primary();
      });

      // Evita el menú contextual al mantener pulsado en móvil
      canvas.addEventListener('contextmenu', (event) => event.preventDefault());

      // --- Botones ---
      UI.btnRestart.addEventListener('click', () => {
        Game.restart();
        UI.btnRestart.blur(); // devuelve el foco para que Espacio siga saltando
      });

      UI.btnPause.addEventListener('click', () => {
        Game.togglePause();
        UI.btnPause.blur();
      });

      // --- Pausa automática al perder el foco ---
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) Game.pause();
      });
      window.addEventListener('blur', () => Game.pause());
    },
  };

  /* ======================================================================== */

  Game.init();
})();
