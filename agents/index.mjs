// Agent types. A config file declares agent *instances*: each picks a type, gets an id,
// a display name, an interval, its own settings and an optional site-specific playbook.
import host from './host.mjs';
import llmApp from './llm-app.mjs';
import teamPortal from './team-portal.mjs';
import sites from './sites.mjs';

export const TYPES = { host, 'llm-app': llmApp, 'team-portal': teamPortal, sites };

/**
 * @param {object} config  parsed config.json
 * @returns {Array<{id,name,icon,type,playbook,config,run}>}
 */
export function createAgents(config, types = TYPES) {
  const seen = new Set();
  return (config.agents || []).filter(a => a.enabled !== false).map(a => {
    const type = types[a.type];
    if (!type) throw new Error(`agent "${a.id}": unknown type "${a.type}" (known: ${Object.keys(types).join(', ')})`);
    if (!a.id || seen.has(a.id)) throw new Error(`agent id missing or duplicated: "${a.id}"`);
    seen.add(a.id);
    const extra = Array.isArray(a.playbook) ? a.playbook.join('\n') : (a.playbook || '');
    return {
      id: a.id,
      type: a.type,
      name: a.name || type.defaultName,
      icon: a.icon || type.defaultIcon,
      playbook: [type.playbook, extra].filter(Boolean).join('\n'),
      config: { ...(config.shared || {}), ...a },
      run: type.run,
    };
  });
}
