/** These API paths have audited observation clocks that are unused by their page display. Other reads keep their answer behavior. */
export function canSkipReadAnswer(path, before, after) {
  const graph = /^\/api\/rigs\/[^/]+\/(graph|nodes)$/.test(path);
  const health = /^\/api\/health(?:\?|$)/.test(path);
  if (!graph && !health) return false;
  const coverage = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const { evaluatedAt: _clock, ...content } = value;
    return content;
  };
  const project = value => health && value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value, coverage: Array.isArray(value.coverage) ? value.coverage.map(coverage) : coverage(value.coverage) }
    : value;
  const sample = graph ? (key, value) => {
    if ((key !== 'agentActivity' && key !== 'contextUsage') || !value || typeof value !== 'object' || Array.isArray(value)) return value;
    const { sampledAt: _clock, ...content } = value;
    return content;
  } : undefined;
  return JSON.stringify(project(before), sample) === JSON.stringify(project(after), sample);
}
