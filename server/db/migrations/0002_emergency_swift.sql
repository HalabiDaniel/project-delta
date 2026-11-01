-- v0.0.11: the Swift replaced the Dart as the starter and the free emergency plane.
--
-- Persisted aircraft keep their type: a Dart a player folded stays a Dart (it is the fast recon
-- plane now). Only emergency planes, folded free from scrap (loadout.emergency = true), move to the
-- Swift. Destroyed aircraft are history and are left as they were.
update aircraft
   set type = 'swift', updated_at = now()
 where type = 'dart'
   and status <> 'destroyed'
   and coalesce((loadout ->> 'emergency')::boolean, false);
