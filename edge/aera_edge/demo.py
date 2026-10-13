"""Pretend every train has sensors, for demos without hardware.

    python -m aera_edge.demo --api http://localhost:8000 --level crowded

Every round it sends one door-counter reading per car for each station and direction; the
service matches each to the train that last stopped there and ignores the rest. Watch the
map and train cards switch from predicted to "Updated with ... door counts".
"""

from __future__ import annotations

import argparse
import json
import random
import time
import urllib.request

from aera_edge.sender import Sender

LEVEL_PCT = {"quiet": 10, "comfortable": 35, "busy": 62, "crowded": 85, "packed": 105}
CAR_CAPACITY = 200


def station_ids(api: str) -> list[str]:
    with urllib.request.urlopen(f"{api.rstrip('/')}/api/lines/KJ", timeout=10) as resp:
        return [s["id"] for s in json.load(resp)["stations"]]


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--token", default="")
    ap.add_argument("--level", choices=sorted(LEVEL_PCT), default="busy")
    ap.add_argument("--every", type=float, default=15, help="seconds between rounds")
    ap.add_argument("--rounds", type=int, default=0, help="0 runs until stopped")
    args = ap.parse_args(argv)
    stations = station_ids(args.api)
    senders: dict[str, Sender] = {}
    n = 0
    while not args.rounds or n < args.rounds:
        n += 1
        accepted = 0
        for sid in stations:
            for direction in (0, 1):
                device = f"demo-{sid}-{direction}"
                sender = senders.setdefault(device, Sender(args.api, device, args.token))
                for car in (1, 2, 3, 4):
                    pct = max(0.0, random.gauss(LEVEL_PCT[args.level], 6))
                    msg = sender.reading(car=car, method="door_counter", count=round(pct / 100 * CAR_CAPACITY),
                                         station_id=sid, direction_id=direction)
                    accepted += sender.send(msg)
        print(f"round {n}: sent readings for {len(stations) * 2} station directions ({accepted} delivered)")
        time.sleep(args.every)


if __name__ == "__main__":
    main()
