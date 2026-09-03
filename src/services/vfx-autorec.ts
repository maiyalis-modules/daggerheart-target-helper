/**
 * Auto-recognition: a best-effort guess at which JB2A animation suits an action,
 * for everything nobody has configured by hand.
 *
 * Matched against the lowercased **action** name first and the **item** name
 * second, first hit winning — so a Grimoire's three actions match on their own
 * names, while a weapon called "Dagger" whose only action is "Attack" falls
 * through to the item. Because matching is a substring test, **order matters**:
 * every entry here is arranged specific-before-generic, or "sword" would swallow
 * "greatsword" and "bow" would swallow "crossbow".
 *
 * This is a *starting point*, not a claim to be right. Daggerheart is being mapped
 * onto a library drawn for D&D 5e: the weapons transfer well because a longsword
 * is a longsword, and the domain cards are educated guesses at the feel of a
 * spell that has no counterpart in the library at all. Anything that reads wrong
 * is one per-action config away from being fixed, and the per-action config always
 * wins over this table.
 *
 * Keys are Sequencer database paths, so this table needs Sequencer installed to
 * resolve. Hand-written configs can still use literal `modules/...` paths.
 */
import type { VfxStep } from "./vfx-resolver.js";

export type AutorecStep = Partial<VfxStep> & { key: string };

/**
 * JB2A's melee assets are 800x600 strips authored for a token plus its reach, so
 * they have to overhang a portrait to read as a swing rather than a smear.
 */
const melee = (key: string): AutorecStep => ({
  key,
  on: "target",
  placement: { scale: 1.7, anchor: 0.45 },
});

/** A square effect drawn on the target — impacts, conditions, most spells. */
const onTarget = (key: string, scale = 1.2): AutorecStep => ({
  key,
  on: "target",
  placement: { scale, anchor: 0.4 },
});

/** Something the acting character does to themselves — buffs, stances, cloaks. */
const onCaster = (key: string, scale = 1.2): AutorecStep => ({
  key,
  on: "caster",
  placement: { scale, anchor: 0.4 },
});

/**
 * A projectile drawn between the two portraits.
 *
 * `reach` above 1 because JB2A's ranged strips carry transparent lead-in and
 * lead-out; 1.3 is a reasonable starting point but is worth tuning per asset.
 */
const ranged = (key: string): AutorecStep => ({
  key,
  on: "spanning",
  placement: { scale: 1, anchor: 0.45 },
  reach: 1.3,
});

export const AUTOREC: ReadonlyArray<readonly [string, AutorecStep]> = [
  // ---------------------------------------------------------------- weapons --
  // Tier prefixes (Advanced/Improved/Legendary) fall out of substring matching,
  // so only the base noun needs an entry.

  // Blades. Longest names first — "sword" would otherwise take them all.
  ["greatsword", melee("jb2a.greatsword.melee")],
  ["shortsword", melee("jb2a.shortsword.melee")],
  ["longsword", melee("jb2a.sword.melee")],
  ["sword of light", melee("jb2a.sword.melee.fire.orange")],
  ["dual-ended sword", melee("jb2a.sword.melee")],
  ["cutlass", melee("jb2a.scimitar.melee")],
  ["scimitar", melee("jb2a.scimitar.melee")],
  ["rapier", melee("jb2a.rapier.melee")],
  ["anlace", melee("jb2a.dagger.melee")],
  ["dagger", melee("jb2a.dagger.melee")],
  ["sword", melee("jb2a.sword.melee")],

  // Axes and polearms.
  ["battleaxe", melee("jb2a.greataxe.melee")],
  ["greataxe", melee("jb2a.greataxe.melee")],
  ["hallowed axe", melee("jb2a.handaxe.melee")],
  ["axe", melee("jb2a.handaxe.melee")],
  ["war scythe", melee("jb2a.glaive.melee")],
  ["scythe", melee("jb2a.glaive.melee")],
  ["glaive", melee("jb2a.glaive.melee")],
  ["halberd", melee("jb2a.halberd.melee")],
  ["spear", melee("jb2a.spear.melee")],

  // Blunt.
  ["warhammer", melee("jb2a.warhammer.melee")],
  ["hammer", melee("jb2a.warhammer.melee")],
  ["maul", melee("jb2a.maul.melee")],
  ["mace", melee("jb2a.mace.melee")],
  ["flail", melee("jb2a.mace.melee")],
  ["club", melee("jb2a.club.melee")],

  // Staves. All before the bare "staff" catch-all.
  ["quarterstaff", melee("jb2a.quarterstaff.melee")],
  ["shortstaff", melee("jb2a.quarterstaff.melee")],
  ["dualstaff", ranged("jb2a.spell_projectile")],
  ["greatstaff", ranged("jb2a.spell_projectile")],
  ["staff", melee("jb2a.quarterstaff.melee")],

  // Reach and improvised. Whips and grapplers have no JB2A weapon of their own.
  ["bladed whip", melee("jb2a.melee_generic")],
  ["whip", melee("jb2a.melee_generic")],
  ["grappler", melee("jb2a.melee_generic")],
  ["wheelchair", melee("jb2a.melee_generic")],
  ["fangs", melee("jb2a.bite")],
  ["unarmed", melee("jb2a.unarmed_strike.physical")],

  // Shields used offensively.
  ["braveshield", melee("jb2a.shield_attack")],
  ["spiked shield", melee("jb2a.shield_attack")],
  ["tower shield", melee("jb2a.shield_attack")],
  ["round shield", melee("jb2a.shield_attack")],

  // Ranged weapons draw between the two portraits — the case spanning exists for.
  ["crossbow", ranged("jb2a.bolt.physical.white")],
  ["bloodbow", ranged("jb2a.arrow.physical.red")],
  ["longbow", ranged("jb2a.arrow.physical.white")],
  ["shortbow", ranged("jb2a.arrow.physical.white")],
  ["bow", ranged("jb2a.arrow.physical.white")],
  ["blunderbuss", ranged("jb2a.bullet")],
  ["sling", ranged("jb2a.bullet")],
  ["bladeshards", ranged("jb2a.chakram")],
  ["sharpwing", ranged("jb2a.dart")],

  // Arcane implements. Magic at range rather than a thrown object.
  ["runes of ruination", ranged("jb2a.eldritch_blast")],
  ["hand runes", ranged("jb2a.eldritch_blast")],
  ["glowing rings", ranged("jb2a.eldritch_blast")],
  ["arcane gauntlets", ranged("jb2a.eldritch_blast")],
  ["fusion gloves", ranged("jb2a.eldritch_blast")],
  ["scepter", ranged("jb2a.spell_projectile")],
  ["wand", ranged("jb2a.spell_projectile")],

  // ----------------------------------------------------------- domain cards --
  // Guesswork, and the weakest part of this table: Daggerheart's domains have no
  // counterpart in a 5e library, so these are matched on feel. Entries only exist
  // where there is a real visual to reach for — a card about presence or guile
  // gets nothing rather than a shrug of an animation.

  // Blade and Bone: strikes and finishers.
  ["reaper", onTarget("jb2a.impact.dark_purple", 1.4)],
  ["splintering strike", onTarget("jb2a.impact", 1.4)],
  ["rousing strike", onTarget("jb2a.impact", 1.4)],
  ["glancing blow", onTarget("jb2a.impact", 1.2)],
  ["deathrun", onTarget("jb2a.impact", 1.4)],
  ["dire strike", onTarget("jb2a.impact", 1.4)],
  ["wailing leap", onTarget("jb2a.impact", 1.4)],
  ["whirlwind", onTarget("jb2a.whirlwind", 1.6)],
  ["smite", onTarget("jb2a.divine_smite", 1.6)],
  ["gore and glory", onCaster("jb2a.on_token_buff")],
  ["rage up", onCaster("jb2a.on_token_buff")],
  ["full surge", onCaster("jb2a.on_token_buff")],
  ["bare bones", onCaster("jb2a.bone")],

  // Grace and Codex: arcane workings.
  ["chain lightning", ranged("jb2a.chain_lightning")],
  ["tempest", onTarget("jb2a.lightning_strike", 1.6)],
  ["cinder grasp", onTarget("jb2a.flames", 1.3)],
  ["falling sky", onTarget("jb2a.falling_rocks", 1.6)],
  ["forceful push", onTarget("jb2a.thunderwave", 1.6)],
  ["forcefully pushed", onTarget("jb2a.thunderwave", 1.6)],
  ["preservation blast", onCaster("jb2a.energy_field", 1.4)],
  ["cloaking blast", onCaster("jb2a.smoke", 1.4)],
  ["telekinesis", onTarget("jb2a.energy_strands", 1.3)],
  ["counterspell", onCaster("jb2a.magic_signs", 1.3)],
  ["banish", onTarget("jb2a.portals", 1.3)],
  ["manifest wall", onCaster("jb2a.wall_of_force", 1.6)],
  ["arcane reflection", onCaster("jb2a.shield", 1.3)],
  ["rune ward", onCaster("jb2a.ward", 1.3)],
  ["arcane rune", onCaster("jb2a.magic_signs", 1.3)],
  ["glyph of nightfall", onTarget("jb2a.magic_signs", 1.3)],
  ["shape material", onCaster("jb2a.magic_signs", 1.2)],
  ["adjust reality", onCaster("jb2a.magic_signs", 1.2)],
  ["book of", onCaster("jb2a.magic_signs", 1.2)],
  ["wall walk", onCaster("jb2a.magic_signs", 1.2)],
  ["confusing aura", onCaster("jb2a.aura_themed", 1.4)],
  ["sand", onTarget("jb2a.smoke", 1.4)],
  ["wind", onTarget("jb2a.wind_stream", 1.5)],

  // Sage: growing things.
  ["vicious entangle", onTarget("jb2a.entangle", 1.4)],
  ["forest sprites", onCaster("jb2a.fairies", 1.4)],
  ["wild fortress", onCaster("jb2a.plant_growth", 1.6)],
  ["force of nature", onCaster("jb2a.swirling_leaves", 1.4)],
  ["thorn", onTarget("jb2a.entangle", 1.3)],

  // Splendor: healing and wards.
  ["healing field", onTarget("jb2a.healing_generic", 1.4)],
  ["restoration", onTarget("jb2a.healing_generic", 1.3)],
  ["invigoration", onTarget("jb2a.healing_generic", 1.3)],
  ["recovery", onTarget("jb2a.healing_generic", 1.3)],
  ["vitality", onCaster("jb2a.healing_generic", 1.3)],
  ["life ward", onTarget("jb2a.ward", 1.3)],
  ["shield aura", onCaster("jb2a.shield", 1.3)],
  ["safe haven", onCaster("jb2a.aura_themed", 1.6)],
  ["mending", onTarget("jb2a.healing_generic", 1.3)],
  ["weave the flesh", onTarget("jb2a.healing_generic", 1.3)],

  // Midnight: shadow and misdirection.
  ["shadowbind", onTarget("jb2a.black_tentacles", 1.4)],
  ["death grip", onTarget("jb2a.black_tentacles", 1.4)],
  ["specter of the dark", onTarget("jb2a.arms_of_hadar", 1.5)],
  ["twilight toll", onTarget("jb2a.toll_the_dead", 1.3)],
  ["umbra veil", onCaster("jb2a.smoke", 1.4)],
  ["uncanny disguise", onCaster("jb2a.shimmer", 1.2)],
  ["invisibility", onCaster("jb2a.shimmer", 1.2)],
  ["disguised", onCaster("jb2a.shimmer", 1.2)],
  ["swift step", onCaster("jb2a.misty_step", 1.3)],
  ["hidden", onCaster("jb2a.shimmer", 1.2)],

  // Valor and Bone: guarding, rallying, seeing.
  ["unyielding armor", onCaster("jb2a.ward", 1.3)],
  ["fortified armor", onCaster("jb2a.ward", 1.3)],
  ["unbreakable", onCaster("jb2a.ward", 1.3)],
  ["brace", onCaster("jb2a.shield", 1.2)],
  ["battle cry", onCaster("jb2a.bardic_inspiration", 1.3)],
  ["rise up", onCaster("jb2a.bardic_inspiration", 1.3)],
  ["lead by example", onCaster("jb2a.bardic_inspiration", 1.3)],
  ["inspirational words", onCaster("jb2a.bardic_inspiration", 1.3)],
  ["reassurance", onTarget("jb2a.bardic_inspiration", 1.2)],
  ["lean on me", onTarget("jb2a.bardic_inspiration", 1.2)],
  ["voice of reason", onCaster("jb2a.bardic_inspiration", 1.2)],
  ["a soldier", onCaster("jb2a.bardic_inspiration", 1.2)],
  ["boost", onTarget("jb2a.on_token_buff", 1.2)],
  ["shrug it off", onCaster("jb2a.on_token_buff", 1.2)],
  ["premonition", onCaster("jb2a.detect_magic", 1.2)],
  ["i see it coming", onCaster("jb2a.detect_magic", 1.2)],
  ["sensory projection", onCaster("jb2a.detect_magic", 1.3)],
  ["know thy enemy", onTarget("jb2a.markers", 1.2)],
  ["floating eye", onCaster("jb2a.eyes", 1.2)],
  ["through your eyes", onCaster("jb2a.eyes", 1.2)],
  ["flight", onCaster("jb2a.swirling_feathers", 1.4)],
  ["enraptured", onTarget("jb2a.swirling_sparkles", 1.3)],
  ["enrapture", onTarget("jb2a.swirling_sparkles", 1.3)],
  ["transcendent union", onCaster("jb2a.twinkling_stars", 1.4)],
  ["redirect", ranged("jb2a.energy_beam")],

  // The Void.
  ["burning gore", onTarget("jb2a.flames", 1.4)],
  ["damnation", onTarget("jb2a.arms_of_hadar", 1.5)],
  ["eldritch flesh", onCaster("jb2a.eldritch_blast", 1.3)],
  ["grisly harpoon", ranged("jb2a.spear.throw")],
  ["chains of affliction", onTarget("jb2a.markers", 1.3)],
  ["parasite of the will", onTarget("jb2a.condition", 1.3)],
  ["shared trauma", ranged("jb2a.energy_beam")],
  ["siphon essence", ranged("jb2a.energy_strands")],
  ["scabrous adamance", onCaster("jb2a.ward", 1.3)],
  ["power through pain", onCaster("jb2a.on_token_buff", 1.2)],
  ["viscous form", onCaster("jb2a.liquid", 1.3)],

  // Stragglers that do have something to show.
  ["chokehold", onTarget("jb2a.unarmed_strike.physical", 1.4)],
  ["ground pound", onTarget("jb2a.ground_cracks", 1.6)],
  ["telepathy", onCaster("jb2a.magic_signs", 1.2)],
  ["wrangle", onTarget("jb2a.entangle", 1.3)],

  // Every domain's "-Touched" card. Last, so a more specific card wins first.
  ["-touched", onCaster("jb2a.on_token_buff", 1.2)],
];
