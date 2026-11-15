// Minimal custom agent type used by the plugin-loader test.
export default {
  defaultName: 'Echo',
  defaultIcon: '🔁',
  playbook: { en: '- echo playbook', ko: '- 에코 지침' },
  async run(ctx) {
    return { findings: ctx.config.fail ? [{ key: 'echo', severity: 'warn', title: 'echo', detail: '' }] : [], metrics: { echo: 1 } };
  },
};
