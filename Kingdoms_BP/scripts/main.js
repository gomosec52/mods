import { system, world } from '@minecraft/server';
import { FLAG_ENTITY_TYPE, FLAG_ITEM_ID, MENU_SCROLL_ID } from './config.js';
import { queueFlagMenu, refreshUnclaimedFlagLabels, tryOpenFlagMenu } from './flagInteract.js';
import { refreshFlagLabelsNearPlayers } from './flagLabels.js';
import { applyMoraleTick } from './morale.js';
import {
  applyNameTag,
  bindChatPrefix,
  getChatPrefixMode,
  getPlayerSettlementContext,
  refreshAllOnlineNameTags
} from './prefixes.js';
import { damageFlag, dissolveSettlement } from './settlement.js';
import { loadSettlements, upsertSettlement } from './storage.js';
import { getProtectionMessage, getTerritoryOwnerAt } from './war.js';

const UNCLAIMED_LABEL = '§eНовый флаг §7| ПКМ — меню';
const greeted = new Set();

function safeSubscribe(signal, handler) {
  try {
    if (!signal?.subscribe) return false;
    signal.subscribe(handler);
    return true;
  } catch (error) {
    console.warn('[Kingdoms] subscribe failed:', error);
    return false;
  }
}

function greet(player) {
  if (!player?.isValid || greeted.has(player.id)) return;
  greeted.add(player.id);
  player.sendMessage('§a[Kingdoms] Мод загружен (v4.1.1).');
  player.sendMessage('§7ПКМ по флагу / свиток = меню. ЛКМ = удар.');
  player.sendMessage(
    getChatPrefixMode() === 'before'
      ? '§aПрефикс в чате активен.'
      : '§cПрефикс в чате не подключился.'
  );
}

function setupPlayer(player) {
  if (!player?.isValid) return;
  greet(player);
  const { settlement, member } = getPlayerSettlementContext(player);
  if (settlement && member) applyNameTag(player, settlement, member);
}

function setupAllPlayers() {
  for (const player of world.getPlayers()) setupPlayer(player);
}

function preparePlacedFlag(player) {
  const flags = player.dimension.getEntities({
    type: FLAG_ENTITY_TYPE,
    location: player.location,
    maxDistance: 6
  });

  for (const flag of flags) {
    if (flag.getDynamicProperty('kingdoms:settlementId')) continue;
    flag.nameTag = UNCLAIMED_LABEL;
    flag.addTag('kingdoms:unclaimed');
  }
}

console.warn('[Kingdoms] loading v4.1.1');

function tryBindChatPrefix() {
  const ok = bindChatPrefix();
  console.warn('[Kingdoms] chat prefix:', ok ? getChatPrefixMode() : 'none');
  return ok;
}

safeSubscribe(world.afterEvents.worldInitialize, () => {
  console.warn('[Kingdoms] world initialized');
  tryBindChatPrefix();
  system.runTimeout(() => tryBindChatPrefix(), 40);
  system.run(() => setupAllPlayers());
  system.runTimeout(() => setupAllPlayers(), 40);
});

safeSubscribe(world.afterEvents.playerSpawn, (event) => {
  system.runTimeout(() => setupPlayer(event.player), 10);
});

safeSubscribe(world.afterEvents.entitySpawn, (event) => {
  if (event.entity.typeId !== FLAG_ENTITY_TYPE) return;
  if (event.entity.getDynamicProperty('kingdoms:settlementId')) return;
  event.entity.nameTag = UNCLAIMED_LABEL;
  event.entity.addTag('kingdoms:unclaimed');
});

safeSubscribe(world.afterEvents.itemUse, (event) => {
  const player = event.source;
  const itemId = event.itemStack?.typeId;

  if (itemId === FLAG_ITEM_ID) {
    system.runTimeout(() => preparePlacedFlag(player), 3);
    return;
  }

  if (itemId === MENU_SCROLL_ID) {
    if (!tryOpenFlagMenu(player)) {
      player.sendMessage('§cПодойдите к флагу (до 8 блоков).');
    }
  }
});

safeSubscribe(world.afterEvents.playerInteractWithEntity, (event) => {
  if (event.target.typeId !== FLAG_ENTITY_TYPE) return;
  queueFlagMenu(event.player, event.target);
});

safeSubscribe(world.beforeEvents.entityHurt, (event) => {
  if (event.hurtEntity.typeId !== FLAG_ENTITY_TYPE) return;
  const attacker = event.damageSource.damagingEntity;
  if (attacker?.typeId !== 'minecraft:player') return;

  event.cancel = true;
  const damage = Math.max(1, Math.floor(event.damage || 1));
  system.run(() => damageFlag(event.hurtEntity, damage, attacker));
});

safeSubscribe(world.beforeEvents.playerBreakBlock, (event) => {
  const owner = getTerritoryOwnerAt(
    event.player.dimension.id,
    event.block.location.x,
    event.block.location.z,
    event.player.id
  );
  if (!owner) return;
  event.cancel = true;
  event.player.sendMessage(getProtectionMessage(owner));
});

safeSubscribe(world.beforeEvents.playerInteractWithBlock, (event) => {
  const id = event.block.typeId;
  const isProtected =
    id.includes('chest') ||
    id.includes('barrel') ||
    id.includes('shulker') ||
    id.includes('button') ||
    id.includes('lever');
  if (!isProtected) return;

  const owner = getTerritoryOwnerAt(
    event.player.dimension.id,
    event.block.location.x,
    event.block.location.z,
    event.player.id
  );
  if (!owner) return;
  event.cancel = true;
  event.player.sendMessage(getProtectionMessage(owner));
});

system.run(() => {
  tryBindChatPrefix();
  setupAllPlayers();
});
system.runTimeout(() => {
  tryBindChatPrefix();
  setupAllPlayers();
}, 60);
system.runTimeout(() => tryBindChatPrefix(), 200);

system.runInterval(() => {
  try {
    const dimension = world.getDimension('overworld');
    refreshFlagLabelsNearPlayers(dimension);
    refreshUnclaimedFlagLabels(dimension);
  } catch {
    // ignore dimension timing
  }
}, 20);

system.runInterval(() => refreshAllOnlineNameTags(world), 100);

system.runInterval(() => {
  const settlements = loadSettlements();
  for (const settlement of settlements) {
    try {
      const dimension = world.getDimension(settlement.dimensionId);
      settlement.villagersNearby = dimension.getEntities({
        location: { x: settlement.flagX, y: settlement.flagY, z: settlement.flagZ },
        maxDistance: settlement.radius,
        families: ['villager']
      }).length;
      applyMoraleTick(settlement);
    } catch {
      // ignore unloaded dimensions
    }
  }

  for (const settlement of settlements) {
    if ((settlement.morale ?? 100) <= 0) {
      dissolveSettlement(settlement, 'мораль упала до нуля');
      continue;
    }
    upsertSettlement(settlement);
  }
}, 1200);

console.warn('[Kingdoms] ready v4.1.1');
