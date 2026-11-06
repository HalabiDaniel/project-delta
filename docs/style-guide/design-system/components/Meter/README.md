# Meter

A segmented bar for plane health, folding progress and upgrade timers.

Default segments fill in `win-500` (health). Add `pw-meter--low` below 30% so it turns `raid-500`, and `pw-meter--progress` for timers, which fill in pencil yellow. Always show the value as text on the right, so the bar never relies on colour alone, and set `role="meter"` with its values. Use 10 segments for health and as many as fit for timers.
