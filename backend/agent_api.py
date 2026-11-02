"""AI 도우미(출결 규정 안내 챗봇) API.

화면이 지금까지의 대화를 들고 있다가 질문할 때마다 전체를 보내면, 서버가 시스템 프롬프트를 붙여서 모델에 묻고 답 하나를 돌려준다.
서버는 대화를 저장하지 않는다.
"""
import logging
import re
from typing import Literal

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from agent_prompt import build_system_prompt
from auth import get_current_user
from llm import ask
from models import User

router = APIRouter(prefix="/agent", tags=["agent"])
logger = logging.getLogger(__name__)

MAX_MESSAGES = 20  # 한 번에 보낼 수 있는 대화 개수. 길어질수록 매번 보내는 양(비용)이 늘어서 제한한다


class ChatMessage(BaseModel):
    # system 은 허용하지 않는다: 화면이 AI 의 지침을 바꿀 수 없게 한다 (지침은 서버만 만든다)
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1000)


class ChatIn(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)


class ChatOut(BaseModel):
    reply: str


# 모델이 가끔 붙이는 내부 표시(<final> 같은 영문 태그)를 걸러낸다. 프롬프트 지침이 1차 방어, 이 코드가 2차 방어다.
# '<' 바로 다음이 영문자인 태그만 지우므로 "5 < 10"이나 "<이름>" 같은 정상 글은 그대로 둔다
TAG_RE = re.compile(r"</?[A-Za-z][A-Za-z0-9_-]*\s*/?>")


def clean_reply(text: str) -> str:
    return TAG_RE.sub("", text).strip()


@router.post("/chat", response_model=ChatOut)
def chat(data: ChatIn, _: User = Depends(get_current_user)):
    # def 로 쓰면 FastAPI 가 별도 스레드에서 실행해서, 모델 응답을 기다리는 동안에도 서버가 다른 요청을 받는다
    if data.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="마지막 메시지는 질문이어야 합니다")
    try:
        reply = clean_reply(ask(build_system_prompt(), [m.model_dump() for m in data.messages]))
    # 구체적인 오류를 먼저 쓴다: RateLimitError 는 APIStatusError 의 한 종류라서 순서가 바뀌면 영원히 실행되지 않는다
    except anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="요청이 많아 잠시 후 다시 시도해 주세요")
    except (anthropic.APIConnectionError, anthropic.APITimeoutError):
        raise HTTPException(status_code=503, detail="AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요")
    except anthropic.APIStatusError as e:
        # 키 오류·크레딧 소진 같은 서버 설정 문제는 학생에게 자세히 알리지 않고, 로그에는 남긴다 (키나 요청 내용은 남기지 않는다)
        logger.error("Claude API 오류: 상태 코드 %s", e.status_code)
        raise HTTPException(status_code=502, detail="AI 도우미가 지금 답하지 못합니다. 잠시 후 다시 시도해 주세요")
    if not reply:  # 태그만 보냈다면 걸러낸 뒤 빈 글이 남는다. 빈 말풍선 대신 오류 안내를 준다
        raise HTTPException(status_code=502, detail="AI 도우미가 지금 답하지 못합니다. 잠시 후 다시 시도해 주세요")
    return ChatOut(reply=reply)
