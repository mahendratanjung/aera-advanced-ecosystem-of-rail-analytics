# Parked code

Kept for later phases and excluded from the build (see `exclude` in tsconfig.json).

- `iot/`: station-zone twin in 3D, operator console, device registry, zone analytics and
  zone settings. These belong to the IoT scale-model phase (BRS sections 8 and 9). The twin
  service still runs the matching backend endpoints and tests.
- `old-ui/`: the first "Night Line" interface, replaced by the in-train crowding redesign.

To bring a page back, move it into `app/` and restyle it with the current components.
- `strip-ui/`: the vertical station strip, "Right now" line panel and standalone station
  page, replaced by the full-screen map with floating cards (docs/AERA_UX_V2.md).
