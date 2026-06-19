import { FLAG_ENTITY_TYPE, getTier } from './config.js';
import { getSettlementById } from './storage.js';

export const FLAG_LABEL_RADIUS = 15;
const UNCLAIMED_LABEL = '§eНовый флаг §7| ПКМ — меню';

export function formatSettlementFlagLabel(settlement) {
  const tier = getTier(settlement.tierId);
  return `§6${settlement.name} §7| ${tier.title} §f| ${settlement.ownerName}`;
}

export function refreshFlagLabelsNearPlayers(dimension) {
  const players = [...dimension.getPlayers()];
  if (!players.length) return;

  const flags = dimension.getEntities({ type: FLAG_ENTITY_TYPE });
  for (const flag of flags) {
    if (!flag.isValid) continue;

    let nearest = FLAG_LABEL_RADIUS + 1;
    for (const player of players) {
      const dx = flag.location.x - player.location.x;
      const dy = flag.location.y - player.location.y;
      const dz = flag.location.z - player.location.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < nearest) nearest = dist;
    }

    if (nearest > FLAG_LABEL_RADIUS) continue;

    const settlementId = flag.getDynamicProperty('kingdoms:settlementId');
    if (!settlementId) {
      flag.nameTag = UNCLAIMED_LABEL;
      continue;
    }

    const settlement = getSettlementById(String(settlementId));
    if (!settlement) {
      flag.nameTag = UNCLAIMED_LABEL;
      continue;
    }

    flag.nameTag = formatSettlementFlagLabel(settlement);
  }
}
