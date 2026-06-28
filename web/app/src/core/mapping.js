/**
 * Mapping engine — translates pad presses into controller actions.
 *
 * The text config is a flat JSON object:
 *   {
 *     "pads": {
 *       "0":  { "trigger": "fireworks" },
 *       "1":  { "trigger": "fireworks", "args": { "x": 0.5, "y": 0.5 } },
 *       "12": { "preset-prev": true },
 *       "13": { "preset-next": true },
 *       "14": { "toggle": "stick-dancer" },
 *       "15": { "osc": { "address": "/eq/mirror", "value": 1 } }
 *     }
 *   }
 *
 * A pad's value is an action object with exactly one action key. Supported:
 *   - trigger:     <module-id>           // OR { id, args }
 *   - toggle:      <module-id>           // flip enabled-state for that module
 *   - load/unload: <module-id>
 *   - preset-next: true | preset-prev: true
 *   - osc:         { address, value }
 *
 * The engine keeps a soft model of each module's enabled state so toggle works
 * correctly — it syncs from server WS broadcasts and the initial GET on boot.
 */

const STORAGE_KEY = 'vj.mapping.v1';

export const DEFAULT_MAPPING = {
  pads: {
    '0':  { trigger: 'fireworks', args: { x: 0.2, y: 0.6, color: '#ff3d7f' } },
    '1':  { trigger: 'fireworks', args: { x: 0.5, y: 0.5, color: 'auto' } },
    '2':  { trigger: 'fireworks', args: { x: 0.8, y: 0.6, color: '#3df7ff' } },
    '3':  { trigger: 'peek-seagull' },
    '4':  { trigger: 'fireworks', args: { x: 0.2, y: 0.35, color: '#8c3aff', count: 50 } },
    '5':  { trigger: 'fireworks', args: { x: 0.5, y: 0.25, color: '#ff8c2a', count: 100 } },
    '6':  { trigger: 'fireworks', args: { x: 0.8, y: 0.35, color: '#3dff7f', count: 50 } },
    '7':  { trigger: 'big-message', args: { text: 'BOOM' } },
    '12': { 'preset-prev': true },
    '13': { 'preset-next': true },
    '14': { toggle: 'stick-dancer' },
    '15': { trigger: 'big-message', args: { text: 'DROP' } },
  },
};

export function loadMappingFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_MAPPING);
    const parsed = JSON.parse(raw);
    if (!parsed.pads || typeof parsed.pads !== 'object') return structuredClone(DEFAULT_MAPPING);
    return parsed;
  } catch (e) {
    console.warn('[mapping] failed to load from localStorage:', e);
    return structuredClone(DEFAULT_MAPPING);
  }
}

export function saveMappingToStorage(mapping) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mapping, null, 2));
    return true;
  } catch (e) {
    console.warn('[mapping] failed to save:', e);
    return false;
  }
}

export function createMappingEngine({ mapping = DEFAULT_MAPPING, baseUrl = '' } = {}) {
  let current = mapping;
  const enabledState = new Map();   // moduleId -> bool (mirrors server)
  const listeners = [];             // post-dispatch callbacks (for UI feedback)

  function setMapping(next) {
    if (!next || typeof next !== 'object' || !next.pads) {
      throw new Error('mapping must have a `pads` object');
    }
    current = next;
  }
  function getMapping() { return current; }

  function setEnabled(id, enabled) { enabledState.set(id, !!enabled); }
  function isEnabled(id)           { return enabledState.get(id) ?? true; }

  function on(fn) { listeners.push(fn); }
  function emit(event) {
    for (const fn of listeners) {
      try { fn(event); } catch (e) { console.warn(e); }
    }
  }

  async function post(path, body) {
    try {
      const res = await fetch(baseUrl + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      return res.json();
    } catch (e) {
      console.warn(`[mapping] POST ${path} failed:`, e);
      throw e;
    }
  }

  async function dispatchAction(action, ctx = {}) {
    if (!action || typeof action !== 'object') return null;

    // trigger
    if (action.trigger !== undefined) {
      const id   = typeof action.trigger === 'string' ? action.trigger : action.trigger.id;
      const args = action.args ?? (typeof action.trigger === 'object' ? action.trigger.args : undefined);
      if (!id) return null;
      emit({ kind: 'trigger', id, args, ...ctx });
      return post('/browser-modules/trigger', { id, args });
    }

    // toggle (flip the current enabled state)
    if (action.toggle !== undefined) {
      const id   = action.toggle;
      const next = !isEnabled(id);
      enabledState.set(id, next);   // optimistic — WS broadcast will confirm
      emit({ kind: 'toggle', id, enabled: next, ...ctx });
      return post('/browser-modules/enable', { id, enabled: next });
    }

    // load / unload
    if (action.load !== undefined) {
      emit({ kind: 'load', id: action.load, ...ctx });
      return post('/browser-modules/load', { id: action.load });
    }
    if (action.unload !== undefined) {
      emit({ kind: 'unload', id: action.unload, ...ctx });
      return post('/browser-modules/unload', { id: action.unload });
    }

    // preset navigation
    if (action['preset-next']) {
      emit({ kind: 'preset-next', ...ctx });
      return post('/browser-modules/preset-next');
    }
    if (action['preset-prev']) {
      emit({ kind: 'preset-prev', ...ctx });
      return post('/browser-modules/preset-prev');
    }

    // raw OSC
    if (action.osc !== undefined) {
      const { address, value } = action.osc;
      if (!address) return null;
      emit({ kind: 'osc', address, value, ...ctx });
      return post('/osc', { address, value });
    }

    console.warn('[mapping] unknown action shape:', action);
    return null;
  }

  function onPadPress(idx, velocity, source) {
    const entry = current?.pads?.[String(idx)];
    if (!entry) {
      emit({ kind: 'pad', idx, mapped: false, source });
      return null;
    }
    return dispatchAction(entry, { idx, velocity, source });
  }

  return {
    setMapping, getMapping,
    setEnabled, isEnabled,
    on,
    onPadPress, dispatchAction,
  };
}
