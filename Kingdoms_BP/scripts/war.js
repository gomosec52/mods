import { getSettlementAtPosition, getSettlementByPlayer, loadSettlements } from './storage.js';
import { isAlly } from './territory.js';
import { loadAlliances } from './storage.js';

function isMember(settlement, playerId, playerName = '') {
  return settlement?.members?.some((member) =>
    member.playerId === playerId || (!!playerName && member.playerName === playerName)
  ) ?? false;
}

export function canOutsiderHarmInTerritory(player, settlement) {
  if (!settlement) return true;
  if (isMember(settlement, player.id, player.name)) return true;

  const playerSettlement = getSettlementByPlayer(player.id, player.name);
  const alliances = loadAlliances();
  if (playerSettlement && isAlly(playerSettlement, settlement, alliances)) return true;

  const activeWar = (settlement.wars ?? []).some((war) =>
    war.active && playerSettlement && war.targetId === playerSettlement.id
  );
  if (activeWar) return true;

  return false;
}

export function getProtectionMessage(settlement) {
  return `§cТерритория «${settlement.name}» защищена. Объявите войну, чтобы нарушать порядок.`;
}

export function getTerritoryOwnerAt(dimensionId, x, z, playerId, playerName = '') {
  const settlement = getSettlementAtPosition(dimensionId, x, z);
  if (!settlement) return null;
  if (canOutsiderHarmInTerritory({ id: playerId, name: playerName }, settlement)) return null;
  return settlement;
}

export function isAtWar(attackerSettlement, defenderSettlement) {
  if (!attackerSettlement || !defenderSettlement) return false;
  return (attackerSettlement.wars ?? []).some((war) =>
    war.active && war.targetId === defenderSettlement.id
  );
}

export function declareWar(sourceSettlement, targetSettlement) {
  if (!sourceSettlement || !targetSettlement || sourceSettlement.id === targetSettlement.id) return false;
  if (isAlly(sourceSettlement, targetSettlement, loadAlliances())) return false;

  sourceSettlement.wars = sourceSettlement.wars ?? [];
  if (!sourceSettlement.wars.some((war) => war.targetId === targetSettlement.id && war.active)) {
    sourceSettlement.wars.push({
      targetId: targetSettlement.id,
      targetName: targetSettlement.name,
      active: true,
      declaredAt: Date.now()
    });
    sourceSettlement.morale = Math.max(0, (sourceSettlement.morale ?? 80) - 6);
  }

  targetSettlement.wars = targetSettlement.wars ?? [];
  if (!targetSettlement.wars.some((war) => war.targetId === sourceSettlement.id && war.active)) {
    targetSettlement.wars.push({
      targetId: sourceSettlement.id,
      targetName: sourceSettlement.name,
      active: true,
      declaredAt: Date.now()
    });
    targetSettlement.morale = Math.max(0, (targetSettlement.morale ?? 80) - 6);
  }

  return true;
}

export function endWar(winnerSettlementId, loserSettlementId) {
  const all = loadSettlements();
  for (const settlement of all) {
    settlement.wars = (settlement.wars ?? []).filter((war) =>
      !(war.active && (war.targetId === loserSettlementId || war.targetId === winnerSettlementId))
    );
  }
  return all;
}