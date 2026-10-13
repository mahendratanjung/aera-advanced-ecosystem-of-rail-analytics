# AERA edge: in-train crowding sensors

Software that runs on a device inside a train car and sends how full the car is to the twin
service. Readings follow `packages/contracts/car-count.schema.json`; the service fuses them with
rider reports (see `docs/LIVE_DATA.md`).

## Which sensor

| Option | Hardware (approx.) | Accuracy | Notes |
| --- | --- | --- | --- |
| Camera counting (code here) | Raspberry Pi 5 + AI HAT, or Jetson Orin Nano; a wide-angle camera per car | Good up to Busy; undercounts when packed | Counts only leave the device. Needs operator permission to mount |
| Door beam counters | Time-of-flight or infrared sensor over each door, ESP32 | Good, but drifts over a day | Count boardings minus alightings, reset at terminals. Send with `method: "door_counter"` |
| Load-weigh | None: trains already measure suspension load for braking | Best (service trusts it most) | Needs Prasarana's train data (TCMS). Send `load_pct` with `method: "load_weigh"` |
| Platform camera | One camera per platform | Good for waiting crowds | Predicts boarding; fits the parked station-zone twin |

For the pitch and the scale model, start with the camera counter on a laptop webcam, then the
demo sender for the whole line.

## Run

```bash
# demo: pretend every train has door counters (no hardware)
uv run --project ../backend python -m aera_edge.demo --api http://localhost:8000 --level crowded

# camera counter (installs Ultralytics and OpenCV)
pip install -e '.[cv]'
python -m aera_edge.camera_counter --source 0 --car 2 --device cam-t07-c2 \
    --station KJ15 --direction 1 --api http://localhost:8000 --preview
```

`--station` and `--direction` name the train by the last station it stopped at (0 towards Gombak,
1 towards Putra Heights); use `--trip-id` instead when the train can tell the device. Set
`--token` to the service's `AERA_INGEST_TOKEN`. MQTT devices publish the same JSON on
`aera/v1/train/{device}/count`.

Readings queue while offline and are dropped after 2 minutes, because old crowding misleads riders.

## Tests

```bash
cd backend && uv run python -m pytest -q ../edge/tests
```
