"""RunPod serverless handler: LTX-2.5 text-to-video and image-to-video, returns an mp4 with audio.

Input:  {"mode": "t2v"|"i2v", "prompt": str, "aspect_ratio": "16:9"|"9:16"|"1:1",
         "duration": 2-10 (seconds), "seed": int?, "image_b64": str (i2v only)}
Output: {"video_b64": str, "mime": "video/mp4", "duration": float, "seed": int, "elapsed": float}
        or {"error": str} (RunPod marks the job FAILED).
Weights load once per worker from HF_HOME (put it on a network volume so cold starts skip the ~72 GB download).
"""

import base64
import io
import logging
import os
import random
import tempfile
import time

import runpod
import torch
from diffusers import LTX2ImageToVideoPipeline, LTX2Pipeline
from diffusers.pipelines.ltx2.utils import DEFAULT_NEGATIVE_PROMPT, DISTILLED_SIGMA_VALUES
from diffusers.utils import encode_video
from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ltx-worker")

MODEL_ID = os.environ.get("LTX_MODEL_ID", "Lightricks/LTX-2.5-Diffusers")
OFFLOAD = os.environ.get("LTX_OFFLOAD", "none")  # none (80 GB GPU) | model | sequential
FPS = 24
SIZES = {"16:9": (960, 544), "9:16": (544, 960), "1:1": (704, 704)}  # model card default is 960x544
MAX_IMAGE_BYTES = 7 * 1024 * 1024
MAX_OUTPUT_BYTES = 15 * 1024 * 1024  # keep the JSON response well under RunPod's payload limit

_pipes = {}


def load_pipes():
    if _pipes:
        return _pipes
    started = time.time()
    t2v = LTX2Pipeline.from_pretrained(MODEL_ID, dtype=torch.bfloat16, token=os.environ.get("HF_TOKEN"))
    if OFFLOAD == "model":
        t2v.enable_model_cpu_offload()
    elif OFFLOAD == "sequential":
        t2v.enable_sequential_cpu_offload()
    else:
        t2v.to("cuda")
    t2v.vae.enable_tiling()
    _pipes["t2v"] = t2v
    _pipes["i2v"] = LTX2ImageToVideoPipeline.from_pipe(t2v)  # shares weights, no extra memory
    log.info("pipelines loaded in %.1fs (offload=%s)", time.time() - started, OFFLOAD)
    return _pipes


def frames_for(seconds):
    # LTX frame counts must be 8k+1.
    return int(round(seconds * FPS / 8)) * 8 + 1


def validate(inp):
    if not isinstance(inp, dict):
        raise ValueError("input must be an object")
    mode = inp.get("mode")
    if mode not in ("t2v", "i2v"):
        raise ValueError("mode must be t2v or i2v")
    prompt = str(inp.get("prompt", "")).strip()
    if not 3 <= len(prompt) <= 2000:
        raise ValueError("prompt must be 3-2000 characters")
    aspect = inp.get("aspect_ratio", "16:9")
    if aspect not in SIZES:
        raise ValueError(f"aspect_ratio must be one of {sorted(SIZES)}")
    duration = float(inp.get("duration", 5))
    if not 2 <= duration <= 10:
        raise ValueError("duration must be 2-10 seconds")
    seed = inp.get("seed")
    seed = int(seed) if seed is not None else random.randint(0, 2**31 - 1)
    image = None
    if mode == "i2v":
        raw = inp.get("image_b64")
        if not raw:
            raise ValueError("image_b64 is required for i2v")
        data = base64.b64decode(raw, validate=True)
        if len(data) > MAX_IMAGE_BYTES:
            raise ValueError("image must be under 7 MB")
        image = Image.open(io.BytesIO(data)).convert("RGB")
    return {"mode": mode, "prompt": prompt, "aspect": aspect, "duration": duration, "seed": seed, "image": image}


def handler(job):
    started = time.time()
    try:
        req = validate(job.get("input"))
    except Exception as e:  # bad input is the caller's fault: fail fast with a clear message
        return {"error": f"invalid input: {e}"}

    try:
        pipes = load_pipes()
        width, height = SIZES[req["aspect"]]
        kwargs = dict(
            prompt=req["prompt"],
            negative_prompt=DEFAULT_NEGATIVE_PROMPT,
            width=width,
            height=height,
            num_frames=frames_for(req["duration"]),
            frame_rate=float(FPS),
            sigmas=DISTILLED_SIGMA_VALUES,
            guidance_scale=1.0,
            audio_guidance_scale=1.0,
            stg_scale=0.0,
            audio_stg_scale=0.0,
            modality_scale=1.0,
            audio_modality_scale=1.0,
            generator=torch.Generator("cuda").manual_seed(req["seed"]),
            output_type="np",
            return_dict=False,
        )
        pipe = pipes["t2v"]
        if req["mode"] == "i2v":
            pipe = pipes["i2v"]
            kwargs["image"] = req["image"]
        with torch.inference_mode():
            video, audio = pipe(**kwargs)

        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "out.mp4")
            encode_video(
                video[0],
                fps=FPS,
                output_path=out,
                audio=audio[0].float().cpu(),
                audio_sample_rate=pipe.vocoder.config.output_sampling_rate,
            )
            with open(out, "rb") as f:
                data = f.read()
        if len(data) > MAX_OUTPUT_BYTES:
            return {"error": f"output too large ({len(data)} bytes)"}
        elapsed = round(time.time() - started, 1)
        log.info("job %s done: %s %ss %s in %.1fs", job.get("id"), req["mode"], req["duration"], req["aspect"], elapsed)
        return {
            "video_b64": base64.b64encode(data).decode(),
            "mime": "video/mp4",
            "duration": req["duration"],
            "seed": req["seed"],
            "elapsed": elapsed,
        }
    except torch.cuda.OutOfMemoryError:
        torch.cuda.empty_cache()
        return {"error": "GPU out of memory; use an 80 GB GPU or set LTX_OFFLOAD=model"}
    except Exception as e:
        log.exception("generation failed")
        return {"error": f"generation failed: {e}"}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
