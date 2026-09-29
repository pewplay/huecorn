// keys.js - tracks which keys are currently held down.
// Touch controls feed the same table with virtual key codes, so the hero code
// only ever asks "is this key down?".
var Keys = {
  down: {},

  isDown: function (code) {
    return !!Keys.down[code];
  },

  init: function () {
    var gameKeys = {
      ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Space: 1,
    };

    window.addEventListener("keydown", function (e) {
      Keys.down[e.code] = true;
      // Keep arrows/space from scrolling a hosting page when running in an iframe.
      if (gameKeys[e.code]) e.preventDefault();
    });
    window.addEventListener("keyup", function (e) {
      Keys.down[e.code] = false;
    });

    // No long-press menus, pinch zoom or double-tap zoom on the game.
    function prevent(e) {
      if (e.target && e.target.closest && e.target.closest("#mute")) return;
      e.preventDefault();
    }
    var passiveFalse = { passive: false };
    document.addEventListener("touchstart", prevent, passiveFalse);
    document.addEventListener("touchmove", prevent, passiveFalse);
    document.addEventListener("gesturestart", prevent, passiveFalse);
    document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    Keys.bindDpad(document.getElementById("dpad"));
    Keys.bindJump(document.getElementById("jump"));

    window.addEventListener("blur", Keys.releaseAll);
  },

  releaseAll: function () {
    for (var code in Keys.down) Keys.down[code] = false;
    Keys.dpadPointers = {};
    Keys.updateDpad();
    var jump = document.getElementById("jump");
    if (jump) jump.classList.remove("active");
  },

  // The d-pad is one touch zone: the left half steers left, the right half
  // steers right, and a thumb can slide between them without lifting.
  dpadPointers: {},
  dpadElement: null,

  bindDpad: function (pad) {
    if (!pad) return;
    Keys.dpadElement = pad;

    function direction(e) {
      var rect = pad.getBoundingClientRect();
      return e.clientX < rect.left + rect.width / 2 ? -1 : 1;
    }
    function press(e) {
      e.preventDefault();
      try { pad.setPointerCapture(e.pointerId); } catch (err) {}
      Keys.dpadPointers[e.pointerId] = direction(e);
      Keys.updateDpad();
    }
    function move(e) {
      if (Keys.dpadPointers[e.pointerId] === undefined) return;
      Keys.dpadPointers[e.pointerId] = direction(e);
      Keys.updateDpad();
    }
    function release(e) {
      delete Keys.dpadPointers[e.pointerId];
      Keys.updateDpad();
    }
    pad.addEventListener("pointerdown", press);
    pad.addEventListener("pointermove", move);
    pad.addEventListener("pointerup", release);
    pad.addEventListener("pointercancel", release);
    pad.addEventListener("lostpointercapture", release);
  },

  updateDpad: function () {
    var left = false;
    var right = false;
    for (var id in Keys.dpadPointers) {
      if (Keys.dpadPointers[id] < 0) left = true;
      else right = true;
    }
    Keys.down.TouchLeft = left;
    Keys.down.TouchRight = right;
    if (!Keys.dpadElement) return;
    var buttons = Keys.dpadElement.querySelectorAll("[data-dir]");
    for (var i = 0; i < buttons.length; i++) {
      var dir = buttons[i].getAttribute("data-dir");
      buttons[i].classList.toggle("active", dir === "-1" ? left : right);
    }
  },

  bindJump: function (button) {
    if (!button) return;
    var pointers = {};
    function count() {
      var n = 0;
      for (var id in pointers) n++;
      return n;
    }
    function press(e) {
      e.preventDefault();
      try { button.setPointerCapture(e.pointerId); } catch (err) {}
      // A fresh press while another finger still holds the button must still
      // register as a new jump (double jump), so pulse the key up first.
      if (count() > 0) Keys.jumpPulse = true;
      pointers[e.pointerId] = true;
      Keys.down.TouchJump = true;
      button.classList.add("active");
    }
    function release(e) {
      delete pointers[e.pointerId];
      if (count() === 0) {
        Keys.down.TouchJump = false;
        button.classList.remove("active");
      }
    }
    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  },

  jumpPulse: false,
};
