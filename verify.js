// =============================================================================
// IAMS — verify.js  (public letter verification page)
// No auth required — uses the anon key only.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── DOM refs ─────────────────────────────────────────────────────────────────
const codeInput  = document.getElementById('code-input');
const verifyBtn  = document.getElementById('verify-btn');
const btnLabel   = document.getElementById('btn-label');
const btnIcon    = document.getElementById('btn-icon');
const btnSpinner = document.getElementById('btn-spinner');
const resultEl   = document.getElementById('result');

// ── Read code from URL ────────────────────────────────────────────────────────
function getCodeFromUrl() {
  // Support: /verify?code=A3F9B1C2  OR  /verify/A3F9B1C2  OR  /verify#A3F9B1C2
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('code');
  if (fromQuery) return fromQuery.trim().toUpperCase();

  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const last = pathParts[pathParts.length - 1];
  if (last && last !== 'verify.html' && /^[A-Z0-9]{8}$/i.test(last)) {
    return last.toUpperCase();
  }

  const hash = window.location.hash.replace('#', '').trim().toUpperCase();
  if (/^[A-Z0-9]{8}$/.test(hash)) return hash;

  return '';
}

// ── Set loading state ─────────────────────────────────────────────────────────
function setLoading(on) {
  verifyBtn.disabled = on;
  btnLabel.textContent   = on ? 'Checking…' : 'Verify';
  btnIcon.style.display  = on ? 'none' : '';
  btnSpinner.style.display = on ? 'inline-block' : 'none';
}

// ── Format date nicely ────────────────────────────────────────────────────────
function fmt(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('en-GH', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

// ── Render result ─────────────────────────────────────────────────────────────
function renderValid(letter) {
  const studentName  = letter.profiles?.full_name ?? '—';
  const indexNumber  = letter.students?.index_number ?? '—';
  const company      = letter.company_name ?? '—';
  const city         = [letter.city_town, letter.region].filter(Boolean).join(', ') || '—';
  const generated    = fmt(letter.generated_at);

  resultEl.style.display = 'block';
  resultEl.innerHTML = `
    <div class="result-valid">
      <div class="result-valid-header">
        <span class="result-valid-badge">
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          AUTHENTIC
        </span>
        <span class="result-title">Letter verified successfully</span>
      </div>
      <div class="detail-grid">
        <div class="detail-item">
          <label>Student Name</label>
          <span>${escHtml(studentName)}</span>
        </div>
        <div class="detail-item">
          <label>Index Number</label>
          <span>${escHtml(indexNumber)}</span>
        </div>
        <div class="detail-item">
          <label>Company</label>
          <span>${escHtml(company)}</span>
        </div>
        <div class="detail-item">
          <label>Location</label>
          <span>${escHtml(city)}</span>
        </div>
        <div class="detail-item">
          <label>Date Issued</label>
          <span>${escHtml(generated)}</span>
        </div>
        <div class="detail-item">
          <label>Verification Code</label>
          <span style="font-family: monospace; letter-spacing: 0.10em;">${escHtml(letter.verification_code)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderInvalid(code) {
  resultEl.style.display = 'block';
  resultEl.innerHTML = `
    <div class="result-invalid">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      <div>
        <h3>Code not found</h3>
        <p>No attachment letter matches the code <strong>${escHtml(code)}</strong>. Please check the code and try again, or contact the TTU Industrial Liaison Office if you believe this is an error.</p>
      </div>
    </div>
  `;
}

function renderError(msg) {
  resultEl.style.display = 'block';
  resultEl.innerHTML = `
    <div class="result-invalid">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <div>
        <h3>Verification error</h3>
        <p>${escHtml(msg)} — please try again or contact support.</p>
      </div>
    </div>
  `;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Verify ────────────────────────────────────────────────────────────────────
async function verify() {
  const raw  = codeInput.value.trim().toUpperCase();
  if (!raw) { codeInput.focus(); return; }

  if (!/^[A-Z0-9]{8}$/.test(raw)) {
    renderInvalid(raw);
    return;
  }

  setLoading(true);
  resultEl.style.display = 'none';

  try {
    const { data, error } = await supabase
      .from('letters')
      .select(`
        id,
        company_name,
        region,
        city_town,
        generated_at,
        verification_code,
        profiles!letters_student_id_fkey ( full_name ),
        students!letters_student_id_fkey ( index_number )
      `)
      .eq('verification_code', raw)
      .maybeSingle();

    if (error) {
      console.error('[verify] Supabase error:', error);
      renderError(error.message || 'An unexpected error occurred');
      return;
    }

    if (!data) {
      renderInvalid(raw);
      return;
    }

    renderValid(data);
  } catch (e) {
    console.error('[verify] Unexpected error:', e);
    renderError(e.message || 'Network error');
  } finally {
    setLoading(false);
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────
verifyBtn.addEventListener('click', verify);
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') verify();
});
// Auto-uppercase as user types
codeInput.addEventListener('input', () => {
  const pos = codeInput.selectionStart;
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  codeInput.setSelectionRange(pos, pos);
});

// ── Auto-run if code in URL ───────────────────────────────────────────────────
const urlCode = getCodeFromUrl();
if (urlCode) {
  codeInput.value = urlCode;
  verify();
}
