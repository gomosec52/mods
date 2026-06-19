import { world, ItemStack } from '@minecraft/server';
import { FLAG_ENTITY_TYPE, FLAG_ITEM_ID, getNextTier, getTier } from './config.js';
import { boostMoraleOnUpgrade, calcTaxRate } from './morale.js';
import { formatSettlementFlagLabel } from './flagLabels.js';
import { applyNameTag, clearChatPrefix, refreshAllNameTags, syncPlayerIdentity } from './prefixes.js';
import {
  getSettlementById,
  getSettlementByPlayer,
  loadAlliances,
  loadSettlements,
  removeSettlementRelations,
  removeSettlement,
  saveSettlements,
  upsertSettlement
} from './storage.js';
import { refreshSettlementStats, territoriesOverlap } from './territory.js';
import { endWar, isAtWar } from './war.js';

function randomId() {
  return `st_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function countEmeralds(player) {
  let total = 0;
  const inv = player.getComponent('minecraft:inventory')?.container;
  if (!inv) return 0;
  for (let i = 0; i < inv.size; i++) {
    const item = inv.getItem(i);
    if (item?.typeId === 'minecraft:emerald') total += item.amount;
  }
  return total;
}

function removeEmeralds(player, amount) {
  let left = amount;
  const inv = player.getComponent('minecraft:inventory')?.container;
  if (!inv) return false;
  for (let i = 0; i < inv.size; i++) {
    const item = inv.getItem(i);
    if (!item || item.typeId !== 'minecraft:emerald') continue;
    const take = Math.min(item.amount, left);
    left -= take;
    if (item.amount - take <= 0) inv.setItem(i, undefined);
    else {
      item.amount -= take;
      inv.setItem(i, item);
    }
    if (left <= 0) return true;
  }
  return left <= 0;
}

function giveEmeralds(player, amount) {
  const inv = player.getComponent('minecraft:inventory')?.container;
  if (!inv) return 0;

  let left = amount;
  while (left > 0) {
    const stack = Math.min(64, left);
    const overflow = inv.addItem(new ItemStack('minecraft:emerald', stack));
    if (overflow) {
      left -= stack - overflow.amount;
      break;
    }
    left -= stack;
  }

  return amount - left;
}

export function spawnFlagEntity(dimension, x, y, z, settlement) {
  const tier = getTier(settlement.tierId);
  const entity = dimension.spawnEntity(FLAG_ENTITY_TYPE, { x: x + 0.5, y, z: z + 0.5 });
  entity.addTag(`kingdom:id:${settlement.id}`);
  entity.nameTag = formatSettlementFlagLabel(settlement);
  entity.setDynamicProperty('kingdoms:settlementId', settlement.id);
  entity.setDynamicProperty('kingdoms:hp', tier.flagHp);
  entity.setDynamicProperty('kingdoms:maxHp', tier.flagHp);
  entity.removeTag('kingdoms:unclaimed');
  return entity;
}

export function syncFlagEntity(settlement, dimension) {
  const entities = dimension.getEntities({ type: FLAG_ENTITY_TYPE });
  const flag = entities.find((entity) => entity.getDynamicProperty('kingdoms:settlementId') === settlement.id);
  if (!flag) return;
  const tier = getTier(settlement.tierId);
  flag.nameTag = formatSettlementFlagLabel(settlement);
  flag.setDynamicProperty('kingdoms:hp', settlement.flagHp ?? tier.flagHp);
  flag.setDynamicProperty('kingdoms:maxHp', tier.flagHp);
}

export function createSettlement(player, name, flagPos) {
  const existing = getSettlementByPlayer(player.id, player.name);
  if (existing) {
    player.sendMessage('§cУ вас уже есть поселение.');
    return null;
  }

  const tier = getTier('village');
  const settlement = {
    id: randomId(),
    name,
    tierId: 'village',
    ownerId: player.id,
    ownerName: player.name,
    dimensionId: player.dimension.id,
    flagX: flagPos.x,
    flagY: flagPos.y,
    flagZ: flagPos.z,
    radius: tier.radius,
    flagHp: tier.flagHp,
    flagMaxHp: tier.flagHp,
    morale: 80,
    taxRate: 4,
    members: [{ playerId: player.id, playerName: player.name, prefix: tier.leaderPrefix }],
    wars: [],
    villagersNearby: 0
  };

  if (loadSettlements().some((item) => item.name.toLowerCase() === name.toLowerCase())) {
    player.sendMessage('§cПоселение с таким названием уже существует.');
    return null;
  }

  const conflicts = territoriesOverlap(
    settlement,
    tier.radius,
    loadSettlements(),
    loadAlliances()
  );
  if (conflicts.length > 0) {
    const names = conflicts.map((item) => `${getTier(item.tierId).title} «${item.name}»`).join(', ');
    player.sendMessage(`§cНельзя основать деревню: рядом территория ${names}.`);
    return null;
  }

  if (countEmeralds(player) < tier.createCost) {
    player.sendMessage(`§cНужно ${tier.createCost} изумрудов для основания деревни.`);
    return null;
  }

  if (!removeEmeralds(player, tier.createCost)) {
    player.sendMessage('§cНе удалось списать изумруды.');
    return null;
  }

  refreshSettlementStats(settlement, player.dimension);
  settlement.taxRate = calcTaxRate(settlement);
  upsertSettlement(settlement);

  const entities = player.dimension.getEntities({
    type: FLAG_ENTITY_TYPE,
    location: { x: flagPos.x, y: flagPos.y, z: flagPos.z },
    maxDistance: 2
  });
  const flag = entities.find((entity) => !entity.getDynamicProperty('kingdoms:settlementId')) ??
    spawnFlagEntity(player.dimension, flagPos.x, flagPos.y, flagPos.z, settlement);
  flag.setDynamicProperty('kingdoms:settlementId', settlement.id);
  flag.setDynamicProperty('kingdoms:hp', tier.flagHp);
  flag.setDynamicProperty('kingdoms:maxHp', tier.flagHp);
  flag.removeTag('kingdoms:unclaimed');
  flag.nameTag = formatSettlementFlagLabel(settlement);

  applyNameTag(player, settlement, settlement.members[0]);
  syncPlayerIdentity(player);
  applyNameTag(player, settlement, settlement.members[0]);
  player.sendMessage(`§aВаш префикс: §6[${tier.leaderPrefix}]`);
  world.sendMessage(`§e${player.name} основал деревню §6${name}§e!`);
  return settlement;
}

export function upgradeSettlement(player, settlement, newName) {
  const next = getNextTier(settlement.tierId);
  if (!next) {
    player.sendMessage('§cЭто максимальный уровень поселения.');
    return;
  }

  if (settlement.ownerId !== player.id && settlement.ownerName !== player.name) {
    player.sendMessage('§cТолько глава может улучшать поселение.');
    return;
  }

  const currentTier = getTier(settlement.tierId);
  refreshSettlementStats(settlement, player.dimension);

  if (countEmeralds(player) < currentTier.upgradeCost) {
    player.sendMessage(`§cНужно ${currentTier.upgradeCost} изумрудов.`);
    return;
  }

  if (settlement.villagersNearby < currentTier.villagersRequired) {
    player.sendMessage(`§cНужно ${currentTier.villagersRequired} жителей на территории. Сейчас: ${settlement.villagersNearby}.`);
    return;
  }

  const conflicts = territoriesOverlap(
    settlement,
    next.radius,
    loadSettlements(),
    loadAlliances()
  );

  if (conflicts.length > 0) {
    const names = conflicts.map((item) => item.name).join(', ');
    player.sendMessage(`§cНельзя улучшить: мешает территория «${names}». Объявите войну и уничтожьте флаг врага.`);
    return;
  }

  if (!removeEmeralds(player, currentTier.upgradeCost)) {
    player.sendMessage('§cНе удалось списать изумруды.');
    return;
  }

  settlement.tierId = next.id;
  settlement.name = newName || settlement.name;
  settlement.radius = next.radius;
  settlement.flagHp = next.flagHp;
  settlement.flagMaxHp = next.flagHp;
  const ownerMember = settlement.members.find((member) =>
    member.playerId === settlement.ownerId || member.playerName === settlement.ownerName
  );
  if (ownerMember) ownerMember.prefix = next.leaderPrefix;
  boostMoraleOnUpgrade(settlement);
  refreshSettlementStats(settlement, player.dimension);
  settlement.taxRate = calcTaxRate(settlement);
  upsertSettlement(settlement);
  syncFlagEntity(settlement, player.dimension);
  refreshAllNameTags(settlement, world);
  world.sendMessage(`§aПоселение §6${settlement.name} §aулучшено до «${next.title}»!`);
}

export function dissolveSettlement(settlement, reason) {
  const dimension = world.getDimension(settlement.dimensionId);
  const entities = dimension.getEntities({ type: FLAG_ENTITY_TYPE });
  for (const entity of entities) {
    if (entity.getDynamicProperty('kingdoms:settlementId') === settlement.id) {
      entity.remove();
    }
  }

  for (const member of settlement.members ?? []) {
    const player = [...world.getPlayers()].find(
      (p) => p.id === member.playerId || p.name === member.playerName
    );
    if (!player) continue;
    player.nameTag = player.name;
    clearChatPrefix(player);
    player.sendMessage(`§cПоселение «${settlement.name}» расформировано.`);
  }

  removeSettlementRelations(settlement.id);
  removeSettlement(settlement.id);
  world.sendMessage(`§cПоселение «${settlement.name}» распалось. Причина: ${reason}`);
}

export function destroySettlementByWar(winnerSettlementId, loserSettlement) {
  const all = endWar(winnerSettlementId, loserSettlement.id);
  saveSettlements(all);
  dissolveSettlement(loserSettlement, 'поражение в войне');
}

export function damageFlag(entity, amount, attacker) {
  const settlementId = entity.getDynamicProperty('kingdoms:settlementId');
  if (!settlementId) return;
  const settlement = getSettlementById(settlementId);
  if (!settlement) return;

  const attackerSettlement = attacker ? getSettlementByPlayer(attacker.id, attacker.name) : null;
  if (!isAtWar(attackerSettlement, settlement)) {
    attacker?.sendMessage('§cФлаг можно бить только во время войны с этим поселением.');
    return;
  }

  let hp = Number(entity.getDynamicProperty('kingdoms:hp') ?? settlement.flagHp);
  hp = Math.max(0, hp - amount);
  entity.setDynamicProperty('kingdoms:hp', hp);
  settlement.flagHp = hp;
  upsertSettlement(settlement);

  if (hp <= 0) {
    if (attackerSettlement) {
      destroySettlementByWar(attackerSettlement.id, settlement);
    } else {
      dissolveSettlement(settlement, 'флаг уничтожен');
    }
  }
}

export function addMember(settlement, player) {
  if (settlement.members.some((member) => member.playerId === player.id || member.playerName === player.name)) {
    player.sendMessage('§cВы уже в этом поселении.');
    return;
  }
  if (getSettlementByPlayer(player.id, player.name)) {
    player.sendMessage('§cСначала покиньте своё текущее поселение.');
    return;
  }
  settlement.members.push({ playerId: player.id, playerName: player.name, prefix: 'Крестьянин' });
  upsertSettlement(settlement);
  applyNameTag(player, settlement, settlement.members.at(-1));
  player.sendMessage(`§aВы вступили в «${settlement.name}».`);
}

export function removeMember(settlement, playerId) {
  settlement.members = settlement.members.filter((member) => member.playerId !== playerId);
  upsertSettlement(settlement);
  const player = [...world.getPlayers()].find((p) => p.id === playerId);
  if (player) {
    player.nameTag = player.name;
    clearChatPrefix(player);
    player.sendMessage('§cВас исключили из поселения.');
  }
}

export function collectTax(player, settlement) {
  if (settlement.ownerId !== player.id && settlement.ownerName !== player.name) {
    player.sendMessage('§cТолько глава собирает налог.');
    return;
  }
  const tax = settlement.taxRate ?? calcTaxRate(settlement);
  let collected = 0;
  refreshSettlementStats(settlement, player.dimension);

  for (const member of settlement.members) {
    if (member.playerId === settlement.ownerId) continue;
    const target = [...world.getPlayers()].find((p) =>
      p.id === member.playerId || p.name === member.playerName
    );
    if (!target) continue;
    if (countEmeralds(target) < tax) {
      settlement.morale = Math.max(0, (settlement.morale ?? 50) - 5);
      target.sendMessage(`§cВы не смогли заплатить налог ${tax} изумрудов. Мораль поселения падает.`);
      continue;
    }
    if (removeEmeralds(target, tax)) {
      collected += tax;
      target.sendMessage(`§eВы заплатили налог ${tax} изумрудов поселению «${settlement.name}».`);
    }
  }
  const villagerTaxes = Math.floor((settlement.villagersNearby ?? 0) / 2);
  if (villagerTaxes > 0) {
    collected += villagerTaxes;
  }

  if (collected > 0) {
    const delivered = giveEmeralds(player, collected);
    settlement.morale = Math.min(100, (settlement.morale ?? 50) + 3);
    player.sendMessage(`§aСобрано налогов: ${delivered} изумрудов. Вклад жителей: ${villagerTaxes}.`);
  } else {
    player.sendMessage('§cНикто не смог заплатить налог.');
  }
  upsertSettlement(settlement);
}
