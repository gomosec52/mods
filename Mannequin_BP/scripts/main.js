import { system, world } from "@minecraft/server";

const NPC_TYPE = "mannequin:player_npc";
const DEFAULT_RADIUS = 50;
const MAX_NPC = 30;
const DEEP_SLEEP_DISTANCE = 64;
const AI_INTERVAL = 4;

const npcState = new Map();
const playerPrevPos = new Map();
let globalConfig = {
  radius: DEFAULT_RADIUS
};

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function dist2D(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function normalizeYaw(yaw) {
  let v = yaw % 360;
  if (v > 180) v -= 360;
  if (v < -180) v += 360;
  return v;
}

function yawTo(from, to) {
  return Math.atan2(to.z - from.z, to.x - from.x) * 180 / Math.PI;
}

function isInsideAnchor(pos, anchor, radius) {
  return dist2D(pos, anchor) <= radius;
}

function isClimbable(typeId) {
  return typeId.includes("ladder") || typeId.includes("vine") || typeId.includes("scaffolding");
}

function getBlockSafe(dimension, loc) {
  try {
    return dimension.getBlock(loc);
  } catch {
    return undefined;
  }
}

function canStandAt(dimension, point) {
  const feet = getBlockSafe(dimension, { x: Math.floor(point.x), y: Math.floor(point.y), z: Math.floor(point.z) });
  const head = getBlockSafe(dimension, { x: Math.floor(point.x), y: Math.floor(point.y) + 1, z: Math.floor(point.z) });
  const below = getBlockSafe(dimension, { x: Math.floor(point.x), y: Math.floor(point.y) - 1, z: Math.floor(point.z) });
  if (!feet || !head || !below) return false;
  if (feet.typeId !== "minecraft:air") return false;
  if (head.typeId !== "minecraft:air") return false;
  if (below.typeId === "minecraft:air") return false;
  return true;
}

function findGroundTarget(dimension, anchor, radius) {
  for (let i = 0; i < 16; i++) {
    const x = anchor.x + rand(-radius, radius);
    const z = anchor.z + rand(-radius, radius);
    const y = anchor.y + randInt(-4, 4);
    const candidate = { x: Math.floor(x) + 0.5, y: Math.floor(y), z: Math.floor(z) + 0.5 };
    if (!isInsideAnchor(candidate, anchor, radius)) continue;
    if (canStandAt(dimension, candidate)) return candidate;
  }
  return undefined;
}

function findNearbyClimbable(entity, radius = 1) {
  const p = entity.location;
  const d = entity.dimension;
  for (let dy = -1; dy <= 2; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const pos = {
          x: Math.floor(p.x) + dx,
          y: Math.floor(p.y) + dy,
          z: Math.floor(p.z) + dz
        };
        const block = getBlockSafe(d, pos);
        if (!block) continue;
        if (isClimbable(block.typeId)) {
          return { x: pos.x + 0.5, y: pos.y, z: pos.z + 0.5 };
        }
      }
    }
  }
  return undefined;
}

function nearestPlayer(entity) {
  let nearest;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const player of entity.dimension.getPlayers()) {
    const d = dist2D(player.location, entity.location);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = player;
    }
  }
  return { player: nearest, distance: nearestDist };
}

function pickBehavior(entity, state) {
  const nearClimb = findNearbyClimbable(entity, 1);
  const roll = Math.random();
  if (roll < 0.6) {
    state.mode = "walk";
  } else if (roll < 0.8) {
    state.mode = "idle";
  } else if (roll < 0.95 && nearClimb) {
    state.mode = "climb";
    state.climbTarget = nearClimb;
  } else {
    state.mode = "jump";
  }
  state.modeTicks = randInt(60, 160);
  if (state.mode === "walk") {
    state.target = findGroundTarget(entity.dimension, state.anchor, state.radius);
  }
}

function initNpc(entity) {
  const loc = entity.location;
  npcState.set(entity.id, {
    anchor: { x: loc.x, y: loc.y, z: loc.z },
    radius: globalConfig.radius ?? DEFAULT_RADIUS,
    mode: "idle",
    modeTicks: randInt(60, 140),
    target: undefined,
    climbTarget: undefined,
    deepSleep: false,
    headPitch: 0,
    headYaw: 0
  });
}

function setHead(entity, pitch, yaw) {
  try {
    entity.setProperty("mannequin:head_pitch", Math.max(-75, Math.min(75, pitch)));
    entity.setProperty("mannequin:head_yaw", Math.max(-80, Math.min(80, yaw)));
  } catch {
    // keep running on versions that ignore custom properties
  }
}

function moveToward(entity, target, speed = 0.13) {
  const here = entity.location;
  const yaw = yawTo(here, target);
  const rad = yaw * Math.PI / 180;
  entity.setRotation({ x: 0, y: yaw });
  entity.applyImpulse({
    x: Math.cos(rad) * speed,
    y: 0,
    z: Math.sin(rad) * speed
  });
}

function updateNpc(entity) {
  if (!entity?.isValid()) return;
  let state = npcState.get(entity.id);
  if (!state) {
    initNpc(entity);
    state = npcState.get(entity.id);
  }

  const pos = entity.location;
  const fromAnchor = dist2D(pos, state.anchor);
  if (fromAnchor > state.radius) {
    const backYaw = yawTo(pos, state.anchor);
    entity.setRotation({ x: 0, y: backYaw });
    moveToward(entity, state.anchor, 0.2);
    setHead(entity, 0, 0);
    return;
  }

  const nearest = nearestPlayer(entity);
  if (nearest.distance > DEEP_SLEEP_DISTANCE) {
    if (!state.deepSleep) {
      state.deepSleep = true;
      try {
        entity.triggerEvent("mannequin:enter_sleep");
      } catch {}
    }
    return;
  }
  if (state.deepSleep) {
    state.deepSleep = false;
    try {
      entity.triggerEvent("mannequin:exit_sleep");
    } catch {}
  }

  state.modeTicks -= AI_INTERVAL;
  if (state.modeTicks <= 0) {
    pickBehavior(entity, state);
  }

  let localHeadYaw = rand(-8, 8);
  let localHeadPitch = rand(-6, 6);

  if (nearest.player && nearest.distance <= 8) {
    const bodyYaw = entity.getRotation().y;
    const targetYaw = yawTo(pos, nearest.player.location);
    localHeadYaw = normalizeYaw(targetYaw - bodyYaw);
    const dy = nearest.player.location.y - pos.y;
    localHeadPitch = Math.max(-45, Math.min(45, -dy * 12));
  }

  switch (state.mode) {
    case "walk": {
      if (!state.target || !isInsideAnchor(state.target, state.anchor, state.radius)) {
        state.target = findGroundTarget(entity.dimension, state.anchor, state.radius);
      }
      if (state.target) {
        if (dist2D(pos, state.target) < 1.0) {
          state.mode = "idle";
          state.modeTicks = randInt(40, 90);
        } else {
          moveToward(entity, state.target, 0.14);
        }
      }
      break;
    }
    case "climb": {
      if (!state.climbTarget) {
        state.climbTarget = findNearbyClimbable(entity, 1);
      }
      if (state.climbTarget) {
        const c = state.climbTarget;
        moveToward(entity, c, 0.1);
        if (dist2D(pos, c) < 0.8) {
          entity.applyImpulse({ x: 0, y: 0.08, z: 0 });
          localHeadPitch = -25;
        }
      }
      break;
    }
    case "jump": {
      if (Math.random() < 0.25) {
        entity.applyImpulse({ x: 0, y: 0.33, z: 0 });
      }
      break;
    }
    case "idle":
    default: {
      if (Math.random() < 0.02) {
        entity.setRotation({ x: 0, y: entity.getRotation().y + (Math.random() < 0.5 ? 30 : -30) });
      }
      break;
    }
  }

  setHead(entity, localHeadPitch, localHeadYaw);
}

function allNpcEntities() {
  const result = [];
  for (const dimName of ["overworld", "nether", "the_end"]) {
    let dim;
    try {
      dim = world.getDimension(dimName);
    } catch {
      continue;
    }
    for (const e of dim.getEntities({ type: NPC_TYPE })) {
      result.push(e);
    }
  }
  return result;
}

function anyAnchorNear(location) {
  for (const state of npcState.values()) {
    if (dist2D(location, state.anchor) <= state.radius) return true;
  }
  return false;
}

world.afterEvents.entitySpawn.subscribe((ev) => {
  const entity = ev.entity;
  if (entity.typeId !== NPC_TYPE) return;
  if (allNpcEntities().length > MAX_NPC) {
    entity.kill();
    return;
  }
  initNpc(entity);
});

world.afterEvents.entityRemove.subscribe((ev) => {
  if (ev.removedTypeId !== NPC_TYPE) return;
  npcState.delete(ev.entityId);
});

world.afterEvents.entityHurt.subscribe((ev) => {
  const hurt = ev.hurtEntity;
  if (!hurt?.isValid()) return;

  if (hurt.typeId === NPC_TYPE) {
    const prev = playerPrevPos.get(hurt.id);
    if (prev) {
      try {
        hurt.teleport(prev.location, { rotation: prev.rotation, dimension: hurt.dimension });
      } catch {}
    }
    return;
  }

  if (hurt.typeId === "minecraft:player" && anyAnchorNear(hurt.location)) {
    const prev = playerPrevPos.get(hurt.id);
    if (prev) {
      try {
        hurt.teleport(prev.location, { rotation: prev.rotation, dimension: hurt.dimension });
      } catch {}
    }
  }
});

world.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "mannequin:config") return;
  try {
    const data = JSON.parse(ev.message);
    if (typeof data.radius === "number") {
      globalConfig.radius = Math.max(8, Math.min(80, Math.floor(data.radius)));
    }
    if (typeof data.applyToExisting === "boolean" && data.applyToExisting) {
      for (const st of npcState.values()) {
        st.radius = globalConfig.radius;
      }
    }
  } catch {
    // ignore invalid JSON
  }
});

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    playerPrevPos.set(player.id, {
      location: { x: player.location.x, y: player.location.y, z: player.location.z },
      rotation: { x: player.getRotation().x, y: player.getRotation().y }
    });
  }

  for (const npc of allNpcEntities()) {
    playerPrevPos.set(npc.id, {
      location: { x: npc.location.x, y: npc.location.y, z: npc.location.z },
      rotation: { x: npc.getRotation().x, y: npc.getRotation().y }
    });
    updateNpc(npc);
  }
}, AI_INTERVAL);
