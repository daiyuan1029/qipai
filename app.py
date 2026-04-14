"""
麻将AI陪练 - FastAPI 后端
"""
import sys
import os
import uuid
import numpy as np
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

# 将 rlcard-master 加入 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "rlcard-master"))

import rlcard
from rlcard.agents.random_agent import RandomAgent

app = FastAPI(title="麻将AI陪练")
app.mount("/static", StaticFiles(directory="frontend"), name="static")

# 内存中的游戏会话 {session_id: session_dict}
sessions: dict = {}

# ─────────────────────────────────────────────
#  牌名映射（内部字符串 → 中文显示）
# ─────────────────────────────────────────────
TILE_CN = {
    **{f"bamboo-{i}": f"{i}竹" for i in range(1, 10)},
    **{f"characters-{i}": f"{i}万" for i in range(1, 10)},
    **{f"dots-{i}": f"{i}筒" for i in range(1, 10)},
    "dragons-green": "發",
    "dragons-red": "中",
    "dragons-white": "白",
    "winds-east": "东",
    "winds-south": "南",
    "winds-west": "西",
    "winds-north": "北",
}

ACTION_CN = {"pong": "碰", "chow": "吃", "gong": "杠", "stand": "不要"}

from rlcard.games.mahjong.utils import card_decoding_dict  # id→name


def action_id_to_name(action_id: int) -> str:
    return card_decoding_dict.get(action_id, str(action_id))


def card_obj_to_str(card) -> str:
    return card.get_str() if hasattr(card, "get_str") else str(card)


def tile_cn(name: str) -> str:
    return TILE_CN.get(name, name)


# ─────────────────────────────────────────────
#  游戏状态序列化
# ─────────────────────────────────────────────
def serialize_state(session: dict) -> dict:
    env = session["env"]
    log = session.get("log", [])

    if session["done"]:
        return {
            "done": True,
            "winner": session["winner"],
            "is_human_turn": False,
            "human_hand": [],
            "players_info": [],
            "table": [],
            "valid_acts": [],
            "legal_actions": [],
            "log": log,
        }

    game = env.game
    players = game.players
    current_player_id: int = game.round.current_player

    # 玩家0（人类）的手牌
    human_hand = [card_obj_to_str(c) for c in players[0].hand]

    # 各玩家信息
    players_info = []
    for i in range(4):
        pile_sets = []
        for meld in players[i].pile:
            pile_sets.append([card_obj_to_str(c) for c in meld])
        players_info.append(
            {"id": i, "hand_count": len(players[i].hand), "pile": pile_sets}
        )

    # 桌面弃牌
    table = [card_obj_to_str(c) for c in game.round.dealer.table]

    # 是否轮到人类
    is_human_turn = current_player_id == 0
    legal_actions = []
    valid_acts: list = []

    if is_human_turn:
        raw_state = game.get_state(0)
        env_state = env._extract_state(raw_state)
        valid_acts = raw_state.get("valid_act", [])
        for action_id in env_state["legal_actions"].keys():
            name = action_id_to_name(action_id)
            legal_actions.append(
                {
                    "id": action_id,
                    "name": name,
                    "cn": ACTION_CN.get(name, tile_cn(name)),
                }
            )

    return {
        "done": False,
        "winner": None,
        "current_player": current_player_id,
        "is_human_turn": is_human_turn,
        "human_hand": human_hand,
        "players_info": players_info,
        "table": table,
        "valid_acts": valid_acts,
        "legal_actions": legal_actions,
        "log": log,
    }


# ─────────────────────────────────────────────
#  AI 自动推进（直到轮到人类或游戏结束）
# ─────────────────────────────────────────────
def advance_ai_turns(session: dict, max_steps: int = 500):
    env = session["env"]
    agents = session["agents"]

    for _ in range(max_steps):
        if env.is_over():
            payoffs = env.get_payoffs()
            best = int(np.argmax(payoffs))
            winner = best if payoffs[best] > 0 else -1
            session["done"] = True
            session["winner"] = winner
            if winner == 0:
                _log(session, "🎉 游戏结束！你赢了！")
            elif winner > 0:
                _log(session, f"游戏结束，玩家{winner}（AI）赢了。")
            else:
                _log(session, "游戏结束，牌局流局。")
            break

        current_player = env.game.round.current_player
        if current_player == 0:
            break  # 等待人类操作

        agent = agents[current_player]
        raw_state = env.game.get_state(current_player)
        env_state = env._extract_state(raw_state)

        action_id = agent.step(env_state)
        action_name = action_id_to_name(action_id)

        if action_id < 34:
            _log(session, f"玩家{current_player} 打出: {tile_cn(action_name)}")
        else:
            cn = ACTION_CN.get(action_name, action_name)
            _log(session, f"玩家{current_player} 选择: {cn}")

        env.step(action_id)


def _log(session: dict, msg: str):
    session["log"].append(msg)
    if len(session["log"]) > 20:
        session["log"] = session["log"][-20:]


# ─────────────────────────────────────────────
#  HTTP 路由
# ─────────────────────────────────────────────
@app.get("/")
async def root():
    return FileResponse("frontend/index.html")


@app.post("/api/start")
async def start_game():
    session_id = str(uuid.uuid4())[:8]
    env = rlcard.make("mahjong")
    agents = [None] + [RandomAgent(num_actions=env.num_actions) for _ in range(3)]

    session = {
        "env": env,
        "agents": agents,
        "done": False,
        "winner": None,
        "log": ["游戏开始！你是玩家0（东家）。"],
    }
    sessions[session_id] = session

    env.reset()
    advance_ai_turns(session)

    return {"session_id": session_id, "state": serialize_state(session)}


@app.get("/api/state/{session_id}")
async def get_state(session_id: str):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="会话不存在")
    return serialize_state(sessions[session_id])


class ActionRequest(BaseModel):
    action_id: int


@app.post("/api/action/{session_id}")
async def take_action(session_id: str, request: ActionRequest):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="会话不存在")

    session = sessions[session_id]
    if session["done"]:
        raise HTTPException(status_code=400, detail="游戏已结束")

    env = session["env"]
    current_player = env.game.round.current_player
    if current_player != 0:
        raise HTTPException(status_code=400, detail="还没轮到你")

    # 验证合法性
    raw_state = env.game.get_state(0)
    env_state = env._extract_state(raw_state)
    if request.action_id not in env_state["legal_actions"]:
        raise HTTPException(status_code=400, detail=f"非法操作: {request.action_id}")

    # 记录并执行
    action_name = action_id_to_name(request.action_id)
    if request.action_id < 34:
        _log(session, f"你 打出: {tile_cn(action_name)}")
    else:
        cn = ACTION_CN.get(action_name, action_name)
        _log(session, f"你 选择: {cn}")

    env.step(request.action_id)
    advance_ai_turns(session)

    return serialize_state(session)
