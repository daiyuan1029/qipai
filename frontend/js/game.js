/**
 * 麻将AI陪练 - 前端逻辑
 */

// ─── 牌名映射 ───────────────────────────────────
const TILE_CN = {};
['bamboo', 'characters', 'dots'].forEach(suit => {
  for (let i = 1; i <= 9; i++) TILE_CN[`${suit}-${i}`] = `${i}`;
});
Object.assign(TILE_CN, {
  'dragons-green': '發', 'dragons-red': '中', 'dragons-white': '白',
  'winds-east': '东', 'winds-south': '南', 'winds-west': '西', 'winds-north': '北',
});

const SUIT_ICON = {
  bamboo: '竹', characters: '万', dots: '筒',
  dragons: '', winds: '',
};

const ACTION_CN = { pong: '碰', chow: '吃', gong: '杠', stand: '不要' };

function getSuit(name) {
  return name.split('-')[0];
}

function getTileClass(name) {
  const suit = getSuit(name);
  const classMap = {
    bamboo: 'bamboo', characters: 'characters', dots: 'dots',
    'dragons': name === 'dragons-red' ? 'dragon-red'
              : name === 'dragons-green' ? 'dragon-green' : 'dragon-white',
    winds: 'wind',
  };
  return classMap[suit] || '';
}

/**
 * 创建麻将牌 DOM 元素
 * @param {string} name - 牌名 e.g. "bamboo-3"
 * @param {boolean} small - 是否小尺寸（对手/弃牌堆）
 * @param {boolean} playable - 是否可点击
 * @returns HTMLElement
 */
function createTile(name, small = false, playable = false) {
  const div = document.createElement('div');
  div.className = `tile ${getTileClass(name)}${small ? ' small' : ''}${playable ? ' playable' : ''}`;
  div.dataset.name = name;

  const suit = getSuit(name);
  const icon = SUIT_ICON[suit] || '';
  const num = TILE_CN[name] || name;

  div.innerHTML = `
    <span class="suit-icon">${icon}</span>
    <span class="tile-num">${num}</span>
  `;
  return div;
}

// ─── 应用状态 ────────────────────────────────────
let sessionId = null;
let gameState = null;

// ─── DOM 引用 ────────────────────────────────────
const welcome    = document.getElementById('welcome');
const gameArea   = document.getElementById('game-area');
const gameOver   = document.getElementById('game-over');
const btnNewGame = document.getElementById('btn-new-game');
const btnPlayAgain = document.getElementById('btn-play-again');
const statusBar  = document.getElementById('status-bar');
const loading    = document.getElementById('loading');

const playerHand  = document.getElementById('player-hand');
const discardArea = document.getElementById('discard-area');
const actionBar   = document.getElementById('action-bar');
const logList     = document.getElementById('log-list');

const oppTop   = document.getElementById('opp-top');
const oppLeft  = document.getElementById('opp-left');
const oppRight = document.getElementById('opp-right');

const gameOverTitle = document.getElementById('game-over-title');
const gameOverMsg   = document.getElementById('game-over-msg');

// ─── API ─────────────────────────────────────────
async function apiStart() {
  const res = await fetch('/api/start', { method: 'POST' });
  if (!res.ok) throw new Error('启动失败');
  return res.json();
}

async function apiAction(actionId) {
  const res = await fetch(`/api/action/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action_id: actionId }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || '操作失败');
  }
  return res.json();
}

// ─── 渲染 ────────────────────────────────────────
function renderOpponent(container, playerInfo, showTiles = false) {
  container.innerHTML = '';

  // 手牌（正面/背面）
  const tilesDiv = document.createElement('div');
  tilesDiv.className = 'opp-tiles';
  if (showTiles && playerInfo.hand_tiles) {
    playerInfo.hand_tiles.forEach(name => {
      tilesDiv.appendChild(createTile(name, true, false));
    });
  } else {
    for (let i = 0; i < playerInfo.hand_count; i++) {
      const back = document.createElement('div');
      back.className = 'tile-back';
      tilesDiv.appendChild(back);
    }
  }
  container.appendChild(tilesDiv);

  // 已碰/杠/吃的牌组
  if (playerInfo.pile && playerInfo.pile.length > 0) {
    const meldArea = document.createElement('div');
    meldArea.className = 'meld-area';
    playerInfo.pile.forEach(meld => {
      const meldDiv = document.createElement('div');
      meldDiv.className = 'meld';
      meld.forEach(name => meldDiv.appendChild(createTile(name, true)));
      meldArea.appendChild(meldDiv);
    });
    container.appendChild(meldArea);
  }
}

function renderDiscard(table) {
  discardArea.innerHTML = '';
  table.forEach(name => {
    discardArea.appendChild(createTile(name, true, false));
  });
}

function renderPlayerHand(hand, legalActions, validActs) {
  playerHand.innerHTML = '';
  actionBar.innerHTML = '';

  const isPlay = validActs && validActs.includes('play');
  const isReact = validActs && (
    validActs.includes('pong') || validActs.includes('chow') ||
    validActs.includes('gong') || validActs.includes('stand')
  );

  // 出牌模式：手牌可点击
  if (isPlay) {
    const legalNames = new Set(legalActions.map(a => a.name));
    hand.forEach(name => {
      const tile = createTile(name, false, legalNames.has(name));
      if (legalNames.has(name)) {
        tile.addEventListener('click', () => {
          const act = legalActions.find(a => a.name === name);
          if (act) sendAction(act.id);
        });
      }
      playerHand.appendChild(tile);
    });
  } else {
    // 非出牌模式：显示手牌但不可点击
    hand.forEach(name => playerHand.appendChild(createTile(name, false, false)));
  }

  // 反应模式：显示操作按钮
  if (isReact) {
    legalActions.forEach(act => {
      const btn = document.createElement('button');
      btn.className = `action-btn ${act.name}`;
      btn.textContent = act.cn || act.name;
      btn.addEventListener('click', () => sendAction(act.id));
      actionBar.appendChild(btn);
    });
  }
}

function renderLog(log) {
  logList.innerHTML = '';
  [...log].reverse().forEach(msg => {
    const li = document.createElement('li');
    li.textContent = msg;
    logList.appendChild(li);
  });
}

function renderState(state) {
  gameState = state;

  if (state.done) {
    showGameOver(state.winner);
    return;
  }

  const players = state.players_info;

  // 对手：player1=右，player2=上，player3=左（从人类视角）
  renderOpponent(oppRight, players[1]);
  renderOpponent(oppTop,   players[2]);
  renderOpponent(oppLeft,  players[3]);

  renderDiscard(state.table);
  renderPlayerHand(state.human_hand, state.legal_actions, state.valid_acts);
  renderLog(state.log);

  if (state.is_human_turn) {
    const validActs = state.valid_acts || [];
    if (validActs.includes('play')) {
      setStatus('轮到你了 — 点击手牌出牌');
    } else {
      const acts = validActs.filter(a => a !== 'stand').map(a => ACTION_CN[a] || a);
      setStatus(`轮到你了 — 可选操作: ${acts.join(' / ')} / 不要`);
    }
  } else {
    setStatus(`AI 玩家${state.current_player} 正在思考…`, true);
  }
}

function setStatus(text, isAI = false) {
  statusBar.textContent = text;
  statusBar.className = isAI ? 'ai-thinking' : '';
}

function showGameOver(winner) {
  if (winner === 0) {
    gameOverTitle.textContent = '🎉 你赢了！';
    gameOverMsg.textContent = '恭喜！你胡牌了！';
  } else if (winner > 0) {
    gameOverTitle.textContent = '😔 AI 赢了';
    gameOverMsg.textContent = `玩家${winner}（AI）胡牌了。再来一局？`;
  } else {
    gameOverTitle.textContent = '🤝 流局';
    gameOverMsg.textContent = '牌局流局，没有赢家。';
  }
  renderLog(gameState.log);
  gameOver.classList.add('active');
}

// ─── 用户操作 ─────────────────────────────────
async function sendAction(actionId) {
  setLoading(true);
  try {
    const state = await apiAction(actionId);
    renderState(state);
  } catch (e) {
    setStatus(`错误: ${e.message}`);
  } finally {
    setLoading(false);
  }
}

async function startGame() {
  setLoading(true);
  try {
    const data = await apiStart();
    sessionId = data.session_id;
    welcome.style.display = 'none';
    gameOver.classList.remove('active');
    gameArea.classList.add('active');
    renderState(data.state);
  } catch (e) {
    setStatus(`启动失败: ${e.message}`);
  } finally {
    setLoading(false);
  }
}

function setLoading(on) {
  loading.classList.toggle('active', on);
  btnNewGame.disabled = on;
}

// ─── 事件绑定 ─────────────────────────────────
btnNewGame.addEventListener('click', startGame);
btnPlayAgain.addEventListener('click', () => {
  gameOver.classList.remove('active');
  startGame();
});
document.getElementById('btn-start-welcome')?.addEventListener('click', startGame);
