import { CanaryComparisonReport } from '../core/metrics-collector';
import { CanaryExperiment } from '../types';

export interface DashboardData {
  experiments: CanaryExperiment[];
  reports: Record<string, CanaryComparisonReport>;
  apiBasePath: string;
}

export function renderDashboard(data: DashboardData): string {
  const { experiments, reports, apiBasePath } = data;

  const experimentCards = experiments.map((exp) => {
    const report = reports[exp.name];
    return renderExperimentCard(exp, report, apiBasePath);
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Canary Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; padding: 24px; }
  h1 { font-size: 24px; font-weight: 600; margin-bottom: 8px; }
  .subtitle { color: #8b949e; margin-bottom: 32px; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(560px, 1fr)); gap: 24px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 24px; }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .card-title { font-size: 18px; font-weight: 600; }
  .badge { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .badge-enabled { background: #1a3a2a; color: #3fb950; }
  .badge-disabled { background: #3d1f1f; color: #f85149; }
  .strategies { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
  .strategy-tag { background: #1c2333; border: 1px solid #30363d; padding: 4px 10px; border-radius: 6px; font-size: 12px; color: #8b949e; }
  .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
  .metric-box { background: #1c2333; border-radius: 8px; padding: 16px; }
  .metric-box h3 { font-size: 12px; text-transform: uppercase; color: #8b949e; margin-bottom: 12px; letter-spacing: 0.5px; }
  .metric-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
  .metric-label { color: #8b949e; }
  .metric-value { font-weight: 600; font-variant-numeric: tabular-nums; }
  .bar-container { height: 8px; background: #30363d; border-radius: 4px; margin-top: 4px; margin-bottom: 12px; overflow: hidden; }
  .bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
  .bar-stable { background: #58a6ff; }
  .bar-canary { background: #3fb950; }
  .bar-error { background: #f85149; }
  .verdict-box { text-align: center; padding: 16px; border-radius: 8px; margin-bottom: 20px; font-weight: 600; font-size: 14px; }
  .verdict-better { background: #1a3a2a; color: #3fb950; }
  .verdict-worse { background: #3d1f1f; color: #f85149; }
  .verdict-neutral { background: #1c2333; color: #8b949e; }
  .verdict-insufficient { background: #1c2333; color: #d29922; }
  .actions { display: flex; gap: 12px; flex-wrap: wrap; }
  .btn { padding: 8px 20px; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
  .btn:hover { opacity: 0.85; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-rollout { background: #238636; color: #fff; }
  .btn-rollback { background: #da3633; color: #fff; }
  .btn-secondary { background: #30363d; color: #e1e4e8; }
  .toast { position: fixed; bottom: 24px; right: 24px; background: #238636; color: #fff; padding: 12px 24px; border-radius: 8px; font-size: 14px; display: none; z-index: 100; }
  .toast.error { background: #da3633; }
  .empty { text-align: center; padding: 80px 24px; color: #8b949e; }
  .compare-row { display: grid; grid-template-columns: 80px 1fr 60px 1fr 60px; gap: 8px; align-items: center; margin-bottom: 8px; font-size: 13px; }
  .compare-label { color: #8b949e; text-align: right; }
  .compare-value { text-align: center; font-weight: 600; font-variant-numeric: tabular-nums; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } .metrics-grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>Canary Dashboard</h1>
<p class="subtitle">${experiments.length} experiment${experiments.length !== 1 ? 's' : ''} &middot; auto-refreshes every 10s</p>
<div class="grid">
  ${experimentCards || '<div class="empty">No experiments found. Create one with <code>manager.createExperiment()</code></div>'}
</div>
<div class="toast" id="toast"></div>
<script>
const API = '${apiBasePath}';

async function apiCall(method, path, body) {
  const toast = document.getElementById('toast');
  try {
    const res = await fetch(API + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    toast.className = 'toast';
    toast.textContent = data.message || 'Done';
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
    setTimeout(() => location.reload(), 500);
  } catch (err) {
    toast.className = 'toast error';
    toast.textContent = 'Error: ' + err.message;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 5000);
  }
}

function rollout(name) {
  const pct = prompt('New rollout percentage (0-100):');
  if (pct === null) return;
  const num = parseInt(pct, 10);
  if (isNaN(num) || num < 0 || num > 100) { alert('Invalid percentage'); return; }
  apiCall('POST', '/' + name + '/rollout', { percentage: num });
}

function rollback(name) {
  if (!confirm('Rollback "' + name + '"? All users will see stable immediately.')) return;
  apiCall('POST', '/' + name + '/rollback');
}

function enable(name) {
  apiCall('POST', '/' + name + '/enable');
}

function deleteExp(name) {
  if (!confirm('Delete "' + name + '" and all its assignments? This cannot be undone.')) return;
  apiCall('DELETE', '/' + name);
}

setTimeout(() => location.reload(), 10000);
</script>
</body>
</html>`;
}

function renderExperimentCard(exp: CanaryExperiment, report: CanaryComparisonReport | undefined, apiBasePath: string): string {
  const strategies = exp.strategies.map((s) => {
    if (s.type === 'percentage') return `${s.percentage}% rollout`;
    if (s.type === 'whitelist') return `whitelist (${s.userIds.length})`;
    if (s.type === 'attribute') return `${s.attribute}: ${s.values.join(', ')}`;
    return (s as any).type;
  });

  const pctStrategy = exp.strategies.find((s) => s.type === 'percentage');
  const currentPct = pctStrategy?.type === 'percentage' ? pctStrategy.percentage : null;

  let verdictHtml = '';
  let metricsHtml = '<div class="verdict-box verdict-insufficient">No metrics data yet</div>';

  if (report && (report.stable.totalRequests > 0 || report.canary.totalRequests > 0)) {
    const verdictClass = {
      'canary-is-better': 'verdict-better',
      'canary-is-worse': 'verdict-worse',
      'no-significant-difference': 'verdict-neutral',
      'insufficient-data': 'verdict-insufficient',
    }[report.verdict];

    const verdictLabel = {
      'canary-is-better': 'Canary is performing better — safe to increase rollout',
      'canary-is-worse': 'Canary is performing worse — consider rollback',
      'no-significant-difference': 'No significant difference — safe to increase rollout',
      'insufficient-data': 'Not enough data yet — wait for more traffic',
    }[report.verdict];

    verdictHtml = `<div class="verdict-box ${verdictClass}">${verdictLabel}</div>`;

    const maxTime = Math.max(report.stable.p95ResponseTimeMs, report.canary.p95ResponseTimeMs, 1);
    const maxErr = Math.max(report.stable.errorRate, report.canary.errorRate, 0.1);

    metricsHtml = `
      ${verdictHtml}
      <div class="metrics-grid">
        <div class="metric-box">
          <h3>Stable</h3>
          <div class="metric-row"><span class="metric-label">Requests</span><span class="metric-value">${report.stable.totalRequests}</span></div>
          <div class="metric-row"><span class="metric-label">Users</span><span class="metric-value">${report.stable.uniqueUsers}</span></div>
          <div class="metric-row"><span class="metric-label">Avg</span><span class="metric-value">${report.stable.avgResponseTimeMs.toFixed(1)}ms</span></div>
          <div class="metric-row"><span class="metric-label">p95</span><span class="metric-value">${report.stable.p95ResponseTimeMs.toFixed(1)}ms</span></div>
          <div class="bar-container"><div class="bar bar-stable" style="width:${(report.stable.p95ResponseTimeMs / maxTime * 100).toFixed(0)}%"></div></div>
          <div class="metric-row"><span class="metric-label">Errors</span><span class="metric-value">${report.stable.errorRate.toFixed(2)}%</span></div>
          <div class="bar-container"><div class="bar bar-error" style="width:${(report.stable.errorRate / maxErr * 100).toFixed(0)}%"></div></div>
        </div>
        <div class="metric-box">
          <h3>Canary</h3>
          <div class="metric-row"><span class="metric-label">Requests</span><span class="metric-value">${report.canary.totalRequests}</span></div>
          <div class="metric-row"><span class="metric-label">Users</span><span class="metric-value">${report.canary.uniqueUsers}</span></div>
          <div class="metric-row"><span class="metric-label">Avg</span><span class="metric-value">${report.canary.avgResponseTimeMs.toFixed(1)}ms</span></div>
          <div class="metric-row"><span class="metric-label">p95</span><span class="metric-value">${report.canary.p95ResponseTimeMs.toFixed(1)}ms</span></div>
          <div class="bar-container"><div class="bar bar-canary" style="width:${(report.canary.p95ResponseTimeMs / maxTime * 100).toFixed(0)}%"></div></div>
          <div class="metric-row"><span class="metric-label">Errors</span><span class="metric-value">${report.canary.errorRate.toFixed(2)}%</span></div>
          <div class="bar-container"><div class="bar bar-error" style="width:${(report.canary.errorRate / maxErr * 100).toFixed(0)}%"></div></div>
        </div>
      </div>
      <div style="text-align:center;color:#8b949e;font-size:12px;margin-bottom:16px">
        Time diff: ${report.responseTimeDiffMs > 0 ? '+' : ''}${report.responseTimeDiffMs.toFixed(1)}ms &middot;
        Error diff: ${report.errorRateDiffPercent > 0 ? '+' : ''}${report.errorRateDiffPercent.toFixed(2)}%
      </div>`;
  }

  return `
    <div class="card">
      <div class="card-header">
        <span class="card-title">${exp.name}</span>
        <span class="badge ${exp.enabled ? 'badge-enabled' : 'badge-disabled'}">${exp.enabled ? 'ENABLED' : 'DISABLED'}</span>
      </div>
      ${exp.description ? `<p style="color:#8b949e;font-size:13px;margin-bottom:16px">${exp.description}</p>` : ''}
      <div class="strategies">
        ${strategies.map((s) => `<span class="strategy-tag">${s}</span>`).join('')}
        ${currentPct !== null ? `<span class="strategy-tag" style="color:#3fb950;border-color:#238636">rollout: ${currentPct}%</span>` : ''}
      </div>
      ${metricsHtml}
      <div class="actions">
        <button class="btn btn-rollout" onclick="rollout('${exp.name}')" ${!exp.enabled ? 'disabled' : ''}>Increase Rollout</button>
        <button class="btn btn-rollback" onclick="rollback('${exp.name}')">Rollback</button>
        ${!exp.enabled ? `<button class="btn btn-secondary" onclick="enable('${exp.name}')">Re-enable</button>` : ''}
        <button class="btn btn-secondary" onclick="deleteExp('${exp.name}')">Delete</button>
      </div>
    </div>`;
}
