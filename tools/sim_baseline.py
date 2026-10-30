"""Hotel Murder v0.4 - structural simulation (NOT a prediction of real play).

What it can say
  1. How often a night actually kills someone when the locksmith's barrier is in play (kill rate).
  2. How much the barrier + the body narrow down WHICH FLOOR the murderer lives on (exact deduction, no guessing).
  3. How sensitive the win rate is to the two skill levers the rules create: q1 = chance per day that the table
     points at the real murderer in phase 1 (players), q2 = chance per day that the table names the murderer's
     room in phase 2 (rooms).  q1 and q2 are ASSUMPTIONS standing in for human skill, not measurements.

Rules simulated
  - Corpse rooms closed at the start (players // 2). The murderer cannot be told which rooms are occupied.
  - Night: the locksmith puts a barrier on a random floor (not the same floor two nights in a row).
    The murderer picks a random open room that does not cross the barrier (not his own room).
    He does not know the accomplice, so he may kill him.
  - Day phase 1: the table points at one player. If it is the murderer he is outed (phase 2 starts next day).
    A wrong guess does nothing (no one leaves, no room is revealed).
  - Day phase 2: the table names a room. Murderer's room -> innocents win. Occupied -> that player is evicted.
  - Killers win if the murderer is alive after the last day, or living innocents <= living killers.
"""
import random
import statistics

# players -> (floors, columns, has accomplice)
SETUP = {6: (4, 3, False), 7: (4, 3, False), 8: (5, 3, True), 9: (5, 3, True), 10: (5, 4, True), 11: (5, 4, True), 12: (5, 4, True)}


def allowed(floor_from, floor_to, barrier):
    if floor_from == barrier:
        return floor_to == barrier
    if floor_to == barrier:
        return False
    return (floor_from > barrier) == (floor_to > barrier)


def game(n, rng, q1, q2, days, track=None):
    floors, cols, acc = SETUP[n]
    rooms = [(f, c) for f in range(floors) for c in range(cols)]
    closed = set(rng.sample(rooms, n // 2))
    open_rooms = [r for r in rooms if r not in closed]
    mine = rng.sample(open_rooms, n)
    alive = {i: mine[i] for i in range(n)}              # 0 = murderer, 1 = accomplice (if any)
    killers = {0} | ({1} if acc else set())
    outed = False
    prev_barrier = None
    cand_floors = set(range(floors))
    for day in range(1, days + 1):
        barrier = rng.choice([f for f in range(floors) if f != prev_barrier])
        prev_barrier = barrier
        mf = alive[0][0]
        options = [r for r in open_rooms if r != alive[0] and allowed(mf, r[0], barrier)]
        killed = None
        if options:
            target = rng.choice(options)
            victim = next((p for p, r in alive.items() if r == target), None)
            if victim is not None:
                killed = target
                del alive[victim]
                open_rooms = [r for r in open_rooms if r != target]
        if track is not None:
            track['nights'] += 1
            track['kills'] += killed is not None
            if killed is not None:      # the table deduces the murderer's side of the barrier from the body
                b = killed[0]
                if b == barrier:
                    cand_floors &= {barrier}
                elif b > barrier:
                    cand_floors &= set(range(barrier + 1, floors))
                else:
                    cand_floors &= set(range(0, barrier))
            track['cand'][day].append(len(cand_floors))
        if sum(p not in killers for p in alive) <= sum(p in killers for p in alive):
            return 'killers'
        # day
        if not outed:
            if rng.random() < q1:
                outed = True
        else:
            if rng.random() < q2:
                return 'innocents'
            room = rng.choice(open_rooms)
            evicted = next((p for p, r in alive.items() if r == room), None)
            if evicted == 0:
                return 'innocents'
            if evicted is not None:
                del alive[evicted]
            open_rooms = [r for r in open_rooms if r != room]
            if sum(p not in killers for p in alive) <= sum(p in killers for p in alive):
                return 'killers'
    return 'killers'


if __name__ == '__main__':
    rng = random.Random(11)
    print('1) kill rate per night and how many floors the murderer can still be on (avg), no guessing involved')
    print('players | floors | kill rate | candidate floors after day 1 / 2 / 3 / 4 / 5')
    for n, (fl, co, acc) in SETUP.items():
        track = {'nights': 0, 'kills': 0, 'cand': {d: [] for d in range(1, 6)}}
        for _ in range(20000):
            game(n, rng, 0, 0, 5, track)
        cs = [statistics.mean(track['cand'][d]) for d in range(1, 6)]
        print(f'{n:7d} | {fl:6d} | {track["kills"] / track["nights"] * 100:8.1f}% | ' + ' / '.join(f'{c:.2f}' for c in cs))
    print()
    print('2) innocents win % for 4 / 5 days, as a function of skill levers q1 (phase 1) and q2 (phase 2) -- ASSUMPTIONS')
    for days in (4, 5):
        print(f'days = {days}')
        print('players | q1=.15,q2=.15 | q1=.25,q2=.25 | q1=.35,q2=.35 | q1=.25,q2=.50')
        for n in SETUP:
            row = []
            for q1, q2 in ((.15, .15), (.25, .25), (.35, .35), (.25, .50)):
                w = sum(game(n, rng, q1, q2, days) == 'innocents' for _ in range(20000)) / 200
                row.append(f'{w:13.1f}')
            print(f'{n:7d} | ' + ' | '.join(row))
