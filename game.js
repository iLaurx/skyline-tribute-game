/* ==========================================================================
   Skyline Tribute — lógica del juego (HTML5 Canvas, JS vanilla)
   --------------------------------------------------------------------------
   Organización del archivo:
     1. CONFIG        → todos los números ajustables del juego
     2. Sprites       → registro de imágenes opcionales (sustituye rectángulos)
     3. Player        → avión: gravedad, salto, hitbox
     4. Pipes         → obstáculos: generación, movimiento, reciclaje
     5. Traffic       → patrullas y bomberos (pixel art en la calle)
     6. Physics       → detección de colisiones y punto de impacto
     7. Particles     → destello, metralla y humo de la explosión
     8. Score         → puntuación y récord
     9. Render        → dibujado (fondo, obstáculos, jugador, suelo)
    10. UI            → marcador y capas de inicio / Game Over
    11. Audio         → motor del avión y explosión
    12. Game          → máquina de estados y bucle principal
    13. Input         → teclado, ratón y táctil
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
      width: 66,         // encaja con el recorte del sprite (avión ~2.37:1)
      height: 28,
      hitboxPadding: 0.12, // 12% interno: ignora transparencias del PNG
      gravity: 1500,     // px/s²
      jumpImpulse: -430, // px/s (negativo = hacia arriba)
      maxFallSpeed: 620, // px/s
      maxTiltUp: -0.45,  // radianes (nariz arriba al saltar)
      maxTiltDown: 0.85, // radianes (nariz abajo al caer)
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

    // Efecto de choque: destello + metralla pixel art + humo continuo
    explosion: {
      flashDuration: 100,        // ms del destello inicial
      flashRadius: 86,           // radio máximo del destello

      debrisMin: 15,             // nº de cuadros de metralla (15–20)
      debrisMax: 20,
      debrisSize: [3, 8],        // lado del cuadrado en px
      debrisSpeed: [110, 330],   // px/s inicial en dirección aleatoria
      debrisLife: [0.55, 1.25],  // s
      debrisGravity: 700,        // px/s²
      debrisFriction: 1.7,       // proporción de velocidad perdida por segundo
      debrisBounce: 0.42,        // rebote al tocar el suelo
      debrisColors: ['#fff3b0', '#ffd166', '#f4a12a', '#ef6c1f', '#d1341c', '#8c1c10'],

      smokeRate: 17,             // partículas por segundo del emisor continuo
      smokeBurst: 8,             // bocanada inicial en el momento del impacto
      smokeSpread: 15,           // dispersión del emisor alrededor del impacto
      smokeSize: [7, 15],
      smokeGrowth: 16,           // px/s de crecimiento mientras flota
      smokeRise: [-82, -42],     // px/s (negativo = sube)
      smokeDrift: 34,            // vaivén horizontal
      smokeLife: [1.4, 2.6],     // s
      smokeShade: [34, 128],     // gris: de casi negro a humo claro
    },

    restartDelay: 450,       // ms de bloqueo tras morir (evita reinicio accidental)
    storageKey: 'skyline-tribute-best',

    // Sacudida de cámara al chocar con una torre o el suelo
    shake: {
      duration: 200,   // ms
      intensity: 10,   // px de desplazamiento aleatorio (8–12)
    },

    // El fondo se mueve más despacio que las torres (profundidad / parallax)
    parallax: {
      background: 0.45,
    },

    // Tráfico decorativo en la calle del suelo (sin colisión ni sonido)
    traffic: {
      spawnMin: 4,          // s entre vehículos
      spawnMax: 8,
      sirenMs: 200,         // parpadeo de luces
      maxItems: 3,
      // Ruedas sobre las líneas amarillas de ground.png (offset bajo FLOOR_Y)
      laneBottom: 31,
      police: { width: 24, height: 12, speed: [88, 110] },
      fireEngine: { width: 38, height: 14, speed: [62, 82] },
    },
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
    player: 'assets/plane.png',
    pipeBody: 'assets/tower.png',
    pipeCap: null,
    background: 'assets/background.png',
    ground: 'assets/ground.png',
  };

  // Rutas de audio (acepta .mp3, .wav o .m4a: cambia solo la extensión aquí)
  const SOUND_SOURCES = {
    engine: 'assets/plane-sound.m4a',
    explosion: 'assets/explosion-sound.m4a',
  };

  const Sprites = {
    images: {},
    trim: {},      // recorte del contenido opaco (ignora padding transparente)
    ready: false,
    loaded: 0,
    total: 0,

    /**
     * Precarga todas las rutas definidas. Resuelve cuando cada imagen ha
     * terminado de decodificarse (o ha fallado). No lanza: un error se
     * registra y esa clave queda sin sprite (se usa el fallback).
     */
    load() {
      const entries = Object.entries(SPRITE_SOURCES).filter(([, src]) => src);
      this.total = entries.length;
      this.loaded = 0;
      this.ready = this.total === 0;

      if (this.ready) return Promise.resolve();

      return Promise.all(entries.map(([key, src]) => this.loadOne(key, src)))
        .then(() => {
          this.ready = true;
        });
    },

    loadOne(key, src) {
      return new Promise((resolve) => {
        const img = new Image();

        const finish = (ok) => {
          if (ok) {
            this.images[key] = img;
            if (key === 'player' || key === 'pipeBody') {
              this.trim[key] = this.contentRect(img);
            }
          }
          this.loaded += 1;
          resolve(ok ? img : null);
        };

        img.onload = () => {
          if (typeof img.decode === 'function') {
            img.decode().then(() => finish(true)).catch(() => finish(true));
          } else {
            finish(true);
          }
        };
        img.onerror = () => {
          console.warn(`[sprites] no se pudo cargar "${key}" desde ${src}`);
          finish(false);
        };
        img.src = src;
      });
    },

    /** Caja del contenido con alfa > 16, para no dibujar (ni colisionar) padding. */
    contentRect(img) {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const cctx = c.getContext('2d');
      if (!cctx) return { sx: 0, sy: 0, sw: w, sh: h };

      cctx.drawImage(img, 0, 0);
      const data = cctx.getImageData(0, 0, w, h).data;
      let minX = w;
      let minY = h;
      let maxX = 0;
      let maxY = 0;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] > 16) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX < minX) return { sx: 0, sy: 0, sw: w, sh: h };
      return { sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
    },

    sourceRect(key, img) {
      return this.trim[key] || { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight };
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
    crashed: false,   // destruido: deja de dibujarse y lo sustituye la explosión

    reset() {
      this.y = H * 0.42;
      this.vy = 0;
      this.tilt = 0;
      this.crashed = false;
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

    /**
     * Caja de colisión AABB con padding interno (10–15%).
     * Recorta las transparencias del PNG (nariz, cola, esquinas) para que
     * no cuenten como golpe.
     */
    hitbox() {
      const padX = this.width * CONFIG.player.hitboxPadding;
      const padY = this.height * CONFIG.player.hitboxPadding;
      return {
        left: this.x - this.width / 2 + padX,
        right: this.x + this.width / 2 - padX,
        top: this.y - this.height / 2 + padY,
        bottom: this.y + this.height / 2 - padY,
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
     5. Traffic — vehículos de emergencia en la calle (pixel art)
     ------------------------------------------------------------------------
     Solo decorativos: cruzan la carretera del suelo, no colisionan ni suenan.
     Se dibujan con fillRect (sin sprites) para encajar con la estética 8-bit.
     ======================================================================== */

  const Traffic = {
    items: [],
    spawnIn: 0,

    reset() {
      this.items = [];
      this.spawn('police', 1, 72);
      this.spawn('fireEngine', -1, W - 160);
      this.spawnIn = this.randomInterval();
    },

    randomInterval() {
      const t = CONFIG.traffic;
      return t.spawnMin + Math.random() * (t.spawnMax - t.spawnMin);
    },

    spawn(type, dir, x) {
      const t = CONFIG.traffic;
      if (this.items.length >= t.maxItems) return;

      type = type || (Math.random() < 0.5 ? 'police' : 'fireEngine');
      const spec = t[type];
      dir = dir == null ? (Math.random() < 0.5 ? 1 : -1) : dir; // 1 = izquierda→derecha
      const speed = spec.speed[0] + Math.random() * (spec.speed[1] - spec.speed[0]);
      const y = FLOOR_Y + t.laneBottom - spec.height;

      this.items.push({
        x: x == null ? (dir === 1 ? -spec.width : W) : x,
        y,
        speed,
        type,
        dir,
        width: spec.width,
        height: spec.height,
        lightTimer: Math.random() * t.sirenMs * 2,
      });
    },

    update(dt) {
      this.spawnIn -= dt;
      if (this.spawnIn <= 0) {
        this.spawn();
        this.spawnIn = this.randomInterval();
      }

      for (let i = this.items.length - 1; i >= 0; i--) {
        const v = this.items[i];
        v.x += v.speed * v.dir * dt;
        v.lightTimer += dt * 1000;

        const gone = v.dir === 1 ? v.x > W : v.x + v.width < 0;
        if (gone) this.items.splice(i, 1);
      }
    },

    draw() {
      const t = CONFIG.traffic;
      for (const v of this.items) {
        const flash = Math.floor(v.lightTimer / t.sirenMs) % 2 === 0;
        const x = Math.round(v.x);
        const y = Math.round(v.y);

        ctx.save();
        if (v.dir < 0) {
          ctx.translate(x + v.width, y);
          ctx.scale(-1, 1);
        } else {
          ctx.translate(x, y);
        }

        if (v.type === 'police') this.drawPolice(flash);
        else this.drawFireEngine(flash);

        ctx.restore();
      }
    },

    /** Patrulla: carrocería azul/blanca, ruedas oscuras y barra de luces. */
    drawPolice(flash) {
      const r = (x, y, w, h, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
      };

      const sirenR = flash ? '#ff3b3b' : '#6b1212';
      const sirenB = flash ? '#1e3a8a' : '#4d8dff';

      r(8, 0, 10, 3, '#1c1917');          // base de la barra
      r(8, 0, 5, 3, sirenR);
      r(13, 0, 5, 3, sirenB);

      r(5, 3, 15, 2, '#1e40af');          // techo
      r(6, 3, 13, 2, '#67e8f9');          // ventanas
      r(16, 3, 3, 2, '#e0f2fe');          // parabrisas

      r(1, 5, 22, 4, '#1d4ed8');          // carrocería azul
      r(6, 5, 12, 3, '#f8fafc');          // puertas blancas
      r(12, 5, 1, 3, '#94a3b8');          // junta de puerta
      r(1, 8, 22, 1, '#1e3a8a');          // franja inferior

      r(0, 7, 2, 2, '#9ca3af');           // parachoques
      r(22, 7, 2, 2, '#9ca3af');
      r(0, 5, 2, 2, '#ef4444');           // piloto trasero
      r(22, 5, 2, 2, '#fde68a');          // faro

      r(3, 9, 5, 3, '#0a0a0a');           // ruedas
      r(16, 9, 5, 3, '#0a0a0a');
      r(4, 10, 3, 1, '#6b7280');
      r(17, 10, 3, 1, '#6b7280');
    },

    /** Camión de bomberos: rojo alargado, detalles amarillos y escala. */
    drawFireEngine(flash) {
      const r = (x, y, w, h, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
      };

      const sirenR = flash ? '#ff2d2d' : '#6b1212';
      const sirenA = flash ? '#b45309' : '#fff3b0';

      r(4, 0, 22, 2, '#a8a29e');          // escala
      r(4, 0, 22, 1, '#e7e5e4');
      for (let i = 0; i < 7; i++) r(6 + i * 3, 0, 1, 2, '#78716c');

      r(26, 0, 10, 3, '#1c1917');         // barra de luces en la cabina
      r(26, 0, 5, 3, sirenR);
      r(31, 0, 5, 3, sirenA);

      r(1, 3, 24, 8, '#b91c1c');          // caja trasera
      r(2, 4, 22, 5, '#dc2626');
      r(1, 7, 24, 2, '#fbbf24');          // franja amarilla
      r(1, 7, 24, 1, '#fef3c7');
      r(4, 4, 4, 3, '#f8fafc');           // paneles blancos
      r(10, 4, 4, 3, '#f8fafc');
      r(16, 4, 4, 3, '#f8fafc');

      r(24, 3, 13, 8, '#991b1b');         // cabina
      r(25, 4, 11, 6, '#dc2626');
      r(27, 4, 8, 3, '#67e8f9');          // ventana
      r(32, 4, 3, 3, '#e0f2fe');

      r(0, 8, 2, 3, '#a8a29e');           // parachoques
      r(36, 8, 2, 3, '#a8a29e');
      r(36, 6, 2, 2, '#fde68a');          // faro

      r(4, 11, 5, 3, '#0a0a0a');          // ruedas
      r(14, 11, 5, 3, '#0a0a0a');
      r(28, 11, 5, 3, '#0a0a0a');
      r(5, 12, 3, 1, '#6b7280');
      r(15, 12, 3, 1, '#6b7280');
      r(29, 12, 3, 1, '#6b7280');
    },
  };

  /* ========================================================================
     6. Physics — colisiones
     ======================================================================== */

  const Physics = {
    /** Solape entre dos rectángulos alineados a los ejes (AABB). */
    overlaps(a, b) {
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    },

    /** Centro de la zona compartida por dos rectángulos: el punto de contacto. */
    contactPoint(a, b) {
      return {
        x: (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2,
        y: (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2,
      };
    },

    /**
     * ¿Ha chocado el jugador con los límites del lienzo o con un obstáculo?
     * Devuelve {x, y} con el punto exacto del impacto, o null si no hay choque.
     */
    playerImpact() {
      const box = Player.hitbox();

      // Límites del lienzo: suelo y techo
      if (box.bottom >= FLOOR_Y) return { x: Player.x, y: FLOOR_Y };
      if (box.top <= 0) return { x: Player.x, y: 0 };

      // Obstáculos (solo los que están cerca en horizontal)
      for (const pipe of Pipes.items) {
        if (pipe.x + CONFIG.pipes.width / 2 < box.left) continue;
        if (pipe.x - CONFIG.pipes.width / 2 > box.right) break;
        for (const rect of Pipes.rects(pipe)) {
          if (this.overlaps(box, rect)) return this.contactPoint(box, rect);
        }
      }

      return null;
    },
  };

  /* ========================================================================
     7. Particles — explosión y humo del choque
     ------------------------------------------------------------------------
     Tres capas independientes que comparten el punto de impacto:
       · flash   → destello circular que se expande durante 100 ms
       · debris  → 15–20 cuadros pixel art con gravedad y fricción
       · smoke   → columna de humo que el emisor repone en bucle
     ======================================================================== */

  const rand = (min, max) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.floor(rand(min, max + 1));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  const Particles = {
    flash: null,      // { x, y, age } — destello inicial
    debris: [],       // metralla de la explosión
    smoke: [],        // humo flotante
    source: null,     // { x, y } — emisor continuo mientras dura el Game Over
    smokeDebt: 0,     // fracción de partícula pendiente entre fotogramas

    clear() {
      this.flash = null;
      this.debris.length = 0;
      this.smoke.length = 0;
      this.source = null;
      this.smokeDebt = 0;
    },

    /** Arranca el efecto completo en el punto del choque. */
    burst(x, y) {
      const c = CONFIG.explosion;
      this.clear();
      this.flash = { x, y, age: 0 };
      this.source = { x, y };

      const count = randInt(c.debrisMin, c.debrisMax);
      for (let i = 0; i < count; i++) {
        // Reparto angular uniforme con ruido: evita huecos en la estrella
        const angle = (i / count) * Math.PI * 2 + rand(-0.35, 0.35);
        const speed = rand(c.debrisSpeed[0], c.debrisSpeed[1]);
        const life = rand(c.debrisLife[0], c.debrisLife[1]);
        this.debris.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - rand(0, 90), // empuje extra hacia arriba
          size: Math.round(rand(c.debrisSize[0], c.debrisSize[1])),
          color: pick(c.debrisColors),
          life,
          maxLife: life,
        });
      }

      for (let i = 0; i < c.smokeBurst; i++) this.spawnSmoke(x, y);
    },

    spawnSmoke(x, y) {
      const c = CONFIG.explosion;
      const life = rand(c.smokeLife[0], c.smokeLife[1]);
      this.smoke.push({
        x: x + rand(-c.smokeSpread, c.smokeSpread),
        y: y + rand(-c.smokeSpread, c.smokeSpread),
        vx: rand(-c.smokeDrift, c.smokeDrift) * 0.35,
        vy: rand(c.smokeRise[0], c.smokeRise[1]),
        size: rand(c.smokeSize[0], c.smokeSize[1]),
        shade: Math.round(rand(c.smokeShade[0], c.smokeShade[1])),
        wobble: Math.random() * Math.PI * 2,
        life,
        maxLife: life,
      });
    },

    update(dt) {
      const c = CONFIG.explosion;

      if (this.flash) {
        this.flash.age += dt * 1000;
        if (this.flash.age >= c.flashDuration) this.flash = null;
      }

      for (let i = this.debris.length - 1; i >= 0; i--) {
        const p = this.debris[i];
        const drag = Math.max(0, 1 - c.debrisFriction * dt);
        p.vx *= drag;
        p.vy = p.vy * drag + c.debrisGravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // Rebote amortiguado contra el suelo, para que no desaparezca bajo él
        if (p.y > FLOOR_Y) {
          p.y = FLOOR_Y;
          p.vy = -p.vy * c.debrisBounce;
          p.vx *= c.debrisBounce;
        }

        p.life -= dt;
        if (p.life <= 0) this.debris.splice(i, 1);
      }

      // El emisor repone humo mientras siga activo: la columna nunca se agota
      if (this.source) {
        this.smokeDebt += c.smokeRate * dt;
        while (this.smokeDebt >= 1) {
          this.smokeDebt -= 1;
          this.spawnSmoke(this.source.x, this.source.y);
        }
      }

      for (let i = this.smoke.length - 1; i >= 0; i--) {
        const p = this.smoke[i];
        p.wobble += dt * 2.4;
        p.x += (p.vx + Math.sin(p.wobble) * c.smokeDrift * 0.4) * dt;
        p.y += p.vy * dt;
        p.vy *= Math.max(0, 1 - 0.25 * dt); // se frena poco a poco al subir
        p.size += c.smokeGrowth * dt;

        p.life -= dt;
        if (p.life <= 0) this.smoke.splice(i, 1);
      }
    },

    draw() {
      // Humo primero: la metralla y el destello quedan por delante
      for (const p of this.smoke) {
        const t = p.life / p.maxLife;   // 1 recién nacida → 0 al disiparse
        // Aparece rápido y se desvanece con el resto de su vida
        ctx.globalAlpha = Math.min(1, (1 - t) * 6) * 0.6 * t;
        ctx.fillStyle = `rgb(${p.shade}, ${p.shade}, ${p.shade + 4})`;
        const s = Math.max(2, Math.round(p.size));
        ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
      }
      ctx.globalAlpha = 1;

      for (const p of this.debris) {
        const t = p.life / p.maxLife;
        ctx.globalAlpha = t > 0.35 ? 1 : t / 0.35; // se apaga solo al final
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size);
      }
      ctx.globalAlpha = 1;

      if (this.flash) this.drawFlash();
    },

    drawFlash() {
      const c = CONFIG.explosion;
      const t = this.flash.age / c.flashDuration;
      const radius = c.flashRadius * (0.3 + 0.7 * Math.sqrt(t)); // rápido al abrir

      const grad = ctx.createRadialGradient(
        this.flash.x, this.flash.y, 0,
        this.flash.x, this.flash.y, radius,
      );
      grad.addColorStop(0, 'rgba(255, 255, 236, 0.95)');
      grad.addColorStop(0.35, 'rgba(255, 209, 102, 0.85)');
      grad.addColorStop(0.7, 'rgba(239, 108, 31, 0.55)');
      grad.addColorStop(1, 'rgba(209, 52, 28, 0)');

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - t * 0.5;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(this.flash.x, this.flash.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  };

  /* ========================================================================
     8. Score — puntuación y récord
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
     9. Render — dibujado
     ------------------------------------------------------------------------
     Cada elemento tiene su función `draw*`: si existe el sprite lo usa y si
     no, cae en el rectángulo. Para cambiar el aspecto, toca solo esta zona.
     ======================================================================== */

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const Render = {
    groundOffset: 0,  // desplazamiento horizontal del suelo (px hacia la izquierda)
    backgroundX: 0,   // desplazamiento del fondo (loop infinito hacia la izquierda)
    shakeDuration: 0, // ms restantes de sacudida de cámara
    shakeIntensity: 10,

    /** Ajusta la resolución real del lienzo a la pantalla (nitidez en HiDPI).
     *  El tamaño visible lo marca el CSS (aspect-ratio); aquí solo el buffer. */
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const nextW = Math.round(W * dpr);
      const nextH = Math.round(H * dpr);
      if (canvas.width === nextW && canvas.height === nextH) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        return;
      }
      canvas.width = nextW;
      canvas.height = nextH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
    },

    startShake() {
      this.shakeDuration = CONFIG.shake.duration;
      this.shakeIntensity = CONFIG.shake.intensity;
    },

    frame(time) {
      ctx.clearRect(0, 0, W, H);

      ctx.save();
      if (this.shakeDuration > 0) {
        ctx.translate(
          (Math.random() - 0.5) * this.shakeIntensity,
          (Math.random() - 0.5) * this.shakeIntensity
        );
      }

      if (!Sprites.ready) {
        this.drawLoading();
        ctx.restore();
        return;
      }

      this.drawBackground(time);
      for (const pipe of Pipes.items) this.drawPipe(pipe);
      this.drawGround(time);
      Traffic.draw();
      this.drawPlayer();
      Particles.draw();
      ctx.restore();
    },

    drawLoading() {
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#0b1a2e');
      sky.addColorStop(1, '#13416f');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '16px "Press Start 2P", "Pixelify Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Cargando recursos...', W / 2, H / 2);
    },

    // ---- Fondo -----------------------------------------------------------
    drawBackground(time) {
      const sprite = Sprites.get('background');
      if (sprite) {
        this.drawScrollingBackground(sprite);
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
     * Fondo a pantalla completa, teselado en X. La altura cubre el lienzo y
     * el ancho conserva la proporción del PNG.
     */
    drawScrollingBackground(sprite) {
      const bgH = H;
      const bgW = Math.ceil(sprite.naturalWidth * (bgH / sprite.naturalHeight));

      while (this.backgroundX <= -bgW) this.backgroundX += bgW;
      if (this.backgroundX > 0) this.backgroundX = 0;

      // Posición entera + 1px de solape: evita la raya por subpíxeles / antialias
      const x = Math.round(this.backgroundX);
      ctx.drawImage(sprite, x, 0, bgW, bgH);
      ctx.drawImage(sprite, x + bgW - 1, 0, bgW, bgH);
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
      const { width } = CONFIG.pipes;
      const x = pipe.x - width / 2;
      const gapTop = pipe.gapY - pipe.gap / 2;
      const gapBottom = pipe.gapY + pipe.gap / 2;

      // Mitad superior (invertida) y mitad inferior (hasta el suelo)
      this.drawPipeHalf(x, 0, width, gapTop, 'top');
      this.drawPipeHalf(x, gapBottom, width, FLOOR_Y - gapBottom, 'bottom');

      // Remate rectangular solo si no hay sprite de torre (tower.png ya incluye el techo)
      if (!Sprites.get('pipeBody')) {
        this.drawPipeCap(x, gapTop - CONFIG.pipes.capHeight, width, CONFIG.pipes.capHeight);
        this.drawPipeCap(x, gapBottom, width, CONFIG.pipes.capHeight);
      }
    },

    drawPipeHalf(x, y, w, h, side) {
      if (h <= 0) return;

      const sprite = Sprites.get('pipeBody');
      if (sprite) {
        const src = Sprites.sourceRect('pipeBody', sprite);
        ctx.save();
        if (side === 'top') {
          // Torre superior: de cabeza, anclada al techo
          ctx.translate(x, y + h);
          ctx.scale(1, -1);
          ctx.drawImage(sprite, src.sx, src.sy, src.sw, src.sh, 0, 0, w, h);
        } else {
          ctx.drawImage(sprite, src.sx, src.sy, src.sw, src.sh, x, y, w, h);
        }
        ctx.restore();
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
        const tileW = Math.max(1, sprite.naturalWidth * (gh / sprite.naturalHeight));
        const offset = ((this.groundOffset % tileW) + tileW) % tileW;
        for (let x = -offset; x < W; x += tileW) {
          ctx.drawImage(sprite, x, FLOOR_Y, tileW, gh);
        }
        return;
      }

      ctx.fillStyle = '#cfa96b';
      ctx.fillRect(0, FLOOR_Y, W, gh);

      // Franjas en movimiento: dan sensación de avance
      const stripeW = 30;
      const shift = this.groundOffset % (stripeW * 2);
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
      if (Player.crashed) return; // destruido: en su lugar queda la explosión

      const { width: w, height: h } = Player;

      ctx.save();
      ctx.translate(Player.x, Player.y);
      ctx.rotate(Player.tilt);

      const sprite = Sprites.get('player');
      if (sprite) {
        const src = Sprites.sourceRect('player', sprite);
        // El PNG mira a la izquierda; se voltea para apuntar al sentido del vuelo
        ctx.scale(-1, 1);
        ctx.drawImage(sprite, src.sx, src.sy, src.sw, src.sh, -w / 2, -h / 2, w, h);
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
    10. UI — capas de interfaz y marcador del DOM
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
     11. Audio — motor y explosión (autoplay seguro)
     ------------------------------------------------------------------------
     Los navegadores bloquean Audio.play() si no hay un gesto previo. El
     sonido de explosión se dispara desde el bucle (no desde un tap), así
     que hay que "desbloquear" los elementos en la primera interacción.
     Todas las llamadas a play() se envuelven para no dejar Promises
     rechazadas sin capturar en consola.
     ======================================================================== */

  /** Reproduce un elemento de audio sin lanzar ni dejar unhandledrejection. */
  function safePlay(el) {
    if (!el) return;
    try {
      const result = el.play();
      if (result && typeof result.catch === 'function') {
        result.catch(() => { /* autoplay bloqueado o archivo ausente */ });
      }
    } catch { /* ignore */ }
  }

  function safePause(el) {
    if (!el) return;
    try { el.pause(); } catch { /* ignore */ }
  }

  function safeRewind(el) {
    if (!el) return;
    try { el.currentTime = 0; } catch { /* aún sin datos cargados */ }
  }

  function createSound(src, { loop = false, volume = 1 } = {}) {
    const audio = new Audio(src);
    audio.loop = loop;
    audio.volume = volume;
    audio.preload = 'auto';
    audio.playsInline = true;
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', 'true');
    return audio;
  }

  const AudioHub = {
    unlocked: false,
    primed: false,

    /** Marca que ya hubo un gesto: a partir de aquí play() está permitido. */
    noteGesture() {
      this.unlocked = true;
    },

    /**
     * Ceba la explosión (play silenciado + pause) para poder dispararla
     * más tarde desde el bucle, fuera de un gesto. Llamar DESPUÉS de
     * arrancar el motor, para que iOS no “gaste” el gesto en el mute.
     */
    primeExplosion() {
      if (this.primed) return;
      this.primed = true;

      const el = ExplosionSound.el;
      if (!el) return;

      const volume = el.volume;
      el.muted = true;
      el.volume = 0;
      try {
        const result = el.play();
        const restore = () => {
          safePause(el);
          safeRewind(el);
          el.muted = false;
          el.volume = volume;
        };
        if (result && typeof result.then === 'function') {
          result.then(restore).catch(restore);
        } else {
          restore();
        }
      } catch {
        el.muted = false;
        el.volume = volume;
      }
    },

    /** Primera interacción: permite audio y ceba la explosión. */
    unlock() {
      this.noteGesture();
      this.primeExplosion();
    },
  };

  const PlaneSound = {
    el: null,

    init() {
      this.el = createSound(SOUND_SOURCES.engine, { loop: true, volume: 0.4 });
    },

    play() {
      if (!this.el || !AudioHub.unlocked) return;
      safePlay(this.el);
    },

    pause() {
      safePause(this.el);
    },

    stop() {
      safePause(this.el);
      safeRewind(this.el);
    },
  };

  /** Explosión del choque: un disparo puntual, siempre desde el segundo 0. */
  const ExplosionSound = {
    el: null,

    init() {
      this.el = createSound(SOUND_SOURCES.explosion, { volume: 0.75 });
    },

    play() {
      if (!this.el || !AudioHub.unlocked) return;
      safeRewind(this.el);
      safePlay(this.el);
    },

    stop() {
      safePause(this.el);
      safeRewind(this.el);
    },
  };

  /* ========================================================================
     12. Game — máquina de estados y bucle principal
     ======================================================================== */

  const STATE = { LOADING: 'loading', READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };

  const Game = {
    state: STATE.LOADING,
    lastFrame: 0,
    elapsed: 0,   // tiempo acumulado, usado para las animaciones de fondo
    diedAt: 0,

    init() {
      Render.resize();
      Score.init();
      PlaneSound.init();
      ExplosionSound.init();
      UI.hideAll();
      this.state = STATE.LOADING;

      const onViewportChange = () => Render.resize();
      window.addEventListener('resize', onViewportChange);
      window.addEventListener('orientationchange', onViewportChange);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onViewportChange);
      }
      Input.bind();

      requestAnimationFrame((t) => {
        this.lastFrame = t;
        this.loop(t);
      });

      Sprites.load().then(() => {
        if (this.state === STATE.LOADING) this.toReady();
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
      Traffic.reset();
      Particles.clear();
      Render.shakeDuration = 0;
      ExplosionSound.stop();
      UI.showStart();
      UI.setPaused(false);
    },

    start() {
      if (this.state !== STATE.READY || !Sprites.ready) return;
      this.state = STATE.PLAYING;
      UI.hideAll();
      Player.jump();
      PlaneSound.play();
    },

    /**
     * Congela el escenario y lanza el efecto de destrucción en el punto de
     * impacto. `impact` son las coordenadas devueltas por Physics.playerImpact.
     */
    gameOver(impact) {
      if (this.state === STATE.OVER) return;
      this.state = STATE.OVER;
      this.diedAt = performance.now();

      PlaneSound.stop();       // primero el motor, luego la explosión
      ExplosionSound.play();

      Player.crashed = true;
      Particles.burst(impact.x, impact.y);
      Render.startShake();

      Score.commit();
      UI.showGameOver();
    },

    /** Reinicia y arranca de inmediato (pantalla de Game Over). */
    restart() {
      if (!Sprites.ready) return;
      this.toReady();
      this.start();
    },

    togglePause() {
      if (this.state === STATE.PLAYING) {
        this.state = STATE.PAUSED;
        UI.setPaused(true);
        PlaneSound.pause();
      } else if (this.state === STATE.PAUSED) {
        this.state = STATE.PLAYING;
        UI.setPaused(false);
        PlaneSound.play();
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
        const speed = Pipes.currentSpeed();
        Render.groundOffset += speed * dt;
        Render.backgroundX -= speed * CONFIG.parallax.background * dt;
        Player.update(dt);
        Pipes.update(dt);
        Traffic.update(dt);
        const impact = Physics.playerImpact();
        if (impact) this.gameOver(impact);
      } else if (this.state === STATE.READY) {
        this.elapsed += dt * 1000;
        const speed = CONFIG.pipes.speed;
        Render.groundOffset += speed * dt;
        Render.backgroundX -= speed * CONFIG.parallax.background * dt;
        Player.idle(this.elapsed);
        Traffic.update(dt);
      }

      // El humo, la metralla y la sacudida siguen vivos sobre el escenario congelado
      if (this.state !== STATE.PAUSED) {
        Particles.update(dt);
        if (Render.shakeDuration > 0) {
          Render.shakeDuration = Math.max(0, Render.shakeDuration - dt * 1000);
        }
      }

      Render.frame(this.elapsed);
      requestAnimationFrame((t) => this.loop(t));
    },
  };

  /* ========================================================================
     13. Input — teclado, ratón y táctil
     ======================================================================== */

  const Input = {
    /** Evita que touchstart + pointerdown + click disparen el salto dos veces. */
    ignorePointer: false,

    /** Acción principal: empezar, saltar o reiniciar según el estado. */
    primary() {
      AudioHub.noteGesture();
      if (!Sprites.ready || Game.state === STATE.LOADING) {
        AudioHub.primeExplosion();
        return;
      }

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

      AudioHub.primeExplosion();
    },

    /** Toque en el lienzo: previene scroll/zoom y ejecuta la acción. */
    onTouchStart(event) {
      event.preventDefault();
      this.ignorePointer = true;
      this.primary();
      window.setTimeout(() => { this.ignorePointer = false; }, 500);
    },

    /** Clic / stylus. Los toques ya se resolvieron en touchstart. */
    onPointerDown(event) {
      if (this.ignorePointer || event.pointerType === 'touch') return;
      event.preventDefault();
      this.ignorePointer = true;
      window.setTimeout(() => { this.ignorePointer = false; }, 500);
      this.primary();
    },

    bind() {
      const shell = document.getElementById('game-shell');
      const playArea = shell || canvas;
      const touchOpts = { passive: false };

      // --- Teclado ---
      window.addEventListener('keydown', (event) => {
        if (event.repeat) return;

        // Cualquier tecla cuenta como gesto: desbloquea audio
        AudioHub.unlock();

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

      // --- Táctil (mobile): touchstart explícito, no pasivo, para poder
      //     cancelar el desplazamiento y el zoom por doble toque. ---
      playArea.addEventListener('touchstart', (event) => {
        this.onTouchStart(event);
      }, touchOpts);
      playArea.addEventListener('touchmove', (event) => {
        event.preventDefault();
      }, touchOpts);

      // --- Ratón / lápiz sobre el marco del juego (incluye el canvas) ---
      playArea.addEventListener('pointerdown', (event) => {
        this.onPointerDown(event);
      });

      // Clic como respaldo (navegadores sin Pointer Events)
      playArea.addEventListener('click', (event) => {
        if (this.ignorePointer) return;
        event.preventDefault();
        this.primary();
      });

      // Evita el menú contextual al mantener pulsado en móvil
      playArea.addEventListener('contextmenu', (event) => event.preventDefault());

      // --- Botones ---
      UI.btnRestart.addEventListener('click', () => {
        AudioHub.unlock();
        Game.restart();
        UI.btnRestart.blur(); // devuelve el foco para que Espacio siga saltando
      });

      UI.btnPause.addEventListener('click', () => {
        AudioHub.unlock();
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
