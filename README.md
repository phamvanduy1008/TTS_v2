## Local Node Server

Use this mode when you want the Vietnamese TTS pipeline to run in a local Node.js server instead of in the browser.

### Run Server

```bash
npm run server:local
```

### Run Main Desktop App

CPU instance, API port `3030`:

```bash
npm run desktop
```
### Run a Second Desktop App

CPU instance, API port `3031`:

```bash
npm run desktop:worker
```

### Run a GPU Desktop App

GPU/DirectML instance, API port `3031`:

```bash
npm run desktop:gpu
```

`desktop:gpu` sets `TTS_INFERENCE_BACKEND=dml` for Windows GPU acceleration
through ONNX Runtime DirectML. Use `cuda` only on a runtime that has an ONNX
Runtime CUDA execution provider installed.

Manual override examples:

```bash
$env:TTS_INFERENCE_BACKEND='cpu'; npm run desktop
node scripts/run-desktop-instance.js 3032 gpu-2 dml
node scripts/run-desktop-instance.js 3033 cpu-2 cpu
```

Expected split:

- Main app: CPU worker on `127.0.0.1:3030`.
- Second app: CPU worker on `127.0.0.1:3031`.
- GPU app: DirectML worker on `127.0.0.1:3031` after GPU runtime setup is complete.
- Use different input/output folders for each app so two jobs do not write to the same folder at the same time.

