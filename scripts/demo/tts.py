import json, soundfile as sf
import espeakng_loader
from kokoro_onnx import Kokoro, EspeakConfig
k = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin", espeak_config=EspeakConfig(lib_path="/opt/homebrew/lib/libespeak-ng.dylib", data_path="/opt/homebrew/share/espeak-ng-data"))
out = {}
for key, text in json.load(open("narration.json")):
    samples, sr = k.create(text, voice="af_heart", speed=1.0, lang="en-us")
    sf.write(f"n_{key}.wav", samples, sr)
    out[key] = round(len(samples) / sr, 2)
json.dump(out, open("durations.json", "w"), indent=1)
print(out)
