# v0.0.19 checkpoint: advanced multiplayer, measured

## The long-run simulator with the anti-farming rules

`npm run sim -- --days 7 --seed 1`: the v0.0.18 players plus a **farmer** pair (two accounts that do
nothing but shoot each other's Swifts down for the kill reward, in turns). Full report in
[sim-7d-seed1.json](sim-7d-seed1.json), one row per player per day in [sim-7d-seed1.csv](sim-7d-seed1.csv).

```
paperwars long-run simulation: 9 players, 7 days, seed 1 (1.3 s)
Paper 3.5/min, ink 1.5/min, rubber balls 0.6/min with no buildings; production only while online.

player          sorties  wins  raids±   paper    ink  rubber   worth  merit  rank  gain/h merit/h  recovery(s)
steady-1            254   173   30/12    2100    927     103    2770   1804    21   373.7   257.7  203
steady-2            267   188   19/16    2100    950     101    2777   1881    22   374.7   268.7  391 (some never)
aggressive-3        123    91   101/3    2029    919     102    2693   1870    22   362.7   267.1  405 (some never)
newcomer-4          169   101     0/4    1957    937      57    2540    729    14   681.7   208.3  49 (some never)
idle-5               51    28     0/1     224     56      18     288    192     6   143.6   205.7  71
exploiter-6         760     0   16/32      38      1      26      91    205     7      -9    29.3  48
exploiter-7         758     0   16/35      46      6      26     101    205     7    -7.6    29.3  63 (some never)
farmer-8            218     0    0/12      38    150      30     173      0     0     2.7       0  467
farmer-9            222     0    0/13      52    150      30     187      0     0     4.7       0  467

Designs flown (share of sorties, win rate):
  swift       50.8%    0%
  falcon      21.6%   48%
  dart        16.9%   42%
  widewing     7.1%   68%
  thug         3.0%   50%
  jumper       0.5%   77%

Leader ÷ median: 1
Flags: runaway leader no · dead end no · exploit beats play no
Anti-farming: 24 pair flag(s), 1249 paper held back
  - farmer-8 / farmer-9: kills (day 1)
  - exploiter-7 / exploiter-6: undefended (day 1)
  - farmer-9 / farmer-8: kills (day 1)
  - exploiter-7 / exploiter-6: undefended (day 1)
  - farmer-9 / farmer-8: kills (day 1)
  - exploiter-6 / exploiter-7: undefended (day 1)
  - farmer-9 / farmer-8: kills (day 1)
  - farmer-9 / farmer-8: kills (day 1)
  - exploiter-6 / exploiter-7: undefended (day 1)
  - farmer-9 / farmer-8: kills (day 1)
```

- **Farming loses.** Both farmers gain under 5 paper an hour against about 375 for steady play: each
  kill costs the victim a Swift, PVP.killRepeat already shrinks repeats, and the anti-farming decay
  and pauses held back 1,249 paper over the week. The pair is flagged on the first day and again
  each time a pause runs out; raid-trading exploiters are flagged for raids nobody defends.
- No runaway leader, no dead end, no exploit that beats play (the v0.0.18 findings about the
  storage caps still stand).

## Load test

`npm run loadtest` (server and bots in one process, memory store, 30 s per run; the last row is the
v0.0.19 run: every bot buys two escorts, two raid, two take cooperation cards, protections cut to 5 s):

| Players | Sessions | Network | Server step avg / max (ms) | Down per player (KB/s) | Up per player (KB/s) | Corrections / reconciles | Mean correction (m) | Server auto-steps | Frames dropped | Hits | Kills | Heap (MB) | Drop + resume | Escorts (peak) | v0.0.19 systems |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 1 | local | 0.227 / 5.5 | 5.3 | 1.2 | 0/588 | 0.000 | 0 | 0 | 0 | 0 | 58 | kept seat | 0 | — |
| 8 | 1 | local | 0.400 / 1.4 | 10.3 | 1.2 | 0/3594 | 0.000 | 0 | 0 | 57 | 0 | 80 | kept seat | 0 | — |
| 16 | 1 | local | 0.526 / 3.7 | 15.1 | 1.2 | 2/9482 | 0.007 | 0 | 0 | 102 | 1 | 73 | kept seat | 0 | — |
| 8 | 1 | 120±40 ms, stall every 5 s | 0.453 / 1.8 | 11.0 | 1.2 | 4/3609 | 0.054 | 0 | 0 | 64 | 3 | 71 | kept seat | 0 | — |
| 16 | 2 | local | 0.398 / 4.0 | 10.3 | 1.2 | 5/6467 | 0.060 | 0 | 0 | 114 | 4 | 77 | kept seat | 0 | — |
| 8 | 1 | local | 0.679 / 10.7 | 17.1 | 1.2 | 0/3584 | 0.000 | 0 | 0 | 59 | 0 | 62 | kept seat | 11 | 0 raids (none), 0 bounties, coop cards flown no |

Longer v0.0.19 runs (`npm run loadtest -- --players 8 --advanced 1 --seconds N`):

| Seconds | Step avg / max (ms) | Down per player (KB/s) | Escorts (peak) | Seen |
|---|---|---|---|---|
| 60 | 0.483 / 3.8 | 12.4 | 12 | 2 bombing raids, 5 kills |
| 150 | 0.406 / 3.3 | 10.8 | 12 | 2 bombing raids |

The eight-seat session with twelve escorts in the air stays well inside the 16.7 ms step and the
bandwidth budget. The bots fly raids rarely and badly, so bounties, staged raids and cooperation were
verified by the server tests (`server/world/*.test.ts`), not by the load run. The two-player playtest
is the developer's.
