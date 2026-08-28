import re

FENCE = re.compile(
    r"^(?P<ticks>`{3,})[ \t]*(?P<lang>[^\n`]*)\n(?P<code>.*?)\n?^(?P=ticks)`*[ \t]*$",
    re.S | re.M)


def extract_code(text: str) -> str | None:
    blocks = [(m.group("lang").strip().lower(), m.group("code")) for m in FENCE.finditer(text)]
    tagged = [b for lang, b in blocks if lang in ("python", "py")]
    if tagged:
        return tagged[-1].strip()
    untagged = [b for lang, b in blocks if lang == ""]
    return untagged[-1].strip() if untagged else None
