"""Count people in a train car with a camera and send the count to AERA.

    python -m aera_edge.camera_counter --source 0 --car 2 --device cam-t07-c2 \\
        --station KJ15 --direction 1 --api http://localhost:8000

Runs YOLO person detection on the device (Raspberry Pi 5 with an AI HAT, or a Jetson Orin
Nano) about twice a second. Privacy by design: frames stay in memory on the device and are
never saved or sent; only the number of people leaves it. ``--preview`` shows a local window
with faces blurred, for setting up the camera.

Accuracy: counting is reliable up to roughly a Busy car. In a Packed car people hide each
other and counts come out low, so pair cameras with door counters or the train's load-weigh
signal where possible (the service trusts load-weigh most).
"""

from __future__ import annotations

import argparse
import time

from aera_edge.sender import Sender
from aera_edge.smoothing import CountSmoother

PERSON = 0  # COCO class id


def in_roi(box: tuple[float, float, float, float], roi: tuple[float, float, float, float], w: int, h: int) -> bool:
    """Whether a box's centre lies inside the region of interest (fractions of the frame)."""
    cx, cy = (box[0] + box[2]) / 2 / w, (box[1] + box[3]) / 2 / h
    return roi[0] <= cx <= roi[2] and roi[1] <= cy <= roi[3]


def parse_roi(text: str) -> tuple[float, float, float, float]:
    parts = [float(p) for p in text.split(",")]
    if len(parts) != 4 or not (0 <= parts[0] < parts[2] <= 1 and 0 <= parts[1] < parts[3] <= 1):
        raise argparse.ArgumentTypeError("roi is x1,y1,x2,y2 as fractions of the frame, e.g. 0,0.1,1,1")
    return parts[0], parts[1], parts[2], parts[3]


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default="0", help="camera index, video file or RTSP URL")
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--device", required=True, help="this sensor's id, e.g. cam-t07-c2")
    ap.add_argument("--token", default="", help="AERA_INGEST_TOKEN of the service")
    ap.add_argument("--car", type=int, choices=[1, 2, 3, 4], required=True)
    ap.add_argument("--trip-id", help="the train's trip id, if the train tells the device")
    ap.add_argument("--station", help="last station the train stopped at, e.g. KJ15")
    ap.add_argument("--direction", type=int, choices=[0, 1], help="0 towards Gombak, 1 towards Putra Heights")
    ap.add_argument("--model", default="yolo11n.pt", help="any Ultralytics detection model")
    ap.add_argument("--conf", type=float, default=0.35)
    ap.add_argument("--roi", type=parse_roi, default=(0.0, 0.0, 1.0, 1.0),
                    help="count only inside this box, to skip people seen through the doors")
    ap.add_argument("--fps", type=float, default=2.0)
    ap.add_argument("--preview", action="store_true", help="show a local window with faces blurred")
    args = ap.parse_args(argv)
    if not args.trip_id and (not args.station or args.direction is None):
        ap.error("give --trip-id, or --station and --direction")

    import cv2  # heavy imports only when actually counting
    from ultralytics import YOLO

    model = YOLO(args.model)
    cap = cv2.VideoCapture(int(args.source) if args.source.isdigit() else args.source)
    if not cap.isOpened():
        raise SystemExit(f"cannot open video source {args.source}")
    sender = Sender(args.api, args.device, args.token)
    smoother = CountSmoother()
    period = 1 / args.fps
    try:
        while True:
            started = time.monotonic()
            ok, frame = cap.read()
            if not ok:
                break
            h, w = frame.shape[:2]
            result = model(frame, classes=[PERSON], conf=args.conf, verbose=False)[0]
            boxes = [tuple(b) for b in result.boxes.xyxy.tolist()]
            confs = result.boxes.conf.tolist()
            kept = [(b, c) for b, c in zip(boxes, confs, strict=True) if in_roi(b, args.roi, w, h)]
            value = smoother.add(len(kept), time.time())
            if value is not None:
                confidence = round(sum(c for _, c in kept) / len(kept), 2) if kept else None
                sender.send(sender.reading(car=args.car, method="camera", count=value, confidence=confidence,
                                           trip_id=args.trip_id, station_id=args.station,
                                           direction_id=args.direction))
            if args.preview:
                view = cv2.GaussianBlur(frame, (51, 51), 0)  # never show identifiable faces, even locally
                for (x1, y1, x2, y2), _ in kept:
                    cv2.rectangle(view, (int(x1), int(y1)), (int(x2), int(y2)), (0, 200, 255), 2)
                cv2.putText(view, f"{len(kept)} people", (16, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
                cv2.imshow("AERA camera counter", view)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
            time.sleep(max(0.0, period - (time.monotonic() - started)))
    finally:
        cap.release()
        if args.preview:
            cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
