const $ = (sel) => document.querySelector(sel)
const state = { active: [], history: [], selectedId: null, agentFilter: null, search: '' }

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const age = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

async function load() {
  try {
    const res = await fetch('/api/claims')
    const data = await res.json()
    state.active = data.active
    state.history = data.history
    $('#server-status').textContent = 'live'
    $('#server-status').className = 'badge badge-ok'
  } catch {
    $('#server-status').textContent = 'offline'
    $('#server-status').className = 'badge badge-danger'
  }
  render()
}

function visibleClaims() {
  return state.active.filter(
    (c) =>
      (!state.agentFilter || c.agent === state.agentFilter) &&
      (!state.search || `${c.resource} ${c.note}`.toLowerCase().includes(state.search))
  )
}

function render() {
  $('#stat-active').textContent = state.active.length
  $('#stat-stale').textContent = state.active.filter((c) => c.stale).length
  $('#stat-history').textContent = state.history.length

  const agents = [...new Set(state.active.map((c) => c.agent))]
  $('#agent-chips').innerHTML = agents
    .map((a) => `<button class="chip ${state.agentFilter === a ? 'on' : ''}" data-agent="${esc(a)}">${esc(a)}</button>`)
    .join('')

  const rows = visibleClaims()
  $('#claims-body').innerHTML = rows
    .map(
      (c) => `<tr data-id="${esc(c.id)}" tabindex="0" class="${c.id === state.selectedId ? 'selected' : ''} ${c.stale ? 'stale' : ''}">
        <td><span class="badge badge-agent">${esc(c.agent)}</span></td>
        <td>${esc(c.resource)}</td><td>${esc(c.kind)}</td><td>${age(c.claimed_at)}</td>
        <td>${c.stale ? '<span class="badge badge-warn">stale</span>' : '<span class="badge badge-ok">active</span>'}</td>
      </tr>`
    )
    .join('')
  $('#empty').classList.toggle('hidden', rows.length > 0)

  renderDetail(state.active.find((c) => c.id === state.selectedId))
  $('#history').innerHTML = state.history
    .slice(0, 30)
    .map(
      (h) => `<li><span class="badge badge-agent">${esc(h.agent)}</span> ${esc(h.resource)} —
        ${h.status === 'expired' ? '<span class="badge badge-warn">expired</span>' : 'released'} ${age(h.released_at)} ago</li>`
    )
    .join('')
}

function renderDetail(c) {
  if (!c) {
    $('#detail').innerHTML = '<span class="muted">Select a claim.</span>'
    return
  }
  $('#detail').innerHTML = `
    <dl class="kv">
      <dt>agent</dt><dd>${esc(c.agent)}</dd>
      <dt>resource</dt><dd>${esc(c.resource)} (${esc(c.kind)})</dd>
      <dt>note</dt><dd>${esc(c.note) || '—'}</dd>
      <dt>claimed</dt><dd>${esc(c.claimed_at)}</dd>
      <dt>heartbeat</dt><dd>${esc(c.heartbeat_at)} (${age(c.heartbeat_at)} ago)</dd>
    </dl>
    <button class="btn btn-danger" id="force-release" data-id="${esc(c.id)}">Force release</button>`
  $('#force-release').onclick = async () => {
    await fetch(`/api/claims/${c.id}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ by: 'dashboard' }),
    })
    state.selectedId = null
    load()
  }
}

const selectRow = (e) => {
  const tr = e.target.closest('tr[data-id]')
  if (tr) (state.selectedId = tr.dataset.id), render()
}
$('#claims-body').addEventListener('click', selectRow)
$('#claims-body').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), selectRow(e))
})
$('#agent-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-agent]')
  if (chip) {
    state.agentFilter = state.agentFilter === chip.dataset.agent ? null : chip.dataset.agent
    render()
  }
})
$('#search').addEventListener('input', (e) => ((state.search = e.target.value.toLowerCase()), render()))

try {
  new EventSource('/api/events').onmessage = load
} catch { /* SSE unsupported — polling still covers it */ }
setInterval(load, 2500)
load()
