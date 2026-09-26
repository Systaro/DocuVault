# Promo GIFs

The GIFs in `../assets/` are rendered from `scenes.html`: conceptual mockups in the
release-note house style, animated from `data-fx` attributes (see the comment at the top
of that file). Open `scenes.html#<scene-id>` in a browser to preview one scene.

```bash
npm install && npx playwright install chromium-headless-shell
npm run render              # all scenes
npm run render -- share     # one scene
```

Needs `ffmpeg` on the PATH.
