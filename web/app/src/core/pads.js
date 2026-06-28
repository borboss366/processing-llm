/**
 * Unified pad input — keyboard + Web MIDI feeding a single padPress/padRelease
 * event channel. The mapping engine (Phase 4) sits downstream of this and
 * doesn't care which source the press came from.
 *
 * Keyboard layout (Ableton-style, top row = pads 12-15 like a Launchpad):
 *
 *   pads 12 13 14 15      keys  1 2 3 4
 *   pads  8  9 10 11   →        q w e r
 *   pads  4  5  6  7            a s d f
 *   pads  0  1  2  3            z x c v
 *
 * This means physically the keyboard mirrors the controller — bottom-left
 * pad = bottom-left key. Velocity = 1.0 for keyboard (keys aren't sensitive).
 *
 * Web MIDI: any note-on with velocity > 0 → pad press. Default mapping is
 * `note % 16` so any sequencer triggers something useful out of the box;
 * override with setMidiMap() to match your hardware's grid layout.
 */

const KEYBOARD_MAP = {
  'z': 0,  'x': 1,  'c': 2,  'v': 3,
  'a': 4,  's': 5,  'd': 6,  'f': 7,
  'q': 8,  'w': 9,  'e': 10, 'r': 11,
  '1': 12, '2': 13, '3': 14, '4': 15,
};

export function createPadController({ onPadPress, onPadRelease } = {}) {
  const listeners = {
    press:   onPadPress   ? [onPadPress]   : [],
    release: onPadRelease ? [onPadRelease] : [],
  };
  const pressed = new Set();

  let midiMap     = (note) => note % 16;
  let midiInputs  = [];
  let midiAccess  = null;

  function emit(kind, idx, vel, source) {
    for (const fn of listeners[kind]) {
      try { fn(idx, vel, source); } catch (e) { console.warn('[pads] listener threw:', e); }
    }
  }

  // ── Keyboard ────────────────────────────────────────────────────────────
  function onKeyDown(e) {
    // never steal keys from text inputs (mapping editor textarea, device picker, etc.)
    if (e.target?.matches?.('input, textarea, select, [contenteditable]')) return;
    if (e.repeat) return;
    const idx = KEYBOARD_MAP[e.key.toLowerCase()];
    if (idx === undefined) return;
    pressed.add(idx);
    emit('press', idx, 1.0, 'keyboard');
    e.preventDefault();
  }
  function onKeyUp(e) {
    const idx = KEYBOARD_MAP[e.key.toLowerCase()];
    if (idx === undefined) return;
    pressed.delete(idx);
    emit('release', idx, 0, 'keyboard');
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup',   onKeyUp);

  // ── Web MIDI ────────────────────────────────────────────────────────────
  function onMidiMessage(ev) {
    const [status, note, velocity] = ev.data;
    const cmd = status & 0xf0;
    const isNoteOn  = cmd === 0x90 && velocity > 0;
    const isNoteOff = cmd === 0x80 || (cmd === 0x90 && velocity === 0);
    if (!isNoteOn && !isNoteOff) return;

    const idx = midiMap(note);
    if (idx === null || idx === undefined || idx < 0 || idx > 15) return;

    if (isNoteOn) {
      pressed.add(idx);
      emit('press', idx, velocity / 127, 'midi');
    } else {
      pressed.delete(idx);
      emit('release', idx, 0, 'midi');
    }
  }

  function attachInput(input) {
    input.onmidimessage = onMidiMessage;
    midiInputs.push(input);
    console.log('[pads] MIDI input connected:', input.name || input.id);
  }
  function detachInput(input) {
    midiInputs = midiInputs.filter(i => i !== input);
    console.log('[pads] MIDI input disconnected:', input.name || input.id);
  }

  async function initMidi() {
    if (!navigator.requestMIDIAccess) {
      console.warn('[pads] Web MIDI not supported in this browser');
      return { ok: false, reason: 'unsupported' };
    }
    try {
      midiAccess = await navigator.requestMIDIAccess();
      for (const input of midiAccess.inputs.values()) attachInput(input);
      midiAccess.onstatechange = (e) => {
        if (e.port.type !== 'input') return;
        if (e.port.state === 'connected'    && !midiInputs.includes(e.port)) attachInput(e.port);
        if (e.port.state === 'disconnected') detachInput(e.port);
      };
      return { ok: true, inputs: midiInputs.map(i => i.name || i.id) };
    } catch (err) {
      console.warn('[pads] MIDI access denied:', err);
      return { ok: false, reason: err.message };
    }
  }

  return {
    initMidi,
    setMidiMap(fn) { midiMap = fn; },
    on(kind, fn) {
      if (!listeners[kind]) throw new Error(`unknown event: ${kind}`);
      listeners[kind].push(fn);
    },
    isPressed: (idx) => pressed.has(idx),
    listInputs: () => midiInputs.map(i => ({ id: i.id, name: i.name })),
    keyboardMap: () => ({ ...KEYBOARD_MAP }),
  };
}
