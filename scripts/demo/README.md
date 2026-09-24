# Demo video

`docs/demo/inkflow-demo.mp4` is generated from the running app (`pnpm dev` + `pnpm db:seed`):

1. **Narration**: [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) TTS, female voice `af_heart`.
   Needs `espeak-ng` (`brew install espeak-ng`), `pip install kokoro-onnx soundfile`, and the
   `kokoro-v1.0.onnx` + `voices-v1.0.bin` model files next to the script:

   ```bash
   python tts.py
   ```

   This writes one `n_<scene>.wav` per line of `narration.json` and their lengths to `durations.json`.

2. **Recording**: Playwright drives the editor (and a second browser for live collaboration),
   pacing each scene to its narration and logging scene start times to `marks.json`:

   ```bash
   node record-demo.mjs <dir-with-durations.json>
   ```

3. **Mixing**: ffmpeg delays each narration clip to its scene start, mixes them and encodes
   H.264/AAC; the README preview GIF is a 16-second excerpt.
