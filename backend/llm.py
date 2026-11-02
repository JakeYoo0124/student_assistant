from pathlib import Path
import anthropic
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

MODEL = "claude-opus-5-5"
_client = anthropic.Anthropic(timeout=60.0)

def ask(system: str, messages: list[dict]) -> str:
    response = _client.messages.create(
        model=MODEL,
        max_tokens=4096,
        output_config={"effort": "low"},
        system=system,
        messages=messages,
    )
    return "".join(block.text for block in response.content if block.type == "text")