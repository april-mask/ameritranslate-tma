'use strict';
/* All generated text stays in memory. Profile values come from the API only. */
const tg = window.Telegram?.WebApp;
const $ = id => document.getElementById(id);
const TONES = ['soft', 'neutral', 'firm'];
const AGENCY_TONES = ['soft', 'balanced', 'firm'];
const AGENCY_LABELS = ['Warm Peer', 'High-Agency BLUF', 'Scope Boundary'];
const SCENARIOS = [
  'We will be late with deploy for 2 hours sorry',
  'Нагадай про інвойс #1042 на $7,200, термін оплати був Oct 28.',
  'CSV export займе 3 дні та перенесе OAuth реліз на наступний спринт. Що обрати?',
  'PR #214 готовий до рев’ю. Alex, перевір до staging freeze, щоб розблокувати merge.',
  'Вибачте за пізню відповідь. Ось оновлені макети.',
];
const MODES = {
  agency: { action: 'Polish to US English', output: 'YOUR MESSAGE. CLEAR NEXT STEP.', hint: 'Three American English variants in one request. Keep your facts; choose your tone.', examples: SCENARIOS },
  translate: { action: 'Translate text', output: 'AMERICAN ENGLISH', hint: 'From any language to natural American English.', examples: ["I'm utterly knackered after queuing for petrol, put the biscuits in the boot.", 'Привіт! Як справи?'] },
  rewrite: { action: 'Create variants', output: 'SAME MEANING. DIFFERENT TONE.', hint: 'Change the tone, not your position. No new promises, refusals, or proposals.', examples: ['Ви дали мені це завдання в останній момент. Я не можу завершити його сьогодні.', 'You gave me this task at the last minute. I cannot finish it today.', 'Please send the report by Friday. The budget is $2,500.'] },
  explain: { action: 'Explain text', output: 'LESS JARGON. MORE CLARITY.', hint: 'Separate what the text says from possibilities and unanswered questions.', examples: ['We are reviewing the proposal. A decision has not been made.', 'Ми розглядаємо пропозицію. Рішення ще не ухвалено.', 'Payment is due within 30 days of the invoice date.'] },
};
const state = { mode: 'translate', revision: 0, active: null, result: null, fresh: false, tone: 1, example: { agency: 0, translate: 0, rewrite: 0, explain: 0 }, engine: 'Checking engine…' };

function haptic(kind = 'selection') {
  if (!$('hapticOptIn').checked) return;
  try { if (kind === 'selection') tg?.HapticFeedback?.selectionChanged(); else tg?.HapticFeedback?.impactOccurred('light'); } catch (_) { /* optional SDK */ }
}
function setStatus(message) { $('requestStatus').textContent = message; }
function setError(message = '') { $('requestError').textContent = message; $('requestError').hidden = !message; }
function setBusy(busy) {
  $('btnTranslate').disabled = busy || !$('sourceText').value.trim();
  $('btnTranslate').querySelector('.btn-text').hidden = busy;
  $('btnTranslate').querySelector('.btn-loading').hidden = !busy;
  $('btnCancel').hidden = !busy;
  $('workspace').setAttribute('aria-busy', String(busy));
}
function setCopyEnabled(enabled) { $('btnCopy').disabled = !enabled; $('btnShare').disabled = !enabled; }
function invalidate(message = 'Text changed. Run the action again for a fresh result.') {
  closeRefactorCard();
  state.revision++;
  state.active?.controller.abort();
  state.active = null;
  state.fresh = false;
  $('manualCopy').hidden = true;
  $('copyFallback').value = '';
  $('copyStatus').textContent = '';
  if (state.result) { $('outputCard').classList.add('stale'); $('resultBadge').textContent = 'OUT OF DATE'; }
  setCopyEnabled(false);
  setBusy(false);
  setError();
  setStatus(message);
}
function inputChanged() {
  invalidate();
  $('charCount').textContent = $('sourceText').value.length.toLocaleString('en-US');
  $('btnClear').disabled = !$('sourceText').value;
}
function loadExample() {
  const examples = MODES[state.mode].examples;
  $('sourceText').value = examples[state.example[state.mode]++ % examples.length];
  inputChanged();
  setStatus('Example loaded. Press ' + MODES[state.mode].action.toLowerCase() + ' when ready.');
}
function selectMode(mode, focus = false) {
  if (!MODES[mode] || mode === state.mode) return;
  invalidate('Mode changed. Choose an example or enter text, then press the action button.');
  state.mode = mode;
  state.result = null;
  $('outputCard').hidden = true;
  $('emptyOutput').hidden = false;
  $('resultBadge').textContent = 'OUTPUT';
  $('previewNotice').hidden = mode === 'translate';
  $('previewNotice').querySelector('strong').textContent = mode === 'agency' ? 'Agency · examples ready' : 'Scripted preview · sample texts only';
  $('previewNotice').querySelector('span').textContent = mode === 'agency' ? 'Try a scenario below. Custom drafts need a configured model. Agency text is not saved and does not earn XP.' : 'These two modes use prepared examples, not a connected AI model. They do not earn XP.';
  $('scenarioGroup').hidden = mode !== 'agency';
  $('outputLabel').textContent = MODES[mode].output;
  $('modeHint').textContent = MODES[mode].hint;
  $('btnTranslate').querySelector('.btn-text').textContent = MODES[mode].action + ' ↗';
  $('workspace').setAttribute('aria-labelledby', 'tab' + mode[0].toUpperCase() + mode.slice(1));
  document.querySelectorAll('[data-mode]').forEach(button => {
    const selected = button.dataset.mode === mode;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  });
  $('engineLabel').textContent = mode === 'translate' ? state.engine : mode === 'agency' ? 'Agency · reviewed examples / configured model' : 'Scripted preview · no AI connected';
  haptic();
}
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (tg?.initData) headers.Authorization = 'tma ' + tg.initData;
  else headers['X-Test-User-Id'] = '10001'; // Backend independently controls development-only access.
  const response = await fetch(path, { ...options, headers: { ...headers, ...options.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.ok !== true) {
    const error = new Error(body?.message || body?.error || 'The server returned an invalid response.');
    error.code = body?.error;
    error.status = response.status;
    throw error;
  }
  return body;
}
function validResult(mode, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  const keys = Object.keys(result).sort().join(',');
  if (mode === 'agency') return keys === 'audit,nuance,variants' && result.variants && Object.keys(result.variants).sort().join(',') === 'balanced,firm,soft' && AGENCY_TONES.every(key => typeof result.variants[key]?.text === 'string' && result.variants[key].text.trim() && typeof result.variants[key]?.tone === 'string') && typeof result.nuance === 'string' && result.audit && Number.isInteger(result.audit.fluff_detected);
  if (mode === 'rewrite') return keys === 'firm,neutral,soft' && TONES.every(key => typeof result[key] === 'string' && result[key].trim());
  if (mode === 'explain') return keys === 'open_questions,possible_implications,what_the_text_states' && ['what_the_text_states', 'possible_implications', 'open_questions'].every(key => Array.isArray(result[key]) && result[key].every(text => typeof text === 'string' && text.trim())) && result.what_the_text_states.length > 0;
  return typeof result.translation === 'string' && Boolean(result.translation.trim());
}
function isCurrent(job) { return state.active?.id === job.id && state.revision === job.revision && state.mode === job.mode; }
function readableError(error, mode) {
  if (error.status === 401) return 'Your session is unavailable. Reopen the app from Telegram, or ask the test operator to check development access.';
  if (error.status === 404 && mode !== 'translate') return 'This preview needs the updated Python server. The operator must restart it; the current translation mode still works.';
  if (['demo_input_unsupported', 'agency_unavailable', 'agency_provider_failed'].includes(error.code)) return error.message;
  if (error.code === 'text_too_long') return 'Use 10,000 characters or fewer.';
  if (error.name === 'TypeError') return 'The server could not be reached. Your text is still here. Try again when the connection returns.';
  return 'The result could not be created. Your text is still here. Please try again.';
}
async function generate() {
  const text = $('sourceText').value.trim();
  if (!text || state.active) return;
  if (text.length > 10000) { setError('Use 10,000 characters or fewer.'); return; }
  const id = window.crypto?.randomUUID?.() || ('request_' + Date.now() + '_' + Math.random().toString(36).slice(2));
  const job = { id, revision: state.revision, mode: state.mode, controller: new AbortController() };
  state.active = job;
  state.fresh = false;
  setCopyEnabled(false);
  $('manualCopy').hidden = true;
  $('copyStatus').textContent = '';
  if (state.result) { $('outputCard').classList.add('stale'); $('resultBadge').textContent = 'PREVIOUS RESULT'; }
  setError();
  setBusy(true);
  setStatus('Working. Editing the input cancels this view of the request.');
  const timeout = setTimeout(() => {
    if (!isCurrent(job)) return;
    job.controller.abort();
    state.active = null;
    setBusy(false);
    setStatus('Request timed out. It may still have reached the server.');
    setError('No result was confirmed. Check your connection before retrying. A retry may create another server request.');
  }, 25000);
  try {
    const payload = job.mode === 'translate' ? { text } : { schema_version: '1', request_id: job.id, input_revision: job.revision, mode: job.mode, text };
    const data = await api(job.mode === 'translate' ? '/api/translate' : '/api/studio', { method: 'POST', body: JSON.stringify(payload), signal: job.controller.signal });
    if (!isCurrent(job)) return;
    const result = job.mode === 'translate' ? { translation: data.translation } : data.result;
    if (job.mode !== 'translate' && (data.schema_version !== '1' || data.request_id !== job.id || data.input_revision !== job.revision || data.mode !== job.mode || !(job.mode === 'agency' ? ['direct', 'scripted_preview'].includes(data.engine) : data.engine === 'scripted_preview'))) throw new Error('Invalid response identity');
    if (!validResult(job.mode, result)) throw new Error('Invalid response schema');
    state.result = { mode: job.mode, value: result, language: data.detected_lang, engine: data.engine };
    state.fresh = true;
    state.tone = 1;
    renderResult();
    if (data.profile) renderProfile(data.profile);
    setStatus(job.mode === 'translate' ? 'Translation ready. Review the meaning before using it.' : data.engine === 'direct' ? 'Three variants ready. Check the facts before using them.' : 'Prepared example ready. This is not a live AI generation.');
    if (data.xp_earned > 0) toast('+' + data.xp_earned + ' XP · confirmed by the server');
    haptic('success');
  } catch (error) {
    if (!isCurrent(job)) return;
    if (error.name !== 'AbortError') { setError(readableError(error, job.mode)); setStatus('No fresh result. Your input has been kept.'); }
  } finally {
    clearTimeout(timeout);
    if (isCurrent(job)) { state.active = null; setBusy(false); }
  }
}
function renderResult() {
  const { mode, value, language } = state.result;
  $('emptyOutput').hidden = true;
  $('outputCard').hidden = false;
  $('outputCard').classList.remove('stale');
  $('resultBadge').textContent = mode === 'translate' || state.result.engine === 'direct' ? 'READY' : 'SCRIPTED SAMPLE';
  $('resultMeta').textContent = mode === 'translate' ? (language ? 'Detected language: ' + language : 'Translation result') : state.result.engine === 'direct' ? 'Three model variants · review meaning and facts' : 'Prepared fixture · wording reviewed for this example only';
  $('toneControl').hidden = !['rewrite', 'agency'].includes(mode);
  $('nuanceNote').hidden = mode !== 'agency';
  $('nuanceNote').textContent = mode === 'agency' ? value.nuance + (value.audit.fluff_detected ? ' Boilerplate edits across variants: ' + value.audit.fluff_detected + '.' : '') : '';
  $('btnShare').textContent = mode === 'agency' ? 'Refactor card…' : 'Share…';
  $('outputText').hidden = mode === 'explain';
  $('explanationSections').hidden = mode !== 'explain';
  $('explanationSections').replaceChildren();
  $('manualCopy').hidden = true;
  $('copyStatus').textContent = '';
  if (mode === 'rewrite' || mode === 'agency') renderTone();
  else if (mode === 'translate') $('outputText').textContent = value.translation;
  else {
    for (const [key, label] of [['what_the_text_states', 'What the text states'], ['possible_implications', 'Possible implications'], ['open_questions', 'Open questions']]) {
      const section = document.createElement('section');
      const title = document.createElement('h3'); title.textContent = label; section.append(title);
      if (value[key].length) {
        const list = document.createElement('ul');
        value[key].forEach(text => { const item = document.createElement('li'); item.textContent = text; list.append(item); });
        section.append(list);
      } else {
        const note = document.createElement('p'); note.textContent = 'There is not enough information to make a supported inference.'; section.append(note);
      }
      $('explanationSections').append(section);
    }
  }
  $('resultCaution').textContent = mode === 'explain' ? 'Source claims are not independently verified facts. Possibilities are not predictions.' : 'Check names, numbers, and meaning before using this result.';
  setCopyEnabled(true);
}
function renderTone() {
  if (!state.result || !['rewrite', 'agency'].includes(state.result.mode)) return;
  closeRefactorCard();
  const agency = state.result.mode === 'agency';
  const name = (agency ? AGENCY_TONES : TONES)[state.tone];
  $('toneName').textContent = agency ? AGENCY_LABELS[state.tone] : name[0].toUpperCase() + name.slice(1);
  $('outputText').textContent = agency ? state.result.value.variants[name].text : state.result.value[name];
  document.querySelectorAll('[data-tone]').forEach(button => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.tone) === state.tone));
    button.textContent = (agency ? ['🤝 Peer', '⚡ BLUF', '🛡 Boundary'] : ['Soft', 'Neutral', 'Firm'])[Number(button.dataset.tone)];
  });
  $('copyStatus').textContent = '';
  $('manualCopy').hidden = true;
  $('copyFallback').value = '';
}
function resultText() {
  if (!state.fresh || !state.result) return '';
  if (state.result.mode !== 'explain') return $('outputText').textContent;
  return [...$('explanationSections').children].map(section => section.innerText).join('\n\n');
}
async function copyResult() {
  const text = resultText();
  if (!text) return;
  const revision = state.revision;
  const tone = state.tone;
  const result = state.result;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    if (revision !== state.revision || tone !== state.tone || result !== state.result || !state.fresh) return;
    $('manualCopy').hidden = true;
    $('copyStatus').textContent = 'Copied to clipboard. Nothing was sent.';
    haptic();
  } catch (_) {
    if (revision !== state.revision || tone !== state.tone || result !== state.result || !state.fresh) return;
    $('manualCopy').hidden = false;
    $('copyFallback').value = text;
    $('copyFallback').focus();
    $('copyFallback').select();
    $('copyStatus').textContent = 'Not copied. Use the selected text below.';
  }
}
async function shareResult() {
  if (state.result?.mode === 'agency') { openRefactorCard(); return; }
  const text = resultText();
  if (!text) return;
  if (!navigator.share) { await copyResult(); return; }
  const revision = state.revision;
  const tone = state.tone;
  const result = state.result;
  const stillCurrent = () => revision === state.revision && tone === state.tone && result === state.result && state.fresh;
  try {
    await navigator.share({ title: 'AmeriTranslate', text });
    if (!stillCurrent()) return;
    $('manualCopy').hidden = true;
    $('copyFallback').value = '';
    $('copyStatus').textContent = 'Share dialog completed. Delivery is not confirmed here.';
  } catch (error) {
    if (!stillCurrent()) return;
    if (error.name === 'AbortError') $('copyStatus').textContent = 'Sharing cancelled. Nothing was confirmed sent.';
    else { $('copyStatus').textContent = 'Sharing unavailable. You can copy the text instead.'; }
  }
}
let cardUrl = null;
function closeRefactorCard() {
  if (cardUrl) { URL.revokeObjectURL(cardUrl); cardUrl = null; }
  const dialog = $('cardDialog');
  if (dialog?.open) dialog.close();
  if ($('downloadCard')) $('downloadCard').removeAttribute?.('href');
}
function refactorCardText(anonymize) {
  if (!state.fresh || state.result?.mode !== 'agency') return null;
  if (anonymize) return { before: 'Sorry to bother you. Just checking on the review…', after: 'Could you share the review status?', note: 'Generic example · your draft and result are excluded.' };
  return { before: $('sourceText').value.trim(), after: resultText(), note: 'Original text included · check all private details before exporting.' };
}
function openRefactorCard() {
  if (!state.fresh) return;
  $('anonymizeCard').checked = true;
  $('cardDialog').showModal();
  drawRefactorCard();
}
function drawRefactorCard() {
  const text = refactorCardText($('anonymizeCard').checked);
  if (!text) { closeRefactorCard(); return; }
  if (cardUrl) { URL.revokeObjectURL(cardUrl); cardUrl = null; }
  $('downloadCard').removeAttribute('href');
  $('downloadCard').setAttribute('aria-disabled', 'true');
  $('cardPrivacy').textContent = text.note;
  $('cardTranscript').textContent = '[-] Original: ' + text.before + '\n[+] Refactored: ' + text.after;
  const canvas = $('refactorCanvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) { $('cardPrivacy').textContent = 'Canvas is unavailable. Copy the reviewed text from the result instead.'; return; }
  canvas.width = 1080;
  ctx.font = '26px monospace';
  function wrap(value) {
    const lines = [];
    for (const paragraph of value.split('\n')) {
      let line = '';
      for (const char of paragraph) {
        if (ctx.measureText(line + char).width > 936) { lines.push(line); line = ''; }
        line += char;
      }
      lines.push(line);
    }
    return lines;
  }
  const before = wrap(text.before), after = wrap(text.after);
  // Bound Canvas memory. Refuse oversized cards instead of silently truncating text.
  if (before.length + after.length > 100) { canvas.hidden = true; $('cardPrivacy').textContent = 'This draft is too long for a card. Copy the full result instead.'; return; }
  canvas.hidden = false;
  canvas.height = 420 + (before.length + after.length) * 38;
  ctx.fillStyle = '#171d1e'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '24px monospace'; ctx.fillStyle = '#f2b96e'; ctx.fillText('at / AmeriTranslate · Language refactor', 64, 68);
  let y = 132;
  for (const [label, lines, color] of [['[-] ORIGINAL', before, '#ffb7a5'], ['[+] REFACTORED', after, '#b5dfbd']]) {
    ctx.font = '22px monospace'; ctx.fillStyle = color; ctx.fillText(label, 64, y); y += 48;
    ctx.font = '26px monospace'; ctx.fillStyle = '#edf0e7';
    for (const line of lines) { ctx.fillText(line, 64, y); y += 38; }
    y += 48;
  }
  ctx.font = '20px monospace'; ctx.fillStyle = '#a3b0ac';
  ctx.fillText($('anonymizeCard').checked ? 'Generic example · private text excluded' : 'Original draft included · reviewed by you', 64, canvas.height - 50);
  const revision = state.revision, result = state.result, tone = state.tone;
  const anonymize = $('anonymizeCard').checked;
  const renderId = (drawRefactorCard.renderId || 0) + 1; drawRefactorCard.renderId = renderId;
  canvas.toBlob(blob => {
    if (!blob || drawRefactorCard.renderId !== renderId || !$('cardDialog').open || !state.fresh || revision !== state.revision || result !== state.result || tone !== state.tone || anonymize !== $('anonymizeCard').checked) return;
    cardUrl = URL.createObjectURL(blob);
    $('downloadCard').href = cardUrl;
    $('downloadCard').setAttribute('aria-disabled', 'false');
  }, 'image/png');
}
function renderProfile(profile) {
  const names = { 1: 'Beginner', 2: 'Casual Translator', 3: 'Polyglot', 4: 'Ambassador', 5: 'Master Linguist' };
  const thresholds = { 1: 0, 2: 100, 3: 500, 4: 2000, 5: 5000 };
  const xp = Number(profile.xp) || 0;
  const level = Number(profile.level) || 1;
  $('totalXp').textContent = xp.toLocaleString('en-US');
  $('streakDays').textContent = profile.streak_days || 0;
  $('levelLabel').textContent = 'Level ' + level + ' / ' + (names[level] || 'Translator');
  const progress = level >= 5 ? 100 : Math.max(0, Math.min(100, ((xp - thresholds[level]) / (thresholds[level + 1] - thresholds[level])) * 100));
  $('progressFill').style.width = progress + '%';
  $('progressBar').setAttribute('aria-valuenow', String(Math.round(progress)));
  const badgeNames = { first_translation: 'First translation', streak_7: '7-day streak', streak_30: '30-day streak', languages_5: '5 languages', languages_10: '10 languages', translations_100: '100 translations', translations_500: '500 translations' };
  $('badgesRow').replaceChildren();
  (profile.badges || []).forEach(id => { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = badgeNames[id] || 'Achievement'; $('badgesRow').append(badge); });
  $('badgesRow').hidden = !(profile.badges || []).length;
  $('profileStatus').textContent = 'Synced with server';
  $('retryProfile').hidden = true;
}
async function loadProfile() {
  try { const data = await api('/api/profile'); renderProfile(data.profile); }
  catch (error) { $('profileStatus').textContent = error.status === 401 ? 'Session unavailable. Reopen from Telegram.' : 'Profile could not be refreshed. Values may be out of date.'; $('retryProfile').hidden = false; }
}
async function loadEngine() {
  try {
    const response = await fetch('/api/health'); const data = await response.json();
    state.engine = data.mode === 'antigravity' ? 'Test engine · rules + external translation' : data.mode === 'n8n' ? 'n8n translation engine' : 'Direct translation engine';
  } catch (_) { state.engine = 'Engine status unavailable'; }
  if (state.mode === 'translate') $('engineLabel').textContent = state.engine;
}
function toast(message) {
  const element = document.createElement('p'); element.className = 'toast'; element.textContent = message;
  $('toastContainer').append(element); setTimeout(() => element.remove(), 4000);
}
function initTheme() {
  let saved = 'cyber'; try { saved = localStorage.getItem('ameritranslate_theme') || 'cyber'; } catch (_) { /* storage unavailable */ }
  if (!['cyber', 'manhattan', 'miami'].includes(saved)) saved = 'cyber';
  const apply = theme => {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-theme]').forEach(button => { const selected = button.dataset.theme === theme; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); });
    try { localStorage.setItem('ameritranslate_theme', theme); } catch (_) { /* preference only */ }
  };
  apply(saved);
  document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => { apply(button.dataset.theme); haptic(); }));
}
document.addEventListener('DOMContentLoaded', () => {
  try { tg?.ready(); tg?.expand(); } catch (_) { /* standalone browser */ }
  initTheme();
  $('sourceText').addEventListener('input', inputChanged);
  $('btnClear').addEventListener('click', () => { $('sourceText').value = ''; inputChanged(); state.result = null; $('outputCard').hidden = true; $('emptyOutput').hidden = false; $('resultBadge').textContent = 'OUTPUT'; setStatus('Cleared. Ready for a new text.'); $('sourceText').focus(); });
  $('sampleChip').addEventListener('click', loadExample);
  $('btnTranslate').addEventListener('click', generate);
  $('btnCancel').addEventListener('click', () => invalidate('Stopped waiting. The server may still finish; its result will not replace your current text.'));
  $('btnCopy').addEventListener('click', copyResult);
  $('btnShare').addEventListener('click', shareResult);
  $('retryProfile').addEventListener('click', loadProfile);
  $('hapticOptIn').checked = false;
  $('hapticOptIn').addEventListener('change', () => haptic());
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.addEventListener('click', () => selectMode(button.dataset.mode));
    button.addEventListener('keydown', event => {
      const order = ['agency', 'translate', 'rewrite', 'explain']; let next;
      if (event.key === 'ArrowRight') next = (order.indexOf(state.mode) + 1) % order.length;
      if (event.key === 'ArrowLeft') next = (order.indexOf(state.mode) + order.length - 1) % order.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = order.length - 1;
      if (next !== undefined) { event.preventDefault(); selectMode(order[next], true); }
    });
  });
  document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => {
    $('sourceText').value = SCENARIOS[Number(button.dataset.scenario)]; inputChanged();
    setStatus('Scenario loaded. Review it, then press the action button.'); $('sourceText').focus();
  }));
  $('closeCard').addEventListener('click', () => $('cardDialog').close());
  $('cardDialog').addEventListener('close', closeRefactorCard);
  $('anonymizeCard').addEventListener('change', drawRefactorCard);
  selectMode('agency');
  document.querySelectorAll('[data-tone]').forEach(button => button.addEventListener('click', () => { state.tone = Number(button.dataset.tone); renderTone(); haptic(); }));
  loadProfile(); loadEngine();
});
