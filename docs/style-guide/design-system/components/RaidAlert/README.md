# RaidAlert

A banner for radar warnings and mission results, shown top-centre of the HUD.

Default is a raid (`raid-500`); `pw-alert--info` is a radar ping and `pw-alert--win` a result. Every alert has an icon in the badge, a `display` title and one line of detail naming where and what ("3 bombers from Desk 4 heading for your Workshop"). Add `pw-alert__eta` for a countdown. Use `role="alert"` for raids only, so screen readers aren't spammed by pings.
