import { loadAlliances, saveAlliances } from './storage.js';

export function createAllianceProposal(fromSettlementId, toSettlementId) {
  return {
    id: `ally_${Date.now()}`,
    fromId: fromSettlementId,
    toId: toSettlementId,
    status: 'pending',
    name: null,
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
    name: allianceName,
    members: [proposal.fromId, proposal.toId],
    status: 'active',
    createdAt: Date.now()
  });
  saveAlliances(all);
}

export function rejectAlliance(proposalId) {
  saveAlliances(loadAlliances().filter((item) => item.id !== proposalId));
}
