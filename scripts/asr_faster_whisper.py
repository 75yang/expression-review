import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path


SENTENCE_ENDINGS = "\u3002\uff01\uff1f!?\uff1b;"
DEFAULT_PROMPT = (
    "\u8bf7\u4f7f\u7528\u7b80\u4f53\u4e2d\u6587\u8f6c\u5199\uff0c"
    "\u4fdd\u7559\u81ea\u7136\u7684\u6807\u70b9\uff0c\u4e0d\u8981\u8f6c\u6210\u7e41\u4f53\u5b57\u3002"
)


def to_simplified(text: str):
    try:
        from opencc import OpenCC

        return OpenCC("t2s").convert(text)
    except Exception:
        return text


def clean_text(text: str):
    simplified = to_simplified(text.strip())
    simplified = re.sub(r"\s+", "", simplified)
    return simplified


def split_sentences(text: str):
    sentences = []
    current = []
    for char in text.strip():
        current.append(char)
        if char in SENTENCE_ENDINGS:
            sentence = clean_text("".join(current))
            if sentence:
                sentences.append(sentence)
            current = []
    tail = clean_text("".join(current))
    if tail:
        sentences.append(tail)
    return sentences


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe a Chinese recording to sentence-level transcript JSON."
    )
    parser.add_argument("--input", required=True, help="Input video or audio path.")
    parser.add_argument("--output", required=True, help="Output transcript JSON path.")
    parser.add_argument("--model", default="small", help="faster-whisper model name.")
    parser.add_argument("--device", default="cpu", help="cpu, cuda, or auto.")
    parser.add_argument("--compute-type", default="int8", help="faster-whisper compute type.")
    parser.add_argument("--beam-size", type=int, default=8, help="Beam size for decoding.")
    parser.add_argument("--best-of", type=int, default=5, help="Candidate count for sampling fallback.")
    parser.add_argument(
        "--vad-filter",
        dest="vad_filter",
        action="store_true",
        default=True,
        help="Enable VAD filtering. Enabled by default.",
    )
    parser.add_argument(
        "--no-vad-filter",
        dest="vad_filter",
        action="store_false",
        help="Disable VAD filtering.",
    )
    parser.add_argument(
        "--condition-on-previous-text",
        action="store_true",
        help="Carry previous decoded text into the next segment. Disabled by default to reduce repetition.",
    )
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise SystemExit(
            "Missing faster-whisper. Install it with: python -m pip install faster-whisper"
        ) from exc

    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
    )
    segments, _ = model.transcribe(
        args.input,
        language="zh",
        task="transcribe",
        initial_prompt=DEFAULT_PROMPT,
        condition_on_previous_text=args.condition_on_previous_text,
        temperature=[0.0, 0.2, 0.4],
        vad_filter=args.vad_filter,
        vad_parameters={"min_silence_duration_ms": 500},
        beam_size=args.beam_size,
        best_of=args.best_of,
        repetition_penalty=1.15,
        no_repeat_ngram_size=4,
        hallucination_silence_threshold=2.0,
    )

    sentences = []
    for segment in segments:
        pieces = split_sentences(segment.text)
        if not pieces:
            continue

        span = max(segment.end - segment.start, 0.01)
        step = span / len(pieces)
        for index, text in enumerate(pieces):
            start = segment.start + index * step
            end = segment.start + (index + 1) * step
            sentences.append(
                {
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "text": text,
                }
            )

    output = {
        "id": Path(args.output).stem,
        "language": "zh",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "sentences": sentences,
        "full_text": "".join(sentence["text"] for sentence in sentences),
        "status": "ready" if sentences else "empty",
    }

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
