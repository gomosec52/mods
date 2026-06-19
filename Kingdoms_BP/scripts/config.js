/** Прогрессия поселений: деревня → империя */
export const TIERS = [
  {
    id: 'village',
    title: 'Деревня',
    nextTitle: 'Большая деревня',
    radius: 40,
    flagHp: 50,
    createCost: 15,
    upgradeCost: 30,
    villagersRequired: 3,
    leaderPrefix: 'Староста'
  },
  {
    id: 'large_village',
    title: 'Большая деревня',
    nextTitle: 'Замок',
    radius: 60,
    flagHp: 100,
    upgradeCost: 60,
    villagersRequired: 5,
    leaderPrefix: 'Сеньор'
  },
  {
    id: 'castle',
    title: 'Замок',
    nextTitle: 'Город',
    radius: 80,
    flagHp: 200,
    upgradeCost: 100,
    villagersRequired: 8,
    leaderPrefix: 'Лорд'
  },
  {
    id: 'city',
    title: 'Город',
    nextTitle: 'Королевство',
    radius: 120,
    flagHp: 350,
    upgradeCost: 150,
    villagersRequired: 12,
    leaderPrefix: 'Граф'
  },
  {
    id: 'kingdom',
    title: 'Королевство',
    nextTitle: 'Империя',
    radius: 200,
    flagHp: 500,
    upgradeCost: 250,
    villagersRequired: 18,
    leaderPrefix: 'Король'
  },
  {
    id: 'empire',
    title: 'Империя',
    nextTitle: null,
    radius: 300,
    flagHp: 800,
    upgradeCost: null,
    villagersRequired: 0,
    leaderPrefix: 'Император'
  }
];

export const MEMBER_PREFIXES = [
  'Крестьянин',
  'Ремесленник',
  'Страж',
  'Рыцарь',
  'Дворянин',
  'Хранитель'
];

export const WORLD_DATA_KEY = 'kingdoms:settlements';
export const ALLIANCE_KEY = 'kingdoms:alliances';
export const FLAG_ENTITY_TYPE = 'kingdoms:settlement_flag';
export const FLAG_ITEM_ID = 'kingdoms:settlement_flag_item';
export const MENU_SCROLL_ID = 'kingdoms:menu_scroll';

export function getTier(id) {
  return TIERS.find((tier) => tier.id === id) ?? TIERS[0];
}

export function getNextTier(id) {
  const index = TIERS.findIndex((tier) => tier.id === id);
  if (index < 0 || index >= TIERS.length - 1) return null;
  return TIERS[index + 1];
}
