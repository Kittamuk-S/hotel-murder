"""Rough model of ONLY the clue channel (no lab tests, no camera, no discussion), rules 1.0 rhythm (3 nights).
Each night the killer places 1 real clue (a different trait of his each night) + 1 fake clue (a trait of the scapegoat chosen
at the start). Guests keep everybody who matches at least one clue in EVERY night's pair.
Question: how many suspects are left after each night if the guests had nothing but the clues?"""
import os
import random
import statistics

src = open(os.path.join(os.path.dirname(__file__), 'build.py'), encoding='utf-8').read()
ns = {}
exec(src.split("def verify")[0].split("# ---------------------------------------------------------------- content")[1], ns)
GUESTS = ns['GUESTS']
NIGHTS = 3


def trial(n, smart):
    prof = [g[4] for g in GUESTS[:n]]
    k = random.randrange(n)
    sc = random.choice([i for i in range(n) if i != k])
    cats = list(range(4)); random.shuffle(cats)                # real clue categories, one per night (3 of 4 used)
    fake_cats = list(range(4)); random.shuffle(fake_cats)
    alive = set(range(n)); left = []
    for night in range(NIGHTS):
        rc = cats[night]; real = (rc, prof[k][rc])
        if smart:   # killer frames the scapegoat with a category different from the real one when possible
            options = [c for c in fake_cats if c != rc] or fake_cats
            fc = options[night % len(options)]
        else:
            fc = fake_cats[night]
        fake = (fc, prof[sc][fc])
        alive = {p for p in alive if prof[p][real[0]] == real[1] or prof[p][fake[0]] == fake[1]}
        left.append(len(alive))
    return left


random.seed(1)
for n in (6, 7, 8, 9):
    for smart in (False, True):
        runs = [trial(n, smart) for _ in range(20000)]
        avg = [statistics.mean(r[i] for r in runs) for i in range(NIGHTS)]
        print(f'{n} players, framing={"deliberate" if smart else "random"}: avg suspects left after night 1..{NIGHTS} =', [round(a, 2) for a in avg])
