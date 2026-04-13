/* ── State ────────────────────────────────────────────────────────────────── */
const state = {
  sessionId:   null,
  gameType:    null,
  stats:       { wins: 0, losses: 0, ties: 0 },
};

/* ── DOM refs ─────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

/* ── Screen navigation ────────────────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function goToSelect() {
  state.sessionId = null;
  showScreen('screen-select');
}

/* ── API helpers ──────────────────────────────────────────────────────────── */
async function apiFetch(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'API error');
  }
  return res.json();
}

/* ── Card rendering ───────────────────────────────────────────────────────── */
function renderCard(card, faceDown = false) {
  const el = document.createElement('div');
  el.className = 'card';

  if (faceDown) {
    el.classList.add('face-down');
    return el;
  }

  el.classList.add(card.color);

  const tl = document.createElement('div');
  tl.className = 'card-corner top-left';
  tl.textContent = `${card.rank}\n${card.suit}`;
  tl.style.whiteSpace = 'pre';

  const center = document.createElement('div');
  center.className = 'card-center';
  center.textContent = card.suit;

  const br = document.createElement('div');
  br.className = 'card-corner bot-right';
  br.textContent = `${card.rank}\n${card.suit}`;
  br.style.whiteSpace = 'pre';

  el.appendChild(tl);
  el.appendChild(center);
  el.appendChild(br);
  return el;
}

function setHand(containerId, cards, options = {}) {
  const container = $(containerId);
  container.innerHTML = '';
  cards.forEach((card, i) => {
    const faceDown = options.faceDown && i === 0;
    const el = renderCard(card, faceDown);
    el.style.animationDelay = `${i * 80}ms`;
    container.appendChild(el);
  });
}

/* ── Log ──────────────────────────────────────────────────────────────────── */
function addLog(msg, type = 'event') {
  const log = $('game-log');
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = msg;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function syncLog(logEntries) {
  const log = $('game-log');
  const current = log.children.length;
  logEntries.slice(current).forEach(msg => {
    const type = msg.startsWith('You:') ? 'you' : msg.startsWith('AI:') ? 'ai' : 'event';
    addLog(msg, type);
  });
}

/* ── Render game state ────────────────────────────────────────────────────── */
function renderState(data) {
  syncLog(data.log || []);

  if (data.game_type === 'blackjack') {
    renderBlackjack(data);
  } else {
    renderHoldem(data);
  }

  if (data.is_over) {
    showResult(data.result_label);
    updateStats(data.result_label);
    $('action-label').textContent = '游戏结束';
    $('action-buttons').innerHTML = '';
    $('new-game-area').style.display = 'flex';
  } else {
    $('result-banner').style.display = 'none';
    $('new-game-area').style.display = 'none';
    renderActions(data.legal_actions, data.is_human_turn);
  }
}

function renderBlackjack(data) {
  $('bj-scores').style.display = 'flex';
  $('area-center').style.display = 'none';

  // Dealer hand — hide first card if game still going
  setHand('opponent-hand', data.dealer_hand, { faceDown: data.dealer_hidden });
  setHand('player-hand', data.player_hand);

  $('player-score').textContent = data.player_score;
  $('dealer-score').textContent = data.dealer_hidden
    ? `${data.dealer_hand.slice(1).reduce((s, c) => s + cardValue(c.rank), 0)}+?`
    : data.dealer_score;

  $('opponent-chips').textContent = '';
  $('player-chips').textContent   = '';
}

function renderHoldem(data) {
  $('bj-scores').style.display = 'none';

  // Public cards
  if (data.public_cards && data.public_cards.length > 0) {
    $('area-center').style.display = 'flex';
    setHand('public-cards', data.public_cards);
  } else {
    $('area-center').style.display = 'none';
  }

  // Opponent hand (face down, single card for Leduc)
  const oppCount = data.opponent_hand_count || 1;
  const fakeCards = Array.from({ length: oppCount }, () => null);
  const oppContainer = $('opponent-hand');
  oppContainer.innerHTML = '';
  fakeCards.forEach((_, i) => {
    const el = renderCard(null, true);
    el.style.animationDelay = `${i * 80}ms`;
    oppContainer.appendChild(el);
  });

  // Player hand
  setHand('player-hand', data.player_hand);

  // Chips display
  const allChips = data.all_chips || [];
  if (allChips.length >= 2) {
    $('opponent-chips').textContent = `筹码: ${allChips[1]}`;
    $('player-chips').textContent   = `筹码: ${allChips[0]}`;
  } else if (data.player_chips !== undefined) {
    $('player-chips').textContent = `投入: ${data.player_chips}`;
    $('opponent-chips').textContent = '';
  }

  if (data.pot !== undefined) {
    $('pot-info').textContent = `底池: ${data.pot}`;
  }
}

function renderActions(actions, isHumanTurn) {
  const buttons = $('action-buttons');
  buttons.innerHTML = '';

  if (!isHumanTurn) {
    $('action-label').textContent = 'AI 行动中...';
    return;
  }

  $('action-label').textContent = '请选择操作';

  const styleMap = {
    hit:   'safe', stand: 'warn',
    call:  'safe', raise: 'warn', fold: 'danger', check: '',
    'raise-pot': 'warn', 'all-in': 'danger',
  };

  actions.forEach(action => {
    const btn = document.createElement('button');
    const cls = styleMap[action.name.toLowerCase()] || '';
    btn.className = `btn-action ${cls}`;
    btn.textContent = actionLabel(action.name);
    btn.onclick = () => takeAction(action.id);
    buttons.appendChild(btn);
  });
}

/* ── Action labels ────────────────────────────────────────────────────────── */
const ACTION_LABELS = {
  hit: 'Hit — 要牌', stand: 'Stand — 停牌',
  call: 'Call — 跟注', raise: 'Raise — 加注',
  fold: 'Fold — 弃牌', check: 'Check — 过牌',
  'raise-pot': 'Raise Pot', 'all-in': 'All-In',
};
function actionLabel(name) {
  return ACTION_LABELS[name.toLowerCase()] || name;
}

/* ── Card value (Blackjack) ───────────────────────────────────────────────── */
function cardValue(rank) {
  if (['J','Q','K','10'].includes(rank)) return 10;
  if (rank === 'A') return 11;
  return parseInt(rank) || 0;
}

/* ── Result banner ────────────────────────────────────────────────────────── */
function showResult(label) {
  const banner = $('result-banner');
  banner.textContent = label;
  banner.style.display = 'block';
}

function updateStats(label) {
  if (!label) return;
  if (label.includes('Win'))  { state.stats.wins++;   $('stat-wins').textContent   = state.stats.wins; }
  else if (label.includes('Lose')) { state.stats.losses++; $('stat-losses').textContent = state.stats.losses; }
  else if (label.includes('Tie'))  { state.stats.ties++;   $('stat-ties').textContent   = state.stats.ties; }
}

/* ── Loading indicator ────────────────────────────────────────────────────── */
function setLoading(on) {
  $('loading').style.display = on ? 'flex' : 'none';
}

/* ── Start game ───────────────────────────────────────────────────────────── */
async function startGame(gameType) {
  setLoading(true);
  try {
    const data = await apiFetch('/api/new-game', 'POST', { game_type: gameType });
    state.sessionId = data.session_id;
    state.gameType  = gameType;

    // Reset log
    $('game-log').innerHTML = '';
    addLog(`新游戏开始: ${gameType}`, 'event');

    // Set game title
    const titles = {
      'blackjack': 'Blackjack — 21点',
      'leduc-holdem': "Leduc Hold'em",
      'limit-holdem': 'Limit Texas Hold\'em',
    };
    $('game-title-panel').textContent = titles[gameType] || gameType;

    // Opponent label
    $('opponent-label').textContent = gameType === 'blackjack' ? '庄家' : 'AI 对手';

    showScreen('screen-game');
    renderState(data);
  } catch (e) {
    alert('启动游戏失败: ' + e.message);
  } finally {
    setLoading(false);
  }
}

/* ── Take action ──────────────────────────────────────────────────────────── */
async function takeAction(actionId) {
  if (!state.sessionId) return;
  setLoading(true);

  // Disable buttons immediately
  $('action-buttons').querySelectorAll('button').forEach(b => b.disabled = true);

  try {
    const data = await apiFetch(`/api/step/${state.sessionId}`, 'POST', { action_id: actionId });
    renderState(data);
  } catch (e) {
    alert('操作失败: ' + e.message);
  } finally {
    setLoading(false);
  }
}

/* ── New game button ──────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  $('btn-new-game').addEventListener('click', () => {
    if (state.gameType) startGame(state.gameType);
  });
});
