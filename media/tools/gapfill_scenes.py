"""Animated title scenes for lines that have no picture, drawn with Manim in the ZALA style (black, ivory, gold).

Three kinds of scene, each about 7 seconds, 1920x1080 at 30 fps:
  year    a year counts up to its value, with a few words of the line under it
  number  a number counts up with its unit (meters, tons, years, BC)
  phrase  the key words of the line, in one of three layouts so the scenes do not repeat
Each scene plays over a real picture from the same chapter (blurred and darkened by gapfill.mjs) with a slow push-in,
gold dust drifting up, and a soft vignette. Everything is free: Manim, Pango text, the fonts from media/brand/fonts.

Usage: python gapfill_scenes.py scenes.json out_dir
"""
import json
import os
import random
import sys

from manim import (
    DOWN, LEFT, RIGHT, UP, ORIGIN, Circle, Create, Dot, always_redraw, FadeIn, FadeOut, ImageMobject, Line, Rectangle,
    Scene, Text, ValueTracker, VGroup, config, linear, rate_functions, smooth,
)

GOLD = "#D4AF37"
GOLD_LIGHT = "#F4E27A"
IVORY = "#F3EBDD"
INK = "#07080B"
SERIF = "DM Serif Display"
SANS = "Lato"
DISPLAY = "Anton"
LENGTH = 7.0

config.pixel_width = 1920
config.pixel_height = 1080
config.frame_rate = 30
config.background_color = INK
config.verbosity = "WARNING"
config.progress_bar = "none"


def fit(mob, width=11.5, height=None):
    if mob.width > width:
        mob.scale_to_fit_width(width)
    if height and mob.height > height:
        mob.scale_to_fit_height(height)
    return mob


def counter(tracker, size, color, commas, at):
    """A number drawn as plain text (no LaTeX), redrawn every frame while it counts."""
    def make():
        v = int(round(tracker.get_value()))
        return Text(f"{v:,}" if commas else str(v), font=DISPLAY, color=color, font_size=size).move_to(at)
    return always_redraw(make)


def wrap(text, per_line=22):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > per_line:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return "\n".join(lines)


class ZalaScene(Scene):
    spec = {}

    def backdrop(self):
        bg = self.spec.get("bg")
        if bg and os.path.exists(bg):
            img = ImageMobject(bg).scale_to_fit_height(config.frame_height * 1.1)
            self.add(img)
            img.add_updater(lambda m, dt: m.scale(1 + 0.012 * dt))   # slow push-in
        shade = Rectangle(width=config.frame_width + 1, height=config.frame_height + 1, stroke_width=0, fill_color=INK, fill_opacity=0.45)
        glow = Circle(radius=5.5, stroke_width=0, fill_color=GOLD, fill_opacity=0.07).move_to(ORIGIN)
        self.add(shade, glow)
        rnd = random.Random(self.spec.get("name", "z"))
        dust = VGroup(*[
            Dot(point=[rnd.uniform(-7.5, 7.5), rnd.uniform(-4.5, 4.5), 0], radius=rnd.uniform(0.008, 0.028),
                color=GOLD_LIGHT, fill_opacity=rnd.uniform(0.15, 0.55))
            for _ in range(70)
        ])
        dust.add_updater(lambda m, dt: m.shift(UP * 0.07 * dt))
        self.add(dust)
        # vignette: dark bands at the edges
        for side, size in ((UP, (config.frame_width + 1, 1.6)), (DOWN, (config.frame_width + 1, 1.6))):
            band = Rectangle(width=size[0], height=size[1], stroke_width=0, fill_color=INK, fill_opacity=0.55)
            band.move_to(side * (config.frame_height / 2))
            self.add(band)

    def hold(self, used):
        self.wait(max(0.5, LENGTH - used))


class YearScene(ZalaScene):
    def construct(self):
        self.backdrop()
        value = int(self.spec["value"])
        start = value - 40 if value > 100 else 0
        tracker = ValueTracker(start)
        num = counter(tracker, 170, GOLD, False, UP * 0.4)
        rule = Line(LEFT * 2.6, RIGHT * 2.6, color=GOLD, stroke_width=3).next_to(num, DOWN, buff=0.35)
        small = self.spec.get("small", "").strip()
        label = fit(Text(small.upper(), font=SANS, weight="BOLD", color=IVORY, font_size=34), 10).next_to(rule, DOWN, buff=0.4) if small else VGroup()
        self.play(FadeIn(num, shift=UP * 0.2), run_time=0.6)
        self.play(tracker.animate.set_value(value), Create(rule), run_time=1.6, rate_func=rate_functions.ease_out_cubic)
        if small:
            self.play(FadeIn(label, shift=UP * 0.15), run_time=0.7)
        self.hold(0.6 + 1.6 + (0.7 if small else 0))


class NumberScene(ZalaScene):
    def construct(self):
        self.backdrop()
        value = int(self.spec["value"])
        tracker = ValueTracker(0)
        num = counter(tracker, 160, GOLD, value >= 10000, UP * 0.5)
        unit = Text(self.spec.get("unit", ""), font=DISPLAY, color=IVORY, font_size=64)
        unit.next_to(num, DOWN, buff=0.3)
        rule = Line(LEFT * 1.6, RIGHT * 1.6, color=GOLD, stroke_width=3).next_to(unit, DOWN, buff=0.35)
        self.play(FadeIn(num), run_time=0.4)
        self.play(tracker.animate.set_value(value), run_time=1.8, rate_func=rate_functions.ease_out_cubic)
        self.play(FadeIn(unit, shift=UP * 0.2), Create(rule), run_time=0.7)
        self.hold(0.4 + 1.8 + 0.7)


class PhraseScene(ZalaScene):
    def construct(self):
        self.backdrop()
        text = self.spec.get("text", "").strip()
        style = int(self.spec.get("style", 0)) % 3
        if style == 0:
            # centred serif title with a gold rule drawn under it
            title = fit(Text(wrap(text, 24), font=SERIF, color=IVORY, font_size=78, line_spacing=0.9), 12, 3.6)
            rule = Line(LEFT * 1.8, RIGHT * 1.8, color=GOLD, stroke_width=3).next_to(title, DOWN, buff=0.45)
            self.play(FadeIn(title, shift=UP * 0.25), run_time=1.0, rate_func=smooth)
            self.play(Create(rule), run_time=0.7)
            self.play(title.animate.scale(1.035), run_time=LENGTH - 2.2, rate_func=linear)
        elif style == 1:
            # lower third: a gold bar slides in, the words follow it
            title = fit(Text(wrap(text, 30), font=SERIF, color=IVORY, font_size=60, line_spacing=0.9), 10.5, 2.4)
            title.to_corner(DOWN + LEFT, buff=1.0).shift(UP * 0.3 + RIGHT * 0.35)
            bar = Rectangle(width=0.12, height=title.height + 0.3, stroke_width=0, fill_color=GOLD, fill_opacity=1)
            bar.next_to(title, LEFT, buff=0.3)
            self.play(FadeIn(bar, shift=RIGHT * 0.4), run_time=0.5)
            self.play(FadeIn(title, shift=RIGHT * 0.5), run_time=0.9, rate_func=smooth)
            self.wait(LENGTH - 1.4)
        else:
            # one strong word large, the rest small under it
            words = text.split()
            key = max(words, key=lambda w: len(w.strip(",.!?"))).strip(",.!?")
            big = fit(Text(key.upper(), font=DISPLAY, color=GOLD, font_size=150), 12)
            small = fit(Text(text, font=SANS, weight="BOLD", color=IVORY, font_size=34), 11).next_to(big, DOWN, buff=0.45)
            self.play(FadeIn(big, scale=1.08), run_time=0.8, rate_func=smooth)
            self.play(FadeIn(small, shift=UP * 0.15), run_time=0.7)
            self.play(big.animate.scale(1.03), run_time=LENGTH - 1.5, rate_func=linear)


KINDS = {"year": YearScene, "number": NumberScene, "phrase": PhraseScene}


def main():
    spec_file, out_dir = sys.argv[1], sys.argv[2]
    scenes = json.load(open(spec_file, encoding="utf-8"))
    os.makedirs(out_dir, exist_ok=True)
    work = os.path.join(out_dir, "_manim")
    done = 0
    for s in scenes:
        target = os.path.join(out_dir, f"{s['name']}.mp4")
        if os.path.exists(target) and os.path.getsize(target) > 50000:
            done += 1
            continue
        cls = KINDS.get(s.get("type"), PhraseScene)
        config.media_dir = work
        config.output_file = s["name"]
        scene_cls = type(f"Z{done}", (cls,), {"spec": s})
        scene = scene_cls()
        scene.render()
        made = scene.renderer.file_writer.movie_file_path
        os.replace(made, target)
        done += 1
        print(f"scene {done}/{len(scenes)}: {s['type']} {s.get('text') or s.get('value')}", flush=True)
    print(f"{done} scenes ready in {out_dir}")


if __name__ == "__main__":
    main()
