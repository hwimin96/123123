(() => {
'use strict';

/* ============================================================
 * 설정 / 유틸
 * ============================================================ */
const CFG = window.WD_CONFIG || {};
const API = CFG.API_URL || '';
const CLUB = CFG.CLUB_NAME || '풋살 클럽';
const configured = /^https:\/\/script\.google(usercontent)?\.com\//.test(API);
const LS_AUTH = 'fc_auth_v1';
const LS_PREF = 'fc_pref_v1';
const COLORS = ['#C6FF3D', '#4dd0ff', '#ff8a5c', '#d28cff'];
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};

function pad2(n) { return String(n).padStart(2, '0'); }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseD(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
function fmtD(s) { const d = parseD(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`; }
function fmtT(sec) { return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`; }

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ============================================================
 * 상태
 * ============================================================ */
const S = {
  name: '', pin: '', user: null,
  events: [], votes: {}, teams: {},
  tab: 'events', open: {}, pastOpen: false,
  teamEvent: '', teamCount: 2, draft: null,
  members: null, loading: false, loadedAt: 0, loginErr: ''
};

const T = { dur: 600, rem: 600, running: false, endAt: 0, a: 0, b: 0, na: 'A팀', nb: 'B팀', iv: null, ended: false, wl: null, ac: null };

/* ============================================================
 * API
 * ============================================================ */
async function api(action, data) {
  if (!configured) throw new Error('config.js에 API_URL을 먼저 설정해 주세요');
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // preflight 없이 보내기 위함
    body: JSON.stringify(Object.assign({ action, name: S.name, pin: S.pin }, data || {})),
    redirect: 'follow'
  });
  let j;
  try { j = await res.json(); } catch (e) { throw new Error('서버 응답을 읽을 수 없어요'); }
  if (!j.ok) throw new Error(j.error || '요청에 실패했어요');
  return j;
}

async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message || '문제가 생겼어요');
    return null;
  }
}

async function loadAll(silent) {
  if (!silent) { S.loading = true; render(); }
  try {
    const j = await api('events');
    S.events = j.events || [];
    S.votes = j.votes || {};
    S.teams = j.teams || {};
    S.loadedAt = Date.now();
  } finally {
    S.loading = false;
    render();
  }
}

async function login(name, pin, remember) {
  S.name = name.trim();
  S.pin = pin.trim();
  const j = await api('login');
  S.user = j.user;
  if (remember !== false) store.set(LS_AUTH, { name: S.name, pin: S.pin });
  S.loginErr = '';
  await loadAll(false);
}

function logout() {
  store.del(LS_AUTH);
  S.user = null; S.name = ''; S.pin = '';
  S.events = []; S.votes = {}; S.teams = {}; S.members = null; S.draft = null;
  render();
}

/* ============================================================
 * 뷰
 * ============================================================ */
function loginView() {
  return `<div class="login">
    <div class="logo">⚽</div>
    <div><h1>${esc(CLUB)}</h1><p>이름과 숫자 4자리로 로그인해요.</p></div>
    ${configured ? '' : '<div class="notice">아직 서버가 연결되지 않았어요. <b>config.js</b>의 API_URL을 설정해 주세요.</div>'}
    <form data-form="login">
      <div class="field"><label for="ln">이름</label><input id="ln" name="name" autocomplete="username" required maxlength="20" value="${esc(S.name)}"></div>
      <div class="field"><label for="lp">PIN (숫자 4자리)</label><input id="lp" class="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="current-password" required></div>
      <div class="err" id="lerr">${esc(S.loginErr)}</div>
      <button class="btn block" type="submit">로그인</button>
    </form>
    <p class="hint">PIN을 모르면 운영진에게 물어봐 주세요.</p>
  </div>`;
}

function shellView(inner) {
  const tabs = [['events', '📅', '일정'], ['teams', '👥', '팀 편성'], ['timer', '⏱️', '타이머'], ['me', '🙂', '내 정보']];
  const titles = { events: '일정 · 참석', teams: '팀 편성', timer: '경기 타이머', me: '내 정보' };
  return `<div class="shell">
    <header class="top">
      <div><div class="club">${esc(CLUB).toUpperCase()}</div><h1>${titles[S.tab]}</h1></div>
      ${S.tab === 'events' || S.tab === 'teams' ? '<button class="icon-btn" data-act="refresh" aria-label="새로고침">⟳</button>' : ''}
    </header>
    <main class="main">${inner}</main>
    ${S.tab === 'events' && S.user.role === 'admin' ? '<button class="btn fab" data-act="newEvent">＋ 일정 추가</button>' : ''}
    <nav class="nav">${tabs.map(([k, ic, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}"><span class="ic">${ic}</span>${l}</button>`).join('')}</nav>
  </div>`;
}

function emptyView(t, d) { return `<div class="empty"><b>${esc(t)}</b><span>${esc(d)}</span></div>`; }

/* ---------- 일정 ---------- */
function eventCard(e, past) {
  const vs = S.votes[e.id] || [];
  const mine = (vs.find((v) => v.name === S.user.name) || {}).status || '';
  const cnt = { yes: 0, no: 0, maybe: 0 };
  vs.forEach((v) => { if (cnt[v.status] !== undefined) cnt[v.status]++; });
  const names = (st) => vs.filter((v) => v.status === st).map((v) => esc(v.name)).join(', ') || '-';
  const open = !!S.open[e.id];
  const id = esc(e.id);
  return `<article class="card ${past ? 'past' : ''}">
    <div class="card-h">
      <div>
        <div class="ttl">${esc(e.title || '풋살')}</div>
        <div class="meta">${fmtD(e.date)}${e.time ? ' · ' + esc(e.time) : ''}${e.place ? ' · ' + esc(e.place) : ''}</div>
      </div>
      ${S.user.role === 'admin' ? `<button class="icon-btn" data-act="delEvent" data-id="${id}" aria-label="일정 삭제">✕</button>` : ''}
    </div>
    <div class="counts">
      <span class="pill yes">참석 ${cnt.yes}</span><span class="pill maybe">미정 ${cnt.maybe}</span><span class="pill no">불참 ${cnt.no}</span>
    </div>
    ${past ? '' : `<div class="vote">${[['yes', '참석'], ['maybe', '미정'], ['no', '불참']].map(([k, l]) =>
      `<button class="vbtn ${k} ${mine === k ? 'on' : ''}" data-act="vote" data-id="${id}" data-st="${k}">${l}</button>`).join('')}</div>`}
    <button class="link" data-act="toggle" data-id="${id}">${open ? '명단 접기 ▲' : '명단 보기 ▼'}</button>
    ${open ? `<dl class="roster"><dt>참석</dt><dd>${names('yes')}</dd><dt>미정</dt><dd>${names('maybe')}</dd><dt>불참</dt><dd>${names('no')}</dd></dl>` : ''}
  </article>`;
}

function eventsView() {
  if (S.loading && !S.events.length) return '<div class="spin">불러오는 중…</div>';
  const t = todayStr();
  const up = S.events.filter((e) => e.date >= t);
  const past = S.events.filter((e) => e.date < t).slice().reverse();
  let h = '';
  if (!up.length) h += emptyView('예정된 일정이 없어요', S.user.role === 'admin' ? '아래 버튼으로 일정을 추가해 보세요' : '운영진이 일정을 올리면 여기에 보여요');
  else h += up.map((e) => eventCard(e, false)).join('');
  if (past.length) {
    h += `<button class="sec" data-act="togglePast">지난 일정 ${past.length}개 ${S.pastOpen ? '▲' : '▼'}</button>`;
    if (S.pastOpen) h += past.map((e) => eventCard(e, true)).join('');
  }
  return h;
}

/* ---------- 팀 편성 ---------- */
function attendees(id) { return (S.votes[id] || []).filter((v) => v.status === 'yes').map((v) => v.name); }

function ensureTeamEvent() {
  const t = todayStr();
  const evs = S.events.filter((e) => e.date >= t);
  if (!evs.find((e) => e.id === S.teamEvent)) { S.teamEvent = evs[0] ? evs[0].id : ''; S.draft = null; }
  if (S.teamEvent && (!S.draft || S.draft.eventId !== S.teamEvent)) {
    const saved = S.teams[S.teamEvent];
    S.draft = saved && saved.length ? { eventId: S.teamEvent, teams: JSON.parse(JSON.stringify(saved)) } : null;
    if (S.draft) S.teamCount = S.draft.teams.length;
  }
  return evs;
}

function teamsView() {
  const evs = ensureTeamEvent();
  if (!evs.length) return emptyView('예정된 일정이 없어요', '일정 탭에서 먼저 일정을 만들어 주세요');
  const att = attendees(S.teamEvent);
  const assigned = new Set();
  if (S.draft) S.draft.teams.forEach((tm) => tm.players.forEach((p) => assigned.add(p)));
  const unassigned = att.filter((p) => !assigned.has(p));

  let h = `<div class="card">
    <div class="field"><label for="teamEvent">일정</label>
      <select id="teamEvent">${evs.map((e) => `<option value="${esc(e.id)}" ${e.id === S.teamEvent ? 'selected' : ''}>${fmtD(e.date)} ${esc(e.time || '')} ${esc(e.title || '')}</option>`).join('')}</select></div>
    <div class="meta">참석 확정 <b style="color:var(--tx)">${att.length}명</b></div>
    <div class="field"><label>팀 수</label><div class="chips">${[2, 3, 4].map((n) => `<button class="chip ${S.teamCount === n ? 'on' : ''}" data-act="teamCount" data-n="${n}">${n}팀</button>`).join('')}</div></div>
    <button class="btn block" data-act="shuffle" ${att.length ? '' : 'disabled'}>🔀 ${S.draft ? '다시 섞기' : '팀 섞기'}</button>
  </div>`;

  if (!att.length) return h + emptyView('아직 참석자가 없어요', '참석 투표가 모이면 팀을 짤 수 있어요');

  if (S.draft) {
    h += '<p class="hint">이름을 누르면 다음 팀으로 이동해요.</p><div class="teams">';
    h += S.draft.teams.map((tm, i) => `<section class="team" style="--c:${COLORS[i % 4]}">
      <h3>${esc(tm.name)} <small>${tm.players.length}명</small></h3>
      ${tm.players.map((p) => `<button class="pchip" data-act="move" data-t="${i}" data-p="${esc(p)}">${esc(p)}</button>`).join('') || '<span class="hint">비어 있어요</span>'}
    </section>`).join('');
    h += '</div>';
    if (unassigned.length) {
      h += `<section class="team" style="--c:var(--mut)"><h3>미배정 <small>${unassigned.length}명</small></h3>
        ${unassigned.map((p) => `<button class="pchip" data-act="move" data-t="-1" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</section>`;
    }
    h += S.user.role === 'admin'
      ? '<button class="btn ghost block" data-act="saveTeams">💾 팀 저장 (모두에게 공개)</button>'
      : '<p class="hint">팀 저장은 운영진만 할 수 있어요.</p>';
  }
  return h;
}

/* ---------- 타이머 ---------- */
function timerLabel() { return T.running ? '일시정지' : (T.rem < T.dur && T.rem > 0 ? '계속' : '시작'); }

function scoreBox(k) {
  return `<div class="sbox">
    <input class="sname" data-name="${k}" value="${esc(T['n' + k])}" maxlength="8" aria-label="팀 이름">
    <div class="snum" id="sc-${k}">${T[k]}</div>
    <div class="sbtns"><button class="btn ghost" data-act="score" data-k="${k}" data-d="-1">−</button><button class="btn" data-act="score" data-k="${k}" data-d="1">+1</button></div>
  </div>`;
}

function timerView() {
  return `<section class="timer">
    <div class="presets">${[5, 7, 10, 12, 15].map((m) => `<button class="chip ${T.dur === m * 60 ? 'on' : ''}" data-act="preset" data-m="${m}">${m}분</button>`).join('')}</div>
    <div id="tmDisp" class="disp${T.ended ? ' end' : ''}">${fmtT(T.rem)}</div>
    <div class="tbtns"><button id="tmBtn" class="btn big" data-act="tToggle">${timerLabel()}</button><button class="btn ghost" data-act="tReset">리셋</button></div>
    <div class="score">${scoreBox('a')}${scoreBox('b')}</div>
    <button class="link" data-act="scoreReset">점수만 초기화</button>
  </section>`;
}

function updDisp() {
  const d = $('#tmDisp');
  if (d) {
    d.textContent = fmtT(T.rem);
    d.className = 'disp' + (T.ended ? ' end' : (T.running && T.rem <= 60 ? ' low' : ''));
  }
  const b = $('#tmBtn');
  if (b) b.textContent = timerLabel();
}

function beep() {
  try {
    const ac = T.ac;
    if (ac) {
      [0, 0.35, 0.7].forEach((t) => {
        const o = ac.createOscillator(); const g = ac.createGain();
        o.connect(g); g.connect(ac.destination);
        o.frequency.value = 880; g.gain.value = 0.25;
        o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.25);
      });
    }
  } catch (e) { /* ignore */ }
  if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 600]);
}

async function lockScreen() {
  try { if ('wakeLock' in navigator) T.wl = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
}
function unlockScreen() { try { if (T.wl) T.wl.release(); } catch (e) { /* ignore */ } T.wl = null; }

function timerStop() {
  clearInterval(T.iv); T.iv = null; T.running = false; unlockScreen();
}
function tick() {
  T.rem = Math.max(0, Math.ceil((T.endAt - Date.now()) / 1000));
  if (T.rem <= 0) { timerStop(); T.ended = true; beep(); }
  updDisp();
}
function timerToggle() {
  if (T.running) {
    T.rem = Math.max(0, Math.ceil((T.endAt - Date.now()) / 1000));
    timerStop(); updDisp(); return;
  }
  if (T.rem <= 0) { T.rem = T.dur; }
  T.ended = false;
  try { // iOS 오디오 잠금 해제 (사용자 터치 시점에 생성)
    if (!T.ac) T.ac = new (window.AudioContext || window.webkitAudioContext)();
    if (T.ac.state === 'suspended') T.ac.resume();
  } catch (e) { /* ignore */ }
  T.endAt = Date.now() + T.rem * 1000;
  T.running = true;
  T.iv = setInterval(tick, 250);
  lockScreen();
  updDisp();
}

/* ---------- 내 정보 ---------- */
function meView() {
  const u = S.user;
  let h = `<div class="card">
    <div class="ttl">${esc(u.name)}${u.role === 'admin' ? '<span class="badge">운영진</span>' : ''}</div>
    <form data-form="pin" class="row">
      <div class="field" style="flex:2"><label for="np">PIN 변경</label><input id="np" class="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="••••" required></div>
      <button class="btn ghost" type="submit" style="align-self:end">변경</button>
    </form>
  </div>
  <a class="card" href="install.html" style="text-decoration:none;color:inherit">
    <div class="ttl" style="font-size:16px">📲 홈 화면에 설치하는 방법</div>
    <div class="meta">앱처럼 쓰려면 홈 화면에 추가해 주세요</div>
  </a>`;
  if (u.role === 'admin') {
    h += '<div class="card"><div class="ttl" style="font-size:16px">멤버 관리</div>';
    if (!S.members) h += '<div class="hint">불러오는 중…</div>';
    else {
      h += S.members.map((m) => `<div class="mem"><div>${esc(m.name)}${m.role === 'admin' ? '<span class="badge">운영진</span>' : ''}<br><small>PIN ${esc(m.pin)}</small></div>
        ${m.name === u.name ? '' : `<button class="btn danger" style="padding:8px 12px" data-act="delMember" data-name="${esc(m.name)}">삭제</button>`}</div>`).join('');
    }
    h += `<form data-form="member" style="display:grid;gap:10px;margin-top:6px">
      <div class="row">
        <div class="field"><label for="mn">이름</label><input id="mn" name="name" maxlength="20" required></div>
        <div class="field"><label for="mp">PIN</label><input id="mp" name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required></div>
      </div>
      <div class="field"><label for="mr">권한</label><select id="mr" name="role"><option value="member">멤버</option><option value="admin">운영진</option></select></div>
      <button class="btn ghost block" type="submit">멤버 추가 / PIN 재설정</button>
      <p class="hint">이미 있는 이름이면 PIN과 권한이 덮어써져요.</p>
    </form></div>`;
  }
  h += '<button class="btn danger block" data-act="logout">로그아웃</button>';
  return h;
}

/* ---------- 렌더 ---------- */
function render() {
  const root = $('#app');
  if (!S.user) { root.innerHTML = loginView(); return; }
  const inner = { events: eventsView, teams: teamsView, timer: timerView, me: meView }[S.tab]();
  const y = window.scrollY;
  root.innerHTML = shellView(inner);
  if (S.tab !== 'timer') window.scrollTo(0, y);
}

/* ============================================================
 * 모달
 * ============================================================ */
function closeModal() { const m = $('.modal'); if (m) m.remove(); }
function openModal(html) {
  closeModal();
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
  document.body.appendChild(m);
}

function eventForm() {
  const pref = store.get(LS_PREF) || {};
  openModal(`<h2>일정 추가</h2>
    <form data-form="event" style="display:grid;gap:12px">
      <div class="row">
        <div class="field"><label for="ed">날짜</label><input id="ed" name="date" type="date" required value="${todayStr()}" min="${todayStr()}"></div>
        <div class="field"><label for="et">시간</label><input id="et" name="time" type="time" required value="${esc(pref.time || '20:00')}"></div>
      </div>
      <div class="field"><label for="ep">장소</label><input id="ep" name="place" maxlength="40" value="${esc(pref.place || '')}" placeholder="예) OO풋살파크 A구장"></div>
      <div class="field"><label for="ei">제목</label><input id="ei" name="title" maxlength="30" value="${esc(pref.title || '정기 풋살')}"></div>
      <button class="btn block" type="submit">추가하기</button>
    </form>`);
}

/* ============================================================
 * 이벤트 처리
 * ============================================================ */
const actions = {
  tab(el) {
    S.tab = el.dataset.tab;
    render();
    if (S.tab === 'me' && S.user.role === 'admin' && !S.members) loadMembers();
    window.scrollTo(0, 0);
  },
  async refresh() { await run(() => loadAll(true), '새로고침 완료'); },
  toggle(el) { S.open[el.dataset.id] = !S.open[el.dataset.id]; render(); },
  togglePast() { S.pastOpen = !S.pastOpen; render(); },
  async vote(el) {
    const id = el.dataset.id; const st = el.dataset.st;
    const list = S.votes[id] = S.votes[id] || [];
    const prev = list.find((v) => v.name === S.user.name);
    const before = prev ? prev.status : null;
    if (prev) prev.status = st; else list.push({ name: S.user.name, status: st });
    render();
    try { await api('vote', { eventId: id, status: st }); }
    catch (e) {
      if (before) prev.status = before; else S.votes[id] = list.filter((v) => v.name !== S.user.name);
      render(); toast(e.message);
    }
  },
  newEvent() { eventForm(); },
  async delEvent(el) {
    if (!confirm('이 일정을 삭제할까요? 투표와 팀 정보도 함께 지워져요.')) return;
    const ok = await run(() => api('deleteEvent', { eventId: el.dataset.id }), '삭제했어요');
    if (ok) await loadAll(true);
  },
  teamCount(el) { S.teamCount = Number(el.dataset.n); render(); },
  shuffle() {
    const att = attendees(S.teamEvent);
    if (att.length < S.teamCount) { toast('참석자가 팀 수보다 적어요'); return; }
    const a = att.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    const teams = Array.from({ length: S.teamCount }, (_, i) => ({ name: String.fromCharCode(65 + i) + '팀', players: [] }));
    a.forEach((p, i) => teams[i % S.teamCount].players.push(p));
    S.draft = { eventId: S.teamEvent, teams };
    render();
  },
  move(el) {
    if (!S.draft) return;
    const from = Number(el.dataset.t); const p = el.dataset.p; const n = S.draft.teams.length;
    if (from >= 0) S.draft.teams[from].players = S.draft.teams[from].players.filter((x) => x !== p);
    const to = from < 0 ? 0 : (from + 1) % n;
    S.draft.teams[to].players.push(p);
    render();
  },
  async saveTeams() {
    if (!S.draft) return;
    const ok = await run(() => api('saveTeams', { eventId: S.draft.eventId, teams: S.draft.teams }), '팀을 저장했어요');
    if (ok) S.teams[S.draft.eventId] = JSON.parse(JSON.stringify(S.draft.teams));
  },
  preset(el) {
    if (T.running) { toast('먼저 일시정지해 주세요'); return; }
    T.dur = Number(el.dataset.m) * 60; T.rem = T.dur; T.ended = false; render();
  },
  tToggle() { timerToggle(); },
  tReset() { timerStop(); T.rem = T.dur; T.ended = false; render(); },
  score(el) {
    const k = el.dataset.k; T[k] = Math.max(0, T[k] + Number(el.dataset.d));
    const n = $('#sc-' + k); if (n) n.textContent = T[k];
    if (navigator.vibrate) navigator.vibrate(15);
  },
  scoreReset() { T.a = 0; T.b = 0; render(); },
  logout() { if (confirm('로그아웃할까요?')) logout(); },
  async delMember(el) {
    if (!confirm(`${el.dataset.name} 님을 삭제할까요?`)) return;
    const ok = await run(() => api('removeMember', { target: el.dataset.name }), '삭제했어요');
    if (ok) await loadMembers();
  }
};

async function loadMembers() {
  const j = await run(() => api('members'));
  if (j) { S.members = j.members; if (S.tab === 'me') render(); }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el);
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'teamEvent') { S.teamEvent = e.target.value; S.draft = null; render(); }
});

document.addEventListener('input', (e) => {
  const k = e.target.dataset && e.target.dataset.name;
  if (k) T['n' + k] = e.target.value;
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(f).entries());
  const btn = f.querySelector('button[type=submit]');
  if (btn) btn.disabled = true;
  try {
    switch (f.dataset.form) {
      case 'login':
        try { await login(fd.name, fd.pin); }
        catch (err) { S.loginErr = err.message; S.name = fd.name; S.user = null; render(); }
        break;
      case 'event': {
        store.set(LS_PREF, { time: fd.time, place: fd.place, title: fd.title });
        const ok = await run(() => api('createEvent', { date: fd.date, time: fd.time, place: fd.place, title: fd.title }), '일정을 추가했어요');
        if (ok) { closeModal(); await loadAll(true); }
        break;
      }
      case 'pin': {
        const ok = await run(() => api('changePin', { newPin: fd.pin }), 'PIN을 바꿨어요');
        if (ok) { S.pin = fd.pin; store.set(LS_AUTH, { name: S.name, pin: S.pin }); f.reset(); }
        break;
      }
      case 'member': {
        const ok = await run(() => api('upsertMember', { target: fd.name, newPin: fd.pin, role: fd.role }), '저장했어요');
        if (ok) { f.reset(); await loadMembers(); }
        break;
      }
      default: break;
    }
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (S.user && Date.now() - S.loadedAt > 30000) loadAll(true).catch(() => {});
    if (T.running) { tick(); lockScreen(); }
  }
});

/* ============================================================
 * 시작
 * ============================================================ */
(async function init() {
  const saved = store.get(LS_AUTH);
  if (saved && saved.name && saved.pin && configured) {
    S.name = saved.name; S.pin = saved.pin;
    $('#app').innerHTML = '<div class="spin">불러오는 중…</div>';
    try { await login(saved.name, saved.pin); return; }
    catch (e) {
      if (/PIN|이름|맞지/.test(e.message)) store.del(LS_AUTH);
      S.loginErr = e.message; S.user = null;
    }
  }
  render();
})();
})();
