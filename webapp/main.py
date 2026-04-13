"""
RLCard Web Testing App — FastAPI backend
Supports: Blackjack, Leduc Hold'em
"""

import sys
import os
import uuid
from typing import Optional

# Make rlcard importable from the parent directory's extracted zip
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'rlcard-master'))

import rlcard
from rlcard.agents import RandomAgent
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI(title="RLCard Web Tester")

# ── In-memory session store ──────────────────────────────────────────────────
sessions: dict[str, dict] = {}


# ── Helpers ──────────────────────────────────────────────────────────────────

GAME_CONFIGS = {
    "blackjack": {
        "label": "Blackjack",
        "description": "Classic casino card game. Beat the dealer without going over 21.",
        "players": 1,
    },
    "leduc-holdem": {
        "label": "Leduc Hold'em",
        "description": "Simplified poker (6-card deck). You vs AI opponent.",
        "players": 2,
    },
    "limit-holdem": {
        "label": "Limit Texas Hold'em",
        "description": "Fixed-bet Texas Hold'em poker. You vs AI opponent.",
        "players": 2,
    },
}

SUIT_SYMBOLS = {"S": "♠", "H": "♥", "D": "♦", "C": "♣"}
SUIT_COLORS  = {"S": "black", "H": "red", "D": "red", "C": "black"}

def parse_card(card_str: str) -> dict:
    """Convert RLCard card string like 'SA', 'HT', 'D3' into display dict."""
    suit_char = card_str[0]
    rank_chars = card_str[1:]
    rank_display = {"T": "10", "J": "J", "Q": "Q", "K": "K", "A": "A"}.get(rank_chars, rank_chars)
    return {
        "raw": card_str,
        "rank": rank_display,
        "suit": SUIT_SYMBOLS.get(suit_char, suit_char),
        "color": SUIT_COLORS.get(suit_char, "black"),
    }

def blackjack_score(cards: list[str]) -> int:
    rank2score = {
        "A": 11, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6,
        "7": 7, "8": 8, "9": 9, "T": 10, "J": 10, "Q": 10, "K": 10,
    }
    score, aces = 0, 0
    for c in cards:
        r = c[1:]
        score += rank2score.get(r, 0)
        if r == "A":
            aces += 1
    while score > 21 and aces:
        score -= 10
        aces -= 1
    return score


def _make_blackjack_response(session: dict) -> dict:
    env   = session["env"]
    state = session["state"]
    raw   = state["raw_obs"]

    player_cards = raw.get("player0 hand", raw["state"][0])
    if env.game.is_over():
        dealer_cards = raw.get("dealer hand", raw["state"][1])
    else:
        dealer_cards = raw.get("dealer hand", raw["state"][1])

    is_over = env.game.is_over()
    payoffs = env.get_payoffs().tolist() if is_over else None
    result_label = None
    if is_over and payoffs:
        p = payoffs[0]
        result_label = "Win! 🎉" if p > 0 else ("Tie 🤝" if p == 0 else "Lose 😔")

    legal = [{"id": k, "name": v.capitalize()} for k, v in
             zip(state["legal_actions"].keys(), state["raw_legal_actions"])]

    return {
        "game_type": "blackjack",
        "is_over": is_over,
        "current_player": 0,
        "player_hand": [parse_card(c) for c in player_cards],
        "dealer_hand": [parse_card(c) for c in dealer_cards],
        "dealer_hidden": not is_over,
        "player_score": blackjack_score(player_cards),
        "dealer_score": blackjack_score(dealer_cards),
        "legal_actions": legal if not is_over else [],
        "payoffs": payoffs,
        "result_label": result_label,
        "log": session.get("log", []),
    }


def _make_holdem_response(session: dict, game_type: str) -> dict:
    env   = session["env"]
    state = session["state"]
    raw   = state["raw_obs"]

    is_over = env.game.is_over()
    payoffs = env.get_payoffs().tolist() if is_over else None
    result_label = None
    if is_over and payoffs:
        p = payoffs[0]
        result_label = "Win! 🎉" if p > 0 else ("Tie 🤝" if p == 0 else "Lose 😔")

    hand_card   = raw.get("hand") or raw.get("hand_cards")
    # Support both "public_card" (Leduc, singular) and "public_cards" (Limit, plural)
    public_card = raw.get("public_cards") or raw.get("public_card")

    if isinstance(hand_card, list):
        player_hand = [parse_card(c) for c in hand_card]
    elif hand_card:
        player_hand = [parse_card(hand_card)]
    else:
        player_hand = []

    pub_cards = []
    if isinstance(public_card, list):
        pub_cards = [parse_card(c) for c in public_card if c]
    elif public_card:
        pub_cards = [parse_card(public_card)]

    all_chips = raw.get("all_chips", [])
    my_chips  = raw.get("my_chips", 0)

    legal = []
    if not is_over:
        for k, name in zip(state["legal_actions"].keys(), state["raw_legal_actions"]):
            legal.append({"id": k, "name": name.capitalize()})

    return {
        "game_type": game_type,
        "is_over": is_over,
        "current_player": session.get("current_player", 0),
        "is_human_turn": session.get("is_human_turn", True),
        "player_hand": player_hand,
        "public_cards": pub_cards,
        "player_chips": my_chips,
        "all_chips": all_chips,
        "pot": sum(all_chips) if all_chips else 0,
        "legal_actions": legal,
        "payoffs": payoffs,
        "result_label": result_label,
        "log": session.get("log", []),
    }


def _build_response(session: dict) -> dict:
    gt = session["game_type"]
    if gt == "blackjack":
        return _make_blackjack_response(session)
    else:
        return _make_holdem_response(session, gt)


def _ai_step(session: dict):
    """Let the AI agent take its turn (called when current player != human)."""
    env   = session["env"]
    state = session["state"]
    agent = session["ai_agent"]

    action = agent.step(state)
    action_name = state["raw_legal_actions"][list(state["legal_actions"].keys()).index(action)] \
        if action in state["legal_actions"] else "fold"
    session["log"].append(f"AI: {action_name}")

    next_state, next_player = env.step(action)
    session["state"]          = next_state
    session["current_player"] = next_player
    session["is_human_turn"]  = (next_player == session["human_player"])


# ── API Routes ────────────────────────────────────────────────────────────────

class NewGameRequest(BaseModel):
    game_type: str

class StepRequest(BaseModel):
    action_id: int


@app.get("/api/games")
def list_games():
    return list(GAME_CONFIGS.items())


@app.post("/api/new-game")
def new_game(req: NewGameRequest):
    gt = req.game_type
    if gt not in GAME_CONFIGS:
        raise HTTPException(400, f"Unknown game: {gt}")

    env = rlcard.make(gt, config={"allow_step_back": False})
    ai  = RandomAgent(num_actions=env.num_actions)
    state, player_id = env.reset()

    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        "game_type":      gt,
        "env":            env,
        "state":          state,
        "ai_agent":       ai,
        "human_player":   0,          # player 0 is always human
        "current_player": player_id,
        "is_human_turn":  player_id == 0,
        "log":            [],
    }

    session = sessions[session_id]

    # If AI goes first, let it play until it's the human's turn
    while not session["is_human_turn"] and not env.game.is_over():
        _ai_step(session)

    return {"session_id": session_id, **_build_response(session)}


@app.get("/api/state/{session_id}")
def get_state(session_id: str):
    if session_id not in sessions:
        raise HTTPException(404, "Session not found")
    return _build_response(sessions[session_id])


@app.post("/api/step/{session_id}")
def step(session_id: str, req: StepRequest):
    if session_id not in sessions:
        raise HTTPException(404, "Session not found")

    session = sessions[session_id]
    env     = session["env"]

    if env.game.is_over():
        raise HTTPException(400, "Game is already over")

    if not session["is_human_turn"]:
        raise HTTPException(400, "Not your turn")

    state = session["state"]
    action_id = req.action_id
    if action_id not in state["legal_actions"]:
        raise HTTPException(400, f"Illegal action: {action_id}")

    # Human action label for log
    action_idx  = list(state["legal_actions"].keys()).index(action_id)
    action_name = state["raw_legal_actions"][action_idx]
    session["log"].append(f"You: {action_name}")

    next_state, next_player = env.step(action_id)
    session["state"]          = next_state
    session["current_player"] = next_player
    session["is_human_turn"]  = (next_player == session["human_player"])

    # AI takes consecutive turns until it's the human's turn or game over
    while not session["is_human_turn"] and not env.game.is_over():
        _ai_step(session)

    return _build_response(session)


# ── Static files & SPA fallback ───────────────────────────────────────────────
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def serve_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))
