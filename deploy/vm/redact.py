"""Remove VM credentials from a private diagnostic directory before archiving."""
import re
import sys
import os
from pathlib import Path


def redact_text(text, secrets):
    for value in sorted(set(secrets), key=len, reverse=True):
        if value:
            text = text.replace(value, "[REDACTED]")
    text = re.sub(r"postgres(?:ql)?://[^\s\"'<>]+", "[REDACTED_DATABASE_URL]", text, flags=re.I)
    return re.sub(r"(Bearer\s+)[^\s\"'<>]+", r"\1[REDACTED]", text, flags=re.I)


def main():
    env_file, directory = map(Path, sys.argv[1:])
    secrets = []
    for key, value in os.environ.items():
        if re.search(r"PASSWORD|TOKEN|SECRET|DATABASE_URL", key, re.I):
            secrets.append(value)
    for line in env_file.read_text().splitlines():
        key, separator, value = line.partition("=")
        if separator and re.search(r"PASSWORD|TOKEN|SECRET|DATABASE_URL", key, re.I):
            secrets.append(value.strip().strip("\"'"))
    for file in directory.iterdir():
        if file.is_file():
            file.write_text(redact_text(file.read_text(errors="replace"), secrets))


if __name__ == "__main__":
    main()
