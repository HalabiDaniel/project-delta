# PlaneCard

A build card for one of the eleven planes: its render, role, texture, name, three stats and the cost.

The art well shows the plane's render from the Aircraft group (`assets/Aircraft/<id>-<texture>.png`). Under it: the role chip with a Lucide icon (`eye` scout, `crosshair` fighter, `bomb` bomber) and three texture swatches (paper, cardboard, grey; `aria-pressed` on the chosen one), then the name in `title` with what it's inspired by, and Speed, Armour and Payload as five pips each (`pw-pip`, `pw-pip--on`). Always show what a crash costs in `pw-plane__risk`. Set `aria-selected="true"` on the picked plane: its outline and shadow turn `sky-500`. The consumer provides the numbers, the chosen texture and the Fold button's handler.
