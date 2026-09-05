# Field Capture Protocol — Obstacle Photogrammetry / Gaussian Splats

*Bring this checklist on trail visits. Goal: enough coverage for a clean reconstruction on the
first try, so an obstacle doesn't need a second trip just for data.*

## Per-obstacle capture recipe

1. **Two or three slow orbits** around/through the obstacle at different heights:
   - waist height
   - head height
   - arms-overhead if terrain allows
2. **One pass along each driving line** you care about (entry to exit, from the driver's
   perspective height).
3. **Overlap is everything.** Each frame should share ~70% of its view with its neighbors.
   Move slowly; when in doubt, shoot more.
4. **Close the loop** — finish an orbit back where it started so the reconstruction can tie
   itself together.

## Camera settings (phone is fine)

- 4K video, 1–2 minutes of slow walking footage per obstacle — or 150–300 photos.
- **Lock exposure.** Auto-exposure swings confuse feature matching.
- Keep shutter fast enough to avoid motion blur (bright conditions help; walk slowly).

## Conditions (matter more than gear)

- **Overcast is ideal.** Harsh shadows bake into the model and confuse matching.
- Avoid wind strong enough to move vegetation in frame.
- Keep people, dogs, and vehicles out of frame — they become ghosts in the reconstruction.

## Georeferencing requirements (one per obstacle)

- **Scale:** include one object of known size in a few frames, or tape/pace one distance
  across the obstacle and note it. One measurement is enough.
- **Position:** leave phone GPS/location tagging ON — EXIF GPS gives coarse placement
  (expect 3–5m error, worse in canyons). Fine alignment happens later in the viewer.

## Known failure modes (expect holes here)

- Shiny/wet rock and water crossings
- Deep shadow under ledges (shoot extra close-in angles)
- Featureless sand
- Anything moving (vegetation in wind, dust, people)

## After the visit

Run the ingest pipeline. It should report, per obstacle, whether reconstruction succeeded and
if not, *why* (insufficient overlap on which face, motion blur in which section) — that report
is the capture checklist for the next visit.
