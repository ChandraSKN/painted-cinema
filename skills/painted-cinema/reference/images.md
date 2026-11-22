# Making the paintings

## Which generator

Use whatever the user has; ask once.

- **An image tool connected to Claude** (for example a Canva, Figma or other image-generation connector): generate there. If the tool only returns a hosted image, get a full-resolution file out of it (some tools need the image placed in a design and exported as PNG at the film size).
- **A command-line generator** the user is signed in to (Codex CLI, an API script): call it from the shell.
- **The user's own art or images**: ask them to save one image per shot as `images/<shot>.png`; give them the prompts if they generate elsewhere.

Never invent images by drawing them in code as a stand-in — the look depends on real paintings.

## Prompt = style block + shot

Keep one style block for the whole film so every image matches:

> Expressive oil painting with thick impasto brushwork, vertical 9:16 film frame. Bold visible brush strokes, hard-edged planes of colour, visible paint ridges, cinematic lighting with one clear light source, warm light against cool shadow. No text, no letters, no watermark.

Then the shot: who (with a fixed description of each character, repeated word for word in every prompt), where, light source, framing, expression. Example:

> Close-up of ARJUN, a lean 21-year-old man with short messy black hair and a teal hoodie, looking down at a phone; its cold light on his face from below; orange lamps through a rainy windshield behind him.

## Variants for acting

For a change inside a shot, generate a second image **from the first as a reference** and describe only the change ("same man, same framing, same light, but now he looks up, eyes wide"). The player re-lays the painting stroke by stroke from one to the other, which reads as the character moving.

## Checks before use

- Same aspect ratio as the film.
- No text, logos or watermarks (they turn into brush smears).
- Characters consistent between shots; regenerate rather than accept a different face.
- Safety filters may refuse violent wording: describe the mood and the evidence ("a dark wet patch on the floor") instead of gore.
