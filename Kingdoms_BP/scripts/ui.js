import { ActionFormData, ModalFormData } from '@minecraft/server-ui';
import { MEMBER_PREFIXES, getNextTier, getTier } from './config.js';
import { acceptAlliance, createAllianceProposal, getPendingAllianceForSettlement, rejectAlliance } from './alliance.js';
import { calcTaxRate } from './morale.js';
import {
  addMember,
  collectTax,
  createSettlement,
  dissolveSettlement,
  removeMember,
  upgradeSettlement
} from './settlement.js';
import { getSettlementById, getSettlementByPlayer, loadAlliances, loadSettlements, saveAlliances, upsertSettlement } from './storage.js';
import { refreshSettlementStats } from './territory.js';
import { declareWar } from './war.js';
import { world } from '@minecraft/server';

function kingdomsTitle(title) {
  return `kdm:${title}`;
}

async function askText(player, title, label, placeholder) {
  const form = new ModalFormData().title(kingdomsTitle(title)).textField(label, placeholder);
  const result = await form.show(player);
  if (result.canceled) return null;
  return String(result.formValues?.[0] ?? '').trim();
}

export async function openCreateSettlementMenu(player, flagPos) {
  const name = await askText(player, 'Основание деревни', 'Название поселения', 'Бебека');
  if (!name) return;
  createSettlement(player, name.slice(0, 24), flagPos);
}

export async function openFlagMenu(player, settlementId) {
  const settlement = getSettlementById(settlementId);
  if (!settlement) {
    player.sendMessage('§cПоселение не найдено.');
    return;
  }

  refreshSettlementStats(settlement, player.dimension);
  settlement.taxRate = calcTaxRate(settlement);
  upsertSettlement(settlement);

  const tier = getTier(settlement.tierId);
  const next = getNextTier(settlement.tierId);
  const member = settlement.members.find((item) => item.playerId === player.id || item.playerName === player.name);
  const isOwner = settlement.ownerId === player.id || settlement.ownerName === player.name;
  const acceptLabel = 'Принять игрока';
  const upgradeLabel = next ? `Улучшить до «${next.title}»` : 'Максимальный уровень';
  const disbandLabel = `Расформировать «${settlement.name}»`;

  const leftInfo = [
    `Прочность: ${settlement.flagHp ?? tier.flagHp} / ${tier.flagHp}`,
    `Территория: ${settlement.radius} блоков`,
    `Налог: ${settlement.taxRate} изумр.`,
    `Мораль: ${settlement.morale ?? 0} / 100`,
    `Жители NPC: ${settlement.villagersNearby}`,
    `Участников: ${settlement.members.length}`
  ].join('\n');

  const form = new ActionFormData()
    .title(kingdomsTitle(`${tier.title} «${settlement.name}»`))
    .body(leftInfo);

  const ownerActions = [];

  if (isOwner) {
    ownerActions.push(
      () => openAcceptPlayerMenu(player, settlement),
      () => openKickPlayerMenu(player, settlement)
    );
    if (next) {
      ownerActions.push(() => openUpgradeMenu(player, settlement, next));
    }
    ownerActions.push(
      () => collectTax(player, settlement),
      () => openPrefixMenu(player, settlement),
      () => openWarMenu(player, settlement),
      () => openAllianceMenu(player, settlement),
      () => openDisbandMenu(player, settlement)
    );

    form.button(acceptLabel);
    form.button('Исключить игрока');
    if (next) form.button(upgradeLabel);
    form.button('Собрать налог');
    form.button('Назначить префикс');
    form.button('Объявить войну');
    form.button('Создать альянс');
    form.button(disbandLabel);
  } else if (member) {
    form.button('Покинуть поселение');
  } else {
    form.button('Подать заявку на вступление');
  }

  const response = await form.show(player);
  if (response.canceled) return;

  if (!isOwner && !member) {
    addMember(settlement, player);
    return;
  }

  if (!isOwner && member) {
    removeMember(settlement, player.id);
    player.nameTag = player.name;
    return;
  }

  const action = ownerActions[response.selection];
  if (action) await action();
}

async function openAcceptPlayerMenu(player, settlement) {
  const online = [...world.getPlayers()].filter((p) =>
    !settlement.members.some((member) => member.playerId === p.id)
  );
  if (!online.length) {
    player.sendMessage('§cНет игроков для приглашения.');
    return;
  }
  const form = new ActionFormData().title(kingdomsTitle('Принять игрока')).body(' ');
  for (const target of online) form.button(target.name);
  const response = await form.show(player);
  if (response.canceled) return;
  addMember(settlement, online[response.selection]);
}

async function openKickPlayerMenu(player, settlement) {
  const members = settlement.members.filter((member) => member.playerId !== settlement.ownerId);
  if (!members.length) {
    player.sendMessage('§cНекого исключать.');
    return;
  }
  const form = new ActionFormData().title(kingdomsTitle('Исключить игрока')).body(' ');
  for (const member of members) form.button(member.playerName);
  const response = await form.show(player);
  if (response.canceled) return;
  removeMember(settlement, members[response.selection].playerId);
}

async function openUpgradeMenu(player, settlement, nextTier) {
  const currentTier = getTier(settlement.tierId);
  const newName = await askText(
    player,
    `Улучшение до ${nextTier.title}`,
    `Новое название (можно оставить ${settlement.name})`,
    settlement.name
  );
  if (newName === null) return;
  upgradeSettlement(player, settlement, newName || settlement.name);
}

async function openPrefixMenu(player, settlement) {
  const members = settlement.members.filter((member) => member.playerId !== settlement.ownerId);
  if (!members.length) {
    player.sendMessage('§cНет участников для назначения префикса.');
    return;
  }
  const memberForm = new ActionFormData().title(kingdomsTitle('Выберите игрока')).body(' ');
  for (const member of members) memberForm.button(member.playerName);
  const memberResponse = await memberForm.show(player);
  if (memberResponse.canceled) return;

  const prefixForm = new ActionFormData().title(kingdomsTitle('Выберите префикс')).body(' ');
  for (const prefix of MEMBER_PREFIXES) prefixForm.button(prefix);
  const prefixResponse = await prefixForm.show(player);
  if (prefixResponse.canceled) return;

  const target = members[memberResponse.selection];
  target.prefix = MEMBER_PREFIXES[prefixResponse.selection];
  upsertSettlement(settlement);
  const online = [...world.getPlayers()].find((p) => p.id === target.playerId);
  if (online) online.sendMessage(`§aВам назначен префикс: ${target.prefix}`);
  player.sendMessage(`§aПрефикс «${target.prefix}» выдан игроку ${target.playerName}.`);
}

async function openWarMenu(player, settlement) {
  const others = loadSettlements().filter((item) => item.id !== settlement.id);
  if (!others.length) {
    player.sendMessage('§cНет других поселений.');
    return;
  }
  const form = new ActionFormData().title(kingdomsTitle('Объявить войну')).body(' ');
  for (const other of others) {
    const tier = getTier(other.tierId).title;
    form.button(`${tier} «${other.name}» — ${other.ownerName}`);
  }
  const response = await form.show(player);
  if (response.canceled) return;
  const target = others[response.selection];
  declareWar(settlement, target);
  upsertSettlement(settlement);
  upsertSettlement(target);
  world.sendMessage(`§4${settlement.name} объявил войну поселению ${target.name}!`);
}

async function openDisbandMenu(player, settlement) {
  const tier = getTier(settlement.tierId);
  const form = new ActionFormData()
    .title(kingdomsTitle('Расформирование'))
    .body(
      [
        `Вы точно хотите расформировать ${tier.title.toLowerCase()} «${settlement.name}»?`,
        '',
        'Флаг исчезнет, участники потеряют префиксы, территория перестанет защищаться.'
      ].join('\n')
    )
    .button(`Расформировать «${settlement.name}»`)
    .button('Отмена');

  const response = await form.show(player);
  if (response.canceled || response.selection !== 0) return;
  dissolveSettlement(settlement, `расформировано владельцем ${player.name}`);
}

async function openAllianceMenu(player, settlement) {
  const pending = getPendingAllianceForSettlement(settlement.id);
  if (pending && settlement.ownerId === player.id) {
    const from = getSettlementById(pending.fromId);
    const form = new ActionFormData()
      .title(kingdomsTitle('Предложение альянса'))
      .body(`${from?.name ?? 'Поселение'} предлагает альянс.`)
      .button('Принять')
      .button('Отказать');
    const response = await form.show(player);
    if (response.canceled) return;
    if (response.selection === 0) {
      const name = await askText(player, 'Название альянса', 'Имя союза', 'Серебряный союз');
      if (!name) return;
      acceptAlliance(pending, name);
      world.sendMessage(`§bСоздан альянс «${name}» между ${from?.name} и ${settlement.name}.`);
    } else {
      rejectAlliance(pending.id);
      player.sendMessage('§cВы отклонили альянс.');
    }
    return;
  }

  const others = loadSettlements().filter((item) => item.id !== settlement.id);
  if (!others.length) {
    player.sendMessage('§cНет других поселений для альянса.');
    return;
  }
  const form = new ActionFormData().title(kingdomsTitle('Создать альянс')).body(' ');
  for (const other of others) {
    const tier = getTier(other.tierId).title;
    form.button(`${tier} «${other.name}»`);
  }
  const response = await form.show(player);
  if (response.canceled) return;
  const target = others[response.selection];
  const alliances = loadAlliances();
  alliances.push(createAllianceProposal(settlement.id, target.id));
  saveAlliances(alliances);
  player.sendMessage(`§aПредложение альянса отправлено в «${target.name}».`);
  const owner = [...world.getPlayers()].find((p) => p.id === target.ownerId);
  owner?.sendMessage(`§b${settlement.name} предлагает вам альянс. Откройте флаг своего поселения.`);
}

export async function openPendingFlagPlacementMenu(player, flagPos) {
  const existing = getSettlementByPlayer(player.id);
  if (existing) {
    player.sendMessage('§cУ вас уже есть поселение.');
    return;
  }
  const form = new ActionFormData()
    .title(kingdomsTitle('Флаг поселения'))
    .body('Создать деревню за 15 изумрудов?')
    .button('Создать деревню')
    .button('Отмена');
  const response = await form.show(player);
  if (response.canceled || response.selection !== 0) return;
  await openCreateSettlementMenu(player, flagPos);
}
