"""Pure functions that turn origin-destination journeys into in-train load on the line.

Kept free of pandas so the rules can be tested on their own and read by the team.
"""

from __future__ import annotations

import re

# Where journeys from other Rapid Rail lines join the Kelana Jaya Line. Tap-in/tap-out data
# only knows the first and last gate, so the interchange is inferred from the other line.
TRANSFER = {
    "AG": "KJ13",   # Ampang Line, change at Masjid Jamek
    "KG": "KJ14",   # MRT Kajang Line, Pasar Seni
    "MR": "KJ15",   # KL Monorail, KL Sentral
    "PYL": "KJ9",   # MRT Putrajaya Line, Ampang Park
    "SA": "KJ27",   # LRT Shah Alam Line, Glenmarie
}
SRI_PETALING_SOUTH_FROM = 20  # SP20 and beyond are closer to Putra Heights than to the city

# Stations treated as the city centre when classifying a journey as inbound or outbound.
CORE = {f"KJ{i}" for i in range(9, 17)}  # Ampang Park to Bangsar

CODE = re.compile(r"^([A-Z]+)(\d+)")


def map_station(name: str) -> tuple[str | None, bool]:
    """Map a data.gov.my station label to (Kelana Jaya stop id, rides_on_line).

    rides_on_line is False when the journey only reaches the line through an interchange.
    """
    m = CODE.match(name.strip())
    if not m:
        return None, False
    prefix, num = m.group(1), int(m.group(2))
    if prefix == "KJ":
        return f"KJ{num}", True
    if prefix == "SP":
        if num == 31:
            return "KJ37", True  # Putra Heights is shared and coded SP31
        return ("KJ37" if num >= SRI_PETALING_SOUTH_FROM else "KJ13"), False
    if prefix in TRANSFER:
        return TRANSFER[prefix], False
    return None, False


def journey_on_line(origin: str, destination: str) -> tuple[str, str] | None:
    """The part of a journey that rides the Kelana Jaya Line, or None if it does not."""
    o, o_on = map_station(origin)
    d, d_on = map_station(destination)
    if not o or not d or o == d:
        return None
    if not (o_on or d_on):  # both ends on other lines; any use of this line is unknowable
        return None
    return o, d


def direction_of(o_idx: int, d_idx: int) -> int:
    """Direction 1 runs Gombak to Putra Heights (increasing index), direction 0 the reverse."""
    return 1 if d_idx > o_idx else 0


def segments_between(o_idx: int, d_idx: int) -> range:
    """Segment s joins station s and s+1. A ride covers every segment between its ends."""
    return range(min(o_idx, d_idx), max(o_idx, d_idx))


def journey_class(o: str, d: str) -> str:
    if d in CORE and o not in CORE:
        return "inbound"
    if o in CORE and d not in CORE:
        return "outbound"
    return "other"


def shift_profile(profile: list[float], minutes: float) -> list[float]:
    """Move an hourly histogram later by a number of minutes, splitting mass between bins.

    A passenger who taps in at 08:50 and needs 15 minutes to reach a segment rides it at
    09:05, so on-train load lags the tap-in profile by the travel time.
    """
    n = len(profile)
    whole, frac = divmod(minutes / 60.0, 1.0)
    whole = int(whole)
    out = [0.0] * n
    for h, v in enumerate(profile):
        if v == 0:
            continue
        a = h + whole
        if a < n:
            out[a] += v * (1 - frac)
        if a + 1 < n:
            out[a + 1] += v * frac
    return out
