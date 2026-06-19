import { system } from '@minecraft/server';
import { FLAG_ENTITY_TYPE } from './config.js';
import { openCreateSettlementMenu, openFlagMenu } from './ui.js';

const UNCLAIMED_LABEL = '§eНовый флаг §7| ПКМ — меню';
const MENU_COOLDOWN_TICKS = 15;
const menuCooldown = new Map();
const menuOpen = new Set();

export function findFlagPlayerLooksAt(player, maxDistance = 8) {
  try {
    const hits = player.getEntitiesFromViewDirection({ maxDistance, type: FLAG_ENTITY_TYPE });
    if (hits?.length > 0 && hits[0].entity?.isValid) {
      return hits[0].entity;
    }
  } catch {
    // Fallback below when view API is unavailable.
  }

  const nearby = player.dimension.getEntities({
    type: FLAG_ENTITY_TYPE,
    location: player.location,
    maxDistance
  });

  if (!nearby.length) return null;

  const view = player.getViewDirection();
  let best = null;
  let bestScore = -1;

  for (const entity of nearby) {
    if (!entity.isValid) continue;
    const dx = entity.location.x - player.location.x;
    const dy = entity.location.y - player.location.y;
    const dz = entity.location.z - player.location.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const score = (dx * view.x + dy * view.y + dz * view.z) / dist;
    if (score > bestScore) {
      bestScore = score;
      best = entity;
    }
  }

  return bestScore > 0.25 ? best : nearby[0];
}

export function findNearestFlagToPlayer(player, maxDistance = 8) {
  const flags = player.dimension.getEntities({
    type: FLAG_ENTITY_TYPE,
    location: player.location,
    maxDistance
  });
  if (!flags.length) return null;

  let best = null;
  let bestDist = Number.MAX_VALUE;
  for (const flag of flags) {
    if (!flag.isValid) continue;
    const dx = flag.location.x - player.location.x;
    const dy = flag.location.y - player.location.y;
    const dz = flag.location.z - player.location.z;
    const dist = dx * dx + dy * dy + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      best = flag;
    }
  }
  return best;
}

export function refreshUnclaimedFlagLabels(dimension) {
  const flags = dimension.getEntities({ type: FLAG_ENTITY_TYPE });
  for (const entity of flags) {
    if (!entity.isValid) continue;
    if (entity.getDynamicProperty('kingdoms:settlementId')) continue;
    entity.nameTag = UNCLAIMED_LABEL;
    entity.addTag('kingdoms:unclaimed');
  }
}

export async function openFlagMenuForEntity(player, entity) {
  if (!player?.isValid || !entity?.isValid) return;
  if (menuOpen.has(player.id)) return;

  menuOpen.add(player.id);
  try {
    const settlementId = entity.getDynamicProperty('kingdoms:settlementId');
    if (!settlementId) {
      const flagPos = {
        x: Math.floor(entity.location.x),
        y: Math.floor(entity.location.y),
        z: Math.floor(entity.location.z)
      };
      await openCreateSettlementMenu(player, flagPos);
      return;
    }

    await openFlagMenu(player, settlementId);
  } finally {
    menuOpen.delete(player.id);
  }
}

export function queueFlagMenu(player, entity) {
  if (!player?.isValid) return;

  const now = system.currentTick;
  const lastOpen = menuCooldown.get(player.id) ?? 0;
  if (now - lastOpen < MENU_COOLDOWN_TICKS) return;
  if (menuOpen.has(player.id)) return;

  menuCooldown.set(player.id, now);

  system.run(() => {
    const target = entity?.isValid ? entity : findFlagPlayerLooksAt(player);
    if (!target) {
      player.sendMessage('§cПодойдите ближе к флагу и смотрите на него.');
      return;
    }

    openFlagMenuForEntity(player, target).catch((error) => {
      const message = error?.message ?? String(error);
      player.sendMessage(`§cНе удалось открыть меню: ${message}`);
      console.warn(`[Kingdoms] UI error for ${player.name}:`, error);
    });
  });
}

export function tryOpenFlagMenu(player) {
  const flag = findFlagPlayerLooksAt(player) ?? findNearestFlagToPlayer(player);
  if (!flag) {
    return false;
  }
  queueFlagMenu(player, flag);
  return true;
}
