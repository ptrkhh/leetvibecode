import re

FENCE = re.compile(r"```([^\n`]*)\n(.*?)```", re.S)


def extract_code(text: str) -> str | None:
    blocks = [(lang.strip().lower(), body) for lang, body in FENCE.findall(text)]
    tagged = [b for lang, b in blocks if lang in ("python", "py")]
    if tagged:
        return tagged[-1].strip()
    untagged = [b for lang, b in blocks if lang == ""]
    return untagged[-1].strip() if untagged else None
