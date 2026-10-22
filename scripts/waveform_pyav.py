import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


def normalize_samples(array):
    samples = np.asarray(array)
    if samples.ndim == 2:
        if samples.shape[0] <= 16 and samples.shape[0] <= samples.shape[1]:
            samples = samples.mean(axis=0)
        elif samples.shape[1] <= 16:
            samples = samples.mean(axis=1)
        else:
            samples = samples.reshape(-1)
    else:
        samples = samples.reshape(-1)

    if samples.dtype.kind in {"i", "u"}:
        info = np.iinfo(samples.dtype)
        scale = max(abs(info.min), abs(info.max))
        samples = samples.astype(np.float32) / scale
    else:
        samples = samples.astype(np.float32)

    return np.nan_to_num(samples, nan=0.0, posinf=0.0, neginf=0.0)


def main():
    parser = argparse.ArgumentParser(
        description="Extract normalized audio waveform peaks from a media file."
    )
    parser.add_argument("--input", required=True, help="Input video or audio path.")
    parser.add_argument("--output", required=True, help="Output waveform JSON path.")
    parser.add_argument(
        "--peaks-per-second",
        type=int,
        default=80,
        help="Number of waveform peaks to keep for each second.",
    )
    args = parser.parse_args()

    try:
        import av
    except ImportError as exc:
        raise SystemExit("Missing PyAV. Install it with: python -m pip install av") from exc

    input_path = Path(args.input)
    output_path = Path(args.output)
    peaks_per_second = max(10, min(args.peaks_per_second, 240))

    container = av.open(str(input_path))
    stream = next((item for item in container.streams if item.type == "audio"), None)
    if stream is None:
        raise SystemExit("No audio stream found.")

    sample_rate = 0
    bucket_size = 0
    pending = np.array([], dtype=np.float32)
    peaks = []
    total_samples = 0

    for frame in container.decode(stream):
        if not sample_rate:
            sample_rate = int(frame.sample_rate or stream.rate or 48000)
            bucket_size = max(1, sample_rate // peaks_per_second)

        samples = normalize_samples(frame.to_ndarray())
        if not samples.size:
            continue

        total_samples += int(samples.size)
        if pending.size:
            samples = np.concatenate([pending, samples])

        complete_size = (samples.size // bucket_size) * bucket_size
        if complete_size:
            blocks = samples[:complete_size].reshape(-1, bucket_size)
            rms_values = np.sqrt(np.mean(np.square(blocks), axis=1))
            peaks.extend(rms_values.tolist())
        pending = samples[complete_size:]

    if pending.size:
        peaks.append(float(np.sqrt(np.mean(np.square(pending)))))

    container.close()

    if not sample_rate or not total_samples:
        waveform = {
            "id": output_path.stem,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "duration": 0,
            "sample_rate": sample_rate,
            "peaks_per_second": peaks_per_second,
            "peaks": [],
            "status": "empty",
        }
    else:
        max_peak = max(peaks) if peaks else 0
        normalized = [
            round(float(min(max(peak / max_peak, 0), 1)), 4)
            for peak in peaks
        ] if max_peak > 0 else []
        waveform = {
            "id": output_path.stem,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "duration": round(total_samples / sample_rate, 3),
            "sample_rate": sample_rate,
            "peaks_per_second": peaks_per_second,
            "peaks": normalized,
            "status": "ready" if normalized else "empty",
        }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(waveform, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
