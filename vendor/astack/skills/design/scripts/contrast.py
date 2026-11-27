#!/usr/bin/env python3
"""WCAG contrast ratio between a text color and its background.

Usage: contrast.py TEXT BACKGROUND [--min RATIO]

Each color is a hex (#rgb or #rrggbb), rgb(), oklab(), oklch(), black, white, or
color-mix(in oklab, A, B N%) over any of those, as in the design tokens. Paste values from
getComputedStyle or the stylesheet. Prints the ratio and exits 1 when it is under --min
(default 4.5, the floor for body text). Large text and UI parts need 3.

Example: contrast.py white "color-mix(in oklab, #7b3aec, black 8%)"
"""

from __future__ import annotations

import argparse
import math
import re
import sys

Rgb = tuple[float, float, float]

NAMED = {"black": (0.0, 0.0, 0.0), "white": (1.0, 1.0, 1.0)}
MIX = re.compile(r"color-mix\(\s*in\s+oklab\s*,\s*([^,]+?)\s*(\d+(?:\.\d+)?%)?\s*,\s*([^,]+?)\s*(\d+(?:\.\d+)?%)?\s*\)$")


def parse(text: str) -> Rgb:
    """An sRGB color with channels from 0 to 1, rounded to the 8 bits a screen shows."""
    r, g, b = (round(c * 255) / 255 for c in parse_exact(text))
    return r, g, b


def parse_exact(text: str) -> Rgb:
    value = text.strip().lower()
    if value in NAMED:
        return NAMED[value]
    if value.startswith("#"):
        return parse_hex(value)
    if value.startswith("rgb"):
        return parse_rgb(value)
    if value.startswith("oklch("):
        return parse_oklch(value)
    if value.startswith("oklab("):
        return parse_oklab(value)
    mix = MIX.match(value)
    if mix:
        return parse_mix(*mix.groups())
    raise ValueError(f"can't read the color {text!r}; use a hex, rgb(), oklab(), oklch(), black, white, or color-mix(in oklab, ...)")


def parse_hex(value: str) -> Rgb:
    digits = value[1:]
    if len(digits) == 3:
        digits = "".join(d * 2 for d in digits)
    if not re.fullmatch(r"[0-9a-f]{6}", digits):
        raise ValueError(f"{value} isn't #rgb or #rrggbb; a color with transparency has no single contrast")
    r, g, b = (int(digits[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return r, g, b


def channels(value: str) -> list[str]:
    """The three channel numbers inside a color function. A partly transparent color is refused."""
    inner = value[value.index("(") + 1:value.rindex(")")] if value.endswith(")") else ""
    numbers = re.findall(r"-?[\d.]+%?", inner.replace(",", " "))
    if len(numbers) == 4:
        alpha = numbers.pop()
        if float(alpha.rstrip("%")) / (100 if alpha.endswith("%") else 1) != 1:
            raise ValueError(f"{value} is partly transparent; blend it over its background first")
    if len(numbers) != 3:
        raise ValueError(f"{value} needs three channels")
    return numbers


def number(text: str, percent_of: float) -> float:
    """A channel value, where a percentage is a share of `percent_of`."""
    return float(text[:-1]) / 100 * percent_of if text.endswith("%") else float(text)


def parse_rgb(value: str) -> Rgb:
    r, g, b = (number(n, 255) / 255 for n in channels(value))
    return r, g, b


def parse_oklab(value: str) -> Rgb:
    lightness, a, b = channels(value)
    return from_oklab((number(lightness, 1), number(a, 0.4), number(b, 0.4)))


def parse_oklch(value: str) -> Rgb:
    lightness, chroma, hue = channels(value)
    c, h = number(chroma, 0.4), math.radians(float(hue))
    return from_oklab((number(lightness, 1), c * math.cos(h), c * math.sin(h)))


def parse_mix(first: str, first_share: str | None, second: str, second_share: str | None) -> Rgb:
    """CSS color-mix in oklab: shares are percentages, and a missing one is the rest of 100."""
    if first_share is None and second_share is None:
        weight = 0.5
    elif second_share is not None:
        weight = float(second_share[:-1]) / 100
    else:
        weight = 1 - float(first_share[:-1]) / 100
    a, b = to_oklab(parse(first)), to_oklab(parse(second))
    return from_oklab(tuple(x + (y - x) * weight for x, y in zip(a, b)))


def linear(channel: float) -> float:
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def encoded(channel: float) -> float:
    channel = min(max(channel, 0.0), 1.0)
    return channel * 12.92 if channel <= 0.0031308 else 1.055 * channel ** (1 / 2.4) - 0.055


def cbrt(x: float) -> float:
    return math.copysign(abs(x) ** (1 / 3), x)


def to_oklab(color: Rgb) -> Rgb:
    r, g, b = (linear(c) for c in color)
    l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def from_oklab(lab: Rgb) -> Rgb:
    big_l, a, b = lab
    l = (big_l + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (big_l - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (big_l - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (encoded(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
            encoded(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
            encoded(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s))


def luminance(color: Rgb) -> float:
    r, g, b = (linear(c) for c in color)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(text: Rgb, background: Rgb) -> float:
    lighter, darker = sorted((luminance(text), luminance(background)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="contrast.py", description=__doc__.split("\n\n")[0])
    parser.add_argument("text")
    parser.add_argument("background")
    parser.add_argument("--min", type=float, default=4.5, help="the ratio to pass (default 4.5)")
    args = parser.parse_args(argv)
    try:
        value = ratio(parse(args.text), parse(args.background))
    except ValueError as error:
        print(f"contrast.py: {error}", file=sys.stderr)
        return 2
    passed = value >= args.min
    shown = f"{value:.2f}" if (round(value, 2) >= args.min) == passed else f"{value:.3f}"
    print(f"{shown}  {'pass' if passed else f'fail: under {args.min:g}'}")
    return 0 if value >= args.min else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
