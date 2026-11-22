# film.json

```jsonc
{
  "size": [1080, 1920],          // output size; images are stretched to it, so generate at this aspect ratio
  "fps": 24,
  "detail": "normal",            // "high" adds a finer stroke pass (slower)
  "supersample": 1,              // paint at N× resolution and downsample (sharper, slower)
  "audio": "soundtrack.m4a",     // optional, relative to the project; muxed and loudness-normalised to -14 LUFS
  "shots": [ /* played back to back */ ],
  "title": { "text": "MAD", "color": "#2fd0c0", "dur": 4, "lines": ["CHAPTER 1", "My First Murder", "small line"] },
  "subtitles": [ { "t": 0.6, "dur": 2.5, "who": "Speaker", "text": "Line." } ]   // drawn in the picture and exported as .srt
}
```

## A shot

| key | meaning |
|---|---|
| `dur` | seconds |
| `images` | `["images/a.png", { "src": "images/a2.png", "at": 1.5, "dur": 0.5 }]` — the first painting, then variants repainted stroke by stroke `at` seconds into the shot over `dur` |
| `cam` | `{ "from": [x, y, zoom], "to": [x, y, zoom], "shake": 0 }` — x, y in 0..1 of the image, zoom ≥ 1; eased across the shot and kept inside the painting |
| `transition` | `"paint"` (default: the new shot is laid over the old one in a brush sweep) or `"cut"` |
| `transitionDur` | paint-over length, default 0.5 |
| `light` | `"rake"`: the light drops to a grazing angle mid-shot so every paint ridge catches it, then settles |
| `post` | grade overrides: `expo` (brightness), `sat` (colour), `vig` (vignette) |
| `paintIn` / `paintInDur` | first shot only: the painting is laid in from a bare canvas (default on, 2.4 s) |
| `fx` | list of effects below |

## Effects (`fx`)

Coordinates are 0..1 of the image.

| type | keys | use |
|---|---|---|
| `glow` | `x, y, r, color, alpha, pulse` (rad/s), `flicker` (bool) | a phone screen, a lamp, a fire |
| `motes` | `box [x0,y0,x1,y1], n, color, alpha` | dust drifting in a light |
| `shaft` | `x, y, angle` (deg), `len, width, color, alpha` | a beam of light |
| `rain` | `n, y0, h, color` | beads on glass |
| `glint` | `at` (s into shot), `points [[x,y]…]`, `color, alpha` | a flash across glasses, a blade, a lens |
