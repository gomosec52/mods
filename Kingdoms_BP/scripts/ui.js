import * as serverUi from '@minecraft/server-ui';
import { MEMBER_PREFIXES, getNextTier, getTier } from './config.js';
import {
  acceptAlliance,
  areSettlementsAllied,
  createAllianceProposal,
  getPendingAllianceForSettlement,
  hasPendingAlliance,
  rejectAlliance
} from './alliance.js';
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
import { applyNameTag } from './prefixes.js';

const { ActionFormData, ModalFormData } = serverUi;

function kingdomsTitle(title) {
  return `kdm:${title}`;
}

function buildSettlementSummaryRows(settlement, tier, next) {
  const rows = [
    `Название: ${settlement.name}`,
    `Статус: ${tier.title}`,
    `Глава: ${settlement.ownerName}`,
    `Флаг: ${settlement.flagHp ?? tier.flagHp}/${tier.flagHp} HP`,
    `Территория: ${settlement.radius} блоков`,
    `Налог: ${settlement.taxRate} изумр.`,
    `Мораль: ${settlement.morale ?? 0}/100`,
    `Жители: ${settlement.villagersNearby}`,
    `Игроки: ${settlement.members.length}`
  ];

  if (next) {
    rows.push(
      `Дальше: ${next.title}`,
      `Цена: ${tier.upgradeCost} изумр.`,
      `Нужно жителей: ${tier.villagersRequired}`,
      `Будет: ${next.radius} блоков, ${next.flagHp} HP`
    );
  } else {
    rows.push('Достигнут предел развития');
  }

  return rows;
}

function buildFlagMenuBody(settlement, tier, next) {
  const lines = [
    'Зал совета',
    '',
    `Владение: ${settlement.name}`,
    `Статус: ${tier.title}`,
    `Глава: ${settlement.ownerName}`,
    '',
    `Прочность флага: ${settlement.flagHp ?? tier.flagHp}/${tier.flagHp}`,
    `Мораль: ${settlement.morale ?? 0}/100`,
    `Налог: ${settlement.taxRate} изумр.`,
    `Территория: ${settlement.radius} блоков`,
    `Жители: ${settlement.villagersNearby}`,
    `Игроки: ${settlement.members.length}`
  ];

  if (next) {
    lines.push(
      '',
      `Следующий титул: ${next.title}`,
      `Цена: ${tier.upgradeCost} изумр.`,
      `Нужно жителей: ${tier.villagersRequired}`
    );
  } else {
    lines.push('', 'Достигнут предел развития.');
  }

  return lines.join('\n');
}

function runMenuAction(player, action) {
  Promise.resolve()
    .then(action)
    .catch((error) => {
      const message = error?.message ?? String(error);
      player.sendMessage(`§cОшибка меню: ${message}`);
      console.warn('[Kingdoms] DDUI action failed:', error);
    });
}

async function tryOpenDduiFlagMenu(player, settlement, tier, next, actions) {
  const CustomForm = serverUi.CustomForm;
  if (typeof CustomForm !== 'function') return false;

  try {
    const form = new CustomForm(player, kingdomsTitle(`${tier.title} «${settlement.name}»`));

    if (typeof form.header === 'function') {
      form.header(`${tier.title} «${settlement.name}»`);
    }
    if (typeof form.label === 'function') {
      form.label(buildFlagMenuBody(settlement, tier, next));
    }
    if (typeof form.divider === 'function') {
      form.divider();
    }

    for (const { label, action } of actions) {
      form.button(label, () => runMenuAction(player, action));
    }

    await form.show();
    return true;
  } catch (error) {
    console.warn('[Kingdoms] DDUI flag menu unavailable, falling back:', error);
    return false;
  }
}

async function openSettlementSummaryMenu(player, settlement) {
  refreshSettlementStats(settlement, player.dimension);
  settlement.taxRate = calcTaxRate(settlement);
  upsertSettlement(settlement);

  const tier = getTier(settlement.tierId);
  const next = getNextTier(settlement.tierId);
  const rows = buildSettlementSummaryRows(settlement, tier, next);
  const form = new ActionFormData()
    .title(kingdomsTitle(`Сводка: ${settlement.name}`))
    .body('Книга владений. Строки ниже сделаны табличками, чтобы текст не терялся в UI.');

  for (const row of rows) form.button(row);
  form.button('Назад к флагу');

  const response = await form.show(player);

  if (!response.canceled && response.selection === rows.length) {
    await openFlagMenu(player, settlement.id);
  }
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
  const acceptLabel = `Принять игрока в ${tier.title.toLowerCase()}`;
  const upgradeLabel = next ? `Улучшить до «${next.title}»` : 'Максимальный уровень';
  const disbandLabel = `Расформировать «${settlement.name}»`;

  const form = new ActionFormData()
    .title(kingdomsTitle(`${tier.title} «${settlement.name}»`))
    .body(buildFlagMenuBody(settlement, tier, next));

  const ownerActions = [];
  const addAction = (label, action) => {
    ownerActions.push({ label, action });
  };

  addAction('Книга владений', () => openSettlementSummaryMenu(player, settlement));

  if (isOwner) {
    addAction(acceptLabel, () => openAcceptPlayerMenu(player, settlement));
    addAction('Изгнать игрока', () => openKickPlayerMenu(player, settlement));
    if (next) {
      addAction(upgradeLabel, () => openUpgradeMenu(player, settlement, next));
    }
    addAction('Собрать подать', () => collectTax(player, settlement));
    addAction('Назначить титул', () => openPrefixMenu(player, settlement));
    addAction('Объявить войну', () => openWarMenu(player, settlement));
    addAction('Заключить альянс', () => openAllianceMenu(player, settlement));
    addAction(disbandLabel, () => openDisbandMenu(player, settlement));
  } else if (member) {
    addAction('Покинуть поселение', () => {
      removeMember(settlement, player.id);
      player.nameTag = player.name;
    });
  } else {
    addAction('Подать заявку на вступление', () => addMember(settlement, player));
  }

  if (await tryOpenDduiFlagMenu(player, settlement, tier, next, ownerActions)) return;

  for (const { label } of ownerActions) form.button(label);

  const response = await form.show(player);
  if (response.canceled) return;

  const action = ownerActions[response.selection]?.action;
  if (action) await action();
}

async function openAcceptPlayerMenu(player, settlement) {
  const online = [...world.getPlayers()].filter((p) =>
    !settlement.members.some((member) => member.playerId === p.id || member.playerName === p.name) &&
    !getSettlementByPlayer(p.id, p.name)
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
  const online = [...world.getPlayers()].find((p) => p.id === target.playerId || p.name === target.playerName);
  if (online) {
    applyNameTag(online, settlement, target);
    online.sendMessage(`§aВам назначен префикс: ${target.prefix}`);
  }
  player.sendMessage(`§aПрефикс «${target.prefix}» выдан игроку ${target.playerName}.`);
}

async function openWarMenu(player, settlement) {
  const others = loadSettlements().filter((item) =>
    item.id !== settlement.id && !areSettlementsAllied(settlement.id, item.id)
  );
  if (!others.length) {
    player.sendMessage('§cНет поселений, которым можно объявить войну.');
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
  const declared = declareWar(settlement, target);
  if (!declared) {
    player.sendMessage('§cНельзя объявить войну этому поселению.');
    return;
  }
  upsertSettlement(settlement);
  upsertSettlement(target);
  world.sendMessage(`§4${settlement.name} объявил войну поселению ${target.name}! Победит тот, кто сломает вражеский флаг.`);
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
  if (pending && (settlement.ownerId === player.id || settlement.ownerName === player.name)) {
    const from = getSettlementById(pending.fromId);
    const form = new ActionFormData()
      .title(kingdomsTitle('Предложение альянса'))
      .body(`${from?.name ?? 'Поселение'} предлагает альянс «${pending.name ?? 'Безымянный союз'}».`)
      .button('Принять')
      .button('Отказать');
    const response = await form.show(player);
    if (response.canceled) return;
    if (response.selection === 0) {
      const name = pending.name || 'Безымянный союз';
      acceptAlliance(pending, name);
      world.sendMessage(`§bСоздан альянс «${name}» между ${from?.name} и ${settlement.name}.`);
    } else {
      rejectAlliance(pending.id);
      player.sendMessage('§cВы отклонили альянс.');
    }
    return;
  }

  const others = loadSettlements().filter((item) =>
    item.id !== settlement.id &&
    !areSettlementsAllied(settlement.id, item.id) &&
    !hasPendingAlliance(settlement.id, item.id)
  );
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
  const allianceName = await askText(player, 'Название альянса', 'Как назвать союз?', 'Серебряный союз');
  if (!allianceName) return;
  const alliances = loadAlliances();
  alliances.push(createAllianceProposal(settlement.id, target.id, allianceName.slice(0, 24)));
  saveAlliances(alliances);
  player.sendMessage(`§aПредложение альянса «${allianceName}» отправлено в «${target.name}».`);
  const owner = [...world.getPlayers()].find((p) => p.id === target.ownerId || p.name === target.ownerName);
  owner?.sendMessage(`§b${settlement.name} предлагает вам альянс «${allianceName}». Откройте флаг своего поселения.`);
}

export async function openPendingFlagPlacementMenu(player, flagPos) {
  const existing = getSettlementByPlayer(player.id, player.name);
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
