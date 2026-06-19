import { system, world } from '@minecraft/server';
import { getTier } from './config.js';
import { getSettlementByPlayer, loadSettlements, saveSettlements } from './storage.js';

let chatPrefixBound = false;
let chatPrefixMode = 'none';
let directChatPrefixAvailable = false;

export function getLeaderPrefix(settlement) {
  return getTier(settlement.tierId).leaderPrefix;
}

export function getMemberPrefix(member) {
  return member.prefix ?? 'Крестьянин';
}

export function syncPlayerIdentity(player) {
  const settlements = loadSettlements();
  let changed = false;

  for (const settlement of settlements) {
    if (settlement.ownerName === player.name && settlement.ownerId !== player.id) {
      settlement.ownerId = player.id;
      changed = true;
    }

    for (const member of settlement.members) {
      if (member.playerName === player.name && member.playerId !== player.id) {
        member.playerId = player.id;
        changed = true;
      }
    }
  }

  if (changed) saveSettlements(settlements);
}

export function getMemberInSettlement(settlement, player) {
  return settlement.members.find(
    (member) => member.playerId === player.id || member.playerName === player.name
  ) ?? null;
}

export function getPlayerSettlementContext(player) {
  syncPlayerIdentity(player);
  const settlement = getSettlementByPlayer(player.id, player.name);
  if (!settlement) return { settlement: null, member: null };
  const member = getMemberInSettlement(settlement, player);
  return { settlement, member };
}

function getPlayerSettlementContextReadonly(player) {
  const settlement = getSettlementByPlayer(player.id, player.name);
  if (!settlement) return { settlement: null, member: null };
  const member = getMemberInSettlement(settlement, player);
  return { settlement, member };
}

export function isSettlementOwner(settlement, player, member) {
  return (
    settlement.ownerId === player.id ||
    settlement.ownerId === member?.playerId ||
    settlement.ownerName === player.name ||
    settlement.ownerName === member?.playerName
  );
}

export function getPrefixFor(player, settlement, member) {
  return isSettlementOwner(settlement, player, member)
    ? getLeaderPrefix(settlement)
    : getMemberPrefix(member);
}

export function formatPlayerTag(playerName, settlement, member, player) {
  if (!settlement || !member) return playerName;
  const prefix = getPrefixFor(player ?? { id: member.playerId, name: playerName }, settlement, member);
  return `§7[§6${prefix}§7] §f${playerName}`;
}

export function formatChatMessage(player, message, settlement, member) {
  return `${formatPlayerTag(player.name, settlement, member, player)}§7: §f${message}`;
}

export function applyNameTag(player, settlement, member) {
  if (!player?.isValid) return;
  if (!settlement || !member) {
    clearChatPrefix(player);
    return;
  }

  const prefix = getPrefixFor(player, settlement, member);
  player.nameTag = `§7[§6${prefix}§7] §f${player.name}`;
  try {
    player.chatNamePrefix = `§7[§6${prefix}§7] §f`;
    player.chatNameSuffix = '';
    player.chatMessagePrefix = '';
    directChatPrefixAvailable = true;
    chatPrefixMode = 'chatNamePrefix';
  } catch {
    // Если прямой API недоступен, bindChatPrefix попробует chatSend.
  }
}

export function clearChatPrefix(player) {
  if (!player?.isValid) return;
  player.nameTag = player.name;
  try {
    player.chatNamePrefix = '';
    player.chatNameSuffix = '';
    player.chatMessagePrefix = '';
  } catch {
    // direct chat prefix API unavailable
  }
}

export function refreshAllNameTags(settlement, worldRef) {
  for (const member of settlement.members) {
    const player = [...worldRef.getPlayers()].find(
      (p) => p.id === member.playerId || p.name === member.playerName
    );
    if (player) applyNameTag(player, settlement, member);
  }
}

export function refreshAllOnlineNameTags(worldRef) {
  for (const player of worldRef.getPlayers()) {
    const { settlement, member } = getPlayerSettlementContext(player);
    if (settlement && member) applyNameTag(player, settlement, member);
    else clearChatPrefix(player);
  }
}

function sendFormattedChat(text) {
  for (const player of world.getPlayers()) {
    player.sendMessage(text);
  }
}

export function bindChatPrefix() {
  if (directChatPrefixAvailable) return true;
  if (chatPrefixBound) return true;

  try {
    if (world.beforeEvents?.chatSend?.subscribe) {
      world.beforeEvents.chatSend.subscribe((event) => {
        const { settlement, member } = getPlayerSettlementContextReadonly(event.sender);
        if (!settlement || !member) return;

        const formatted = formatChatMessage(event.sender, event.message, settlement, member);
        event.cancel = true;
        system.run(() => sendFormattedChat(formatted));
      });

      chatPrefixBound = true;
      chatPrefixMode = 'before';
      return true;
    }
  } catch (error) {
    console.warn('[Kingdoms] chat prefix bind failed:', error);
  }

  chatPrefixMode = 'none';
  return false;
}

export function getChatPrefixMode() {
  if (directChatPrefixAvailable) return 'chatNamePrefix';
  return chatPrefixMode;
}
