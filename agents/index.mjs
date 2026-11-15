// Agent types and the config → agent-instance factory.
//
// A config file declares agent *instances*. Each one picks a `type`: either a built-in type
// below, or a path to your own module (absolute, or relative to the config file) that
// exports the same shape as the built-ins. See docs/writing-agents.md.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createT, localized } from '../lib/i18n.mjs';
import host from './host.mjs';
import llmApp from './llm-app.mjs';
import teamPortal from './team-portal.mjs';
import sites from './sites.mjs';

export const TYPES = { host, 'llm-app': llmApp, 'team-portal': teamPortal, sites };

const isPath = type => type.startsWith('./') || type.startsWith('../') || path.isAbsolute(type);

/** Validate the shape every agent type must have. */
export function assertAgentType(mod, label) {
  if (!mod || typeof mod.run !== 'function') {
    throw new Error(`agent type "${label}" must export default { run(ctx) { ... } }`);
  }
  return mod;
}

/**
 * @param {object} config        parsed config.json
 * @param {object} [opts]
 * @param {string} [opts.baseDir] directory that relative plugin paths resolve against (the config's folder)
 * @param {object} [opts.types]   built-in type table (tests can override)
 * @returns {Promise<Array<{id,name,icon,type,playbook,config,run}>>}
 */
export async function createAgents(config, { baseDir = process.cwd(), types = TYPES } = {}) {
  const locale = config.locale || 'en';
  const t = createT(locale);
  const seen = new Set();
  const agents = [];
  for (const a of config.agents || []) {
    if (a.enabled === false) continue;
    if (!a.id || seen.has(a.id)) throw new Error(`agent id missing or duplicated: "${a.id}"`);
    seen.add(a.id);
    let type = types[a.type];
    if (!type && typeof a.type === 'string' && isPath(a.type)) {
      const file = path.resolve(baseDir, a.type);
      type = assertAgentType((await import(pathToFileURL(file).href)).default, a.type);
    }
    if (!type) {
      throw new Error(`agent "${a.id}": unknown type "${a.type}" (built-in: ${Object.keys(types).join(', ')}, or a path to a plugin file)`);
    }
    const extra = Array.isArray(a.playbook) ? a.playbook.join('\n') : (a.playbook || '');
    agents.push({
      id: a.id,
      type: a.type,
      name: a.name || (type.nameKey ? t(type.nameKey) : type.defaultName) || a.id,
      icon: a.icon || type.defaultIcon || '🔧',
      playbook: [localized(type.playbook, locale), extra].filter(Boolean).join('\n'),
      config: { ...(config.shared || {}), ...a },
      run: type.run,
    });
  }
  return agents;
}
