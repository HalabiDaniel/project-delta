# BuildSlot

One spot on your desk for a defence (Turret, Rocket Launcher, Radar) or building (Workshop, Storage, Command Center, Runway, Helipad, Hangar, Ink Depot).

A thick-outlined paper card with a big picture of the building on top and its details below, so no text ever sits on cardboard or yellow. The picture is the building's PNG render at its current level (`assets/Buildings/<id>-level<n>.png`), shown with `object-fit: contain` in the `pw-slot__art` well, with a level badge in the corner. Below it: the name, three level marks (every building goes from level 1 to 3) and one status line with a Lucide icon: `arrow-up-circle` plus the next upgrade's cost, `check-circle` for "Max level", or `wrench` plus the repair cost. `pw-slot--damaged` turns the outline and shadow raid red after a raid. `pw-slot--empty` is a dashed outline with a `plus`, inviting the player to build. The consumer provides the building data, the picture and what happens on select.
