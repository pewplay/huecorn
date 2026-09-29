// game.js - canvas setup, responsive layout + main loop
var canvas, ctx, camera, hero, lastTime, wallRideShakeTimer;
var titleScreen = true;
var titleTime = 0;
var cloudTime = 0;
var titleBurstTimer = 0.25;
var titleCamera = { x: 0, y: 0 };

// The game world is drawn in logical units. The logical height is always 480
// (as in the original 800 x 480 game); the logical width follows the shape of
// the screen, between a square-ish view on portrait phones and ultra-wide.
var GAME_HEIGHT = 480;
var GAME_WIDTH = 800;
var MIN_ASPECT = 0.9;
var MAX_ASPECT = 2.2;
var HUD_SCALE = 1; // enlarges HUD text on small screens
var HUD_RIGHT_INSET = 0; // room for the mute button, in HUD units
var isTouch = false;
var paused = false;

var BEST_RUN_KEY = "huecorn:best";
var bestRun = null;
try {
  var savedRun = JSON.parse(localStorage.getItem(BEST_RUN_KEY));
  if (savedRun && savedRun[0] > 0 && savedRun[1] >= 0) bestRun = savedRun;
} catch (e) {}

function startGame() {
  canvas = document.getElementById("c");
  ctx = canvas.getContext("2d");

  isTouch =
    (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
    (navigator.maxTouchPoints > 0 && window.matchMedia && window.matchMedia("(hover: none)").matches);
  document.body.classList.toggle("touch", isTouch);

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () {
    setTimeout(resize, 150);
  });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);

  genAudio();

  // Sound must be unlocked before the music tries to start.
  Sound.init();
  window.addEventListener("keydown", startMusic);
  window.addEventListener("pointerdown", startMusic);
  window.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "touch" && !isTouch) {
      isTouch = true;
      document.body.classList.add("touch");
      resize();
    }
    if (e.target && e.target.closest && e.target.closest("#mute")) return;
    startFromTitle();
  });
  window.addEventListener("keydown", function (e) {
    if (e.code === "KeyM") toggleMute();
    if ((e.code === "Space" || e.code === "Enter") && titleTime > 0.6) startFromTitle();
  });
  Keys.init();
  Level.init();

  var muteButton = document.getElementById("mute");
  muteButton.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    Sound.unlock();
    toggleMute();
  });
  muteButton.addEventListener("keydown", function (e) {
    // Space/Enter on the focused button would otherwise click it twice.
    if (e.code === "Space" || e.code === "Enter") e.preventDefault();
  });
  updateMuteButton();

  document.addEventListener("visibilitychange", function () {
    paused = document.hidden;
    if (paused) Keys.releaseAll();
    lastTime = performance.now();
  });

  hero = new Hero(64, 64);
  camera = new Camera(GAME_WIDTH, GAME_HEIGHT);
  wallRideShakeTimer = 0;

  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function toggleMute() {
  Sound.setMuted(!Sound.muted);
  updateMuteButton();
}

function updateMuteButton() {
  var button = document.getElementById("mute");
  button.classList.toggle("muted", Sound.muted);
  button.setAttribute("aria-label", Sound.muted ? "Unmute sound" : "Mute sound");
}

function startFromTitle() {
  if (!titleScreen) return;
  if (Level.gameComplete) {
    Level.runTimer = Level.deathCount = 0;
    Level.resetLevel(hero, 0);
  }
  titleScreen = false;
  // A held Space/tap that started the game must not also trigger a jump.
  hero.jumpKeyWasDown = true;
  Particles.items.length = 0;
  document.body.classList.remove("title-screen");
}

function px(value) {
  return Math.round(value) + "px";
}

function resize() {
  var viewW = Math.max(1, window.innerWidth);
  var viewH = Math.max(1, window.innerHeight);

  // On touch devices held upright, the controls get their own band under the
  // game so thumbs never cover the action. In landscape they overlay the corners.
  var controlsBelow = isTouch && viewH > viewW * 1.05;
  document.body.classList.toggle("controls-below", controlsBelow);
  var reserved = controlsBelow ? Math.round(clamp(viewH * 0.3, 170, 340)) : 0;
  var areaW = viewW;
  var areaH = viewH - reserved;

  var aspect = clamp(areaW / areaH, MIN_ASPECT, MAX_ASPECT);
  var cssW = Math.min(areaW, areaH * aspect);
  var cssH = cssW / aspect;
  var left = (areaW - cssW) / 2;
  var top = controlsBelow ? (areaH - cssH) * 0.35 : (areaH - cssH) / 2;

  GAME_WIDTH = Math.round(GAME_HEIGHT * aspect);
  canvas.style.width = px(cssW);
  canvas.style.height = px(cssH);
  canvas.style.left = px(left);
  canvas.style.top = px(top);

  // Rasterise at the real display resolution so thin outlines stay crisp.
  var pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.max(1, Math.round(Math.round(cssW) * pixelRatio));
  canvas.height = Math.max(1, Math.round(Math.round(cssH) * pixelRatio));
  ctx.setTransform(canvas.width / GAME_WIDTH, 0, 0, canvas.height / GAME_HEIGHT, 0, 0);
  ctx.imageSmoothingEnabled = false;

  // Keep HUD text at least ~13 CSS px tall.
  var cssPerUnit = cssW / GAME_WIDTH;
  HUD_SCALE = clamp(13 / (15 * cssPerUnit), 1, 1.45);

  // Mute button: top-right corner of the game view.
  var mute = document.getElementById("mute");
  var muteSize = 44;
  mute.style.left = px(left + cssW - muteSize - 6);
  mute.style.top = px(top + 6);
  mute.style.right = "auto";
  HUD_RIGHT_INSET = (muteSize + 8) / (cssPerUnit * HUD_SCALE);

  layoutTouchControls(viewW, viewH, controlsBelow, top + cssH);

  if (camera) camera.resize(GAME_WIDTH, GAME_HEIGHT);
}

function layoutTouchControls(viewW, viewH, controlsBelow, gameBottom) {
  var dpad = document.getElementById("dpad");
  var jump = document.getElementById("jump");
  var size, bottom, side;
  if (controlsBelow) {
    var band = viewH - gameBottom;
    size = Math.round(clamp(Math.min(viewW * 0.22, band * 0.42), 70, 116));
    bottom = Math.max(16, (band - size) / 2);
    side = Math.round(clamp(viewW * 0.06, 16, 60));
  } else {
    size = Math.round(clamp(Math.min(viewW, viewH) * 0.2, 64, 100));
    bottom = Math.round(clamp(viewH * 0.05, 12, 36));
    side = Math.round(clamp(viewW * 0.025, 14, 40));
  }
  var jumpSize = Math.round(size * 1.12);
  dpad.style.width = px(size * 2 + 10);
  dpad.style.height = px(size);
  dpad.style.left = "calc(" + px(side) + " + env(safe-area-inset-left, 0px))";
  dpad.style.bottom = "calc(" + px(bottom) + " + env(safe-area-inset-bottom, 0px))";
  jump.style.width = px(jumpSize);
  jump.style.height = px(jumpSize);
  jump.style.right = "calc(" + px(side) + " + env(safe-area-inset-right, 0px))";
  jump.style.bottom =
    "calc(" + px(bottom + (size - jumpSize) / 2 + (controlsBelow ? 0 : size * 0.15)) + " + env(safe-area-inset-bottom, 0px))";
  jump.style.fontSize = px(clamp(size * 0.2, 14, 20));
}

function loop(now) {
  var dt = Math.min((now - lastTime) / 1000, 1 / 30); // clamp to avoid huge steps on tab-switch
  lastTime = now;

  if (!paused) {
    update(dt);
    draw();
  }

  requestAnimationFrame(loop);
}

function update(dt) {
  cloudTime += dt;
  if (titleScreen) {
    titleTime += dt;
    titleBurstTimer -= dt;
    if (titleBurstTimer <= 0) {
      Particles.titleBurst(
        90 + Math.random() * (GAME_WIDTH - 180),
        70 + Math.random() * (GAME_HEIGHT - 170)
      );
      titleBurstTimer = Level.gameComplete ? 0.6 : 1.8 + Math.random() * 1.8;
    }
    Particles.update(dt);
    return;
  }

  if (Level.failed || Level.complete) {
    if (Level.complete) camera.follow(hero, dt);
    Level.update(hero, dt);
    Particles.update(dt);
    camera.updateShake(dt);
    return;
  }

  var wasGrounded = hero.onGround;
  var wasTouchingWall = hero.touchingWallLeft || hero.touchingWallRight;
  var previousVx = hero.vx;
  var previousVy = hero.vy;
  var previousJumpSerial = hero.jumpSerial;

  Level.updateMovingPlatforms(hero, dt);
  hero.update(dt);
  Level.update(hero, dt);
  Particles.update(dt);
  camera.follow(hero, dt);

  if (hero.jumpSerial !== previousJumpSerial) {
    camera.shake(2.5, 0.1);
  }
  if (!wasGrounded && hero.onGround) {
    camera.shake(clamp(previousVy / 80, 3, 8), 0.18);
  }

  var wallRiding =
    !hero.onGround && (hero.touchingWallLeft || hero.touchingWallRight);
  if (wallRiding && !wasTouchingWall) {
    camera.shake(clamp(Math.abs(previousVx) / 140, 1.2, 2.2), 0.11);
    wallRideShakeTimer = 0.09;
  } else if (wallRiding && hero.vy > 0) {
    wallRideShakeTimer -= dt;
    if (wallRideShakeTimer <= 0) {
      camera.shake(0.55, 0.045);
      wallRideShakeTimer = 0.1;
    }
  } else {
    wallRideShakeTimer = 0;
  }

  camera.updateShake(dt);
}

function draw() {
  if (titleScreen) {
    drawTitleScreen();
    return;
  }

  ctx.fillStyle = "#7ec0ee";
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  // Restore the distant rainbow one crystal at a time, red on the outside.
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.lineWidth = 9;
  var rainbowBand = 0;
  for (var color in COLOR_INFO) {
    if (Level.isColorUnlocked(color)) {
      ctx.strokeStyle = COLOR_INFO[color].color;
      ctx.beginPath();
      ctx.arc(
        GAME_WIDTH / 2 - camera.x * 0.02,
        350 - camera.y * 0.01,
        265 - rainbowBand * 9,
        Math.PI,
        Math.PI * 2
      );
      ctx.stroke();
    }
    rainbowBand++;
  }
  ctx.restore();

  // Faint cloud banks drift independently, with a little distant parallax.
  ctx.fillStyle = "rgba(244, 240, 255, 0.18)";
  for (var cloud = 0; cloud < 5; cloud++) {
    var span = GAME_WIDTH + 240;
    var cloudX = ((cloud * 227 + cloudTime * (3 + cloud % 3) - camera.x * 0.025) % span + span) % span - 120;
    var cloudY = 65 + (cloud * 53) % 150 - camera.y * 0.015;
    ctx.beginPath();
    for (var puff = 0; puff < 3; puff++) {
      var puffX = cloudX + (puff - 1) * 30;
      var puffY = cloudY - (puff === 1 ? 9 : 0);
      var radius = 34 + (cloud % 2) * 8;
      ctx.moveTo(puffX + radius, puffY);
      ctx.ellipse(puffX, puffY, radius, puff === 1 ? 20 : 13, 0, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // Two distant ridgelines drift at different speeds for cheap parallax depth.
  for (var layer = 0; layer < 2; layer++) {
    ctx.fillStyle = layer ? "#72a8ca" : "#a7cee4";
    ctx.beginPath();
    ctx.moveTo(0, GAME_HEIGHT);
    for (var x = -200; x < GAME_WIDTH + 300; x += 100) {
      ctx.lineTo(
        x - ((camera.x * (layer + 1)) / 12) % 200,
        320 + layer * 70 - (x % 200 ? 45 : 0) - (camera.y * (layer + 1)) / 24
      );
    }
    ctx.lineTo(GAME_WIDTH, GAME_HEIGHT);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(Math.round(camera.shakeX), Math.round(camera.shakeY));
  ctx.translate(GAME_WIDTH / 2, GAME_HEIGHT / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.viewWidth / 2, -camera.viewHeight / 2);
  Level.draw(ctx, camera);
  hero.drawShadow(ctx, camera);
  Particles.draw(ctx, camera);
  hero.draw(ctx, camera);
  ctx.restore();
  ctx.save();
  ctx.scale(HUD_SCALE, HUD_SCALE);
  Level.drawHud(ctx, GAME_WIDTH / HUD_SCALE, GAME_HEIGHT / HUD_SCALE);
  ctx.restore();
}

function drawTitleScreen() {
  var W = GAME_WIDTH;
  var H = GAME_HEIGHT;
  var gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, "#18264a");
  gradient.addColorStop(1, "#39204f");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  Particles.draw(ctx, titleCamera);

  // Wide screens use the original single-line layout; narrow (portrait)
  // screens get a taller panel with the tagline split over two lines.
  var narrow = W < 700;
  var panelW = narrow ? W - 36 : 660;
  var panelH = narrow ? 400 : 320;
  var panelX = (W - panelW) / 2;
  var panelY = (H - panelH) / 2;
  var cx = W / 2;

  ctx.fillStyle = "rgba(10, 14, 30, 0.78)";
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = 2;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  var title = "Huecorn";
  var titleSize = narrow ? Math.min(82, Math.floor(panelW / 5.3)) : 82;
  ctx.font = "900 " + titleSize + "px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  var titleY = panelY + (narrow ? 72 : 84);
  var titleWidth = ctx.measureText(title).width;
  var titleX = (W - titleWidth) / 2;
  for (var i = 0; i < title.length; i++) {
    var letter = title[i];
    ctx.strokeStyle = "#0c1020";
    ctx.lineWidth = 7;
    ctx.strokeText(letter, titleX, titleY);
    ctx.fillStyle = Particles.rainbow[i % Particles.rainbow.length];
    ctx.fillText(letter, titleX, titleY);
    titleX += ctx.measureText(letter).width;
  }

  var bandTotal = Math.min(420, panelW - 60);
  var bandWidth = bandTotal / Particles.rainbow.length;
  for (var band = 0; band < Particles.rainbow.length; band++) {
    ctx.fillStyle = Particles.rainbow[band];
    ctx.fillRect(cx - bandTotal / 2 + band * bandWidth, titleY + 54, Math.ceil(bandWidth), 5);
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  var y = titleY + (narrow ? 104 : 111);
  if (Level.gameComplete) {
    ctx.font = "800 " + (narrow ? 30 : 26) + "px system-ui, sans-serif";
    ctx.fillText("Rainbow saved!", cx, y);
  } else if (narrow) {
    ctx.font = "700 26px system-ui, sans-serif";
    ctx.fillText("Collect 7 crystals,", cx, y - 16);
    ctx.fillText("save the rainbow!", cx, y + 18);
  } else {
    ctx.font = "700 24px system-ui, sans-serif";
    ctx.fillText("Collect 7 crystals, save the rainbow!", cx, y);
  }

  y += narrow ? 64 : 35;
  var statsFont = narrow ? 20 : 21;
  if (Level.gameComplete) {
    ctx.font = "800 " + statsFont + "px system-ui, sans-serif";
    ctx.fillText("TIME " + Level.formatRunTime() + "  /  DEATHS " + Level.deathCount, cx, y);
  }
  if (bestRun) {
    ctx.font = "700 " + (statsFont - 3) + "px system-ui, sans-serif";
    ctx.fillStyle = "#b8b7ff";
    ctx.fillText("BEST " + Level.formatRunTime(bestRun[0]) + "  /  DEATHS " + bestRun[1], cx, y + 30);
  }

  var prompt;
  if (isTouch) prompt = Level.gameComplete ? "TAP TO PLAY AGAIN" : "TAP TO START";
  else prompt = Level.gameComplete ? "CLICK OR PRESS SPACE TO PLAY AGAIN" : "CLICK OR PRESS SPACE TO START";
  ctx.fillStyle = "#fff";
  ctx.font = "800 " + (narrow ? 24 : 21) + "px system-ui, sans-serif";
  ctx.globalAlpha = 0.65 + Math.sin(titleTime * 4) * 0.35;
  ctx.fillText(prompt, cx, panelY + panelH - (narrow ? 40 : 22));
  ctx.globalAlpha = 1;

  ctx.font = "600 13px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.fillText(
    isTouch ? "Use the arrows to run  -  tap JUMP twice to double jump" : "Arrows / A D to run  -  Space / W / Up to jump  -  M to mute",
    cx,
    panelY + panelH + 22
  );
}
