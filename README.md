## Local Node Server

Use this mode when you want the Vietnamese TTS pipeline to run in a local Node.js server instead of in the browser.

## Desktop App

Use desktop mode for very large inputs. The Electron shell starts the local TTS server automatically, keeps the UI out of the browser runtime, writes each segment to disk, and can resume a failed local job from existing segment WAV files.

### Run Desktop Production Build

```bash
npm run desktop
```

### Run Desktop Development Mode

```bash
npm run desktop:dev
```

Notes:
- Desktop mode uses `http://127.0.0.1:3030` for the local TTS API.
- If a previous local server is already running on that port, the desktop app will reuse it.
- For failed local jobs, use **Tiep tuc job** to resume from completed `segment-xxxx.wav` files instead of starting over.
- For very large files, prefer desktop mode over browser worker mode.

### Start the Server

```bash
npm run server:local
```

The server listens on `http://127.0.0.1:3030` by default.

### Submit a Job by File Path

```bash
curl -X POST http://127.0.0.1:3030/jobs ^
  -H "Content-Type: application/json" ^
  -d "{\"inputPath\":\"D:\\\\path\\\\to\\\\input.txt\",\"modelName\":\"ngochuyen\"}"
```

### Submit a Job by Upload

```bash
curl -X POST http://127.0.0.1:3030/jobs ^
  -F "file=@D:\\path\\to\\input.txt" ^
  -F "modelName=ngochuyen"
```

### Check Job Status

```bash
curl http://127.0.0.1:3030/jobs/{jobId}
```

### Get Job Result Metadata

```bash
curl http://127.0.0.1:3030/jobs/{jobId}/result
```

### Download the Final Audio

```bash
curl http://127.0.0.1:3030/jobs/{jobId}/audio --output final.wav
```

### Resume a Failed Job

```bash
curl -X POST http://127.0.0.1:3030/jobs/{jobId}/resume
```

Notes:
- Current local server input support: `.txt` and `.docx`
- Final audio and temporary files are written under `runtime/`
- Segment metadata is also written to `runtime/jobs/{jobId}/segments.csv`
- Existing segment WAV files are reused when a failed job is resumed.

## Development

### Build for Production

```bash
npm run build
```

The production build will be in the `dist/` folder.

### Preview Production Build

```bash
npm run preview
```

This serves the production build locally for testing.

## Deployment

The project is configured for Cloudflare Pages deployment:

1. **TTS models** should be stored in a Cloudflare R2 bucket (e.g. `tts-bucket`) with **language prefixes**:
   - **Vietnamese**: `piper/vi/{model-name}.onnx` and `piper/vi/{model-name}.onnx.json` (discovered via `/api/models`)
   - **English**: `piper/en/{model-name}.onnx` and `.onnx.json` (discovered via `/api/piper/en/models`)
   - **Indonesian**: `piper/id/{model-name}.onnx` and `.onnx.json` (discovered via `/api/piper/id/models`)
   - Each TTS model requires two files (`.onnx` + `.onnx.json`) per language folder.

2. **ASR models** should be stored under the `asr/` prefix in the same R2 bucket:
   - `asr/{model-name}/{file}` (discovered via `/api/asr/models`, served via `/api/model/asr/{model}/{name}`)
   - Model files are served with 1-year immutable cache headers.

The Cloudflare Pages Functions discover and serve models by prefix.

## Configuration

### Wrangler Configuration

The `wrangler.toml` file configures:
- Pages build output directory
- R2 bucket binding (`piper` → `tts-bucket`)

### Application Configuration

`src/config.json` controls runtime behavior:
- `debug` – Enable/disable debug logging
- `UnlimitedRomanNumerals` – When `false`, only Roman numerals I–XXX are converted; when `true`, all valid Roman numerals are converted

### TTS Model Format

TTS models must be in Piper TTS ONNX format with:
- `.onnx` file containing the ONNX model
- `.onnx.json` file containing voice configuration (phoneme_id_map, audio settings, etc.)

## Features in Detail

### Text Cleaning

- Removes emojis and special characters
- Normalizes Unicode (NFC)
- Handles Vietnamese-specific punctuation
- Cleans whitespace

### Text Chunking

- Intelligently splits text into optimal chunks
- Respects sentence boundaries
- Handles long sentences by splitting at word boundaries
- Maintains minimum and maximum chunk sizes for optimal processing

### Audio Processing

- Real-time streaming of audio chunks
- Automatic normalization and peak limiting
- Silence trimming
- Sample rate preservation

## Browser Compatibility

- Modern browsers with WebAssembly support
- Web Workers support required
- ES Modules support required

## 📜 License & Usage

This project is:

- ✅ **Free to use**
- ✅ **Open source**
- ✅ **Allowed for commercial use**
- ✅ **Customizable and deployable**

⚠️ **Important**: Users are responsible for complying with voice and content laws when using generated audio.

## Acknowledgments

- Built on [Piper TTS (GPL)](https://github.com/OHF-Voice/piper1-gpl) by OHF-Voice
- Inspired by [piper-tts-web-demo](https://clowerweb.github.io/piper-tts-web-demo/) by clowerweb
- Uses [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) for browser-based TTS inference
- Uses [Sherpa-ONNX](https://github.com/k2-fsa/sherpa-onnx) for browser-based ASR with Silero VAD
