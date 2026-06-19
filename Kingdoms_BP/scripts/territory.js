import { getTier } from './config.js';
import { loadSettlements } from './storage.js';

export function distance2d(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function isAlly(settlementA, settlementB, alliances) {
  if (!settlementA || !settlementB) return false;
  return alliances.some((alliance) =>
    alliance.members.includes(settlementA.id) && alliance.members.includes(settlementB.id)
  );
}

export function territoriesOverlap(settlement, nextRadius, allSettlements, alliances) {
  const conflicts = [];
  for (const other of allSettlements) {
    if (other.id === settlement.id) continue;
    if (isAlly(settlement, other, alliances)) continue;
    const dist = distance2d(settlement.flagX, settlement.flagZ, other.flagX, other.flagZ);
    if (dist < nextRadius + other.radius) {
      conflicts.push(other);
    }
  }
  return conflicts;
}

export function countVillagersNear(settlement, dimension) {
  const entities = dimension.getEntities({
    location: { x: settlement.flagX, y: settlement.flagY, z: settlement.flagZ },
    maxDistance: settlement.radius,
    families: ['villager']
  });
  return entities.length;
}

export function refreshSettlementStats(settlement, dimension) {
  const tier = getTier(settlement.tierId);
  settlement.radius = tier.radius;
  settlement.flagMaxHp = tier.flagHp;
  settlement.villagersNearby = countVillagersNear(settlement, dimension);
  return settlement;
}
