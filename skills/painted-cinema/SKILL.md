---
name: painted-cinema
description: Turn a story, script, book chapter or idea into a short painterly animated film (MP4) — one generated painting per shot, repainted as moving oil brush strokes with camera moves, paint-over "acting" between image variants, light and dust effects, subtitles and an optional soundtrack. Use when the user asks for a painted / oil-painting / impasto / cinematic animated video, trailer, teaser, reel or short from their story or topic, or wants to animate a set of paintings or AI images in this style.
---

# painted-cinema

You direct and produce a 20–60 s film. The picture is built from **paintings** (one per shot, from an image generator or the user's own art). The bundled player repaints each painting as oil brush strokes every frame and moves a camera inside it; you describe the whole film in one `film.json`.

`<root>` below means the plugin folder: two levels above the folder this file is in (`skills/painted-cinema/../..`; it holds `runtime/`, `scripts/`, `examples/`).

## 0. Set up (once)

```sh
cd <root> && npm install && npx playwright install chromium
```
Needs Node 18+ and ffmpeg on the PATH. If either is missing, tell the user; don't install system software yourself.

## 1. Brief — ask once, then decide everything else

In a single message ask only what you can't decide: the story or text to adapt, length (default 40 s), format (default vertical 1080×1920; 1920×1080 for YouTube), whether they have a voice-over or music file, and **which image generator** to use (see `reference/images.md`). Tell them roughly how many images you'll generate (shots + variants, usually 9–14) before generating.

## 2. Shot list

Write `<project>/SHOTS.md`: logline, then 6–10 shots with duration, framing, camera move, what changes inside the shot, and the line of dialogue or caption. Rules that make it work: `reference/directing.md`.

## 3. Paintings

For each shot write one prompt from `reference/images.md` (shared style block + the shot), generate, and save as `<project>/images/<shot>.png` at the film's aspect ratio. For a moment of acting (a head turns, a door opens, a light comes on) generate a **variant** of the same image with only that change, using the first image as reference. Look at every image before using it; regenerate any with text, wrong characters, extra limbs or a different style.

## 4. film.json

Describe the film; the schema is in `reference/film-json.md`, and `examples/mad-teaser/film.json` is a full example. Shots play back to back; the title card comes last.

## 5. Preview, fix, render

```sh
node <root>/scripts/render.mjs <project> --still 1,5,12      # preview frames → <project>/out/still_<t>.jpg
node <root>/scripts/render.mjs <project>                     # full film → <project>/out/film.mp4 + film.srt
```
Add `--software` when the machine has no usable GPU (slower, but works everywhere). Rendering resumes from saved frames if interrupted — just run the same command again.

Look at the previews before the full render: subject readable at phone size, no bare canvas at frame edges (the camera clamps, but check zoom), subtitles not covering faces, variants lining up. Fix in `film.json`, re-preview, then render.

## 6. Deliver

Give the user `<project>/out/film.mp4`, `film.srt`, `SHOTS.md`, the images, and a `CREDITS` file naming the image generator ("AI-generated with …"), voice/music sources and their licences, and the painted-cinema engine. Remind them they are responsible for the rights to material they bring.
