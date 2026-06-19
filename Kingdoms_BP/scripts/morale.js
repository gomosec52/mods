export function calcTaxRate(settlement) {
  const members = settlement.members.length;
  const villagers = settlement.villagersNearby ?? 0;
  return Math.min(20, 2 + members + Math.floor(villagers / 3));
}

export function applyMoraleTick(settlement) {
  let morale = settlement.morale ?? 100;

  const members = settlement.members.length;
  const villagers = settlement.villagersNearby ?? 0;
  const activeWars = (settlement.wars ?? []).filter((war) => war.active).length;

  if (villagers < 2) morale -= 2;
  if (members < 2) morale -= 1;
  if (activeWars > 0) morale -= 3 * activeWars;
  if (villagers >= 5) morale += 1;
  if (members >= 4) morale += 1;

  const taxRate = settlement.taxRate ?? calcTaxRate(settlement);
  if (taxRate > 12) morale -= 2;
  if (taxRate <= 6) morale += 1;

  settlement.morale = Math.max(0, Math.min(100, morale));
  return settlement.morale;
}

export function boostMoraleOnUpgrade(settlement) {
  settlement.morale = Math.min(100, (settlement.morale ?? 70) + 15);
}
