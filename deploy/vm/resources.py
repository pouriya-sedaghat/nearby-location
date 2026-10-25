"""Record timestamped Docker statistics as JSONL without terminal control codes."""
import argparse
import datetime
import json
import re
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", required=True, type=int)
    parser.add_argument("containers", nargs="+")
    args = parser.parse_args()
    if not 1 <= args.seconds <= 3600:
        parser.error("seconds must be between 1 and 3600")
    deadline = time.monotonic() + args.seconds
    while time.monotonic() < deadline:
        result = subprocess.run(
            ["docker", "stats", "--no-stream", "--no-trunc", "--format", "{{json .}}", *args.containers],
            capture_output=True, text=True, timeout=15, check=True,
        )
        timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        # Also handle older Docker clients that add terminal repaint sequences.
        content = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", result.stdout)
        rows = [json.loads(line) for line in content.splitlines() if line.strip()]
        if not rows:
            raise ValueError("Docker stats returned no samples")
        for row in rows:
            print(json.dumps({**row, "timestamp": timestamp}), flush=True)
        time.sleep(max(0, min(2, deadline - time.monotonic())))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except (subprocess.SubprocessError, OSError, ValueError, TypeError):
        print("Resource capture failed: Docker statistics must be available and valid JSON.", file=sys.stderr)
        sys.exit(1)
