import { Base, type BaseSave } from '../base/Base';
import type { BuildingKind, Side } from '../config';
import { DefenseNetwork } from '../defenses/Installation';
import type { Command } from '../net/protocol';
import { ResourceManager } from '../systems/ResourceManager';
import type { Territory } from '../world/Territory';

/**
 * The player's base as their own game sees it in multiplayer: the very same Base class, loaded
 * from what the server says the base is, so base management (BaseMode, the inspector, costs,
 * checks, previews) works exactly as in single-player. What it can't do is change anything: build,
 * upgrade, repair and remove are checked here (for the immediate "Need paper" answer) and then
 * asked of the server, whose answer comes back as the next state.
 */
export class NetBase extends Base {
  constructor(
    home: Territory,
    side: Side,
    private readonly send: (cmd: Command) => void,
    resources: ResourceManager = new ResourceManager(),
  ) {
    // A private network: these installations only answer questions; the scene draws the server's.
    super(home, new DefenseNetwork([]), resources, side);
  }

  /** The server's view of the base: buildings, levels, health, statistics. */
  sync(save: BaseSave, paper: number): void {
    this.resources.restore(paper);
    this.load(save);
  }

  override build(slot: string, kind: BuildingKind): boolean {
    const check = this.canBuild(slot, kind);
    if (!check.ok) return super.build(slot, kind);
    this.send({ a: 'base-build', slot, kind });
    return true;
  }

  override upgrade(slot: string): boolean {
    const check = this.canUpgrade(slot);
    if (!check.ok) return super.upgrade(slot);
    this.send({ a: 'base-upgrade', slot });
    return true;
  }

  override repair(key: string): boolean {
    const check = this.canRepair(key);
    if (!check.ok) return super.repair(key);
    this.send({ a: 'base-repair', key });
    return true;
  }

  override repairAll(): boolean {
    if (this.needsRepair.length === 0 || this.resources.paper < this.repairAllCost) return super.repairAll();
    this.send({ a: 'base-repair-all' });
    return true;
  }

  override remove(slot: string): boolean {
    if (!this.at(slot)) return super.remove(slot);
    this.send({ a: 'base-remove', slot });
    return true;
  }
}
