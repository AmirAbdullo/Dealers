// Extracted from admin/applications.html <script> for syntax check only
const TOKEN_KEY = 'carfox_token';
const USER_KEY = 'carfox_user';
let currentStatus = 'pending';
let rejectTarget = null;

function setToast(kind, message) {
  const host = { classList: { remove() {}, add() {} } };
  const inner = { className: '', textContent: '' };
  const base = 'rounded-lg border p-3 text-sm shadow-md';
  let styles = 'bg-green-50 border-green-200 text-green-800';
  if (kind === 'error') styles = 'bg-red-50 border-red-200 text-red-800';
  inner.className = base + ' ' + styles;
  inner.textContent = message;
  if (host.classList && host.classList.remove) host.classList.remove('hidden');
  setTimeout(() => host.classList && host.classList.add && host.classList.add('hidden'), 10);
}

function fmtAgo(iso) {
  if (!iso) return '—';
  const then = new Date(iso);
  const now = new Date();
  const days = Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
  return days === 0 ? 'today' : (days === 1 ? '1 day ago' : days + ' days ago');
}

function statusBadge(status) {
  const map = {
    pending: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    approved: 'bg-green-50 border-green-200 text-green-800',
    rejected: 'bg-red-50 border-red-200 text-red-800'
  };
  return map[status] || 'bg-gray-50 border-gray-200 text-gray-700';
}

async function fetchApps(status) {
  currentStatus = status;
  const token = '';
  const res = { ok: true, json: async () => ({ applications: [] }) };
  if (!res.ok) {
    setToast('error', 'Failed to load applications');
    return;
  }
  const data = await res.json();
  (function renderList() { return data; })();
}

async function init() {
  const token = '';
  if (!token) {
    return;
  }
}

