import { world } from '@minecraft/server';
import { ALLIANCE_KEY, WORLD_DATA_KEY } from './config.js';

function readJson(key, fallback) {
  const raw = world.getDynamicProperty(key);
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  world.setDynamicProperty(key, JSON.stringify(value));
}

export function loadSettlements() {
  return readJson(WORLD_DATA_KEY, []);
}

export function saveSettlements(settlements) {
  writeJson(WORLD_DATA_KEY, settlements);
}

export function loadAlliances() {
  return readJson(ALLIANCE_KEY, []);
}

export function saveAlliances(alliances) {
  writeJson(ALLIANCE_KEY, alliances);
}

export function getSettlementById(id) {
  return loadSettlements().find((settlement) => settlement.id === id) ?? null;
}

export function getSettlementByPlayer(playerId, playerName = '') {
  const settlements = loadSettlements();
  const byId = settlements.find((settlement) =>
    settlement.ownerId === playerId ||
    settlement.members.some((member) => member.playerId === playerId)
  );
  if (byId) return byId;

  if (!playerName) return null;
  return settlements.find((settlement) =>
    settlement.ownerName === playerName ||
    settlement.members.some((member) => member.playerName === playerName)
  ) ?? null;
}

export function getSettlementAtPosition(dimensionId, x, z) {
  return loadSettlements().find((settlement) => {
    if (settlement.dimensionId !== dimensionId) return false;
    const dx = x - settlement.flagX;
    const dz = z - settlement.flagZ;
    const tier = settlement.tierId;
    const radius = settlement.radius;
    return Math.sqrt(dx * dx + dz * dz) <= radius;
  }) ?? null;
}

export function upsertSettlement(settlement) {
  const all = loadSettlements().filter((item) => item.id !== settlement.id);
  all.push(settlement);
  saveSettlements(all);
  return settlement;
}

export function removeSettlement(id) {
  saveSettlements(loadSettlements().filter((settlement) => settlement.id !== id));
}

export function removeSettlementRelations(id) {
  const settlements = loadSettlements().map((settlement) => ({
    ...settlement,
    wars: (settlement.wars ?? []).filter((war) => war.targetId !== id)
  }));
  saveSettlements(settlements);

  const alliances = loadAlliances().filter((alliance) => {
    if (alliance.fromId === id || alliance.toId === id) return false;
    if (alliance.members?.includes(id)) return false;
    return true;
  });
  saveAlliances(alliances);
}
