# v0.0.18 checkpoint: the economy, measured

The long-run simulator's 7-day run (seed 1), as `npm run sim -- --days 7 --seed 1` prints it. The
full report is in [sim-7d-seed1.json](sim-7d-seed1.json) and one row per player per day in
[sim-7d-seed1.csv](sim-7d-seed1.csv). Players: two steady (an hour a day), one aggressive (raids
whenever the rules allow), a newcomer (30 minutes), an idle player (8 minutes) and two exploiters
(they abandon every mission and trade raids between their two accounts).

```
paperwars long-run simulation: 7 players, 7 days, seed 1 (2.5 s)
Paper 3.5/min, ink 1.5/min, rubber balls 0.6/min with no buildings; production only while online.

player          sorties  wins  raids±   paper    ink  rubber   worth  merit  rank  gain/h merit/h  recovery(s)
steady-1            262   188   28/19    2100    950     106    2787   2087    22   376.1   298.1  307 (some never)
steady-2            257   176   21/23    2025    915     102    2687   1846    21   361.9   263.7  400 (some never)
aggressive-3        122    97    97/5    2100    950     108    2791   1951    22   376.7   278.7  323
newcomer-4          169   101    0/11    1879    781      35    2340    729    14   624.6   208.3  88 (some never)
idle-5               44    23     0/2     300     46       9     341    163     6   200.4   174.6  652
exploiter-6         659     0   37/58      25      2      27      80    163     6   -10.6    23.3  101
exploiter-7         665     0   37/62      25      8      28      85    163     6    -9.9    23.3  99

Designs flown (share of sorties, win rate):
  swift       39.4%    0%
  falcon      27.1%   41%
  dart        21.7%   36%
  widewing     7.9%   67%
  thug         3.4%   62%
  jumper       0.5%  100%

Leader ÷ median: 1
Flags: runaway leader no · dead end no · exploit beats play no
```

## What it says

- **No runaway leader.** Everyone who plays an hour a day ends at the storage caps (2,100 paper with
  a level-2 and a level-1 box, 950 ink, about 110 rubber balls), so the aggressive raider ends level
  with the steady players. The caps do their anti-snowball job, perhaps too well: a week in, more
  play buys nothing but upgrades. **For the developer:** raise the storage capacities, or let
  surplus go into something (v0.0.19's bounties and escorts are the plan's sinks).
- **No dead end.** Nobody went five sorties without a card they could fly. The free basic load and
  the paper-only Swift keep even an empty-storeed player flying.
- **Exploiting doesn't pay.** Abandoning missions and trading raids between two accounts loses
  about 10 worth an hour, against roughly +370 an hour for steady play. The raid repeat rule (`PVP.repeat`),
  the pair cooldown and the shield see to it.
- **Raids are recovered from** in a few minutes of play (median 90 to 650 s online). A few are never
  fully won back before the run ends, usually because the store was already at its cap.
- **Short sessions:** the idle player (8 minutes a day) grows slowly over a week. Over 3 days (seed
  7) they drift down a little in ink and rubber balls, because arming costs more than 8 minutes of
  production brings in. That is never a dead end, but it is worth a look if very short sessions
  should feel rewarding.
- **Merit and ranks:** about 270 to 300 Merit an hour for steady play puts a player on step 21 or 22
  of 48 after seven hours. The newcomer reaches step 14, the idle player step 6. **For the
  developer:** check that pace against the curve you want (`MERIT.curve`).
- **Designs flown:** the simulated chooser takes the cheapest suitable plane, so the Swift, Falcon
  and Dart dominate and the dear designs (Raptor, Lightning, Lancer, Ghost) are never picked. The
  Swift's 0% win rate is the exploiters'. This says little about the roster; the playtest has to.

## Re-running it

```bash
npm run sim -- --days 7 --seed 1
```

```bash
npm run sim -- --players steady,aggressive,aggressive,newcomer --days 14 --json report.json --csv report.csv
```

`--strict` exits with code 1 if a flag is raised (for CI).
