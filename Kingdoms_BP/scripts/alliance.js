import { loadAlliances, saveAlliances } from './storage.js';

export function areSettlementsAllied(settlementAId, settlementBId) {
  return loadAlliances().some((alliance) =>
    alliance.status === 'active' &&
    alliance.members?.includes(settlementAId) &&
    alliance.members?.includes(settlementBId)
  );
}

export function hasPendingAlliance(fromSettlementId, toSettlementId) {
  return loadAlliances().some((alliance) =>
    alliance.status === 'pending' &&
    (
      (alliance.fromId === fromSettlementId && alliance.toId === toSettlementId) ||
      (alliance.fromId === toSettlementId && alliance.toId === fromSettlementId)
    )
  );
}

export function createAllianceProposal(fromSettlementId, toSettlementId, allianceName) {
  return {
    id: `ally_${Date.now()}`,
    fromId: fromSettlementId,
    toId: toSettlementId,
    status: 'pending',
    name: allianceName,
    createdAt: Date.now()
  };
}

export function getPendingAllianceForSettlement(settlementId) {
  return loadAlliances().find((alliance) =>
    alliance.status === 'pending' && alliance.toId === settlementId
  ) ?? null;
}

export function acceptAlliance(proposal, allianceName) {
  const all = loadAlliances().filter((item) => item.id !== proposal.id);
  all.push({
    id: proposal.id,
    name: allianceName || proposal.name,
    members: [proposal.fromId, proposal.toId],
    status: 'active',
    createdAt: Date.now()
  });
  saveAlliances(all);
}

export function rejectAlliance(proposalId) {
  saveAlliances(loadAlliances().filter((item) => item.id !== proposalId));
}
