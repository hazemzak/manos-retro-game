// Manos Retro Game -- Milestone 1: walk, jump, RTL scroll, ground collision.
// No enemies, no goal, no lyric-as-world-object system yet -- later milestones.

const SPEED = 260;
const JUMP_VELOCITY = -750;
const GRAVITY_Y = 1800;
const PROJECTILE_SPEED = 700;
const PROJECTILE_TTL_MS = 3000;
const PROJECTILE_WORLD_MARGIN = 50;
// One body-relative launch point for every player shot. Measured from the heart gesture's
// release pose: (0.877 - 0.5) * 405 / 386 body-heights forward, and
// (1 - 0.197) * 408 / 386 body-heights above the player's bottom-centre root. The
// reference body height is independent of the active sheet's canvas, so changing level,
// gesture type or singing frame cannot move this socket around Manos's body.
const PLAYER_PROJECTILE_SOCKET = Object.freeze({
  forwardBodyHeights: 0.3955,
  upBodyHeights: 0.8488,
});
// The design canvas every fixed-screen level is composed against (the Phaser.Game
// width/height at the bottom of this file reads it). No level scrolls, so this doubles as
// the world bounds and the camera bounds -- and it is the new environment plates' own
// 1280x720, so plate-local coordinates (blocking_coordinates.json) ARE world coordinates.
const STAGE_VIEW = { width: 1280, height: 720 };
// INTERIM (2026-09-10): placements still waiting on design calls (the band, the crowd,
// Theatre's spawn side, Party's percussionist) were never re-blocked against the new
// plates. Their old 1376x768 numbers are converted proportionally so they keep their place
// in the frame; every call site of these two is a value to replace once measured.
const interimX = (x) => x * 1280 / 1376;
const interimY = (y) => y * 720 / 768;
// THE tempo of assets/audio/manos_theme.mp3, and the only one in this file: everything
// musical below derives from it. Re-measured 2026-09-10 by a linear fit over all 363
// beats librosa tracked (124.0008 BPM, 4.4ms rms residual, beat grid phase-aligned to
// t=0 within 9ms). This supersedes RUN 20's 123.05, which was not the song's real tempo
// but librosa's own lag-grid quantization (21 hops x 512/22050s = 0.4876s); at 3.7ms per
// beat that error walks a full beat away from the track inside a minute of play, which
// would have visibly desynced the heart cadence from the background pulse.
const SONG_BPM = 124;
const BEAT_MS = 60000 / SONG_BPM;    // 483.87ms
const BAR_MS = 4 * BEAT_MS;          // 1935.48ms -- one background loop, 8 frames of an 8th note each
// The M-key's tempo-synced heart cadence (RUN 20), now off the same constant as the
// backgrounds so the two can never drift apart. Swap the commented line in for a
// once-per-2-beats feel if the on-beat cadence reads too fast -- Hazem compares by ear.
const HEART_FIRE_INTERVAL_MS = BEAT_MS;      // ~483.87ms (once per beat)
// const HEART_FIRE_INTERVAL_MS = 2 * BEAT_MS;  // ~967.74ms (half-tempo alternative)
// Each value is 8 separate 1280x720 images, not a sheet: an 8-frame strip (10240px) or a
// 4x2 grid (5120x1440) would exceed the 4096px texture limit of mobile GPUs.
const LEVEL_BACKGROUND_KEYS = ['level1_fara7_bg', 'level2_theatre_bg', 'level3_party_bg'];
// Band walk-in sheets, texture key -> animation key. Kept in one place because three
// separate passes need the same list (the loader in create(), the anims in buildLevel(),
// and the Level 1 roster below), and because they are registered in assets.json by a
// separate asset pass -- every consumer here is written to tolerate a key being absent.
const ACTOR_WALK_IN_ANIMS = {
  musician_drums_walkin: 'musicianDrumsWalkInAnim',
  musician_keyboard_walkin: 'musicianKeyboardWalkInAnim',
  musician_accordion_walkin: 'musicianAccordionWalkInAnim',
  tabla_player_walkin: 'tablaPlayerWalkInAnim',
};
const ACTOR_WALK_IN_SHEETS = Object.keys(ACTOR_WALK_IN_ANIMS);
// The four band members' "playing their instrument" loops -- the terminal visual an actor
// holds forever once it has been hit to threshold, gone dizzy and faded through. Level-
// AGNOSTIC on purpose, exactly like ACTOR_WALK_IN_ANIMS above: the same four sheets are
// used by Level 1 and Level 3, so duplicating them into both per-level tables would give
// two copies to keep in sync. Included once in ALL_ANIM_GROUPS, which is what gets the
// loader in create() and the anims pass in buildLevel() for free.
//
// 8fps/repeat:-1 is this file's convention for every idle/love/performance loop. Three of
// these four keys are registered by a separate asset pass, so -- like the walk-ins -- every
// consumer here tolerates a key being absent (an actor whose playing sheet is missing keeps
// the old dizzy-hold behaviour instead of crashing).
const BAND_PERFORMANCE_ANIM_GROUP = {
  frameRate: 8,
  repeat: -1,
  sheets: {
    musician_drums_playing: 'musicianDrumsPlayingAnim',
    musician_keyboard_playing: 'musicianKeyboardPlayingAnim',
    musician_accordion_playing: 'musicianAccordionPlayingAnim',
    tabla_player_playing: 'tablaPlayerPlayingAnim',
  },
};
// Player sheets are never overwritten during a level handoff. Each physical idle and
// singing strip owns a texture/animation key, while semantic selection lives in
// getPlayerVisual() below.
const PLAYER_IDLE_ANIM_GROUP = {
  frameRate: 4,
  repeat: -1,
  sheets: {
    idle_fara7: 'idleFara7Anim',
    idle_theatre: 'idleTheatreAnim',
    idle_party: 'idlePartyAnim',
  },
};
const PLAYER_SINGING_ANIM_GROUP = {
  frameRate: 8,
  repeat: -1,
  sheets: {
    singing_fara7: 'singingFara7Anim',
    singing_theatre: 'singingTheatreAnim',
    singing_party: 'singingPartyAnim',
  },
};
const PLAYER_DEATH_ANIM_GROUP = {
  frameRate: 8,
  repeat: 0,
  sheets: { dizzy_death: 'dizzyDeathAnim' },
};
// Boss-kiss sequence (docs/LEVEL3_BOSS_SEQUENCE_SPEC.md): the hit reaction is a one-shot whose
// animationcomplete drives the next state; the two singing states loop until something cuts them.
const PLAYER_BOSS_HIT_ANIM_GROUP = {
  frameRate: 8,
  repeat: 0,
  sheets: { dizzy_hit: 'dizzyHitAnim' },
};
const PLAYER_BOSS_SINGING_ANIM_GROUP = {
  frameRate: 8,
  repeat: -1,
  sheets: { dizzy_singing: 'dizzySingingAnim', floor_singing: 'floorSingingAnim' },
};
const PLAYER_LEVEL_REFERENCE_HEIGHTS = Object.freeze({
  fara7: 233.4,
  theatre: 143.2,
  party: 176.0,
});
const PLAYER_VISUALS = Object.freeze({
  idle: Object.freeze({
    fara7: Object.freeze({ textureKey: 'idle_fara7', animationKey: 'idleFara7Anim' }),
    theatre: Object.freeze({ textureKey: 'idle_theatre', animationKey: 'idleTheatreAnim' }),
    party: Object.freeze({ textureKey: 'idle_party', animationKey: 'idlePartyAnim' }),
  }),
  singing: Object.freeze({
    fara7: Object.freeze({ textureKey: 'singing_fara7', animationKey: 'singingFara7Anim' }),
    theatre: Object.freeze({ textureKey: 'singing_theatre', animationKey: 'singingTheatreAnim' }),
    party: Object.freeze({ textureKey: 'singing_party', animationKey: 'singingPartyAnim' }),
  }),
  walk: Object.freeze({ textureKey: 'walk', animationKey: 'walkAnim' }),
  jump: Object.freeze({ textureKey: 'jump', animationKey: 'jumpAnim' }),
  heart: Object.freeze({ textureKey: 'gesture_heart', animationKey: 'giveHeartAnim' }),
  flowers: Object.freeze({ textureKey: 'gesture_flowers', animationKey: 'giveFlowersAnim' }),
  phone_pull: Object.freeze({ textureKey: 'phone_pull', animationKey: 'phonePullAnim' }),
  phone_read: Object.freeze({ textureKey: 'phone_read', animationKey: 'phoneReadAnim' }),
  phone_check_idle: Object.freeze({ textureKey: 'phone_check_idle', animationKey: 'phoneCheckIdleAnim' }),
  dizzy_love: Object.freeze({ textureKey: 'dizzy_love', animationKey: 'dizzyLoveAnim' }),
  dizzy_death: Object.freeze({ textureKey: 'dizzy_death', animationKey: 'dizzyDeathAnim' }),
  // --- Package G boss-kiss sequence (docs/LEVEL3_BOSS_SEQUENCE_SPEC.md) -----------------
  // State 3 -- the kiss lands: one-shot stagger that recovers to standing on its last frame.
  dizzy_hit: Object.freeze({ textureKey: 'dizzy_hit', animationKey: 'dizzyHitAnim' }),
  // State 4 -- dizzy-in-love and singing at once (loop, ended by BOSS_KISS_SINGING_HOLD_MS).
  dizzy_singing: Object.freeze({ textureKey: 'dizzy_singing', animationKey: 'dizzySingingAnim' }),
  // State 6 -- singing on the floor after the collapse (loop). Its scale is pinned to
  // dizzy_death's in assets.json so the death -> floor cut keeps the same body size.
  floor_singing: Object.freeze({ textureKey: 'floor_singing', animationKey: 'floorSingingAnim' }),
});
// Boss-kiss sequence timing (docs/LEVEL3_BOSS_SEQUENCE_SPEC.md). dizzy_hit is a one-shot and
// hands off on its own animationcomplete; dizzy_singing is a loop with no natural end, so this
// hold is what times the collapse.
const BOSS_KISS_SINGING_HOLD_MS = 3000;
// dizzy_hit is 8 frames at 8fps (~1.0s), so this only fires if its animationcomplete never does.
const BOSS_KISS_HIT_FALLBACK_MS = 1500;
// "From her forehead" (spec), as a fraction of her measured content height above her foot
// line. No measured forehead anchor exists -- her attack art is still ungenerated -- so this
// is a stand-in approximation, not a plate mark.
const BOSS_KISS_FOREHEAD_HEIGHT_RATIO = 0.92;
// The keyboardist's cue-specific walk and ecstatic standing-rock loops. They are kept in
// the same grouped loader/animation path as the ordinary instrument-playing sheets, but
// split by cadence: the travelling pose matches every other 10fps walk while the standing
// pose matches the game's 8fps performance loops.
const KEYBOARD_SOLO_ANIM_GROUPS = {
  standing: {
    frameRate: 8,
    repeat: -1,
    sheets: { musician_keyboard_solo_standing: 'musicianKeyboardSoloStandingAnim' },
  },
  walking: {
    frameRate: 10,
    repeat: -1,
    sheets: { musician_keyboard_solo_walking: 'musicianKeyboardSoloWalkingAnim' },
  },
};
const KEYBOARD_SOLO_VISUALS = {
  standing: {
    textureKey: 'musician_keyboard_solo_standing',
    animationKey: KEYBOARD_SOLO_ANIM_GROUPS.standing.sheets.musician_keyboard_solo_standing,
  },
  walking: {
    textureKey: 'musician_keyboard_solo_walking',
    animationKey: KEYBOARD_SOLO_ANIM_GROUPS.walking.sheets.musician_keyboard_solo_walking,
  },
};
// The bounded dizzy window between "third hit lands" and "starts playing". A REAL timer,
// not "one cycle of whatever the dizzy sheet happens to be" -- the dizzy loops run at 8fps
// with differing frame counts, so the old animationrepeat trigger gave each character a
// different, art-dependent hold. 1500ms + the two 250ms fades puts the whole beat at 2s.
const ACTOR_DIZZY_HOLD_MS = 1500;
// Per-SPRITE alpha fade (a tween on the actor's own alpha), deliberately not the camera
// fade this file uses for LEVEL transitions -- one band member changing texture must not
// dim the rest of the scene.
const ACTOR_PERFORM_FADE_MS = 250;

// The performance visual for one band sheet, in the same {textureKey, animationKey} shape
// every other actor visual uses so setActorVisual() consumes it verbatim -- plus the
// `kind` that beginActorPerformance() dispatches on. Returns null for any key not in the
// table above, which is what keeps sopranos and the boss out of the instrument path.
// Whether the sheet is actually LOADED is a separate question, answered once in
// buildInteractiveActors() against this.cfg.sprites.
// `performanceHeight`, when given, becomes this visual's OWN displayContentHeight
// (Package E's per-visual-height override -- see setActorVisual()): the plate's seated-
// playing pose and its derived standing pose differ by ~1.3x for the same actor, so the
// instrument-playing visual needs its own reference height rather than inheriting the
// actor spec's standing default.
function bandPerformanceVisual(textureKey, performanceHeight) {
  const animationKey = BAND_PERFORMANCE_ANIM_GROUP.sheets[textureKey];
  if (!animationKey) return null;
  const visual = { kind: 'instrument', textureKey, animationKey };
  if (performanceHeight !== undefined) visual.displayContentHeight = performanceHeight;
  return visual;
}

// Level 1 (El Fara7) geometry. Measured numbers come from
// assets/generated/environments/hz-test-regen/blocking_coordinates.json (plate-local
// 1280x720 == world); everything wrapped in interimX/interimY is an old 1376x768 value
// proportionally converted and still waiting on a design call.
//
// The new plate is a raised wedding deck: carpet top y 528.7 (back) .. 566.2 (front lip),
// deck front face 571.6..648.8, then plaza pavement. Manos stands on the front lip.
const FARA7 = {
  // Manos's ground line = the deck's front lip (measured, high confidence). Also the
  // ground collider's top edge.
  groundY: 566.2,
  // Only the keyboard solo's temporary "walk toward the player" hand-off uses this shared
  // line now (updateLevel1KeyboardSolo()) -- the band's own marks are FARA7.band below,
  // each with its own measured foot line. Still INTERIM (no plate reference for a mid-
  // stage walk-up mark): the old 628 front lip, converted.
  stageFootY: interimY(628),
  // Measured (BLOCKING_COORDINATES.md), per band member: footX/footY, the derived
  // STANDING height (idle/walk-in/dizzy) and the plate's measured seated PERFORMANCE
  // height (the playing-instrument loop). Package E: per-visual heights (see
  // bandPerformanceVisual()/setActorVisual()) are what let one actor use both numbers.
  // Owner decision: accordion and drums sit exactly on these marks even though the
  // accordionist's chair leg lands at the deck edge and the drums sit on carpet that only
  // exists in the populated plate -- exactness wins over comfort here.
  band: {
    accordion: { footX: 187.6, footY: 562.4, standingHeight: 204.4, performanceHeight: 155.3 },
    keyboard: { footX: 306.2, footY: 561.6, standingHeight: 216.5, performanceHeight: 164.5 },
    tabla: { footX: 956.9, footY: 561.6, standingHeight: 198.3, performanceHeight: 150.7 },
    drums: { footX: 1102.4, footY: 562.4, standingHeight: 193.3, performanceHeight: 157.7 },
  },
  // INTERIM: play area between the band and the couple ("confinement", GAME_PLAN section
  // 0; it LIFTS for the scripted exit). Old 610..950, converted.
  walkMinX: interimX(610),
  walkMaxX: interimX(950),
  // Measured Manos mark (BLOCKING_COORDINATES.md); falls inside walkMinX..walkMaxX above.
  playerSpawnX: 581.8,
  // INTERIM (band entrances): stage-RIGHT entry mark just off the right screen edge. Every
  // walk-in sheet draws its character walking LEFT, so an actor entering here travels left
  // with the art unflipped.
  wingX: interimX(1330),
  // INTERIM: stage-LEFT entry mark, the mirror of wingX. An actor entering from here has
  // its walk-in sheet flipped (setFlipX) so the left-facing art reads as walking RIGHT.
  leftWingX: interimX(30),
  entranceSpeedPxPerSecond: 220,
  // The bride/groom heart-chair (fara7_couple_heart_chair_idle), measured: chair centre,
  // chair-feet line, content height (scale 0.2951).
  couple: { x: 759.4, footY: 558.6, contentHeight: 140.8 },
};
// Background furthest back; the band and wedding-party dressing sit behind the hero.
// crowd sits in FRONT of the band/dressing/hero (RUN 21's foreground crowd, per
// the reference photo's own composition) -- see projectileForegroundDepth and
// getProjectileDepth() for why thrown projectiles need their own depth above this,
// or a low throw would render behind it.
const FARA7_DEPTH = { background: -10, band: -5, dressing: -4, crowd: 1 };

// Level 1's own sheets, same grouped shape (and same three consumers) as
// LEVEL2_ANIM_GROUPS below. The band's idle/love loops are NOT here -- they predate this
// table and are still registered one by one in buildLevel().
const LEVEL1_ANIM_GROUPS = {
  loops: {
    frameRate: 8,
    repeat: -1,
    sheets: {
      tabla_player_standing_idle: 'tablaPlayerIdleAnim',
      tabla_player_dizzy_love: 'tablaPlayerLoveAnim',
      husband_groom_seated_idle: 'groomSeatedAnim',
      wife_bride_seated_idle: 'brideSeatedAnim',
    },
  },
  // RUN 21: the 4 new foreground crowd groups (3 men each), deliberately its own
  // slow loop -- a much lower frame rate than every other cast loop here, since
  // this is meant to read as secondary/background motion (a restrained clap or
  // a small sway), not full character-animation fidelity.
  crowd: {
    frameRate: 4,
    repeat: -1,
    sheets: {
      fara7_crowd_group_a: 'fara7CrowdGroupAAnim',
      fara7_crowd_group_b: 'fara7CrowdGroupBAnim',
      fara7_crowd_group_c: 'fara7CrowdGroupCAnim',
      fara7_crowd_group_d: 'fara7CrowdGroupDAnim',
    },
  },
  // RUN 22: the combined bride/groom heart-chair sprite. Same slow secondary-motion rate
  // as crowd -- this is a subtle idle blink loop, not full character animation.
  dressing: {
    frameRate: 4,
    repeat: -1,
    sheets: {
      fara7_couple_heart_chair_idle: 'fara7CoupleHeartChairIdleAnim',
    },
  },
};

// Level 0 (cassette shop) intro reservation: 0:00-0:15 before Fara7 gameplay starts.
const LEVEL0_INTRO_SECONDS = 15;

// Ground-truth cue timings: the Level 1 keyboard solo begins at 0:50 and Manos's existing
// phone exit follows at 0:53. The solo overlaps the call instead of delaying it.
const KEYBOARD_SOLO_SECONDS = 50;
const LEVEL1_PHONE_SECONDS = 53;
const LEVEL1_WALK_OFF_SECONDS = 62;
const THEATRE_KEYBOARD_SOLO_SECONDS = 120;
const THEATRE_PHONE_SECONDS = 113;
const THEATRE_EXIT_CLEARANCE_PX = 1;
const KEYBOARD_SOLO_WALK_SPEED = 260;
// Used only when the non-blocking audio path never starts playback, so the silent
// fallback timeline can still reach the GAME_PLAN's song-end credits beat.
const SILENT_TRACK_SECONDS = 183.92816326530613;
const CREDITS_SCROLL_DURATION_MS = 16000;

// Level 2 (Theatre) geometry, measured off the new plate (blocking_coordinates.json,
// plate-local 1280x720 == world) except the interimX/interimY values. The new plate has
// NO apron strip: the stage nosing drops straight into the seating, so Manos, the trio and
// the mic all stand on the stage floor's front lip (stage floor x 405.7..863.5 at the lip).
// The shared target-guided projectile flight still reaches the cast from there.
const THEATRE = {
  // The sopranos' foot line: P4's measured safe performer foot line (deck front edge y=457,
  // audience heads from y=456; theatre_geometry_2026-09-12.md).
  stageFootY: 454.0,
  // The mic stand's foot (MIC_ANCHOR's frame point): same P4 safe foot line.
  micFootY: 454.0,
  // Manos's ground line (plate row 593) and the ground collider's top edge. Name kept
  // from the old apron strip, which the new plate does not have.
  apronFootY: 454.2,
  // Package E: the box is now built AROUND the measured stage-right spawn below (765.6)
  // rather than the old stage-left one -- walkMaxX gives him a little room to either side
  // of his own mark, walkMinX is unchanged (still short of the wing, staging, no plate
  // reference for a play-area edge). The soprano pre-mic waiting marks (see
  // buildTheatreActors()) were moved clear of this whole box in the same pass.
  walkMinX: interimX(480),
  walkMaxX: 790.7,
  // Measured: Manos 143.2px tall on the plate / idle contentHeight 346.
  playerScale: 0.414,
  // Measured (BLOCKING_COORDINATES.md): the plate stands him stage-RIGHT of the trio.
  // Was interimX(507) (stage-left of the mic, the wrong side) -- see enterLevel2()'s
  // matching flipX(true), which now faces him at the cast on his left.
  playerSpawnX: 765.6,
  // Measured per soprano (the engine allows one height per actor). Green leans into the
  // mic on the plate, so she takes gold's standing height.
  sopranoContentHeights: { gold: 139.4, green: 139.4, red: 145.5 },
  // The mic composite's content height in setActorVisual()'s fixed-anchor form: the
  // measured scale 0.3181 x MIC_ANCHOR.refContentHeight (441).
  micContentHeight: 140.3,
  // INTERIM: stage-left entry mark (old 470), converted.
  wingX: interimX(470),
  entranceSpeedPxPerSecond: 130,
  // The shared mic stand's world x: the stand foot on the plate (plate x 710).
  micX: 543.5,
};
// Fixed admission order for the shared mic, by actor id -- gold sings solo first, green
// joins her, red last. Tracked by IDENTITY, never by roster index (the roster is ordered
// green, gold, red) and never by "who got dizzy first".
const MIC_JOIN_ORDER = ['soprano_gold', 'soprano_green', 'soprano_red'];
// The mic composite's four states, indexed by how many sopranos have ARRIVED.
const MIC_VISUALS = [
  { textureKey: 'theatre_mic_empty', animationKey: 'theatreMicEmptyAnim' },
  { textureKey: 'theatre_mic_1', animationKey: 'theatreMicOneAnim' },
  { textureKey: 'theatre_mic_2', animationKey: 'theatreMicTwoAnim' },
  { textureKey: 'theatre_mic_3', animationKey: 'theatreMicThreeAnim' },
];
// Why the mic group needs setActorVisual()'s fixed-anchor path instead of the default
// bottom-centre-of-content normalisation every other actor uses: the four composites have
// genuinely DIFFERENT alpha bboxes (contentCenterX 256/244/208/275, contentTop 212/100/
// 100/69), so normalising each state to its own content box would slide and resize the
// stand on every swap. Both numbers below are MEASURED off frame 0 of all four sheets with
// an alpha scan, not assumed:
//  - the stand's foot occupies rows 538..541, columns 232..284 IDENTICALLY in all four, so
//    (258, 541) is one frame-space point that means "base of the stand" in every state;
//  - 441 is the gold-solo sheet's own figure height (rows 100..540). Using it as the single
//    scale reference for all four states keeps the stand exactly one size, and puts a
//    composite singer at the same height she reads standing on her own mark in either
//    level. The Party deliberately reuses this exact measured frame anchor and reference
//    height; only its world placement is provisional.
const MIC_ANCHOR = { anchorFrameX: 258, anchorFrameY: 541, refContentHeight: 441 };
// Both below the player's default depth 0, so the hero is never occluded.
const THEATRE_DEPTH = { background: -10, soprano: -5 };

// Ground-truth singing windows for Theatre sopranos:
// Phase 1: 71-88s, Phase 2: 113.98s through Theatre's exit (132s).
// Outside these windows, joined sopranos rest at their mic positions.
const THEATRE_SINGING_PHASE1_START = 71;
const THEATRE_SINGING_PHASE1_END = 88;
// PROVISIONAL: derived from assets/lyrics.json's song structure (the 113.98-134.38s
// held climax note), not a directly annotated backing-vocal cue like Phase 1. Needs
// Hazem's live confirmation and may need a follow-up one-line correction.
const THEATRE_SINGING_PHASE2_START = 113.98;

function isTheatreSingingWindow(elapsed) {
  return (elapsed >= THEATRE_SINGING_PHASE1_START && elapsed < THEATRE_SINGING_PHASE1_END)
    || (elapsed >= THEATRE_SINGING_PHASE2_START && elapsed < LEVEL3_ENTRANCE_SECONDS);
}

// Rest offsets relative to THEATRE.micX when resting around the empty stand: each
// soprano's measured body centre inside the plate's trio (545.1 / 501.4 / 585.6) minus
// the stand foot (543.5), so resting and singing put her in the same spot.
const THEATRE_SOPRANO_REST_OFFSETS = {
  soprano_gold: 1.6,
  soprano_green: -42.1,
  soprano_red: 42.1,
};

// Level 2's sheets, grouped by the animation settings they share. Same reason
// ACTOR_WALK_IN_ANIMS exists above: three passes need this identical list (the loader in
// create(), the anims pass in buildLevel(), and the roster/placements below), and they
// must never drift apart.
const LEVEL2_ANIM_GROUPS = {
  // 8fps loops -- the rate every idle/love loop already in this game uses.
  loops: {
    frameRate: 8,
    repeat: -1,
    sheets: {
      soprano_green_idle: 'sopranoGreenIdleAnim',
      soprano_gold_idle: 'sopranoGoldIdleAnim',
      soprano_red_idle: 'sopranoRedIdleAnim',
      soprano_green_dizzy: 'sopranoGreenDizzyAnim',
      soprano_gold_dizzy: 'sopranoGoldDizzyAnim',
      soprano_red_dizzy: 'sopranoRedDizzyAnim',
      // The shared mic group's four composite states. Listed here purely so the loader in
      // create() and the anims pass in buildLevel() pick them up like every other sheet --
      // the roster below does NOT read them (they belong to one standalone sprite, not to
      // any interactive actor); MIC_VISUALS above is what names them at use sites.
      theatre_mic_empty: 'theatreMicEmptyAnim',
      theatre_mic_1: 'theatreMicOneAnim',
      theatre_mic_2: 'theatreMicTwoAnim',
      theatre_mic_3: 'theatreMicThreeAnim',
    },
  },
  // 10fps -- walk cycles, same rate as walkAnim and Level 1's band walk-ins.
  walkIns: {
    frameRate: 10,
    repeat: -1,
    sheets: {
      soprano_green_walkin: 'sopranoGreenWalkInAnim',
      soprano_gold_walkin: 'sopranoGoldWalkInAnim',
      soprano_red_walkin: 'sopranoRedWalkInAnim',
    },
  },
};

// Level 3 (The Party) geometry, measured off the new plate (blocking_coordinates.json,
// plate-local 1280x720 == world) except the interimX/interimY values. The riverside deck:
// top y 501.9 (back) .. 525.7 (front lip), x 339.1..888.0 at the lip, then a stone front
// face down to the terrace with the tables. The plate stages the band upstage (feet 509.6),
// the trio at 518.0 and Manos at 521.8.
const PARTY = {
  // Manos's ground line (plate row 682) and the ground collider's top edge. The boss
  // walks up to him on the same line.
  groundY: 521.8,
  // Fallback only now -- every band member below carries its own measured footY.
  stageFootY: interimY(567),
  // The trio + mic stand line (plate row 677) -- sopranos and the stand foot.
  micFootY: 518.0,
  // Measured (BLOCKING_COORDINATES.md), per band member: footX/footY, the derived
  // STANDING height and the plate's measured seated PERFORMANCE height. tabla is the
  // task's required move to the measured stage-right percussion mark (was interimX(540),
  // stage-left). drums has NO plate figure (the plate merges tabla/drums into one
  // percussionist) -- owner decision keeps him as a 4th band member anyway, so his mark
  // below is STAGED, not measured: placed stage-left with the rest of the melodic band,
  // and his heights are derived only by applying the Fara7 drummer's own measured scale
  // through the Fara7->Party player-height ratio (176.0/233.4 = 0.754) to keep him
  // visually consistent in size with this level's other actors -- never a plate match.
  band: {
    accordion: { footX: 424.9, footY: 509.6, standingHeight: 166.1, performanceHeight: 126.2 },
    keyboard: { footX: 505.3, footY: 509.6, standingHeight: 154.0, performanceHeight: 117.1 },
    tabla: { footX: 803.8, footY: 509.6, standingHeight: 160.1, performanceHeight: 121.7 },
    drums: { footX: 300, footY: 509.6, standingHeight: 145.8, performanceHeight: 118.9 },
  },
  // INTERIM: play area between the two cast blocks (old 610..780), converted.
  walkMinX: interimX(610),
  walkMaxX: interimX(780),
  // Measured Manos mark (BLOCKING_COORDINATES.md); falls inside walkMinX..walkMaxX above.
  playerSpawnX: 585.6,
  // INTERIM (entrances): stage-RIGHT entry mark; every walk-in sheet draws its character
  // walking LEFT, so an actor entering here travels left with the art unflipped.
  wingX: interimX(1330),
  // INTERIM: stage-LEFT entry mark; actors entering here are setFlipX'd.
  leftWingX: interimX(72),
  // Faster than either earlier level (FARA7 220, THEATRE 130): SEVEN actors have to clear
  // a single shared wing between the 2:12 boot and the 2:40 boss, and they can only be
  // staggered one behind another.
  entranceSpeedPxPerSecond: 300,
  // The mic stand foot on the plate (plate x 929).
  micX: 711.2,
  // Her own dial, deliberately slower than the cast's -- the entrance is the level's one
  // dramatic beat, not another walk-on.
  bossEntranceSpeedPxPerSecond: 200,
  // Measured: Manos 176.0px tall on the plate (playerScale 0.5086).
  playerContentHeight: 176.0,
  // INTERIM (band scale held): old 140, converted.
  castContentHeight: interimY(140),
  // Measured per soprano; green leans in on the plate, so she takes gold's height.
  sopranoContentHeights: { gold: 166.8, green: 166.8, red: 166.0 },
  // The mic composite, fixed-anchor form: scale 0.3774 x 441.
  micContentHeight: 166.4,
  // Not measured (no plate figure): kept at "matches the hero", the rule this value has
  // always followed, so she reads as his equal rather than as scenery.
  bossContentHeight: 176.0,
};
// Background behind everything, cast behind the hero, and the boss between them when she
// arrives downstage of the cast.
const PARTY_DEPTH = { background: -10, cast: -5, boss: -3 };

// Level 3's own sheets. The interactive cast is NOT here -- it is the Level 1 band plus the
// Level 2 sopranos, whose sheets/anims are already registered by those two tables above.
// What is new to this level: the femme fatale and the animated (heart-marquee lit)
// background.
const LEVEL3_ANIM_GROUPS = {
  loops: {
    frameRate: 8,
    repeat: -1,
    sheets: {
      femme_fatale_idle: 'femmeFataleIdleAnim',
    },
  },
  // 10fps -- a walk cycle, same rate as every other walk-in in this file.
  walkIns: {
    frameRate: 10,
    repeat: -1,
    sheets: { femme_fatale_entrance: 'femmeFataleEntranceAnim' },
  },
};

// All three levels' grouped sheets in one flat list -- the loader in create() and the anims
// pass in buildLevel() each walk this once instead of duplicating a per-level loop.
const ALL_ANIM_GROUPS = [
  ...Object.values(LEVEL1_ANIM_GROUPS),
  ...Object.values(LEVEL2_ANIM_GROUPS),
  ...Object.values(LEVEL3_ANIM_GROUPS),
  // Once, not per level -- see the comment on the table itself.
  BAND_PERFORMANCE_ANIM_GROUP,
  PLAYER_IDLE_ANIM_GROUP,
  PLAYER_SINGING_ANIM_GROUP,
  PLAYER_DEATH_ANIM_GROUP,
  PLAYER_BOSS_HIT_ANIM_GROUP,
  PLAYER_BOSS_SINGING_ANIM_GROUP,
  ...Object.values(KEYBOARD_SOLO_ANIM_GROUPS),
];

// The two absolute song-clock beats GAME_PLAN section 0's timeline table locks for this
// level: 2:12 is the Level 2 -> Level 3 transition, 2:40 the femme fatale's entrance. Both
// are checked against getLevelElapsed() (the real shared song clock), NOT against per-level
// scene time -- same treatment KEYBOARD_SOLO_SECONDS gets in updateStageExit().
const LEVEL3_ENTRANCE_SECONDS = 132;
// Ground-truth cue: heart marquee powers on at 143s, independent of and before the 160s boss entrance.
const HEART_MARQUEE_SECONDS = 143;
const BOSS_ENTRANCE_SECONDS = 160;

const CINEMA_LYRICS_START = 60;
// Was 118.87 -- Hazem re-transcribed the real lyric alignment (2026-09-06) and confirmed
// "صار نفسي ابقى معاه" genuinely holds through 134.38s (assets/lyrics.json updated to match,
// see RUN 11 in .foreman/ledger.md), superseding the earlier 2026-09-05 "verified" boundary.
const CINEMA_LYRICS_END = 134.38;

// Android Chrome supports the in-tab Fullscreen API; iOS Safari does not (verified
// current, Sept 2026 -- WebKit has never implemented requestFullscreen outside <video>,
// Add to Home Screen is the only real fullscreen path there, handled separately via
// index.html's manifest/apple-mobile-web-app-capable tags). Must be called synchronously
// from inside a real user-gesture handler or every browser rejects it; checked for
// existence first and its rejection swallowed quietly since a no-op here is expected
// and correct on most devices, not an error.
function requestFullscreenOnce() {
  if (document.fullscreenElement) return;
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!fn) return;
  const result = fn.call(el);
  if (result && typeof result.catch === 'function') result.catch(() => {});
}

// Real user-activation is event-type-AND-pointer-type-specific (verified against MDN's
// current activation-triggering-event list, Sept 2026): `pointerdown` only counts when
// `pointerType` is "mouse"; for touch/pen it's `pointerup` (or `touchend`) that counts --
// a touch `pointerdown` carries NO real activation at all. Registering only `pointerdown`
// (an earlier pass here) would silently fail to unlock audio/fullscreen from a genuine
// first touch tap on a real phone -- the exact bug this whole file exists to fix.
// Listening to both event types covers every pointer type; every caller below already
// no-ops safely if invoked twice (see their own internal guards).
function onFirstRealGesture(fn) {
  document.addEventListener('pointerdown', fn, { once: true });
  document.addEventListener('pointerup', fn, { once: true });
}

class LevelScene extends Phaser.Scene {
  constructor() {
    super('Level');
  }

  preload() {
    this.load.json('assetsConfig', 'assets/assets.json');
  }

  create() {
    const cfg = this.cache.json.get('assetsConfig');
    this.cfg = cfg;

    // load sprite sheets now that we know their real (measured) frame sizes
    const s = cfg.sprites;
    this.load.spritesheet('walk', s.walk.file, { frameWidth: s.walk.frameWidth, frameHeight: s.walk.frameHeight });
    this.load.spritesheet('jump', s.jump.file, { frameWidth: s.jump.frameWidth, frameHeight: s.jump.frameHeight });
    this.load.spritesheet('gesture_heart', s.gesture_heart.file, { frameWidth: s.gesture_heart.frameWidth, frameHeight: s.gesture_heart.frameHeight });
    this.load.spritesheet('gesture_flowers', s.gesture_flowers.file, { frameWidth: s.gesture_flowers.frameWidth, frameHeight: s.gesture_flowers.frameHeight });
    this.load.spritesheet('phone_pull', s.phone_pull.file, { frameWidth: s.phone_pull.frameWidth, frameHeight: s.phone_pull.frameHeight });
    this.load.spritesheet('phone_read', s.phone_read.file, { frameWidth: s.phone_read.frameWidth, frameHeight: s.phone_read.frameHeight });
    this.load.spritesheet('phone_check_idle', s.phone_check_idle.file, { frameWidth: s.phone_check_idle.frameWidth, frameHeight: s.phone_check_idle.frameHeight });
    // NOTE: kiosk_vendor_idle/kiosk_vendor_love (his standing + dizzy sheets) are
    // deliberately no longer loaded. GAME_PLAN section 0 retires the vendor everywhere.
    this.load.spritesheet('musician_drums_idle', s.musician_drums_idle.file, { frameWidth: s.musician_drums_idle.frameWidth, frameHeight: s.musician_drums_idle.frameHeight });
    this.load.spritesheet('musician_drums_love', s.musician_drums_love.file, { frameWidth: s.musician_drums_love.frameWidth, frameHeight: s.musician_drums_love.frameHeight });
    this.load.spritesheet('musician_keyboard_idle', s.musician_keyboard_idle.file, { frameWidth: s.musician_keyboard_idle.frameWidth, frameHeight: s.musician_keyboard_idle.frameHeight });
    this.load.spritesheet('musician_keyboard_love', s.musician_keyboard_love.file, { frameWidth: s.musician_keyboard_love.frameWidth, frameHeight: s.musician_keyboard_love.frameHeight });
    this.load.spritesheet('musician_accordion_idle', s.musician_accordion_idle.file, { frameWidth: s.musician_accordion_idle.frameWidth, frameHeight: s.musician_accordion_idle.frameHeight });
    this.load.spritesheet('musician_accordion_love', s.musician_accordion_love.file, { frameWidth: s.musician_accordion_love.frameWidth, frameHeight: s.musician_accordion_love.frameHeight });
    this.load.spritesheet('dizzy_love', s.dizzy_love.file, { frameWidth: s.dizzy_love.frameWidth, frameHeight: s.dizzy_love.frameHeight });
    // Band walk-in sheets are registered by a separate asset pass. Skipping a key that
    // isn't in assets.json (yet) is deliberate rather than a crash: buildInteractiveActors()
    // degrades that actor to "spawns in place".
    for (const walkInKey of ACTOR_WALK_IN_SHEETS) {
      if (!s[walkInKey]) continue;
      this.load.spritesheet(walkInKey, s[walkInKey].file, { frameWidth: s[walkInKey].frameWidth, frameHeight: s[walkInKey].frameHeight });
    }
    // Both levels' whole casts plus their animated backgrounds, in one pass -- same
    // skip-if-unregistered tolerance as the band walk-ins above, so a missing sheet
    // costs one actor rather than crashing the boot on `undefined.file`.
    for (const group of ALL_ANIM_GROUPS) {
      for (const key of Object.keys(group.sheets)) {
        if (!s[key]) continue;
        this.load.spritesheet(key, s[key].file, { frameWidth: s[key].frameWidth, frameHeight: s[key].frameHeight });
      }
    }
    this.load.image('heart_icon', s.heart_icon.file);
    this.load.image('flowers_icon', s.flowers_icon.file);
    this.load.image(
      'level0_cassette_shop',
      'assets/generated/environments/level0_cassette_shop/level0_cassette_shop.jpg'
    );
    // Each level's beat-locked background loop: one texture per frame, `<key>_<index>`.
    // See showLevelBackground()/updateLevelBackground().
    for (const key of LEVEL_BACKGROUND_KEYS) {
      s[key].files.forEach((file, i) => this.load.image(`${key}_${i}`, file));
    }

    // Lyric cues (small JSON, not media -- doesn't carry the iOS media-loader hang risk
    // audio does, safe to keep in the main gating queue). Missing/malformed file is a
    // reachable state (this.cache.json.get returns undefined), guarded in buildLevel().
    this.load.json('lyricsData', 'assets/lyrics.json');

    // Audio is loaded in its OWN separate pass, started only after the game itself
    // has booted -- NOT part of the load queue that gates buildLevel(). iOS Safari has
    // a documented class of bug where its media loader intermittently hangs inside
    // Phaser's preload (audio and video both reported), which would otherwise leave
    // the entire game stuck on a black canvas forever waiting for a 'complete' event
    // that never fires. This way a hung/failed audio load only means silent music --
    // the actual game still boots and is playable.
    this.load.once('complete', () => this.buildLevel());
    this.load.start();
  }

  buildLevel() {
    const cfg = this.cfg;
    // Fixed single-screen level: the world IS the canvas, in both axes and both levels.
    // Kept as fields because updateProjectiles() culls against them.
    this.worldMinX = 0;
    this.worldMaxX = STAGE_VIEW.width;

    // Ground: one invisible static collider along the wedding deck's front lip.
    this.ground = this.add.rectangle(
      STAGE_VIEW.width / 2, FARA7.groundY + 20, STAGE_VIEW.width, 40, 0x000000, 0
    );
    this.physics.add.existing(this.ground, true);

    // Animations
    this.anims.create({
      key: 'walkAnim',
      frames: this.anims.generateFrameNumbers('walk', { start: 0, end: cfg.sprites.walk.frames - 1 }),
      frameRate: 10,
      repeat: -1,
    });
    this.anims.create({
      key: 'jumpAnim',
      frames: this.anims.generateFrameNumbers('jump', { start: 0, end: cfg.sprites.jump.frames - 1 }),
      frameRate: 10,
      repeat: -1,
    });
    this.anims.create({
      key: 'giveHeartAnim',
      frames: this.anims.generateFrameNumbers('gesture_heart', { start: 0, end: cfg.sprites.gesture_heart.frames - 1 }),
      frameRate: 8,
      repeat: 0,
    });
    this.anims.create({
      key: 'giveFlowersAnim',
      frames: this.anims.generateFrameNumbers('gesture_flowers', { start: 0, end: cfg.sprites.gesture_flowers.frames - 1 }),
      frameRate: 8,
      repeat: 0,
    });
    this.anims.create({
      key: 'phonePullAnim',
      frames: this.anims.generateFrameNumbers('phone_pull', { start: 0, end: cfg.sprites.phone_pull.frames - 1 }),
      frameRate: 10,   // matches walkAnim's rate -- the swap must be seamless mid-stride
      repeat: 0,
    });
    this.anims.create({
      key: 'phoneReadAnim',
      frames: this.anims.generateFrameNumbers('phone_read', { start: 0, end: cfg.sprites.phone_read.frames - 1 }),
      frameRate: 10,
      repeat: -1,
    });
    this.anims.create({
      key: 'phoneCheckIdleAnim',
      frames: this.anims.generateFrameNumbers('phone_check_idle', { start: 0, end: cfg.sprites.phone_check_idle.frames - 1 }),
      frameRate: 8,   // standing idle loop, matches this file's 8fps idle-loop convention
      repeat: -1,
    });
    this.anims.create({
      key: 'musicianDrumsIdleAnim',
      frames: this.anims.generateFrameNumbers('musician_drums_idle', { start: 0, end: 7 }),
      frameRate: 8,
      repeat: -1,
    });
    this.anims.create({
      key: 'musicianDrumsLoveAnim',
      frames: this.anims.generateFrameNumbers('musician_drums_love', { start: 0, end: 7 }),
      frameRate: 8,
      repeat: -1,
    });
    this.anims.create({
      key: 'musicianKeyboardIdleAnim',
      frames: this.anims.generateFrameNumbers('musician_keyboard_idle', { start: 0, end: 7 }),
      frameRate: 8,
      repeat: -1,
    });
    this.anims.create({
      key: 'musicianKeyboardLoveAnim',
      frames: this.anims.generateFrameNumbers('musician_keyboard_love', { start: 0, end: 7 }),
      frameRate: 8,
      repeat: -1,
    });
    this.anims.create({
      key: 'musicianAccordionIdleAnim',
      frames: this.anims.generateFrameNumbers('musician_accordion_idle', { start: 0, end: 7 }),
      frameRate: 8,
      repeat: -1,
    });
    this.anims.create({
      key: 'musicianAccordionLoveAnim',
      frames: this.anims.generateFrameNumbers('musician_accordion_love', { start: 0, end: 7 }),
      frameRate: 8,
      repeat: -1,
    });
    // frameRate 10 matches walkAnim -- these are walk cycles, not the 8fps idle/love loops.
    for (const [walkInKey, animKey] of Object.entries(ACTOR_WALK_IN_ANIMS)) {
      if (!cfg.sprites[walkInKey]) continue;
      this.anims.create({
        key: animKey,
        frames: this.anims.generateFrameNumbers(walkInKey, { start: 0, end: cfg.sprites[walkInKey].frames - 1 }),
        frameRate: 10,
        repeat: -1,
      });
    }
    // Both casts + both backgrounds, from the same grouped tables the loader above reads.
    for (const group of ALL_ANIM_GROUPS) {
      for (const [key, animKey] of Object.entries(group.sheets)) {
        if (!cfg.sprites[key]) continue;
        this.anims.create({
          key: animKey,
          frames: this.anims.generateFrameNumbers(key, { start: 0, end: cfg.sprites[key].frames - 1 }),
          frameRate: group.frameRate,
          repeat: group.repeat,
        });
      }
    }
    this.anims.create({
      key: 'dizzyLoveAnim',
      frames: this.anims.generateFrameNumbers('dizzy_love', { start: 0, end: 7 }),
      frameRate: 8,
      repeat: -1,
    });

    // The wedding-stage loop, 1280x720 frames drawn 1:1 on the canvas.
    this.levelBg = null;
    this.showLevelBackground('level1_fara7_bg', FARA7_DEPTH.background);
    // Fara7's foreground crowd is a composition layer in front of the hero. The common
    // projectile-depth resolver lifts shots above it; levels without such a layer clear
    // this value during their transition.
    this.projectileForegroundDepth = FARA7_DEPTH.crowd;

    // Player spawns centre stage, under the heart marquee.
    // Spawn ABOVE the ground line (not on/inside it) so Arcade Physics resolves a real
    // fall-and-land collision -- spawning already overlapping the collider leaves the body
    // "embedded" and onFloor() never becomes true.
    this.player = this.physics.add.sprite(FARA7.playerSpawnX, FARA7.groundY - 150, 'walk', 0);
    this.player.setOrigin(0.5, 1);
    this.playerReferenceHeight = PLAYER_LEVEL_REFERENCE_HEIGHTS.fara7;
    this.playPlayerVisual('idle', 'fara7');
    this.player.setCollideWorldBounds(true);

    this.physics.add.collider(this.player, this.ground);

    // No scroll, in either level: fixed bounds on the canvas, camera parked on its centre.
    this.physics.world.setBounds(0, 0, STAGE_VIEW.width, STAGE_VIEW.height);
    this.cameras.main.stopFollow();
    this.cameras.main.setFollowOffset(0, 0);
    this.cameras.main.setBounds(0, 0, STAGE_VIEW.width, STAGE_VIEW.height);
    this.cameras.main.centerOn(STAGE_VIEW.width / 2, STAGE_VIEW.height / 2);

    this.passiveAudience = [];
    this.buildFara7Actors();
    this.buildFara7Crowd();      // pushes into the array initialized above
    this.buildFara7Dressing();   // pushes into the same array

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyA = this.input.keyboard.addKey('A');
    // Note: 'D' used to double as a right-movement key (WASD-style) alongside the arrow
    // keys. Repurposed to the dizzy gesture below -- arrow keys already cover movement
    // fully, so nothing is lost, and D now has one unambiguous meaning.
    this.keyL = this.input.keyboard.addKey('L');
    this.keyF = this.input.keyboard.addKey('F');
    this.keyD = this.input.keyboard.addKey('D');
    this.keyM = this.input.keyboard.addKey('M');
    this.mSequenceActive = false;
    this.debugRapidFireAccumMs = 0;

    this.gesture = null; // null | 'heart' | 'flowers' | 'dizzy'
    this.gestureCompleteEvent = null;
    this.gestureCompleteHandler = null;
    this.gestureTimer = null;

    // Touch overlay state (mobile, no keyboard). Movement/jump are held-button flags
    // (set true on pointerdown, false on pointerup/leave/cancel) mirroring how the
    // keyboard's isDown checks already work. Gesture flags are edge-triggered -- set
    // true on pointerdown, read once by update() and reset to false there, mirroring
    // Phaser.Input.Keyboard.JustDown semantics for the L/F/D keys.
    this.touchState = { left: false, right: false, jump: false, heart: false, flowers: false, dizzy: false };
    this.setupTouchControls();

    // Background music -- loaded in its own pass, kicked off only now that the game
    // has actually booted (see the comment in create() for why: iOS Safari's media
    // loader has a documented tendency to hang mid-preload, which must never be
    // allowed to block the game itself from starting).
    this.musicStarted = false;
    this.songEnded = false;
    this.songEndElapsed = null;
    this.load.audio('theme', 'assets/audio/manos_theme.mp3');
    this.load.once('complete', () => this.setupMusic());
    this.load.start();

    // Level 1's clock: this.music.seek WHEN PLAYING, falling back to wall-clock time
    // since the first real interaction otherwise. Required because the audio-loading
    // system is deliberately built to tolerate music never loading at all (the iOS
    // Safari fix above) -- a clock that only worked via music.seek could simply never
    // reach the completion trigger, leaving the level unbounded. This listener is
    // independent of setupMusic()/the audio load succeeding.
    this.levelClockStart = null;
    const startLevelClock = () => { if (this.levelClockStart === null) this.levelClockStart = this.time.now; };
    // document, not this.input: Phaser's InputPlugin only receives pointer events that
    // land on the game CANVAS. The on-screen touch-control buttons (#btn-left etc.) are
    // separate DOM elements outside the canvas with their own pointerdown handlers
    // (setupTouchControls() below) -- a mobile player's first-ever interaction is almost
    // always a tap on one of those buttons (there's no keyboard), which a canvas-scoped
    // listener never sees. `document` catches the bubbled event regardless of which
    // element was actually tapped (the button handlers call preventDefault(), not
    // stopPropagation(), so the event still bubbles up; preventDefault also does not
    // revoke the browser's real user-gesture/activation state, which is what the
    // fullscreen request and audio unlock below both also depend on).
    onFirstRealGesture(startLevelClock);
    this.input.keyboard.once('keydown', startLevelClock);
    onFirstRealGesture(requestFullscreenOnce);
    this.input.keyboard.once('keydown', requestFullscreenOnce);

    // Level 0 (Intro) state
    this.introActive = false;
    this.introDone = false;
    this.introBg = null;

    // Phone-call cutscene / stage-exit state -- generalized across levels.
    // See startPhoneCutscene(), onFadeOut(), isPhonePresentationCurrent(), cancelPhonePresentation().
    this.cutsceneActive = false;   // true from either phone handoff through its fade
    this.fadedOut = false;         // one-shot latch for Level 1 exit
    this.phoneOwner = null;        // 'level1' | 'theatre' | null
    this.phoneDestination = null;  // callback executed on camerafadeoutcomplete
    this.phoneFadedOut = false;    // per-session fade latch
    this.level2Active = false;     // true once the fixed interior has been installed
    this.level2Revealing = false;  // blocks input until the interior fade-in completes
    this.holdPosition = false;
    // Level 3 (Party) state -- same three-flag shape as Level 2's above.
    // level3Requested is the 2:12 one-shot latch; level3Revealing covers BOTH halves of the
    // transition (the fade-out from the Theatre and the fade-in on the Party), so the
    // player is frozen for the whole handover rather than only after it.
    this.level3Active = false;
    this.level3Revealing = false;
    this.level3Requested = false;
    this.heartMarqueeTriggered = false; // 143s heart-cue one-shot trigger
    this.partyBgLit = false;            // guard preventing swapToLitPartyBackground double-fire
    // The femme fatale. Deliberately NOT a member of this.interactiveActors -- that is what
    // structurally guarantees she can never be hit-counted or made dizzy (the same
    // guarantee used by other non-roster scenery), rather than a flag that a
    // future edit to the shared machinery could forget to check. See tryHitBoss().
    this.boss = null;
    // Separate Level 2 and Level 3 mic groups. Each owns its own walker latch and joined
    // ids, and neither is an interactive actor or participates in hit testing.
    this.theatreMic = null;
    this.partyMic = null;
    this.theatreSingingActive = false;  // gated to [79, 88) and [96, 132)
    this.bossRequested = false;
    this.bossNoFlinchRequested = false;   // recorded for a future real no-flinch reaction
    // Package G: one-shot latch so the kiss projectile is never spawned twice, plus the
    // dizzy -> dizzy-singing hold state between "kiss lands" and "the actual collapse" (see
    // handleBossKissImpact()). Gates the same movement/gesture branches manosDefeated does,
    // but is set BEFORE manosDefeated so he can visibly react before he is actually defeated.
    this.bossKissRequested = false;
    this.bossSequenceActive = false;
    this.bossKissHitCompleteHandler = null;
    this.bossKissHitFallbackTimer = null;
    this.bossKissSingingTimer = null;
    // Set once her attack lands. Gates every movement/gesture branch in update().
    this.manosDefeated = false;
    this.deathPending = false;
    this.deathStarted = false;
    this.deathCompleteHandler = null;
    // Scripted keyboard beats. Level 1 takes over the real roster keyboardist at 0:50;
    // Theatre creates its own non-interactive performer at 1:45. The phone latches stay
    // separate so neither performance duration can move its absolute song-clock call cue.
    this.keyboardSoloRequested = false;
    this.theatreKeyboardSoloRequested = false;
    this.theatrePhoneRequested = false;
    this.theatrePhoneStarted = false;
    this.theatreWalkOffSeconds = null;
    this.theatreKeyboardSolo = null;
    this.theatreSoloAudienceSprite = null;
    this.theatreSoloAudienceTween = null;
    this.theatreSoloAudienceRestore = null;
    this.exitSettling = false;     // handoff caught him mid-jump; finish the arc first
    this.exitPinX = null;          // the X he is held on while that arc finishes
    this.exitHoldOneTick = false;
    this.phonePresentationDone = false;  // the DOM panel has finished its whole staging
    this.phoneTimers = [];
    this.phonePullCompleteHandler = null;
    this.phoneImageLoadHandler = null;

    // Lyric cues: [{start, end, text}, ...], real timestamps against the final mix (see
    // MANOS_RETRO_GAME_SUPPORT_PLAYBOOK.md for the alignment methodology). Missing/
    // malformed data degrades to "no lyrics shown", not a crash.
    const lyricData = this.cache.json.get('lyricsData');
    const validLyrics = Array.isArray(lyricData) && lyricData.every((cue) => (
      cue && Number.isFinite(cue.start) && Number.isFinite(cue.end)
      && cue.end > cue.start && typeof cue.text === 'string'
    ));
    this.lyrics = validLyrics ? lyricData : [];
    this.lyricEl = document.getElementById('lyric-bubble');
    this.cinemaLyricEl = document.getElementById('cinema-screen-lyrics');

    // Thrown-projectile state (heart/flowers gestures). Listeners registered ONCE here,
    // not inside startGesture() -- registering per-play would stack duplicate listeners
    // and multi-spawn on every subsequent gesture.
    this.projectiles = [];
    this.player.on('animationupdate', (anim, frame) => {
      this.applyPlayerFrameAnchor(frame.textureFrame);
      if (!frame.isLast || this._projSpawned) return;
      if (anim.key === 'giveHeartAnim') { this._projSpawned = true; this.spawnProjectile('heart'); }
      else if (anim.key === 'giveFlowersAnim') { this._projSpawned = true; this.spawnProjectile('flowers'); }
    });

    this.events.once('shutdown', () => {
      this.endIntro();
      this.cancelGesture();
      this.cancelPhonePresentation();
      this.destroyTheatreKeyboardSolo();
      this.destroyInteractiveActors();
      this.destroyTheatreMic();
      this.destroyPartyMic();
      this.destroyBoss();
      this.destroyPassiveAudience();
      this.destroyProjectiles();
      this.clearDeathCompletionHandler();
      this.clearBossKissHitCompletionHandler();
      if (this.bossKissSingingTimer) { this.bossKissSingingTimer.remove(false); this.bossKissSingingTimer = null; }
      this.bossSequenceActive = false;
      this.mSequenceActive = false;
      this.debugRapidFireAccumMs = 0;
      for (const el of [this.lyricEl, this.cinemaLyricEl]) {
        if (!el) continue;
        el.textContent = '';
        el.hidden = true;
      }
    });

    if (this.getLevelElapsed() < LEVEL0_INTRO_SECONDS) {
      this.startIntro();
    } else {
      this.introDone = true;
    }

    this.ready = true;
  }

  startIntro() {
    if (this.introDone) return;
    this.introActive = true;
    if (!this.introBg) {
      this.introBg = this.add.image(0, 0, 'level0_cassette_shop')
        .setOrigin(0, 0)
        .setDisplaySize(STAGE_VIEW.width, STAGE_VIEW.height)
        .setDepth(100);
    }
    if (this.player) this.player.setVisible(false);
    this.time.delayedCall(5000, () => {
      if (!this.introActive) return;
      const panel = document.getElementById('phone-panel');
      const img = document.getElementById('phone-screen-img');
      const msg = document.getElementById('phone-message-text');
      if (panel && img) {
        img.src = 'assets/game/sms_stage_1_notification.png';
        if (msg) msg.hidden = true;
        panel.classList.add('phone-panel-visible');
      }
    });
  }

  endIntro() {
    if (!this.introActive) return;
    this.introActive = false;
    this.introDone = true;
    if (this.introBg) {
      this.introBg.destroy();
      this.introBg = null;
    }
    if (this.player) this.player.setVisible(true);
    const panel = document.getElementById('phone-panel');
    if (panel) panel.classList.remove('phone-panel-visible');
  }

  updateIntro(elapsed) {
    if (!this.introActive) return;
    if (elapsed >= LEVEL0_INTRO_SECONDS) {
      this.endIntro();
    }
  }

  getActiveLevelKey() {
    if (this.level3Active) return 'party';
    if (this.level2Active) return 'theatre';
    return 'fara7';
  }

  getPlayerVisual(state, levelKey = this.getActiveLevelKey()) {
    const entry = PLAYER_VISUALS[state];
    if (!entry) throw new Error(`Unknown player visual state: ${state}`);
    const visual = entry.textureKey ? entry : entry[levelKey];
    if (!visual) throw new Error(`No player visual for state ${state} in level ${levelKey}`);
    return visual;
  }

  getPlayerReferenceHeight(levelKey = this.getActiveLevelKey()) {
    return PLAYER_LEVEL_REFERENCE_HEIGHTS[levelKey] || PLAYER_LEVEL_REFERENCE_HEIGHTS.fara7;
  }

  playPlayerVisual(state, levelKey = this.getActiveLevelKey()) {
    const visual = this.getPlayerVisual(state, levelKey);
    this.playerReferenceHeight = this.getPlayerReferenceHeight(levelKey);
    this.player.anims.play(visual.animationKey, true);
    // anims.play() installs frame zero immediately. Anchor and resize in the same call so
    // an asynchronous animation callback or level reveal cannot render one stale-root frame.
    this.resizeBodyForTexture();
    return visual;
  }

  getPlayerFrameIndex(explicitFrame) {
    const candidate = explicitFrame === undefined || explicitFrame === null
      ? this.player.frame && this.player.frame.name
      : explicitFrame;
    const index = Number(candidate);
    if (Number.isInteger(index) && index >= 0) return index;
    const animationFrame = this.player.anims && this.player.anims.currentFrame;
    return animationFrame ? Math.max(0, animationFrame.index - 1) : 0;
  }

  // Every player sheet is scaled by Package A's anatomical bodyReferenceHeight, not by
  // its raw frame or full alpha union. The sprite origin is then moved to that frame's
  // measured sole/contact line. Pairing the origin with an equal body-offset correction
  // keeps both the visible feet and Arcade body's bottom at player.y across frame changes.
  // Jump's fixedLaunchContact and death's poseGroupContact metadata deliberately preserve
  // their authored vertical motion instead of bottom-aligning each silhouette.
  applyPlayerFrameAnchor(explicitFrame) {
    const p = this.player;
    if (!p || !p.body || !p.texture) return;
    const textureKey = p.texture.key;
    const spriteCfg = this.cfg.sprites[textureKey];
    const visualCfg = this.cfg.playerVisuals && this.cfg.playerVisuals.visuals[textureKey];
    if (!spriteCfg || !visualCfg || !Array.isArray(visualCfg.frameRootY)) return;

    const frameIndex = this.getPlayerFrameIndex(explicitFrame);
    const rootY = visualCfg.frameRootY[Math.min(frameIndex, visualCfg.frameRootY.length - 1)];
    const rootXNormalized = this.cfg.playerVisuals.rootXNormalized;
    const anchorKey = `${textureKey}:${frameIndex}`;
    const textureChanged = textureKey !== this.sizedForTexture;
    if (!textureChanged && anchorKey === this.anchoredPlayerFrame) return;
    const bodyWidthSource = visualCfg.bodyReferenceHeight * 0.5;

    if (textureChanged) {
      if (!Number.isFinite(this.playerReferenceHeight)) {
        this.playerReferenceHeight = this.getPlayerReferenceHeight();
      }
      const scale = this.playerReferenceHeight / visualCfg.bodyReferenceHeight;
      p.setScale(scale);
      p.body.setSize(bodyWidthSource, visualCfg.bodyReferenceHeight);
    }

    p.setOrigin(rootXNormalized, rootY / spriteCfg.frameHeight);
    p.body.setOffset(
      spriteCfg.frameWidth * rootXNormalized - bodyWidthSource / 2,
      rootY - visualCfg.bodyReferenceHeight
    );

    // A texture swap changes native dimensions and scale. Synchronize once here while
    // preserving the root world coordinate and velocity; never reset on ordinary frames,
    // which would clear onFloor() and recreate the historic idle/jump flicker.
    if (textureChanged) p.body.updateFromGameObject();
    this.sizedForTexture = textureKey;
    this.anchoredPlayerFrame = anchorKey;
  }

  resizeBodyForTexture() {
    this.applyPlayerFrameAnchor();
  }

  // Installs a level's background loop, replacing whichever level's loop was up (one
  // background object for the whole run, like the one ground collider).
  showLevelBackground(key, depth) {
    if (this.levelBg) this.levelBg.destroy();
    this.levelBgKey = key;
    this.levelBgFrame = 0;
    this.levelBg = this.add.image(0, 0, `${key}_0`).setOrigin(0, 0).setDepth(depth);
  }

  // Beat-locked, not a free-running animation: the frame is derived from the song clock
  // every tick, so it cannot drift from the track. getLevelElapsed() IS the audio's own
  // playback position (music.seek) while it plays; it is 0 until the first real gesture
  // (the moment the music starts), so frame 0 holds until then. If audio is slow or never
  // loads, it falls back to the same wall-clock timeline the music joins (setupMusic()
  // seeks to it), so the loop keeps its phase either way.
  updateLevelBackground(elapsed) {
    if (!this.levelBg) return;
    const count = this.cfg.sprites[this.levelBgKey].files.length;
    const frame = Math.floor(Math.max(0, elapsed) * 1000 / (BAR_MS / count)) % count;
    if (frame === this.levelBgFrame) return;
    this.levelBgFrame = frame;
    this.levelBg.setTexture(`${this.levelBgKey}_${frame}`);
  }

  // Called once the separate, non-blocking audio load pass (see create()/buildLevel())
  // actually completes -- may never fire on a device where that load hangs, which is
  // fine, `this.music` just stays undefined and the game is silent but still playable.
  // Browsers block audio playback until a real user gesture -- the game already
  // requires a click to focus for keyboard input to register, so piggyback on that
  // same first interaction rather than building a separate "click to start" overlay.
  setupMusic() {
    // The load pass's 'complete' event fires whether the file loaded OR errored --
    // guard the cache directly rather than assuming success (Phaser's Sound.add()
    // throws on a missing cache entry).
    if (!this.cache.audio.exists('theme')) return;
    // Read the slider's CURRENT value rather than hardcoding -- if Hazem adjusted it
    // before this async load pass finished, the old code silently discarded that.
    // loop:false, not true -- disables .seek wrapping back to 0 mid-track, which would
    // corrupt the shared song clock (see getLevelElapsed()).
    const slider = document.getElementById('music-volume');
    const initialVolume = slider ? parseFloat(slider.value) : 0.5;
    this.music = this.sound.add('theme', { loop: false, volume: initialVolume });
    // This attaches when the BaseSound is created, before any of setupMusic()'s
    // immediate or gesture-triggered start routes can call play({ seek }). It therefore
    // remains attached for recovered playback that resumes partway through the track.
    this.music.once('complete', () => this.onSongEnd());
    // Pointer and keyboard activation listeners are independent, so use a dedicated
    // successful-start latch: a later unused route must never restart a playing song.
    // If audio arrived after the fallback clock began, join the existing timeline
    // instead of rewinding the level to the beginning.
    const startMusic = () => {
      if (this.songEnded || this.musicStarted || !this.music) return this.musicStarted;
      const elapsed = this.getLevelElapsed();
      const duration = this.music.duration;
      const seek = Number.isFinite(duration) && duration > 0
        ? Math.min(elapsed, Math.max(0, duration - 0.01))
        : 0;
      const played = this.music.play({ seek });
      if (played) this.musicStarted = true;
      return played;
    };
    if (this.levelClockStart !== null && startMusic()) {
      // The player's first real gesture already happened before this (async) audio
      // load finished -- start immediately rather than waiting for a SECOND gesture
      // that may never come (e.g. a held movement button doesn't re-fire pointerdown/
      // pointerup/keydown). Also caught by the Codex review.
      return;
    }
    if (!this.musicStarted) {
      // document, not this.input -- same canvas-vs-DOM-button gap as startLevelClock
      // above, and same pointerdown/pointerup pointer-type split. A failed immediate
      // autoplay attempt leaves the latch unset so either real route can retry.
      onFirstRealGesture(startMusic);
      this.input.keyboard.once('keydown', startMusic);
    }
  }

  // Single sampled source of truth for song time, read once per update() tick and
  // reused for lyric routing and the exterior cutscene anchors.
  getLevelElapsed() {
    // A non-looping Phaser sound stops reporting isPlaying at natural completion.
    // Keep every clock consumer pinned to the final audio duration instead of falling
    // through to a wall clock that may have started before audio became available.
    if (this.songEnded) return this.songEndElapsed;
    if (this.music && (this.music.isPlaying || this.music.isPaused)) return this.music.seek;
    if (this.levelClockStart !== null) return (this.time.now - this.levelClockStart) / 1000;
    return 0;
  }

  // Both the BaseSound completion event and the silent-track fallback enter here. The
  // shared songEnded latch makes this safe if a backend ever delivers both routes.
  onSongEnd() {
    if (this.songEnded) return;
    this.songEnded = true;
    const duration = this.musicStarted && this.music ? this.music.duration : NaN;
    this.songEndElapsed = Number.isFinite(duration) && duration > 0
      ? duration
      : SILENT_TRACK_SECONDS;
    this.showCredits();
  }

  showCredits() {
    const overlay = document.getElementById('credits-overlay');
    const content = document.getElementById('credits-content');
    if (!overlay || !content) return;

    overlay.hidden = false;
    if (window.positionCreditsOverlay) window.positionCreditsOverlay();

    // The normal-flow offset includes the overlay's padding. These two transforms put
    // the whole block below the visible rectangle first, then above it at the end.
    // This method only runs through onSongEnd()'s latch; later resize positioning changes
    // the overlay rect but never rewrites these properties, so it cannot restart the scroll.
    const startY = overlay.clientHeight - content.offsetTop;
    const endY = -(content.offsetTop + content.offsetHeight);
    content.style.transition = 'none';
    content.style.transform = `translateY(${startY}px)`;
    // Force the below-overlay starting state to commit before enabling the one-shot CSS transition.
    void content.offsetHeight;
    content.style.transition = `transform ${CREDITS_SCROLL_DURATION_MS}ms linear`;
    content.style.transform = `translateY(${endY}px)`;
  }

  renderLyrics(elapsed) {
    const cue = this.lyrics.find((entry) => elapsed >= entry.start && elapsed < entry.end);
    const activeText = cue ? cue.text : '';
    // The cinema screen is a Level 2 fixture; once the Party is up, its window (which runs
    // to 134.38s, i.e. 2.4s PAST the 132s handover) must stop suppressing the speech bubble
    // or Level 3 would open with a silent gap.
    const inCinemaWindow = !this.level3Active
      && elapsed >= CINEMA_LYRICS_START && elapsed < CINEMA_LYRICS_END;
    // `fadedOut` is Level 1's own one-shot exit latch and stays true for the rest of the
    // run, so every later level has to be named here or its lyrics never come back.
    const fading = this.introActive
      || (this.fadedOut && !this.level2Active && !this.level3Active)
      || this.level2Revealing || this.level3Revealing;
    const bubbleText = !fading && !inCinemaWindow ? activeText : '';
    const cinemaText = !fading && this.level2Active && inCinemaWindow ? activeText : '';

    // Hide both first on a route change so matching/stale text can never leave both
    // destinations visible during a seek or a transition.
    const pairs = [[this.lyricEl, bubbleText], [this.cinemaLyricEl, cinemaText]];
    for (const [el, text] of pairs) {
      if (el && !text) el.hidden = true;
    }
    for (const [el, text] of pairs) {
      if (!el) continue;
      const changed = el.textContent !== text;
      if (changed) el.textContent = text;
      el.hidden = !text;
      if (text && el === this.cinemaLyricEl && changed && window.positionCinemaLyrics) {
        window.positionCinemaLyrics();
      }
    }
  }

  // Level 1's roster. Nothing below this method is Level-1-specific: it hands a plain
  // data array to the generic buildInteractiveActors(), so each level supplies its own
  // cast (different sheets, marks and entrance paths) without touching any of the shared
  // machinery. Direct counterpart of buildTheatreActors() below.
  //
  // FOUR band members, all hittable, all hitsRequired: 3. GAME_PLAN section 0 retires the
  // kiosk vendor from the roster.
  buildFara7Actors() {
    const loops = LEVEL1_ANIM_GROUPS.loops.sheets;
    // Marks run left-to-right across the deck's left half, clear of the hero's own play
    // area (FARA7.walkMinX). The band now enters from BOTH wings rather than filing in
    // from one, so the same-wing ordering invariant is per wing, mirrored:
    //  - RIGHT wing (travels LEFT): the actor with the SMALLEST target x is furthest from
    //    the wing and must start first, or a later entrant walks through it.
    //  - LEFT wing (travels RIGHT): the actor with the LARGEST target x is furthest and
    //    must start first, for exactly the same reason.
    // At a shared speed a walker that started earlier is always further along, so ordering
    // each wing's starts furthest-mark-first is what makes the staggered starts safe.
    // `mark` is one of FARA7.band's four measured entries -- footX/footY, the STANDING
    // height (idle/walk-in/dizzy) and the seated PERFORMANCE height (the playing loop,
    // via visuals.performance/bandPerformanceVisual()'s own displayContentHeight override).
    const bandMember = (id, mark, visuals, earliestStartMs, side) => ({
      id,
      targetX: mark.footX,
      footY: mark.footY,
      displayContentHeight: mark.standingHeight,
      depth: FARA7_DEPTH.band,
      idle: visuals.idle,
      walkIn: visuals.walkIn,
      dizzy: visuals.dizzy,
      // Only the band carries this; it is what buildInteractiveActors() dispatches the new
      // timed dizzy -> fade -> play sequence on (never a character-name string match), so
      // an actor without it -- every soprano, the boss -- keeps its existing treatment.
      performance: visuals.performance || null,
      hitsRequired: 3,
      entrance: {
        // Both waypoints share the actor's own measured foot line so arrival never snaps
        // vertically onto a different shared line.
        path: [
          { x: side === 'left' ? FARA7.leftWingX : FARA7.wingX, y: mark.footY },
          { x: mark.footX, y: mark.footY },
        ],
        speedPxPerSecond: FARA7.entranceSpeedPxPerSecond,
        earliestStartMs,
        // buildInteractiveActors() turns this into the sprite's flipX. 'left' means the
        // left-facing walk-in art is mirrored so it reads as walking rightward.
        side,
      },
      clipBottomY: null,
    });
    // The three sheets the old street build already used, plus the playing loop -- which
    // gets its own measured seated-performance height (mark.performanceHeight) rather than
    // the actor's standing default.
    const musician = (sheet, anim, mark) => ({
      idle: { textureKey: `musician_${sheet}_idle`, animationKey: `musician${anim}IdleAnim` },
      walkIn: { textureKey: `musician_${sheet}_walkin`, animationKey: ACTOR_WALK_IN_ANIMS[`musician_${sheet}_walkin`] },
      dizzy: { textureKey: `musician_${sheet}_love`, animationKey: `musician${anim}LoveAnim` },
      performance: bandPerformanceVisual(`musician_${sheet}_playing`, mark.performanceHeight),
    });

    // Starts are spread across ~20s rather than bunched at boot, per GAME_PLAN section 0
    // ("hit windows spread evenly across the level's actual running time"). The level still
    // opens with only Manos on stage -- buildInteractiveActors() parks every entrance actor
    // hidden on its wing mark.
    //
    // Marks are now the measured plate positions (BLOCKING_COORDINATES.md), replacing the
    // RUN 21 provisional numbers: accordion + keyboard on the LEFT (187.6/306.2), tabla +
    // drums on the RIGHT (956.9/1102.4), flanking Manos/the wedding couple in the middle --
    // same grouping as before, exact marks now measured. Both left marks sit below
    // FARA7.walkMinX(567.4); both right marks sit above walkMaxX(883.7), so the player's
    // play area still stays clear of the band. Entrance ordering keeps the same
    // furthest-from-wing-starts-first invariant and the same start-time SET
    // (1500/7000/13500/20000): keyboard(306.2) is further from the left wing than
    // accordion(187.6), so it still starts first; tabla(956.9) is further from the right
    // wing than drums(1102.4), so it still starts first. Owner decision: accordion and
    // drums sit exactly on these marks even though the accordionist's chair leg lands at
    // the deck edge and the drums sit on carpet that only exists in the populated plate.
    this.buildInteractiveActors([
      bandMember('keyboard', FARA7.band.keyboard, musician('keyboard', 'Keyboard', FARA7.band.keyboard), 1500, 'left'),
      bandMember('accordion', FARA7.band.accordion, musician('accordion', 'Accordion', FARA7.band.accordion), 7000, 'left'),
      // The tabla player -- a genuinely new fourth band member (GAME_PLAN section 0), and
      // the one the old street roster was missing entirely. His sheets do not follow the
      // musician_* naming, hence the literal keys, including his playing loop.
      bandMember('tabla', FARA7.band.tabla, {
        idle: { textureKey: 'tabla_player_standing_idle', animationKey: loops.tabla_player_standing_idle },
        walkIn: { textureKey: 'tabla_player_walkin', animationKey: ACTOR_WALK_IN_ANIMS.tabla_player_walkin },
        dizzy: { textureKey: 'tabla_player_dizzy_love', animationKey: loops.tabla_player_dizzy_love },
        performance: bandPerformanceVisual('tabla_player_playing', FARA7.band.tabla.performanceHeight),
      }, 13500, 'right'),
      bandMember('drums', FARA7.band.drums, musician('drums', 'Drums', FARA7.band.drums), 20000, 'right'),
    ]);
  }

  // RUN 21's 4 new foreground crowd groups (3 seated men each), replacing the crowd
  // RUN 20 deleted wholesale. Matches the reference photo's own treatment: deliberately
  // secondary/lower-detail than the cast, seen mostly from behind, minimal motion (a
  // restrained clap or small sway) at a slow 4fps loop. Ordinary sprites only -- no
  // physics, no entrance, no hit state -- using the same this.passiveAudience array +
  // destroyPassiveAudience() teardown the dressing sprites already share.
  //
  // Placement: 4 groups spread left-to-right (centre-x 172/516/860/1204), each scaled to
  // its OWN measured content box capped at 180px tall / 336px wide, preserving aspect
  // ratio -- every group here is wider than tall (3 men side by side), so all 4 end up
  // width-capped in practice, not height-capped. `top` is the measured world-Y where each
  // group's real background placement was checked against the actual stage art; the
  // resulting foot/anchor Y (top + this group's own scaled height) intentionally runs
  // past the bottom of the canvas for all 4 -- the camera's own edge crops their
  // lower bodies, matching the reference photo's own foreground-crowd framing, no
  // clipBottomY needed for this (contrast with the old pre-RUN-20 audience, which DID use
  // clipBottomY to crop at a background seat-line -- there's no such line here).
  // Staggered starting frames (explicit indices, not setProgress() fractions) so the 4
  // groups don't clap in lockstep.
  buildFara7Crowd() {
    const sheets = LEVEL1_ANIM_GROUPS.crowd.sheets;
    // INTERIM (crowd layout held): centre/top and the 180x336 size caps are the RUN 21
    // numbers converted.
    const placements = [
      // [textureKey, centreX, topY, nativeContentWidth, nativeContentHeight, startFrame]
      ['fara7_crowd_group_a', interimX(172), interimY(636), 644, 304, 0],
      ['fara7_crowd_group_b', interimX(516), interimY(642), 672, 314, 1],
      ['fara7_crowd_group_c', interimX(860), interimY(638), 675, 318, 2],
      ['fara7_crowd_group_d', interimX(1204), interimY(644), 647, 300, 3],
    ];
    for (const [textureKey, x, topY, nativeW, nativeH, startFrame] of placements) {
      if (!this.cfg.sprites[textureKey]) continue;
      const scale = Math.min(interimY(180) / nativeH, interimX(336) / nativeW);
      const displayContentHeight = nativeH * scale;
      const sprite = this.add.sprite(x, topY + displayContentHeight, textureKey, 0)
        .setDepth(FARA7_DEPTH.crowd);
      this.setActorVisual(
        { sprite, spec: { displayContentHeight, clipBottomY: null } },
        { textureKey, animationKey: sheets[textureKey] }
      );
      sprite.anims.setCurrentFrame(sprite.anims.currentAnim.frames[startFrame]);
      this.passiveAudience.push(sprite);
    }
  }

  // Groom and bride: seated set-dressing on the deck itself (GAME_PLAN section 0 --
  // "not part of the hit/dizzy mechanic"). No hit state, no entrance, no collision. They
  // use the this.passiveAudience array initialized in buildLevel() so the existing scene
  // teardown continues to own them.
  //
  // Content height 150/165 against the hero's 214.5: a seated adult reads ~0.7 of standing
  // height, and the bride's gown spreads a little wider/taller than the groom's suit.
  buildFara7Dressing() {
    const sheets = LEVEL1_ANIM_GROUPS.loops.sheets;
    const dressingSheets = LEVEL1_ANIM_GROUPS.dressing.sheets;
    // RUN 22: replaced the two separate bride/groom sprites with one combined sprite --
    // both seated together on an actual heart-shaped "kosha" chair, matching the reference
    // photo's real prop (the two-sprite version below was a positioning-only stand-in from
    // RUN 21, since the shipped background has no heart-chair prop of its own). Placement
    // and height are measured off the new plate (FARA7.couple).
    const coupleKey = 'fara7_couple_heart_chair_idle';
    if (this.cfg.sprites[coupleKey] && dressingSheets[coupleKey]) {
      const { x, footY, contentHeight } = FARA7.couple;
      const sprite = this.add.sprite(x, footY, coupleKey, 0)
        .setDepth(FARA7_DEPTH.dressing);
      this.setActorVisual(
        { sprite, spec: { displayContentHeight: contentHeight, clipBottomY: null } },
        { textureKey: coupleKey, animationKey: dressingSheets[coupleKey] }
      );
      sprite.anims.setProgress(0.5);
      this.passiveAudience.push(sprite);
      return;
    }
    // Fallback: the two separate sprites, kept working if the combined asset is ever
    // missing/unregistered. INTERIM: old marks/heights converted, on the couple's line.
    const placements = [
      ['wife_bride_seated_idle', interimX(795), interimY(165)],
      ['husband_groom_seated_idle', interimX(880), interimY(150)],
    ];
    for (const [textureKey, x, contentHeight] of placements) {
      if (!this.cfg.sprites[textureKey]) continue;
      const sprite = this.add.sprite(x, FARA7.couple.footY, textureKey, 0).setDepth(FARA7_DEPTH.dressing);
      this.setActorVisual(
        { sprite, spec: { displayContentHeight: contentHeight, clipBottomY: null } },
        { textureKey, animationKey: sheets[textureKey] }
      );
      sprite.anims.setProgress(0.5);
      this.passiveAudience.push(sprite);
    }
  }

  // Level 2's roster -- three sopranos on the stage floor, through the same
  // buildInteractiveActors() and the same hitsRequired as the Level 1 band. Their mic
  // performance routes a defeated soprano through the shared composite queue. Only the
  // sheets, marks and entrance direction differ.
  buildTheatreActors() {
    const loops = LEVEL2_ANIM_GROUPS.loops.sheets;
    const walkIns = LEVEL2_ANIM_GROUPS.walkIns.sheets;
    // entranceStartMs === null means "already standing on the mark".
    const soprano = (colour, targetX, entranceStartMs) => {
      const walkInKey = `soprano_${colour}_walkin`;
      return {
        id: `soprano_${colour}`,
        targetX,
        footY: THEATRE.stageFootY,
        displayContentHeight: THEATRE.sopranoContentHeights[colour],
        depth: THEATRE_DEPTH.soprano,
        idle: { textureKey: `soprano_${colour}_idle`, animationKey: loops[`soprano_${colour}_idle`] },
        walkIn: walkIns[walkInKey] ? { textureKey: walkInKey, animationKey: walkIns[walkInKey] } : null,
        dizzy: { textureKey: `soprano_${colour}_dizzy`, animationKey: loops[`soprano_${colour}_dizzy`] },
        // The textureKey is the mic group's first state, and it is here for a real reason
        // rather than decoration: buildInteractiveActors() drops a performance whose sheet
        // isn't registered, so if the composites ever go missing these three degrade to the
        // old stub instead of walking to a mic that was never built.
        performance: { kind: 'mic', textureKey: 'theatre_mic_empty', micInstance: 'theatreMic' },
        hitsRequired: 3,
        entrance: entranceStartMs === null ? null : {
          path: [
            { x: THEATRE.wingX, y: THEATRE.stageFootY },
            { x: targetX, y: THEATRE.stageFootY },
          ],
          speedPxPerSecond: THEATRE.entranceSpeedPxPerSecond,
          earliestStartMs: entranceStartMs,
        },
        clipBottomY: null,
      };
    };

    // Both walkers enter from the same stage-left wing mark, so the one with the FURTHER
    // mark has to leave first or the second would be walked through on its way past.
    // Green clears gold's mark at (500-437.2)/130 = 0.48s; gold's 1600ms start is safely
    // after that.
    // STAGING, not measured: the plate only shows the trio AT the mic (THEATRE_SOPRANO_
    // REST_OFFSETS, below, is the measured part), so these pre-mic waiting marks have no
    // plate reference. Package E moved them (were interimX(780)/620/895) clear of the
    // player's new stage-RIGHT box (THEATRE.playerSpawnX 765.6, walkMaxX 790.7) -- the old
    // marks (725.6/576.9/832.6 converted) put green and red within ~40-65px of Manos's new
    // mark, close enough to visibly overlap his and each other's silhouettes.
    this.buildInteractiveActors([
      soprano('green', 610, 0),
      soprano('gold', 500, 1600),
      soprano('red', 680, null),
    ]);
    this.buildTheatreMic();
  }

  // ONE sprite for the whole mic performance, deliberately NOT a member of
  // this.interactiveActors: it has no hit box, no hit count and no state machine, exactly
  // the structural guarantee spawnBoss() relies on for the femme fatale. It is `spec`/
  // `sprite` shaped only so setActorVisual() consumes it verbatim.
  //
  // Its texture is swapped between four pre-composited states as sopranos arrive -- three
  // independent singer sprites stacked at one mark would fight over depth and drift apart
  // as each sheet's own content box differs.
  buildMic(micInstance, { x, floorY, speedPxPerSecond, contentHeight, depth }) {
    this.destroyMic(micInstance);
    if (!this.cfg.sprites.theatre_mic_empty) return;
    const sprite = this.add.sprite(x, floorY, 'theatre_mic_empty', 0).setDepth(depth);
    this[micInstance] = {
      spec: {
        displayContentHeight: contentHeight,
        clipBottomY: null,
        fixedAnchor: MIC_ANCHOR,
      },
      sprite,
      x,
      floorY,
      speedPxPerSecond,
      // A fresh order array belongs to each mic alongside its joined/walker state, even
      // though both levels intentionally use the same gold -> green -> red identities.
      joinOrder: [...MIC_JOIN_ORDER],
      visuals: MIC_VISUALS,
      // Arrived actor ids, in arrival order. Its LENGTH is the only join count in this
      // file -- never a roster index, never "how many are dizzy".
      joined: [],
      // The one soprano currently walking, or null. One at a time, always.
      walkerId: null,
    };
    this.setActorVisual(this[micInstance], MIC_VISUALS[0]);
  }

  destroyMic(micInstance) {
    if (!this[micInstance]) return;
    this[micInstance].sprite.destroy();
    this[micInstance] = null;
  }

  buildTheatreMic() {
    this.buildMic('theatreMic', {
      x: THEATRE.micX,
      floorY: THEATRE.micFootY,
      speedPxPerSecond: THEATRE.entranceSpeedPxPerSecond,
      contentHeight: THEATRE.micContentHeight,
      depth: THEATRE_DEPTH.soprano,
    });
  }

  destroyTheatreMic() {
    this.destroyMic('theatreMic');
  }

  buildPartyMic() {
    this.buildMic('partyMic', {
      x: PARTY.micX,
      floorY: PARTY.micFootY,
      speedPxPerSecond: PARTY.entranceSpeedPxPerSecond,
      contentHeight: PARTY.micContentHeight,
      depth: PARTY_DEPTH.cast,
    });
  }

  destroyPartyMic() {
    this.destroyMic('partyMic');
  }

  // Level 3's roster: BOTH earlier casts on one deck (GAME_PLAN section 0 -- "both casts
  // together, the fara7 band + the sopranos, walk in one by one"). Seven actors, all
  // hitsRequired: 3, all through the same buildInteractiveActors() the other two levels
  // use. No new sheets: the band reuses Level 1's, the sopranos Level 2's.
  //
  // The femme fatale is NOT in this roster -- see spawnBoss().
  buildPartyActors() {
    const l1 = LEVEL1_ANIM_GROUPS.loops.sheets;
    const l2 = LEVEL2_ANIM_GROUPS.loops.sheets;
    const walkIns = LEVEL2_ANIM_GROUPS.walkIns.sheets;
    // `side` defaults to the right wing, which is what every soprano keeps -- only the band
    // uses the left one (same character-side split as Level 1).
    // visuals.footY/contentHeight override the band's line and height -- the sopranos stand
    // on their own measured line (PARTY.micFootY) at their own measured heights.
    const partyActor = (id, targetX, visuals, earliestStartMs, side = 'right') => ({
      id,
      targetX,
      footY: visuals.footY || PARTY.stageFootY,
      displayContentHeight: visuals.contentHeight || PARTY.castContentHeight,
      depth: PARTY_DEPTH.cast,
      idle: visuals.idle,
      walkIn: visuals.walkIn,
      dizzy: visuals.dizzy,
      // Band members use instrument performance; sopranos below associate with Party's
      // separate mic instance. See bandPerformanceVisual().
      performance: visuals.performance || null,
      hitsRequired: 3,
      entrance: earliestStartMs === null ? null : {
        path: [
          { x: side === 'left' ? PARTY.leftWingX : PARTY.wingX, y: visuals.footY || PARTY.stageFootY },
          { x: targetX, y: visuals.footY || PARTY.stageFootY },
        ],
        speedPxPerSecond: PARTY.entranceSpeedPxPerSecond,
        earliestStartMs,
        side,
      },
      clipBottomY: null,
    });
    // `mark` is one of PARTY.band's four entries -- footX/footY, the standing height and
    // the seated performance height (see FARA7's identical pattern in buildFara7Actors()).
    const musician = (sheet, anim, mark) => ({
      idle: { textureKey: `musician_${sheet}_idle`, animationKey: `musician${anim}IdleAnim` },
      walkIn: { textureKey: `musician_${sheet}_walkin`, animationKey: ACTOR_WALK_IN_ANIMS[`musician_${sheet}_walkin`] },
      dizzy: { textureKey: `musician_${sheet}_love`, animationKey: `musician${anim}LoveAnim` },
      performance: bandPerformanceVisual(`musician_${sheet}_playing`, mark.performanceHeight),
      footY: mark.footY,
      contentHeight: mark.standingHeight,
    });
    const soprano = (colour) => {
      const walkInKey = `soprano_${colour}_walkin`;
      return {
        idle: { textureKey: `soprano_${colour}_idle`, animationKey: l2[`soprano_${colour}_idle`] },
        walkIn: walkIns[walkInKey] ? { textureKey: walkInKey, animationKey: walkIns[walkInKey] } : null,
        dizzy: { textureKey: `soprano_${colour}_dizzy`, animationKey: l2[`soprano_${colour}_dizzy`] },
        performance: { kind: 'mic', textureKey: 'theatre_mic_empty', micInstance: 'partyMic' },
        footY: PARTY.micFootY,
        contentHeight: PARTY.sopranoContentHeights[colour],
      };
    };

    // Marks: accordion/keyboard/drums stage-LEFT, tabla now stage-RIGHT (measured, the
    // task's required move -- the plate's percussionist sits past the trio, not with the
    // rest of the band), the sopranos stage-RIGHT beyond him, the hero's own box
    // (PARTY.walkMinX..walkMaxX) in between -- the locked composition's staging.
    //
    // The BAND (accordion/drums/keyboard) enters from the left wing (PARTY.leftWingX,
    // travelling right, art flipped); tabla and the sopranos share the right wing. Same
    // furthest-mark-first invariant per wing, mirrored: on the LEFT that is the LARGEST
    // target x (accordion 424.9 before drums 300); on the RIGHT it is the smallest
    // (keyboard 505.3 before tabla 803.8, then the sopranos further right still, smallest-
    // first among themselves too: green 900 before gold 960 before red 1020). tabla's new
    // measured mark is now much CLOSER to its wing than the old provisional one was, so it
    // clears the wing and parks well before any soprano starts (tabla starts 9900ms,
    // travels (1236.9-803.8)/300 = 1.44s, arrives ~11.3s -- green doesn't start until
    // 11.6s). Every earliestStartMs below is unchanged from the prior build.
    //
    // Soprano pre-mic waiting marks (900/960/1020) are STAGED, not measured -- same
    // reasoning as Theatre's (no plate reference for a pre-mic mark) -- and were moved
    // right of tabla's new measured mark (was interimX(880)/960/1040, which put green only
    // ~15px from tabla's new 803.8) so the two casts' resting silhouettes stay clear of
    // each other.
    this.buildInteractiveActors([
      partyActor('accordion', PARTY.band.accordion.footX, musician('accordion', 'Accordion', PARTY.band.accordion), 800, 'left'),
      partyActor('drums', PARTY.band.drums.footX, musician('drums', 'Drums', PARTY.band.drums), 4100, 'left'),
      partyActor('keyboard', PARTY.band.keyboard.footX, musician('keyboard', 'Keyboard', PARTY.band.keyboard), 7100, 'right'),
      partyActor('tabla', PARTY.band.tabla.footX, {
        idle: { textureKey: 'tabla_player_standing_idle', animationKey: l1.tabla_player_standing_idle },
        walkIn: { textureKey: 'tabla_player_walkin', animationKey: ACTOR_WALK_IN_ANIMS.tabla_player_walkin },
        dizzy: { textureKey: 'tabla_player_dizzy_love', animationKey: l1.tabla_player_dizzy_love },
        performance: bandPerformanceVisual('tabla_player_playing', PARTY.band.tabla.performanceHeight),
        footY: PARTY.band.tabla.footY,
        contentHeight: PARTY.band.tabla.standingHeight,
      }, 9900, 'right'),
      partyActor('soprano_green', 900, soprano('green'), 11600),
      partyActor('soprano_gold', 960, soprano('gold'), 13000),
      partyActor('soprano_red', 1020, soprano('red'), 14400),
    ]);
    this.buildPartyMic();
  }

  destroyPassiveAudience() {
    this.cancelTheatreAudienceFlourish();
    for (const sprite of this.passiveAudience) sprite.destroy();
    this.passiveAudience = [];
    this.theatreSoloAudienceSprite = null;
  }

  buildInteractiveActors(roster) {
    this.interactiveActors = roster.map((spec) => {
      // An actor whose walk-in sheet isn't registered in assets.json degrades to
      // spawning in place rather than throwing on an undefined metadata read -- the
      // sheets are registered by a separate asset pass, so "not there yet" is a real,
      // reachable state.
      const hasWalkIn = !!(spec.walkIn && spec.entrance && this.cfg.sprites[spec.walkIn.textureKey]);
      // Same tolerance, same reason, for the playing-instrument sheets: three of the four
      // are registered by that separate asset pass, so "declared in the roster but not on
      // disk yet" is a real reachable state. Dropping the field is enough -- everything
      // downstream dispatches on spec.performance, so a band member without its sheet just
      // holds the old dizzy loop instead of crashing on an undefined metadata read.
      const hasPerformance = !!(spec.performance && this.cfg.sprites[spec.performance.textureKey]);
      const usableSpec = (hasWalkIn && hasPerformance) ? spec : {
        ...spec,
        walkIn: hasWalkIn ? spec.walkIn : null,
        entrance: hasWalkIn ? spec.entrance : null,
        performance: hasPerformance ? spec.performance : null,
      };
      const sprite = this.add.sprite(usableSpec.targetX, usableSpec.footY, usableSpec.idle.textureKey, 0);
      sprite.setDepth(usableSpec.depth);
      // Set once, here, and thereafter touched by exactly one other place in the file
      // (releaseNextMicWalker(), whose walk can run in either direction): every walk-in
      // sheet is drawn walking left, so a left-wing entrant is mirrored to read as walking
      // right. setActorVisual() deliberately does not reset flipX, so the mirror persists
      // through walk-in -> idle -> dizzy -> playing without any per-transition bookkeeping
      // (an actor whose walk-in sheet was missing has no entrance at all and never flips).
      sprite.setFlipX(!!(usableSpec.entrance && usableSpec.entrance.side === 'left'));

      const actor = {
        spec: usableSpec,
        sprite,
        state: usableSpec.entrance ? 'waiting_entry' : 'engageable',
        // A COUNT, not the old one-shot `struck` boolean: an actor now absorbs
        // spec.hitsRequired hits before it goes dizzy, and a boolean cannot represent
        // "hit twice, still standing".
        hitsReceived: 0,
        pathSegmentIndex: 0,
        performRequested: false,
        dizzyRepeatHandler: null,
        // Both owned by this actor and both cancelled in clearActorPerformanceTrigger(),
        // which destroyInteractiveActors() calls before destroy() -- neither a pending
        // dizzy timer nor a running fade may outlive the sprite or a level transition.
        dizzyTimer: null,
        performTween: null,
        keyboardSoloRestore: null,
      };

      if (actor.state === 'waiting_entry') {
        // Hidden AND parked on the path's first waypoint, so no frame can ever show it
        // standing on its final mark before the entrance runs.
        sprite.setVisible(false);
        sprite.setPosition(usableSpec.entrance.path[0].x, usableSpec.entrance.path[0].y);
      }
      this.setActorVisual(actor, usableSpec.idle);
      return actor;
    });

    // The band entrance is triggered once, when the camera's view first reaches each
    // actor's own ENTRANCE START mark (path[0], not its final targetX -- targetX sits
    // ENTRANCE_OFFSET_X further left/already inside frame at that point, which made the
    // reveal pop in mid-screen instead of appearing at the scrolling edge; checked live
    // against the accordion's real numbers during plan review). Stored as a number (or
    // null when nothing has an entrance) so updateInteractiveActors() needs no roster scan.
    const entranceTargets = this.interactiveActors
      .filter((actor) => actor.spec.entrance)
      .map((actor) => actor.spec.entrance.path[0].x);
    this.actorEntranceTriggerX = entranceTargets.length ? Math.max(...entranceTargets) : null;
    // null = the sequence hasn't been triggered yet; a number is milliseconds since it
    // was. Doubles as the one-shot latch, so backtracking and re-approaching the band
    // cannot replay the entrance.
    this.actorEntranceElapsedMs = null;
  }

  // Single owner of the scale/origin/crop maths for actor sprites (it used to be
  // duplicated between the build pass and the strike pass, which is how they drifted).
  setActorVisual(actor, visual) {
    const sprite = actor.sprite;
    // Order matters: anims.play() is what swaps the texture, so every metadata read
    // below has to happen AFTER it or it measures the outgoing sheet -- the same root
    // cause documented on resizeBodyForTexture() for the player.
    sprite.anims.stop();
    sprite.anims.play(visual.animationKey, true);

    const meta = this.cfg.sprites[visual.textureKey];
    // OPTIONAL, and used only by the Theatre and Party mic groups (see MIC_ANCHOR). Every
    // other spec leaves it undefined and takes the default
    // branch below, byte-for-byte the maths this method has always run: normalise each
    // sheet to the bottom-centre of its OWN measured content box. That normalisation is
    // right for a character, whose silhouette is the thing being placed, and wrong for a
    // composite whose content box grows as figures are added to it -- there the stand
    // would slide and resize on every swap. A fixed anchor pins one frame-space point and
    // one scale reference instead, so the swap moves nothing.
    const fixed = actor.spec.fixedAnchor || null;
    // Package E: a visual may carry its OWN displayContentHeight (the seated/performance
    // sheets do, via bandPerformanceVisual()) so one actor's walk-in/idle/dizzy states can
    // use its derived STANDING height while its playing loop uses the plate's measured
    // SEATED height -- the two differ by ~1.3x and one number cannot serve both. Anything
    // that doesn't set its own (every non-performance visual) falls back to the actor
    // spec's standing default, unchanged from before this override existed.
    const displayContentHeight = visual.displayContentHeight !== undefined
      ? visual.displayContentHeight
      : actor.spec.displayContentHeight;
    const scale = displayContentHeight / (fixed ? fixed.refContentHeight : meta.contentHeight);
    // The world anchor IS the sprite's own x/y by construction (the origin below sits on
    // the content's bottom-centre, or on the fixed frame point), so re-reading it preserves
    // position across a texture swap -- including mid-walk-in, where it is deliberately NOT
    // spec.targetX.
    const anchorX = sprite.x;
    const anchorY = sprite.y;
    const originFrameX = fixed ? fixed.anchorFrameX : meta.contentCenterX;
    const contentBottomFrameY = fixed ? fixed.anchorFrameY : meta.contentTop + meta.contentHeight;
    sprite.setOrigin(originFrameX / meta.frameWidth, contentBottomFrameY / meta.frameHeight);
    sprite.setScale(scale);
    sprite.setPosition(anchorX, anchorY);

    // Crop is frame-relative, so it must be recomputed against the NEW sheet's metadata
    // after every swap -- carrying the old rectangle over would clip at the wrong height.
    if (actor.spec.clipBottomY === null) {
      sprite.setCrop();
      return;
    }
    const spriteTopWorldY = anchorY - contentBottomFrameY * scale;
    const cropBottomFrameY = (actor.spec.clipBottomY - spriteTopWorldY) / scale;
    sprite.setCrop(0, 0, meta.frameWidth, Phaser.Math.Clamp(cropBottomFrameY, 0, meta.frameHeight));
  }

  startActorEntrance(actor) {
    const start = actor.spec.entrance.path[0];
    actor.sprite.setPosition(start.x, start.y);
    actor.sprite.setVisible(true);
    actor.pathSegmentIndex = 1;   // 0 is where it stands now; walk towards 1 onwards
    actor.state = 'walking_in';
    this.setActorVisual(actor, actor.spec.walkIn);
  }

  updateInteractiveActors(delta) {
    if (this.introActive) return;
    if (this.actorEntranceTriggerX !== null && this.actorEntranceElapsedMs === null
      // worldView.x is the smallest visible world x. The player travels leftward, so this
      // value only decreases on approach: the first time it drops to the band's rightmost
      // mark, that mark has just entered frame. The latch above means walking back right
      // and returning can't re-fire it.
      && this.cameras.main.worldView.x <= this.actorEntranceTriggerX) {
      this.actorEntranceElapsedMs = 0;
    }
    // Accumulate Phaser's own smoothed/capped `delta`, NOT wall-clock time -- identical
    // reasoning to updateProjectiles() below: a backgrounded tab resuming after real time
    // has passed would otherwise let a walk-in jump straight to its end mark in one frame.
    if (this.actorEntranceElapsedMs !== null) this.actorEntranceElapsedMs += delta;

    for (const actor of this.interactiveActors) {
      if (actor.state === 'waiting_entry') {
        if (this.actorEntranceElapsedMs !== null
          && this.actorEntranceElapsedMs >= actor.spec.entrance.earliestStartMs) {
          this.startActorEntrance(actor);
        }
        continue;
      }
      // The mic walk. Same budget-per-frame move on the same capped `delta` as the
      // entrance below and as updateBoss() -- a backgrounded tab must never teleport a
      // walker onto the mark in one frame. One straight segment (both marks sit on
      // stageFootY), so it needs none of the entrance's waypoint bookkeeping.
      if (actor.state === 'walking_to_mic') {
        const mic = this.getActorMic(actor);
        if (!mic) {
          actor.state = 'mic_wait';
          continue;
        }
        const step = mic.speedPxPerSecond * (delta / 1000);
        const dx = mic.x - actor.sprite.x;
        if (Math.abs(dx) <= step) {
          actor.sprite.setPosition(mic.x, mic.floorY);
          this.arriveAtMic(actor);
        } else {
          actor.sprite.setPosition(actor.sprite.x + Math.sign(dx) * step, mic.floorY);
        }
        continue;
      }
      if (actor.state !== 'walking_in') continue;

      const entrance = actor.spec.entrance;
      // Budget-per-frame walk: leftover distance carries into the next path segment, so a
      // long frame can't stall an actor on a waypoint it has already overshot.
      let remaining = entrance.speedPxPerSecond * (delta / 1000);
      while (remaining > 0 && actor.pathSegmentIndex < entrance.path.length) {
        const waypoint = entrance.path[actor.pathSegmentIndex];
        const dx = waypoint.x - actor.sprite.x;
        const dy = waypoint.y - actor.sprite.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= remaining) {
          actor.sprite.setPosition(waypoint.x, waypoint.y);
          actor.pathSegmentIndex++;
          remaining -= distance;
        } else {
          actor.sprite.setPosition(
            actor.sprite.x + (dx / distance) * remaining,
            actor.sprite.y + (dy / distance) * remaining
          );
          remaining = 0;
        }
      }

      if (actor.pathSegmentIndex >= entrance.path.length) {
        actor.sprite.setPosition(actor.spec.targetX, actor.spec.footY);
        // An actor that took its last hit mid-walk (strikeActor() lets it finish the route
        // rather than freezing it there) goes straight to dizzy on arrival instead of
        // standing idle first -- same helper the standing-hit path uses.
        if (actor.hitsReceived >= actor.spec.hitsRequired) {
          this.beginActorDizzy(actor);
        } else {
          actor.state = 'engageable';
          this.setActorVisual(actor, actor.spec.idle);
        }
      }
    }
    // Polled once per frame rather than fired from the three places that can change the
    // answer (a soprano reaching mic_wait, a walker arriving, the last entrance finishing):
    // it early-returns in one comparison on every level that has no mic at all.
    this.releaseNextMicWalker(this.theatreMic);
    this.releaseNextMicWalker(this.partyMic);
  }

  // Admission control for either level's own mic: at most ONE walker at a time, in its
  // fixed gold -> green -> red order, and not until every entrance has finished. A soprano who goes
  // dizzy out of turn simply stands at mic_wait on her own mark, idling, until her turn
  // comes -- a known, accepted visible compromise, not a bug.
  getActorMic(actor) {
    const performance = actor.spec.performance;
    return performance && performance.kind === 'mic' ? this[performance.micInstance] : null;
  }

  releaseNextMicWalker(mic) {
    if (!mic || mic.walkerId || mic.joined.length >= mic.joinOrder.length) return;
    // An outward entrance and an inward mic walk crossing on the same stage would read as
    // two people walking through each other. Entrances never restart, so once this clears
    // it stays clear -- no need to latch it.
    if (this.interactiveActors.some((a) => a.state === 'waiting_entry' || a.state === 'walking_in')) return;
    const nextId = mic.joinOrder[mic.joined.length];
    const actor = this.interactiveActors.find((a) => (
      a.spec.id === nextId && a.state === 'mic_wait' && this.getActorMic(a) === mic
    ));
    if (!actor) return;
    mic.walkerId = nextId;
    actor.state = 'walking_to_mic';
    // Every walk-in sheet in this game is drawn walking LEFT. Resolve the facing from this
    // actor's own mic destination rather than assuming which side of its marks a level uses.
    actor.sprite.setFlipX(mic.x > actor.sprite.x);
    this.setActorVisual(actor, actor.spec.walkIn || actor.spec.idle);
  }

  // The ONE place the join count changes, and the only place it may. Everything here
  // happens in a single synchronous pass so no frame can show a soprano and her composite
  // copy at the same time.
  arriveAtMic(actor) {
    const mic = this.getActorMic(actor);
    if (!mic) return;
    // Idempotence + ordering, checked rather than assumed: the count stays inside 0..3 and
    // a duplicate id can never be admitted twice. An already-joined actor is left exactly
    // as she is -- re-entering her at mic_wait would resurrect a soprano the composite has
    // already absorbed.
    if (mic.joined.includes(actor.spec.id)) {
      if (mic.walkerId === actor.spec.id) mic.walkerId = null;
      return;
    }
    // Arriving out of turn (or after the mic filled): refused, and parked back at mic_wait
    // so the release pass can send her on her real turn instead of admitting her early.
    if (actor.spec.id !== mic.joinOrder[mic.joined.length]) {
      actor.state = 'mic_wait';
      if (mic.walkerId === actor.spec.id) mic.walkerId = null;
      this.setActorVisual(actor, actor.spec.idle);
      return;
    }
    actor.state = 'joined_mic';
    // Hidden, not destroyed: the roster owns every actor sprite from build to
    // destroyInteractiveActors(), and an early destroy would leave a dead sprite in it.
    actor.sprite.anims.stop();
    actor.sprite.setVisible(false);
    mic.joined.push(actor.spec.id);
    mic.walkerId = null;

    if (mic === this.theatreMic) {
      this.applyTheatreSingingState();
    } else {
      // The swap that makes her appear at the mic. setActorVisual()'s fixed-anchor path keeps
      // the stand itself pinned and unchanged in size across it.
      this.setActorVisual(mic, mic.visuals[mic.joined.length]);
    }
  }

  applyTheatreSingingState() {
    const mic = this.theatreMic;
    if (!mic) return;

    if (this.theatreSingingActive) {
      this.setActorVisual(mic, mic.visuals[mic.joined.length]);
      for (const id of mic.joined) {
        const actor = this.interactiveActors.find((a) => a.spec.id === id);
        if (actor) {
          actor.sprite.setVisible(false);
          actor.sprite.anims.stop();
        }
      }
    } else {
      this.setActorVisual(mic, mic.visuals[0]);
      for (const id of mic.joined) {
        const actor = this.interactiveActors.find((a) => a.spec.id === id);
        if (actor) {
          const offsetX = THEATRE_SOPRANO_REST_OFFSETS[id] || 0;
          actor.sprite.setPosition(mic.x + offsetX, mic.floorY);
          actor.sprite.setFlipX(false);
          actor.sprite.setVisible(true);
          this.setActorVisual(actor, actor.spec.idle);
        }
      }
    }
  }

  updateTheatreSopranosSingingGate(elapsed) {
    if (!this.level2Active || !this.theatreMic) return;
    const shouldSing = isTheatreSingingWindow(elapsed);
    if (this.theatreSingingActive !== shouldSing) {
      this.theatreSingingActive = shouldSing;
      this.applyTheatreSingingState();
    }
  }

  getActorHitRect(actor) {
    const sprite = actor.sprite;
    const meta = this.cfg.sprites[sprite.texture.key];
    // Origins locate the anchor within the full frame; content offsets then move from that
    // frame's top-left to the visible silhouette. When flipX is set, the CONTENT offset is
    // reflected (its left edge becomes frameWidth - contentLeft - contentWidth) but the
    // ANCHOR is not: Phaser mirrors the art inside the frame's existing world box rather
    // than about the origin, so the box itself does not move. Measured, not assumed --
    // reflecting the anchor as well put this rectangle 4.6px left of the drums' real
    // rendered silhouette on musician_drums_love (originX 0.5116), read straight off the
    // canvas pixels with every other object hidden. Actors still never rotate.
    const contentLeft = sprite.flipX
      ? meta.frameWidth - meta.contentLeft - meta.contentWidth
      : meta.contentLeft;
    const left = sprite.x + (contentLeft - sprite.originX * meta.frameWidth) * sprite.scaleX;
    const top = sprite.y + (meta.contentTop - sprite.originY * meta.frameHeight) * sprite.scaleY;
    const width = meta.contentWidth * sprite.scaleX;
    let height = meta.contentHeight * sprite.scaleY;
    if (actor.spec.clipBottomY !== null) {
      height = Math.max(0, Math.min(top + height, actor.spec.clipBottomY) - top);
    }
    return { left, top, width, height };
  }

  getProjectileTargetRect(target) {
    if (!target || !target.entity) return null;
    if (target.kind === 'actor' || target.kind === 'boss') {
      return this.getActorHitRect(target.entity);
    }
    if (target.kind === 'player') {
      const bounds = target.entity.getBounds();
      return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    }
    return null;
  }

  isProjectileTargetEligible(projectile, target) {
    if (!target || !target.entity || target.entity === projectile.emitter) return false;
    if (target.kind === 'actor') {
      return projectile.team === 'player'
        && this.interactiveActors.includes(target.entity)
        && this.canHitActor(target.entity);
    }
    if (target.kind === 'boss') {
      return projectile.team === 'player' && this.boss === target.entity;
    }
    if (target.kind === 'player') {
      return projectile.team === 'hostile' && target.entity === this.player
        && !!this.player.active && !this.manosDefeated;
    }
    return false;
  }

  getProjectileTargetPoint(projectile, target = projectile.target) {
    if (!this.isProjectileTargetEligible(projectile, target)) return null;
    const rect = this.getProjectileTargetRect(target);
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    // The rectangle centre is deliberately interior, avoiding a grazing shot whose icon
    // only kisses a boundary. Target acquisition guides visible travel; this point never
    // awards a hit -- the swept collision owner below remains authoritative.
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  getProjectileCollisionCandidates(projectile) {
    const candidates = [];
    if (projectile.team === 'player') {
      for (const actor of this.interactiveActors) {
        const target = { kind: 'actor', entity: actor };
        if (this.isProjectileTargetEligible(projectile, target)) candidates.push(target);
      }
      if (this.boss) {
        const target = { kind: 'boss', entity: this.boss };
        if (this.isProjectileTargetEligible(projectile, target)) candidates.push(target);
      }
    } else if (projectile.team === 'hostile') {
      // Package G can use this seam by spawning a hostile projectile with the boss as its
      // emitter and an onImpact callback. Package F does not make the boss fire it.
      const target = { kind: 'player', entity: this.player };
      if (this.isProjectileTargetEligible(projectile, target)) candidates.push(target);
    }
    return candidates;
  }

  getSweptProjectileContactTime(projectile, rect) {
    // Sweep the projectile's extent by expanding the target AABB, then intersect the
    // logical projectile centre's actual per-frame segment against that expanded box.
    const left = rect.left - projectile.halfWidth;
    const right = rect.left + rect.width + projectile.halfWidth;
    const top = rect.top - projectile.halfHeight;
    const bottom = rect.top + rect.height + projectile.halfHeight;
    const x0 = projectile.previousX;
    const y0 = projectile.previousY;
    const dx = projectile.sprite.x - x0;
    const dy = projectile.sprite.y - y0;
    let enter = 0;
    let exit = 1;

    const clipAxis = (origin, distance, min, max) => {
      if (Math.abs(distance) < 0.000001) return origin >= min && origin <= max;
      let t0 = (min - origin) / distance;
      let t1 = (max - origin) / distance;
      if (t0 > t1) [t0, t1] = [t1, t0];
      enter = Math.max(enter, t0);
      exit = Math.min(exit, t1);
      return enter <= exit;
    };

    if (!clipAxis(x0, dx, left, right) || !clipAxis(y0, dy, top, bottom)) return null;
    return enter >= 0 && enter <= 1 ? enter : null;
  }

  // The single collision owner for every projectile team. It evaluates all eligible
  // objects against the projectile's swept travel segment, orders them by physical
  // contact time, and consumes exactly the first contact whose effect accepts it.
  tryHitInteractiveActor(projectile) {
    const contacts = [];
    for (const target of this.getProjectileCollisionCandidates(projectile)) {
      const rect = this.getProjectileTargetRect(target);
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const time = this.getSweptProjectileContactTime(projectile, rect);
      if (time !== null) contacts.push({ target, time });
    }
    contacts.sort((a, b) => a.time - b.time);

    for (const contact of contacts) {
      const { target, time } = contact;
      if (!this.isProjectileTargetEligible(projectile, target)) continue;
      const endX = projectile.sprite.x;
      const endY = projectile.sprite.y;
      projectile.sprite.setPosition(
        projectile.previousX + (endX - projectile.previousX) * time,
        projectile.previousY + (endY - projectile.previousY) * time
      );
      if (target.kind === 'actor' && this.strikeActor(target.entity)) return true;
      if (target.kind === 'boss' && this.tryHitBoss(projectile, target.entity)) return true;
      if (target.kind === 'player' && this.tryHitPlayer(projectile, target.entity)) return true;
      projectile.sprite.setPosition(endX, endY);
    }
    return false;
  }

  // The SINGLE eligibility rule for taking a hit, read by both the collision search above
  // and strikeActor() below, so the two can never disagree. An actor is a target while it
  // is walking on (a hit mid-entrance now counts -- it used to be ignored) or standing
  // engageable, and only until it has absorbed its threshold; dizzy, fading, performing
  // and waiting-in-the-wings actors are all out.
  canHitActor(actor) {
    // The cue owns the keyboardist completely while either solo pose is active. This
    // explicit exclusion is intentionally ahead of the ordinary walking/engageable
    // whitelist so a future broadening of that whitelist cannot make the solo hittable.
    if (actor.state === 'keyboard_solo_walking' || actor.state === 'keyboard_solo_standing') return false;
    return (actor.state === 'walking_in' || actor.state === 'engageable')
      && actor.hitsReceived < actor.spec.hitsRequired;
  }

  strikeActor(actor) {
    if (!this.canHitActor(actor)) return false;
    // Clamped rather than a bare ++ so the count can never run past the threshold if a
    // future caller strikes outside the state guard.
    actor.hitsReceived = Math.min(actor.hitsReceived + 1, actor.spec.hitsRequired);
    if (actor.hitsReceived < actor.spec.hitsRequired) return true;
    // Threshold reached mid-entrance: the actor FINISHES walking to its mark first and
    // updateInteractiveActors() starts the dizzy on arrival. Freezing it here would park a
    // body mid-route, which every roster's entrance spacing assumes cannot happen (that
    // maths only knows "still walking" or "parked on its mark") and could block a later
    // same-wing entrant behind it.
    if (actor.state === 'walking_in') return true;
    this.beginActorDizzy(actor);
    return true;
  }

  // The ONE place an actor becomes dizzy, whichever route got it there -- hit to threshold
  // while standing, or hit to threshold mid-walk and arriving afterwards. Both call this;
  // neither duplicates the visual swap or the perform trigger.
  beginActorDizzy(actor) {
    actor.state = 'dizzy';
    this.setActorVisual(actor, actor.spec.dizzy);
    // The BAND's bounded timer, and only the band's: this used to test `performance` for
    // truthiness, which was the same thing while `instrument` was the only kind there was.
    // A Theatre soprano now carries a performance too and must keep the one-full-cycle
    // dizzy hold below, so the test names the kind it actually means.
    if (actor.spec.performance && actor.spec.performance.kind === 'instrument') {
      // A real bounded window (see ACTOR_DIZZY_HOLD_MS), on the scene's own timer so it is
      // paused/destroyed with the scene and cancellable by name at teardown.
      actor.dizzyTimer = this.time.delayedCall(ACTOR_DIZZY_HOLD_MS, () => {
        actor.dizzyTimer = null;
        this.beginActorPerformance(actor);
      });
      return;
    }
    // No performance sheet (sopranos, or a band member whose sheet isn't registered yet):
    // the pre-existing trigger, unchanged. The dizzy animation is repeat:-1, so
    // 'animationcomplete' NEVER fires for it -- 'animationrepeat' is the only event that
    // marks the end of one full cycle. The sprite emits it for whatever animation it
    // happens to be running, hence the key filter.
    actor.dizzyRepeatHandler = (anim) => {
      if (anim.key !== actor.spec.dizzy.animationKey) return;
      this.beginActorPerformance(actor);
    };
    actor.sprite.on('animationrepeat', actor.dizzyRepeatHandler);
  }

  // Cancels everything this actor owns that could still fire at it later: the dizzy-cycle
  // listener, bounded dizzy timer and either half of the fade. Called before a
  // performance takeover and again from destroyInteractiveActors() before the sprite is
  // destroyed, so no queued callback can reach a dead sprite or resurrect state across a
  // Level 1 -> 2 -> 3 transition.
  clearActorPerformanceTrigger(actor) {
    if (actor.dizzyRepeatHandler) {
      actor.sprite.off('animationrepeat', actor.dizzyRepeatHandler);
      actor.dizzyRepeatHandler = null;
    }
    if (actor.dizzyTimer) {
      actor.dizzyTimer.remove(false);
      actor.dizzyTimer = null;
    }
    if (actor.performTween) {
      actor.performTween.stop();
      actor.performTween = null;
    }
  }

  // The end of the line for a band member: fade the sprite out on its OWN alpha (never the
  // camera -- one musician changing texture must not dim the level), swap to the playing-
  // instrument loop while invisible so the change never snaps on screen, fade back in and
  // hold there. `performing` is a genuine terminal state: nothing transitions out of it.
  //
  // Anything WITHOUT performance.kind 'instrument' -- every soprano, and a band member
  // whose playing sheet isn't registered yet -- takes the pre-existing perform_stub branch
  // untouched, which starts nothing and leaves the dizzy loop running underneath.
  beginActorPerformance(actor) {
    if (!this.interactiveActors.includes(actor) || actor.state !== 'dizzy') return;
    this.clearActorPerformanceTrigger(actor);
    actor.performRequested = true;
    const performance = actor.spec.performance;
    // A mic-associated soprano: back to her own idle loop where she stands, and into her
    // level's separate mic queue. NOT the instrument fade below -- no alpha tween touches a soprano. The walk
    // itself is released by releaseNextMicWalker(), which may be several seconds later (or
    // immediately); she idles on her mark either way, so both cases look the same.
    if (performance && performance.kind === 'mic') {
      actor.state = 'mic_wait';
      this.setActorVisual(actor, actor.spec.idle);
      return;
    }
    if (!performance || performance.kind !== 'instrument') {
      actor.state = 'perform_stub';
      return;
    }
    actor.state = 'performing_fade';
    actor.performTween = this.tweens.add({
      targets: actor.sprite,
      alpha: 0,
      duration: ACTOR_PERFORM_FADE_MS,
      onComplete: () => {
        actor.performTween = null;
        // setActorVisual() owns the scale/origin/crop maths for every texture swap in this
        // game -- the playing sheets have their own frame sizes and content boxes, so
        // re-deriving any of it here is exactly the drift that method exists to prevent.
        // It does not touch flipX, so a left-wing entrant stays mirrored.
        this.setActorVisual(actor, performance);
        actor.performTween = this.tweens.add({
          targets: actor.sprite,
          alpha: 1,
          duration: ACTOR_PERFORM_FADE_MS,
          onComplete: () => {
            actor.performTween = null;
            actor.state = 'performing';
          },
        });
      },
    });
  }

  // ---- The femme-fatale boss (Level 3, 2:40) -------------------------------------------
  // Built as a standalone object rather than a roster member: `spec`/`sprite` shaped so it
  // can reuse setActorVisual() and getActorHitRect() verbatim (both read only
  // spec.displayContentHeight / spec.clipBottomY plus the sprite itself -- checked, neither
  // touches this.interactiveActors), but structurally out of reach of strikeActor() and the
  // hit-count state machine.
  //
  // Her cue is the ABSOLUTE song clock, deliberately independent of whether the player has
  // landed all 21 cast hits -- same reasoning as Level 1's keyboard solo: a fixed musical
  // beat must never become unreachable because someone missed a throw.
  spawnBoss() {
    if (this.boss || !this.cfg.sprites.femme_fatale_idle) return;
    const spec = {
      id: 'femme_fatale',
      targetX: interimX(810),   // INTERIM: just outside the hero's box -- she walks up to him
      footY: PARTY.groundY,
      displayContentHeight: PARTY.bossContentHeight,
      idle: { textureKey: 'femme_fatale_idle', animationKey: LEVEL3_ANIM_GROUPS.loops.sheets.femme_fatale_idle },
      walkIn: this.cfg.sprites.femme_fatale_entrance
        ? { textureKey: 'femme_fatale_entrance', animationKey: LEVEL3_ANIM_GROUPS.walkIns.sheets.femme_fatale_entrance }
        : null,
      clipBottomY: null,
    };
    const sprite = this.add.sprite(PARTY.wingX, PARTY.groundY, spec.idle.textureKey, 0)
      .setDepth(PARTY_DEPTH.boss);
    this.boss = { spec, sprite, state: spec.walkIn ? 'walking_in' : 'on_mark' };
    this.setActorVisual(this.boss, spec.walkIn || spec.idle);
    // Her arrival is what lights the heart marquee -- Hazem's own note in GAME_PLAN
    // section 0 ties the lit plate specifically to this beat, not to ambient time.
    this.swapToLitPartyBackground();
    if (this.boss.state === 'on_mark') this.arriveBoss();
  }

  // Same budget-per-frame walk as updateInteractiveActors(), on the same capped `delta`
  // (a backgrounded tab must not teleport her onto her mark in one frame). One straight
  // segment, so it needs none of the roster version's path/waypoint bookkeeping.
  updateBoss(delta) {
    const boss = this.boss;
    if (!boss || boss.state !== 'walking_in') return;
    const step = PARTY.bossEntranceSpeedPxPerSecond * (delta / 1000);
    const dx = boss.spec.targetX - boss.sprite.x;
    if (Math.abs(dx) <= step) {
      boss.sprite.setPosition(boss.spec.targetX, boss.spec.footY);
      this.arriveBoss();
      return;
    }
    boss.sprite.setPosition(boss.sprite.x + Math.sign(dx) * step, boss.spec.footY);
  }

  // Package G (docs/LEVEL3_BOSS_SEQUENCE_SPEC.md): arrival throws the kiss. It no longer
  // kills Manos directly -- that was the game's last true instant/implied hit. The actual
  // defeat now only ever happens through the kiss's onImpact seam (handleBossKissImpact()).
  arriveBoss() {
    this.boss.state = 'on_mark';
    this.setActorVisual(this.boss, this.boss.spec.idle);
    this.spawnBossKiss();
  }

  // The kiss she throws from her forehead (spec section "The sequence he wants", step 2): a
  // REAL projectile spawned through F's hostile seam, so it travels and is dodgeable in
  // principle rather than an implied hit. One-shot per boss appearance.
  spawnBossKiss() {
    const boss = this.boss;
    if (!boss || this.bossKissRequested) return;
    this.bossKissRequested = true;
    const spawn = {
      x: boss.sprite.x,
      y: boss.sprite.y - boss.spec.displayContentHeight * BOSS_KISS_FOREHEAD_HEIGHT_RATIO,
    };
    const flip = this.player.x <= boss.sprite.x; // true == travelling toward -x
    this.spawnProjectileDirectional('kiss', flip, {
      team: 'hostile',
      emitter: boss.sprite,
      // Stand-in texture -- no kiss-specific projectile art exists yet. Real art:
      // assets/generated/effects/boss_killer_look/boss_killer_look_projectile.png (named in
      // docs/PLAN_SWAP_BLOCKING_HITS.md's Item 3), registered like any other sprite key.
      textureKey: 'heart_icon',
      spawn,
      target: { kind: 'player', entity: this.player },
      onImpact: () => this.handleBossKissImpact(),
    });
  }

  // The kiss landing (spec steps 3-6): dizzy -> dizzy WHILE singing -> the existing
  // non-looping collapse -> floor singing. Locks input immediately, same as killManos(),
  // but defers the actual defeat/collapse until the hit anim completes and the singing hold
  // below finishes. Idempotent
  // against a duplicate onImpact call.
  handleBossKissImpact() {
    if (this.manosDefeated || this.bossSequenceActive) return;
    this.bossSequenceActive = true;
    this.cancelGesture();
    this.mSequenceActive = false;
    this.debugRapidFireAccumMs = 0;
    this.touchState.left = false;
    this.touchState.right = false;
    this.touchState.jump = false;
    this.player.setVelocityX(0);
    this.playPlayerVisual('dizzy_hit');
    this.clearBossKissHitCompletionHandler();
    this.bossKissHitCompleteHandler = () => this.advanceBossKissToSinging();
    this.player.once('animationcomplete-dizzyHitAnim', this.bossKissHitCompleteHandler);
    // Stall guard: if another player anim ever swallows dizzy_hit's completion, move on anyway.
    this.bossKissHitFallbackTimer = this.time.delayedCall(
      BOSS_KISS_HIT_FALLBACK_MS, () => this.advanceBossKissToSinging()
    );
  }

  // Shared by the dizzy_hit completion listener and its fallback timer. Whichever fires first
  // clears the other; the singing-timer check makes a second call a no-op.
  advanceBossKissToSinging() {
    this.clearBossKissHitCompletionHandler();
    if (!this.bossSequenceActive || this.bossKissSingingTimer) return;
    this.playPlayerVisual('dizzy_singing');
    this.bossKissSingingTimer = this.time.delayedCall(BOSS_KISS_SINGING_HOLD_MS, () => {
      this.bossKissSingingTimer = null;
      if (!this.bossSequenceActive) return;
      this.bossSequenceActive = false;
      // killManos() owns the actual collapse from here: grounded starts it immediately,
      // airborne lets physics settle him first (see its own comment).
      this.killManos();
    });
  }

  clearBossKissHitCompletionHandler() {
    if (this.bossKissHitFallbackTimer) {
      this.bossKissHitFallbackTimer.remove(false);
      this.bossKissHitFallbackTimer = null;
    }
    if (!this.bossKissHitCompleteHandler || !this.player) return;
    this.player.off('animationcomplete-dizzyHitAnim', this.bossKissHitCompleteHandler);
    this.bossKissHitCompleteHandler = null;
  }

  // A projectile overlapping her is consumed and nothing else -- she has no hitsReceived,
  // no dizzy sheet and no state to enter. The flag is recorded only so the future
  // no-flinch reaction (also ungenerated) has something to hang off.
  tryHitBoss(projectile, boss) {
    if (projectile.team !== 'player' || !boss || boss !== this.boss || projectile.emitter === boss) return false;
    this.bossNoFlinchRequested = true;
    return true;
  }

  // Package G's impact seam. F supplies hostile targeting/swept contact and calls the
  // callback only on physical player contact; G remains responsible for boss emission,
  // its asset/lifecycle, and passing the eventual kill callback.
  tryHitPlayer(projectile, player) {
    if (projectile.team !== 'hostile' || player !== this.player || projectile.emitter === player
      || this.manosDefeated) return false;
    if (typeof projectile.onImpact === 'function') projectile.onImpact(projectile, player);
    return true;
  }

  destroyBoss() {
    if (!this.boss) return;
    this.boss.sprite.destroy();
    this.boss = null;
  }

  clearDeathCompletionHandler() {
    if (!this.deathCompleteHandler || !this.player) return;
    this.player.off('animationcomplete-dizzyDeathAnim', this.deathCompleteHandler);
    this.deathCompleteHandler = null;
  }

  // State 6 (spec): singing on the floor, cut to from the collapse's final pose. Plays the real
  // floor_singing loop from frame 0.
  startFloorSinging() {
    const visual = this.getPlayerVisual('floor_singing');
    this.player.anims.play(visual.animationKey, true);
    this.resizeBodyForTexture();
  }

  startGroundedDeath() {
    if (this.deathStarted || !this.manosDefeated) return;
    this.deathPending = false;
    this.deathStarted = true;
    this.player.setVelocity(0, 0);
    this.playPlayerVisual('dizzy_death');
    this.clearDeathCompletionHandler();
    this.deathCompleteHandler = () => {
      this.deathCompleteHandler = null;
      if (!this.manosDefeated || !this.player || !this.player.active) return;
      // Spec step 6: keeps singing on the floor, from the collapse's own final pose.
      this.startFloorSinging();
    };
    this.player.once('animationcomplete-dizzyDeathAnim', this.deathCompleteHandler);
  }

  // Defeat takes input ownership immediately. A grounded impact starts the one-shot
  // collapse now; an airborne impact keeps the current vertical velocity and gravity so
  // Manos completes the real physics arc before that grounded animation begins.
  killManos() {
    if (this.manosDefeated) return;
    this.manosDefeated = true;
    this.cancelGesture();
    this.mSequenceActive = false;
    this.debugRapidFireAccumMs = 0;
    this.touchState.left = false;
    this.touchState.right = false;
    this.touchState.jump = false;
    this.player.body.allowGravity = true;
    this.player.setVelocityX(0);
    if (this.player.body.onFloor()) {
      this.startGroundedDeath();
    } else {
      this.deathPending = true;
      this.playPlayerVisual('jump');
    }
  }

  destroyInteractiveActors() {
    for (const actor of this.interactiveActors) {
      // Drop the listener, the pending dizzy timer and any running fade tween before
      // destroy(), so no queued callback can reach a handler closed over a dead sprite --
      // this runs at both level handovers as well as at scene shutdown.
      this.clearActorPerformanceTrigger(actor);
      if (actor.keyboardSoloRestore) this.finishLevel1KeyboardSolo(actor);
      actor.sprite.destroy();
    }
    this.interactiveActors = [];
  }

  // Wires the #touch-controls DOM overlay (index.html) to this.touchState. Pointer
  // events, not click, so held movement/jump buttons give real press-and-hold behaviour.
  setupTouchControls() {
    const bind = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); onDown(); });
      if (onUp) {
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointerleave', onUp);
        el.addEventListener('pointercancel', onUp);
      }
    };
    bind('btn-left', () => { this.touchState.left = true; }, () => { this.touchState.left = false; });
    bind('btn-right', () => { this.touchState.right = true; }, () => { this.touchState.right = false; });
    bind('btn-jump', () => { this.touchState.jump = true; }, () => { this.touchState.jump = false; });
    bind('btn-heart', () => { this.touchState.heart = true; });
    bind('btn-flowers', () => { this.touchState.flowers = true; });
    bind('btn-dizzy', () => { this.touchState.dizzy = true; });
  }

  startGesture(type) {
    this.gesture = type;
    if (type === 'heart') {
      this._projSpawned = false;
      this.playPlayerVisual('heart');
      this.gestureCompleteEvent = 'animationcomplete-giveHeartAnim';
      this.gestureCompleteHandler = () => {
        this.gestureCompleteEvent = null;
        this.gestureCompleteHandler = null;
        this.gesture = null;
      };
      this.player.once(this.gestureCompleteEvent, this.gestureCompleteHandler);
    } else if (type === 'flowers') {
      this._projSpawned = false;
      this.playPlayerVisual('flowers');
      this.gestureCompleteEvent = 'animationcomplete-giveFlowersAnim';
      this.gestureCompleteHandler = () => {
        this.gestureCompleteEvent = null;
        this.gestureCompleteHandler = null;
        this.gesture = null;
      };
      this.player.once(this.gestureCompleteEvent, this.gestureCompleteHandler);
    } else if (type === 'dizzy') {
      this.playPlayerVisual('dizzy_love');
      this.gestureTimer = this.time.delayedCall(2000, () => {
        this.gestureTimer = null;
        this.gesture = null;
      });
    }
  }

  cancelGesture() {
    if (this.gestureCompleteHandler && this.player) {
      this.player.off(this.gestureCompleteEvent, this.gestureCompleteHandler);
    }
    this.gestureCompleteEvent = null;
    this.gestureCompleteHandler = null;
    if (this.gestureTimer) this.gestureTimer.remove(false);
    this.gestureTimer = null;
    this.gesture = null;
  }

  // The solo temporarily owns the real Level 1 keyboard actor. The restore state is
  // decided once, before any visual is changed, so completion never tries to reconstruct
  // a half-finished dizzy timer or alpha fade.
  getKeyboardSoloRestoreState(actor, priorState) {
    switch (priorState) {
      case 'dizzy':
      case 'performing_fade':
      case 'performing':
      case 'perform_stub':
        return actor.spec.performance ? 'performing' : 'engageable';
      case 'waiting_entry':
      case 'walking_in':
      case 'engageable':
        return actor.hitsReceived < actor.spec.hitsRequired
          ? 'engageable'
          : (actor.spec.performance ? 'performing' : 'engageable');
      default:
        return actor.hitsReceived < actor.spec.hitsRequired
          ? 'engageable'
          : (actor.spec.performance ? 'performing' : 'engageable');
    }
  }

  startLevel1KeyboardSolo() {
    const actor = this.interactiveActors.find((candidate) => candidate.spec.id === 'keyboard');
    if (!actor || actor.state === 'keyboard_solo_walking' || actor.state === 'keyboard_solo_standing') return;
    if (!this.cfg.sprites[KEYBOARD_SOLO_VISUALS.walking.textureKey]
      || !this.cfg.sprites[KEYBOARD_SOLO_VISUALS.standing.textureKey]) return;

    const priorState = actor.state;
    // Cancels a bounded dizzy callback or either half of the playing-sheet alpha fade.
    // Neither is allowed to wake up after the solo has claimed this sprite.
    this.clearActorPerformanceTrigger(actor);
    actor.keyboardSoloRestore = {
      state: this.getKeyboardSoloRestoreState(actor, priorState),
      flipX: actor.sprite.flipX,
    };
    // INTERIM (band placement held): old 135 / 475..815, converted.
    actor.keyboardSoloTargetX = Phaser.Math.Clamp(this.player.x - interimX(135), interimX(475), interimX(815));
    actor.state = 'keyboard_solo_walking';
    actor.sprite.setVisible(true);
    actor.sprite.setAlpha(1);
    // Every keyboard walking sheet faces left in its source art.
    actor.sprite.setFlipX(actor.keyboardSoloTargetX > actor.sprite.x);
    this.setActorVisual(actor, KEYBOARD_SOLO_VISUALS.walking);
  }

  updateLevel1KeyboardSolo(delta) {
    const actor = this.interactiveActors.find((candidate) => candidate.spec.id === 'keyboard');
    if (!actor || actor.state !== 'keyboard_solo_walking') return;
    const step = KEYBOARD_SOLO_WALK_SPEED * (delta / 1000);
    const dx = actor.keyboardSoloTargetX - actor.sprite.x;
    if (Math.abs(dx) <= step) {
      actor.sprite.setPosition(actor.keyboardSoloTargetX, FARA7.stageFootY);
      actor.sprite.setFlipX(false);
      actor.state = 'keyboard_solo_standing';
      this.setActorVisual(actor, KEYBOARD_SOLO_VISUALS.standing);
      return;
    }
    actor.sprite.setPosition(actor.sprite.x + Math.sign(dx) * step, FARA7.stageFootY);
  }

  finishLevel1KeyboardSolo(actor) {
    if (!this.interactiveActors.includes(actor) || !actor.keyboardSoloRestore) return;
    actor.keyboardSoloRestore = null;
    actor.keyboardSoloTargetX = null;
  }

  // Theatre's keyboardist is deliberately standalone, like the mic composite: it has the
  // actor/spec shape needed by setActorVisual(), but is never inserted into
  // interactiveActors and therefore can never enter the projectile hit-test loop.
  startTheatreKeyboardSolo() {
    if (this.theatreKeyboardSolo || !this.cfg.sprites[KEYBOARD_SOLO_VISUALS.walking.textureKey]
      || !this.cfg.sprites[KEYBOARD_SOLO_VISUALS.standing.textureKey]) return;
    // footY/height: P4 measurement (theatre_geometry_2026-09-12.md) -- the safe performer foot
    // line and Manos's Theatre height. targetX and the spawn x are still interim (P4: cannot measure).
    const spec = {
      targetX: interimX(555),
      footY: 454.0,
      displayContentHeight: 143.2,
      depth: THEATRE_DEPTH.soprano + 1,
      clipBottomY: null,
    };
    const sprite = this.add.sprite(interimX(1010), spec.footY, KEYBOARD_SOLO_VISUALS.walking.textureKey, 0)
      .setDepth(spec.depth)
      .setFlipX(false)
      .setAlpha(1);
    this.theatreKeyboardSolo = { spec, sprite, state: 'walking', speedPxPerSecond: KEYBOARD_SOLO_WALK_SPEED };
    this.setActorVisual(this.theatreKeyboardSolo, KEYBOARD_SOLO_VISUALS.walking);
  }

  updateTheatreKeyboardSolo(delta) {
    const solo = this.theatreKeyboardSolo;
    if (!solo || solo.state !== 'walking') return;
    const step = solo.speedPxPerSecond * (delta / 1000);
    const dx = solo.spec.targetX - solo.sprite.x;
    if (Math.abs(dx) <= step) {
      solo.sprite.setPosition(solo.spec.targetX, solo.spec.footY);
      solo.state = 'standing';
      this.setActorVisual(solo, KEYBOARD_SOLO_VISUALS.standing);
      return;
    }
    solo.sprite.setPosition(solo.sprite.x + Math.sign(dx) * step, solo.spec.footY);
  }

  startTheatreAudienceFlourish() {
    this.cancelTheatreAudienceFlourish();
    const sprite = this.theatreSoloAudienceSprite;
    if (!sprite || !sprite.active) return;
    const restore = { x: sprite.x, y: sprite.y, angle: sprite.angle };
    this.theatreSoloAudienceRestore = restore;
    let tween = null;
    tween = this.tweens.add({
      targets: sprite,
      y: restore.y - 8,
      angle: -4,
      duration: 180,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        if (this.theatreSoloAudienceTween !== tween) return;
        sprite.setPosition(restore.x, restore.y).setAngle(restore.angle);
        this.theatreSoloAudienceTween = null;
        this.theatreSoloAudienceRestore = null;
      },
    });
    this.theatreSoloAudienceTween = tween;
  }

  cancelTheatreAudienceFlourish() {
    if (this.theatreSoloAudienceTween) {
      this.theatreSoloAudienceTween.stop();
      this.theatreSoloAudienceTween = null;
    }
    const sprite = this.theatreSoloAudienceSprite;
    const restore = this.theatreSoloAudienceRestore;
    if (sprite && sprite.active && restore) {
      sprite.setPosition(restore.x, restore.y).setAngle(restore.angle);
    }
    this.theatreSoloAudienceRestore = null;
  }

  destroyTheatreKeyboardSolo() {
    this.cancelTheatreAudienceFlourish();
    if (!this.theatreKeyboardSolo) return;
    this.theatreKeyboardSolo.sprite.destroy();
    this.theatreKeyboardSolo = null;
  }

  updateTheatreKeyboardBeat(elapsed, delta) {
    if (!this.level2Active || this.level3Active) return;
    if (!this.theatreKeyboardSoloRequested && elapsed >= THEATRE_KEYBOARD_SOLO_SECONDS
      && elapsed < LEVEL3_ENTRANCE_SECONDS) {
      this.theatreKeyboardSoloRequested = true;
      this.startTheatreKeyboardSolo();
      this.startTheatreAudienceFlourish();
    }
    this.updateTheatreKeyboardSolo(delta);

    if (!this.theatrePhoneRequested && elapsed >= THEATRE_PHONE_SECONDS) {
      this.theatrePhoneRequested = true;
    }
    if (!this.theatrePhoneRequested || this.theatrePhoneStarted || this.cutsceneActive || this.phoneFadedOut
      || this.level2Revealing || this.level3Requested) return;

    this.cancelGesture();
    if (!this.player.body.onFloor()) {
      if (this.exitPinX === null) this.exitPinX = this.player.x;
      const vy = this.player.body.velocity.y;
      this.player.body.reset(this.exitPinX, this.player.y);
      this.player.setVelocityY(vy);
      this.exitSettling = true;
      return;
    }

    this.exitSettling = false;
    this.exitPinX = null;
    this.theatrePhoneStarted = true;
    const walk = this.cfg.sprites.walk;
    const walkVisual = this.cfg.playerVisuals.visuals.walk;
    const walkScale = PLAYER_LEVEL_REFERENCE_HEIGHTS.theatre / walkVisual.bodyReferenceHeight;
    const walkHalfWidth = (walk.frameWidth * walkScale) / 2;
    const travelSeconds = (this.player.x + walkHalfWidth + THEATRE_EXIT_CLEARANCE_PX) / SPEED;
    this.theatreWalkOffSeconds = LEVEL3_ENTRANCE_SECONDS - travelSeconds;
    this.cutsceneActive = true;
    this.player.setCollideWorldBounds(false);
    this.startPhoneCutscene(() => this.enterLevel3(), 'theatre');
  }

  // Level 1's ONE scripted beat, and the successor to the deleted street build's
  // position-gated kiosk arrival: on a fixed single-screen stage there is no world left
  // to gate on, so the trigger is the song clock alone.
  //
  // The keyboardist begins the real solo at 0:50; Manos's existing phone exit remains an
  // independent 0:53 cue, so the standing-rock loop may overlap it. Both are deliberately
  // independent of the keyboard actor's hit count -- a fixed musical beat must not become
  // unreachable because the player never landed three hits on that one musician.
  //
  // Airborne at the handoff: pin X and let the jump finish naturally first, the same
  // recipe (body.reset() to hold X, velocityY carried across by hand because reset()
  // zeroes it, wait for onFloor()) the kiosk gate's 'settling' state used.
  updateStageExit(elapsed, delta) {
    if (!this.level2Active) this.updateLevel1KeyboardSolo(delta);
    if (this.level2Active || this.cutsceneActive || this.fadedOut) return;

    if (!this.keyboardSoloRequested) {
      if (elapsed < KEYBOARD_SOLO_SECONDS) return;
      this.keyboardSoloRequested = true;
      this.startLevel1KeyboardSolo();
    }
    if (elapsed < LEVEL1_PHONE_SECONDS) return;

    // The exit takes over the body from here, whatever gesture was mid-playback.
    this.cancelGesture();

    if (!this.player.body.onFloor()) {
      if (this.exitPinX === null) this.exitPinX = this.player.x;
      const vy = this.player.body.velocity.y;
      this.player.body.reset(this.exitPinX, this.player.y);
      this.player.setVelocityY(vy);
      this.exitSettling = true;
      return;
    }

    this.exitSettling = false;
    this.exitPinX = null;
    this.cutsceneActive = true;
    // Confinement lifts for the scripted exit (GAME_PLAN section 0): both the FARA7 clamp
    // in update() and Arcade's own world-bounds collision have to let go, or he would
    // stop dead at x=0 instead of clearing the frame.
    this.player.setCollideWorldBounds(false);
    this.startPhoneCutscene('level1');
  }

  // True once the player's own sprite bounds have fully cleared the canvas's left edge --
  // measured, not a distance-travelled guess. The camera never scrolls on this stage, so
  // world x and screen x are the same number.
  isPlayerOffscreen() {
    return this.player.getBounds().right < 0;
  }

  // Cutscene stage 1: one-shot phonePullAnim (character notices the call, reaches for
  // phone, pulls it out) plays first. On completion, the looping phoneReadAnim and DOM
  // phone panel take over. Level 1 holds that loop in place until its absolute 62s walk
  // cue; Theatre now derives its own hold-then-walk cue from the handoff position.
  startPhoneCutscene(destOrOpts, maybeOwner) {
    let destination = null;
    let owner = null;
    if (typeof destOrOpts === 'function') {
      destination = destOrOpts;
      owner = maybeOwner || null;
    } else if (destOrOpts && typeof destOrOpts === 'object') {
      destination = destOrOpts.destination || null;
      owner = destOrOpts.owner || null;
    } else if (typeof destOrOpts === 'string') {
      owner = destOrOpts;
    }

    this.phoneOwner = owner || (this.level2Active ? 'theatre' : 'level1');
    this.phoneDestination = destination || (this.level2Active ? (() => this.enterLevel3()) : (() => this.enterLevel2()));
    this.phoneFadedOut = false;
    this.phonePresentationDone = false;

    // The cutscene's movement ownership must take over THIS tick, no matter what gesture
    // (if any) was mid-playback when the handoff hit. Force any in-progress gesture to end
    // right now so the next update() tick takes the cutsceneActive branch, not the gesture one.
    this.cancelGesture();
    this.playPlayerVisual('phone_pull');
    this.phonePullCompleteHandler = () => {
      this.phonePullCompleteHandler = null;
      if (!this.isPhonePresentationCurrent()) return;
      // Level 1 holds still checking his phone (real art, RUN18 Ticket G) while the
      // movement branch keeps him on his mark. Theatre uses the same standing loop until
      // its dynamically computed walk cue, then returns to its read-while-walking stride.
      if (this.phoneOwner === 'theatre' && this.theatreWalkOffSeconds !== null
        && this.getLevelElapsed() < this.theatreWalkOffSeconds) {
        this.playPlayerVisual('phone_check_idle');
      } else {
        this.playPlayerVisual(this.phoneOwner === 'level1' ? 'phone_check_idle' : 'phone_read');
      }
      this.showPhonePanel();
    };
    this.player.once('animationcomplete-phonePullAnim', this.phonePullCompleteHandler);
  }
  isPhonePresentationCurrent() {
    if (!this.cutsceneActive || this.phoneFadedOut) return false;
    if (this.phoneOwner === 'theatre') {
      return this.level2Active && !this.level3Active;
    }
    return !this.level2Active && !this.level3Active && !this.fadedOut;
  }

  cancelPhonePresentation() {
    for (const timer of this.phoneTimers || []) {
      if (timer) timer.remove(false);
    }
    this.phoneTimers = [];

    if (this.phonePullCompleteHandler && this.player) {
      this.player.off('animationcomplete-phonePullAnim', this.phonePullCompleteHandler);
      this.phonePullCompleteHandler = null;
    }

    const panel = document.getElementById('phone-panel');
    const img = document.getElementById('phone-screen-img');
    const msg = document.getElementById('phone-message-text');
    if (img && this.phoneImageLoadHandler) {
      img.removeEventListener('load', this.phoneImageLoadHandler);
      this.phoneImageLoadHandler = null;
    }
    if (panel) panel.classList.remove('phone-panel-visible');
    if (msg) msg.hidden = true;
    this.phonePresentationDone = false;
  }

  showPhonePanel() {
    const panel = document.getElementById('phone-panel');
    const img = document.getElementById('phone-screen-img');
    const msg = document.getElementById('phone-message-text');
    if (!panel || !img || !msg || !this.isPhonePresentationCurrent()) return;
    img.src = 'assets/game/sms_stage_2_select.png';
    msg.hidden = true;
    panel.classList.add('phone-panel-visible'); // triggers the CSS slide-in transition
    // Sub-beat choreography runs on Phaser's own scene timer (delayedCall), anchored to
    // when the cutscene actually started -- NOT on getLevelElapsed()/the song clock.
    // This is deliberate: Phaser's timer pauses/resumes correctly with the game loop
    // itself, so it can't drift against a stalled/buffering audio track the way a
    // getLevelElapsed()-driven sub-timer could. The 0:50 solo request is the first
    // song-clock anchor in this sequence; every beat below it is scene time.
    const schedulePhoneStep = (delay, callback) => {
      const timer = this.time.delayedCall(delay, () => {
        if (!this.isPhonePresentationCurrent()) return;
        callback();
      });
      this.phoneTimers.push(timer);
    };

    schedulePhoneStep(400, () => { img.src = 'assets/game/sms_stage_1_notification.png'; });
    schedulePhoneStep(400 + 1500, () => { img.src = 'assets/game/sms_stage_3_opening.png'; });
    schedulePhoneStep(400 + 1500 + 1500, () => {
      img.src = 'assets/game/sms_stage_4_blank.png';
      const revealMessage = () => {
        if (!this.isPhonePresentationCurrent()) return;
        msg.hidden = false;
      };
      if (img.complete && img.naturalWidth > 0) {
        revealMessage();
      } else {
        this.phoneImageLoadHandler = () => {
          this.phoneImageLoadHandler = null;
          revealMessage();
        };
        img.addEventListener('load', this.phoneImageLoadHandler, { once: true });
      }
    });
    schedulePhoneStep(400 + 1500 + 1500 + 1000 + 4000, () => {
      panel.classList.remove('phone-panel-visible');
    });
    schedulePhoneStep(400 + 1500 + 1500 + 1000 + 4000 + 400, () => {
      if (this.phoneImageLoadHandler) {
        img.removeEventListener('load', this.phoneImageLoadHandler);
        this.phoneImageLoadHandler = null;
      }
      msg.hidden = true;
      // Level 1 has already started walking at its absolute 62s cue; this swaps out the
      // temporary phone-check loop only after the panel completes. Theatre may still be
      // holding here, so its movement branch owns the later transition to walking.
      if (this.phoneOwner === 'theatre' && this.theatreWalkOffSeconds !== null
        && this.getLevelElapsed() < this.theatreWalkOffSeconds) {
        this.playPlayerVisual('phone_check_idle');
      } else {
        this.playPlayerVisual('walk');
      }
      // The message has been shown for its full staged duration and the panel has slid
      // back out. This is half of the fade condition in update(); the other half is him
      // actually clearing the frame. Whichever finishes second is what starts the fade,
      // so a fast exit can't cut the message short and a slow one can't strand him
      // on-screen with a finished phone.
      this.phonePresentationDone = true;
    });
  }

  // Fade to the page's own background color once BOTH halves of the exit are done (see
  // update()'s exit check). Music deliberately continues at its current volume through
  // both visual fades.
  onFadeOut() {
    if (this.phoneOwner === 'theatre') {
      if (this.phoneFadedOut) return;
      this.level3Requested = true;
      this.level3Revealing = true;
    } else {
      if (this.fadedOut || this.phoneFadedOut) return;
      this.fadedOut = true;
    }
    this.phoneFadedOut = true;
    const destination = this.phoneDestination || (this.level2Active ? (() => this.enterLevel3()) : (() => this.enterLevel2()));
    this.cancelPhonePresentation();
    this.holdPosition = true;
    this.player.setVelocity(0, 0);
    this.renderLyrics(this.getLevelElapsed());
    this.cameras.main.once('camerafadeoutcomplete', () => {
      if (typeof destination === 'function') destination();
    });
    this.cameras.main.fadeOut(600, 10, 14, 26); // matches the page's #0a0e1a background, not pure black
  }

  // Install a fixed one-screen interior while the camera is fully faded out. This stays
  // on the same LevelScene/'Level' key, preserving the existing controls and volume hook.
  enterLevel2() {
    if (this.level2Active) return;
    this.cancelPhonePresentation();

    this.destroyProjectiles();
    this.destroyInteractiveActors();
    // Level 1's wedding-party dressing is Fara7-only scenery that would otherwise leak
    // straight into the Theatre (the background is replaced below).
    this.destroyPassiveAudience();
    this.cancelGesture();

    const interiorGroundY = THEATRE.apronFootY;
    this.worldMinX = 0;
    this.worldMaxX = STAGE_VIEW.width;
    this.physics.world.setBounds(0, 0, STAGE_VIEW.width, STAGE_VIEW.height);
    this.cameras.main.stopFollow();
    this.cameras.main.setFollowOffset(0, 0);
    this.cameras.main.setBounds(0, 0, STAGE_VIEW.width, STAGE_VIEW.height);
    this.cameras.main.centerOn(STAGE_VIEW.width / 2, STAGE_VIEW.height / 2);
    this.showLevelBackground('level2_theatre_bg', THEATRE_DEPTH.background);
    this.projectileForegroundDepth = null;
    this.buildTheatreActors();

    this.ground.setPosition(STAGE_VIEW.width / 2, interiorGroundY + 20);
    this.ground.setSize(STAGE_VIEW.width, 40);
    this.ground.body.updateFromGameObject();
    this.sizedForTexture = null;
    this.anchoredPlayerFrame = null;
    this.playPlayerVisual('idle', 'theatre');
    this.player.body.allowGravity = true;
    this.player.body.reset(THEATRE.playerSpawnX, interiorGroundY - 2);
    this.player.setVelocity(0, 0);
    // Package E: he now spawns at the plate's measured stage-RIGHT mark, so the whole
    // Theatre cast (trio + mic, all west of him) is on his LEFT -- flip to face it, the
    // opposite of the old stage-left spawn's flipX(false).
    this.player.setFlipX(true);
    // Re-armed after Level 1's scripted exit turned it off to let him leave the frame.
    this.player.setCollideWorldBounds(true);

    this.level2Active = true;
    this.level2Revealing = true;
    this.holdPosition = false;
    this.cutsceneActive = false;
    this.phoneOwner = null;
    this.phoneDestination = null;
    this.phoneFadedOut = false;
    this.phonePresentationDone = false;
    this.exitSettling = false;
    this.exitPinX = null;
    this.exitHoldOneTick = false;
    this.theatreWalkOffSeconds = null;
    this.theatreSingingActive = false;
    this.mSequenceActive = false;
    this.debugRapidFireAccumMs = 0;

    const touch = document.getElementById('touch-controls');
    if (touch) touch.style.removeProperty('display');

    this.renderLyrics(this.getLevelElapsed());
    this.cameras.main.once('camerafadeincomplete', () => {
      if (!this.level2Active) return;
      this.level2Revealing = false;
      this.renderLyrics(this.getLevelElapsed());
      if (window.positionCinemaLyrics) window.positionCinemaLyrics();
    });
    this.cameras.main.fadeIn(600, 10, 14, 26);
  }

  // Install the Party stage while the camera is fully faded out -- same method shape,
  // same order of operations and the same scene/'Level' key as enterLevel2().
  enterLevel3() {
    if (this.level3Active) return;

    this.destroyTheatreKeyboardSolo();
    this.cancelPhonePresentation();
    this.destroyProjectiles();
    this.destroyInteractiveActors();
    // The Theatre mic group and its join state are Level-2-only and outside the roster, so
    // nothing above reaches it. Party builds a fresh, separate mic below.
    this.destroyTheatreMic();
    // Clear the shared scenery list before Party (the background is replaced below).
    this.destroyPassiveAudience();
    this.cancelGesture();

    this.worldMinX = 0;
    this.worldMaxX = STAGE_VIEW.width;
    this.physics.world.setBounds(0, 0, STAGE_VIEW.width, STAGE_VIEW.height);
    this.cameras.main.stopFollow();
    this.cameras.main.setFollowOffset(0, 0);
    this.cameras.main.setBounds(0, 0, STAGE_VIEW.width, STAGE_VIEW.height);
    this.cameras.main.centerOn(STAGE_VIEW.width / 2, STAGE_VIEW.height / 2);

    this.showLevelBackground('level3_party_bg', PARTY_DEPTH.background);
    this.projectileForegroundDepth = null;

    this.buildPartyActors();

    this.ground.setPosition(STAGE_VIEW.width / 2, PARTY.groundY + 20);
    this.ground.setSize(STAGE_VIEW.width, 40);
    this.ground.body.updateFromGameObject();
    // Each level has its own measured on-screen anatomical reference height.
    // sizedForTexture is cleared because resizeBodyForTexture() short-circuits on an
    // unchanged texture key and would otherwise never notice the new reference height.
    this.sizedForTexture = null;
    this.anchoredPlayerFrame = null;
    this.playPlayerVisual('idle', 'party');
    this.player.body.allowGravity = true;
    this.player.body.reset(PARTY.playerSpawnX, PARTY.groundY - 2);
    this.player.setVelocity(0, 0);
    // The band enters from his right, the sopranos stand there too -- face him at the cast.
    this.player.setFlipX(false);
    this.player.setCollideWorldBounds(true);

    this.level2Active = false;
    // Cleared here, not left to Level 2's own fade-in callback: that callback bails on
    // `!this.level2Active`, so if the 2:12 fade-out ever preempts an unfinished Theatre
    // fade-in, level2Revealing stays true forever and silently blocks EVERY input branch
    // in update() for the rest of the run (observed live). Same class of leak as the
    // Theatre cast/background torn down above, and the same single owner fixes it.
    this.level2Revealing = false;
    this.level3Active = true;
    this.level3Revealing = true;
    this.holdPosition = false;
    this.cutsceneActive = false;
    this.phoneOwner = null;
    this.phoneDestination = null;
    this.phoneFadedOut = false;
    this.phonePresentationDone = false;
    this.theatreWalkOffSeconds = null;
    this.heartMarqueeTriggered = false;
    this.partyBgLit = false;
    this.mSequenceActive = false;
    this.debugRapidFireAccumMs = 0;

    this.renderLyrics(this.getLevelElapsed());
    this.cameras.main.once('camerafadeincomplete', () => {
      if (!this.level3Active) return;
      this.level3Revealing = false;
      this.renderLyrics(this.getLevelElapsed());
    });
    this.cameras.main.fadeIn(600, 10, 14, 26);
  }

  // The heart-marquee beat (143s cue / 160s spawnBoss()), one-shot via partyBgLit.
  // ponytail: the new Party plate has no heart marquee and ships as a single loop, so
  // there is nothing to swap to; the hook and its two cue callers stay so a lit loop can
  // be dropped back in here (showLevelBackground()) if that art returns.
  swapToLitPartyBackground() {
    this.partyBgLit = true;
  }

  // Heart-marquee light-up at 143s, independent of and before the 160s boss entrance.
  updateHeartMarquee(elapsed) {
    if (!this.level3Active || this.heartMarqueeTriggered) return;
    if (elapsed < HEART_MARQUEE_SECONDS) return;
    this.heartMarqueeTriggered = true;
    this.swapToLitPartyBackground();
  }

  // Her 2:40 cue, on the same absolute song clock as the 2:12 transition above.
  updateBossEntrance(elapsed) {
    if (!this.level3Active || this.bossRequested) return;
    if (elapsed < BOSS_ENTRANCE_SECONDS) return;
    this.bossRequested = true;
    this.spawnBoss();
  }

  spawnProjectile(type) {
    this.spawnProjectileDirectional(type, this.player.flipX);
  }

  getPlayerProjectileSocket(direction) {
    // Synchronise the active visual before reading the shared root/scale contract. In
    // particular, M mode can select its singing sheet earlier in this same update tick.
    this.resizeBodyForTexture();
    const bodyHeight = this.playerReferenceHeight || this.getPlayerReferenceHeight();
    return {
      x: this.player.x + direction * PLAYER_PROJECTILE_SOCKET.forwardBodyHeights * bodyHeight,
      y: this.player.y - PLAYER_PROJECTILE_SOCKET.upBodyHeights * bodyHeight,
    };
  }

  getProjectileDepth() {
    return Number.isFinite(this.projectileForegroundDepth)
      ? this.projectileForegroundDepth + 1
      : 0;
  }

  findDirectionalProjectileTarget(projectile) {
    let best = null;
    let bestDistance = Infinity;
    for (const target of this.getProjectileCollisionCandidates(projectile)) {
      const rect = this.getProjectileTargetRect(target);
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const centreX = rect.left + rect.width / 2;
      const overlapsSpawnX = projectile.spawnX >= rect.left
        && projectile.spawnX <= rect.left + rect.width;
      if (!overlapsSpawnX && projectile.direction * (centreX - projectile.spawnX) < 0) continue;
      const forwardDistance = projectile.direction > 0
        ? Math.max(0, rect.left - projectile.spawnX)
        : Math.max(0, projectile.spawnX - (rect.left + rect.width));
      if (forwardDistance < bestDistance) {
        best = target;
        bestDistance = forwardDistance;
      }
    }
    return best;
  }

  pointProjectileAtTarget(projectile) {
    const point = this.getProjectileTargetPoint(projectile);
    if (!point) return false;
    const dx = point.x - projectile.sprite.x;
    const dy = point.y - projectile.sprite.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.000001) return true;
    projectile.vx = dx / distance * projectile.speed;
    projectile.vy = dy / distance * projectile.speed;
    return true;
  }

  // `options` is also Package G's integration contract: a future boss shot supplies
  // team:'hostile', emitter, textureKey, spawn:{x,y}, optional
  // target:{kind:'player', entity:this.player}, and onImpact.
  // Player-team shots always use the one canonical Manos socket regardless of caller.
  spawnProjectileDirectional(type, flip, options = {}) {
    const isHeart = type === 'heart';
    const team = options.team || 'player';
    const direction = flip ? -1 : 1;
    const emitter = options.emitter || (team === 'player' ? this.player : null);
    const spawn = team === 'player' ? this.getPlayerProjectileSocket(direction) : options.spawn;
    if (!spawn || !Number.isFinite(spawn.x) || !Number.isFinite(spawn.y)) return null;
    const texKey = options.textureKey || (isHeart ? 'heart_icon' : 'flowers_icon');
    const icon = this.add.sprite(spawn.x, spawn.y, texKey);
    icon.setFlipX(flip);
    icon.setDepth(options.depth === undefined ? this.getProjectileDepth() : options.depth);
    const projectile = {
      sprite: icon,
      team,
      emitter,
      direction,
      speed: options.speed || PROJECTILE_SPEED,
      vx: direction * (options.speed || PROJECTILE_SPEED),
      vy: 0,
      target: options.target || null,
      onImpact: options.onImpact || null,
      ageMs: 0,
      ttlMs: options.ttlMs || PROJECTILE_TTL_MS,
      spawnX: spawn.x,
      spawnY: spawn.y,
      previousX: spawn.x,
      previousY: spawn.y,
      halfWidth: icon.displayWidth / 2,
      halfHeight: icon.displayHeight / 2,
      hasRenderedFlight: false,
    };
    if (!projectile.target) projectile.target = this.findDirectionalProjectileTarget(projectile);
    this.pointProjectileAtTarget(projectile);
    this.projectiles.push(projectile);
    return projectile;
  }

  destroyProjectiles() {
    for (const projectile of this.projectiles || []) {
      if (projectile.sprite && projectile.sprite.active) projectile.sprite.destroy();
    }
    this.projectiles = [];
  }

  updateProjectiles(delta) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      // Keep the launch state renderable for one frame. The following tick sweeps from
      // that exact socket, so delaying movement does not create a collision blind spot.
      if (!proj.hasRenderedFlight) {
        proj.hasRenderedFlight = true;
        continue;
      }
      // Accumulate age from the smoothed/capped `delta` Phaser already hands every
      // update() tick, NOT raw wall-clock `this.time.now - spawnTime` -- a backgrounded
      // tab resuming after real time has passed would otherwise make the projectile
      // jump straight to its full-flight end position in one frame (Codex second-opinion
      // review catch, RUN 11 Seq 1 -- confirmed via Phaser's own Clock/TimeStep source:
      // `delta` is deliberately capped, `time.now` is not).
      proj.ageMs += delta;
      proj.previousX = proj.sprite.x;
      proj.previousY = proj.sprite.y;
      if (proj.target && !this.isProjectileTargetEligible(proj, proj.target)) {
        // Preserve the last real heading. Losing a target never turns guidance into a
        // guaranteed hit or silently reacquires a different actor.
        proj.target = null;
      } else if (proj.target) {
        this.pointProjectileAtTarget(proj);
      }
      const stepSeconds = delta / 1000;
      proj.sprite.x += proj.vx * stepSeconds;
      proj.sprite.y += proj.vy * stepSeconds;

      // One projectile is spent by one ACCEPTED hit -- including a below-threshold one
      // that leaves the actor standing, which is what makes three hits cost three throws.
      if (this.tryHitInteractiveActor(proj)) {
        proj.sprite.destroy();
        this.projectiles.splice(i, 1);
        continue;
      }

      const outOfBounds = proj.sprite.x < this.worldMinX - PROJECTILE_WORLD_MARGIN
        || proj.sprite.x > this.worldMaxX + PROJECTILE_WORLD_MARGIN
        || proj.sprite.y < -PROJECTILE_WORLD_MARGIN
        || proj.sprite.y > STAGE_VIEW.height + PROJECTILE_WORLD_MARGIN;
      const expired = proj.ageMs > proj.ttlMs;
      if (outOfBounds || expired) {
        proj.sprite.destroy();
        this.projectiles.splice(i, 1);
      }
    }
  }

  update(time, delta) {
    if (!this.ready) return;

    // A sound that never successfully starts cannot emit BaseSound's 'complete' event.
    // `musicStarted` only flips after music.play() succeeds in setupMusic(), so this is
    // deliberately NOT a timeout for playing, paused, or temporarily state-changing audio.
    if (this.levelClockStart !== null && !this.songEnded && !this.musicStarted) {
      const fallbackElapsed = (this.time.now - this.levelClockStart) / 1000;
      if (fallbackElapsed >= SILENT_TRACK_SECONDS) this.onSongEnd();
    }

    // Single sampled value, reused below for both the lyric lookup and the cutscene
    // stage checks -- see the comment on getLevelElapsed().
    const elapsed = this.getLevelElapsed();
    const mJustDown = Phaser.Input.Keyboard.JustDown(this.keyM);
    const mSequenceEligibleAtInput = !this.introActive && !this.level2Revealing && !this.level3Revealing
      && !this.exitSettling && !this.cutsceneActive && !this.gesture && !this.manosDefeated
      && !this.bossSequenceActive;

    this.updateIntro(elapsed);
    this.updateLevelBackground(elapsed);
    // Level 1: real keyboard solo at 0:50, with the existing phone exit still fixed at
    // 0:53. Theatre owns its separate 1:45 solo and 1:53 phone presentation.
    this.updateStageExit(elapsed, delta);
    this.updateTheatreKeyboardBeat(elapsed, delta);
    // Party's own scripted beats remain fixed to the absolute song clock once it is up.
    this.updateHeartMarquee(elapsed);
    this.updateBossEntrance(elapsed);
    this.updateTheatreSopranosSingingGate(elapsed);

    // The fade waits on BOTH halves: he has fully cleared the frame AND the phone panel
    // has finished its own staged sequence. Theatre additionally waits for the absolute
    // 2:12 handoff floor; Level 1 retains its independent eligibility rules.
    const phoneCanFade = this.phoneOwner === 'theatre'
      ? (this.cutsceneActive && !this.phoneFadedOut && this.level2Active && !this.level3Active
        && elapsed >= LEVEL3_ENTRANCE_SECONDS)
      : (this.cutsceneActive && !this.fadedOut && !this.level2Active);

    if (phoneCanFade && this.phonePresentationDone && this.isPlayerOffscreen()) {
      this.onFadeOut();
    }

    this.renderLyrics(elapsed);

    const onFloor = this.player.body.onFloor();

    // Gestures are a deliberate stationary beat (GAME_PLAN.md Milestone 3: "press a
    // button, character performs a scripted gesture") -- only start one when grounded,
    // no gesture is already playing, and the cutscene hasn't taken over movement; skip
    // movement/jump entirely while one runs.
    if (!this.introActive && !this.level2Revealing && !this.level3Revealing && !this.manosDefeated
      && !this.bossSequenceActive && !this.gesture && onFloor && !this.cutsceneActive) {
      if (Phaser.Input.Keyboard.JustDown(this.keyL) || this.touchState.heart) this.startGesture('heart');
      else if (Phaser.Input.Keyboard.JustDown(this.keyF) || this.touchState.flowers) this.startGesture('flowers');
      else if (Phaser.Input.Keyboard.JustDown(this.keyD) || this.touchState.dizzy) this.startGesture('dizzy');
    }
    // Edge-triggered touch gesture flags: consumed above (or dropped, if a gesture was
    // already playing) -- reset every tick so a tap fires at most once, same as JustDown.
    this.touchState.heart = false;
    this.touchState.flowers = false;
    this.touchState.dizzy = false;

    const mSequenceEligible = mSequenceEligibleAtInput && !this.introActive && !this.level2Revealing
      && !this.level3Revealing && !this.exitSettling && !this.cutsceneActive && !this.gesture
      && !this.manosDefeated;
    if (mSequenceEligible && mJustDown) {
      this.mSequenceActive = !this.mSequenceActive;
      if (this.mSequenceActive) this.debugRapidFireAccumMs = 0;
    }

    if (this.introActive) {
      this.player.setVelocity(0, 0);
    } else if (this.manosDefeated) {
      // FIRST branch on purpose: nothing below -- input, gesture, jump or any cutscene
      // branch -- can reach him again once the boss's attack has landed. If impact was in
      // the air, vertical physics remains live until the body reports a grounded contact.
      this.player.setVelocityX(0);
      if (this.deathPending && onFloor) this.startGroundedDeath();
    } else if (this.bossSequenceActive) {
      // The kiss landed but the actual collapse hasn't started yet (spec steps 3-4, dizzy
      // then dizzy-while-singing) -- same input lockout as manosDefeated above, minus the
      // death-start check, since handleBossKissImpact() owns that handoff on its own timer.
      this.player.setVelocityX(0);
    } else if (this.level2Revealing || this.level3Revealing) {
      this.player.setVelocityX(0);
      this.playPlayerVisual('idle');
    } else if (this.gesture) {
      this.player.setVelocityX(0);
    } else if (this.exitSettling) {
      // A phone handoff caught him mid-jump: gravity finishes the arc (Y untouched), X is
      // already pinned by updateStageExit() -- arrow keys must not drag him off it.
      this.player.setVelocityX(0);
      this.playPlayerVisual('jump');
    } else if (this.cutsceneActive) {
      // Level 1 holds at the phone mark through the absolute 62s walk cue. Theatre holds
      // through its position-derived cue, then explicitly selects its walking animation
      // without ever replacing an unfinished phonePullAnim. Both exit stage LEFT.
      if (this.phoneOwner === 'level1' && elapsed < LEVEL1_WALK_OFF_SECONDS) {
        this.exitHoldOneTick = false;
        this.player.setVelocity(0, 0);
        this.player.setFlipX(true);
      } else if (this.phoneOwner === 'theatre') {
        this.exitHoldOneTick = false;
        if (this.theatreWalkOffSeconds !== null && elapsed < this.theatreWalkOffSeconds) {
          this.player.setVelocity(0, 0);
          this.player.setFlipX(true);
        } else if (this.isPlayerOffscreen()) {
          this.player.setVelocity(0, 0);
        } else {
          this.player.setVelocityX(-SPEED);
          this.player.setFlipX(true);
          const phonePullPlaying = this.player.anims.isPlaying && this.player.anims.currentAnim
            && this.player.anims.currentAnim.key === 'phonePullAnim';
          if (!phonePullPlaying) {
            this.playPlayerVisual(this.phonePresentationDone ? 'walk' : 'phone_read');
          }
        }
      } else if (this.exitHoldOneTick) {
        // Exactly one tick of stillness on his mark -- see updateStageExit().
        this.exitHoldOneTick = false;
        this.player.setVelocity(0, 0);
        this.player.setFlipX(true);
      } else if (this.isPlayerOffscreen()) {
        // Already clear of the frame and only the phone's own timing is still running.
        // Stop rather than drift indefinitely into empty world space.
        this.player.setVelocity(0, 0);
      } else {
        this.player.setVelocityX(-SPEED);
        this.player.setFlipX(true);
      }
    } else {
      const left = this.cursors.left.isDown || this.keyA.isDown || this.touchState.left;
      const right = this.cursors.right.isDown || this.touchState.right;
      const jumpPressed = this.cursors.up.isDown || this.cursors.space.isDown || this.touchState.jump;

      if (left) {
        this.player.setVelocityX(-SPEED);
        this.player.setFlipX(true);
      } else if (right) {
        this.player.setVelocityX(SPEED);
        this.player.setFlipX(false);
      } else {
        this.player.setVelocityX(0);
      }

      if (jumpPressed && onFloor) {
        this.player.setVelocityY(JUMP_VELOCITY);
      }

      if (this.mSequenceActive) {
        this.playPlayerVisual('singing');
      } else if (!onFloor) {
        this.playPlayerVisual('jump');
      } else if (left || right) {
        this.playPlayerVisual('walk');
      } else {
        this.playPlayerVisual('idle');
      }
    }

    if (this.mSequenceActive && mSequenceEligible) {
      const allActorsDone = this.interactiveActors.every((actor) => (
        actor.hitsReceived >= actor.spec.hitsRequired
        || actor.state === 'keyboard_solo_walking'
        || actor.state === 'keyboard_solo_standing'
      ));
      if (allActorsDone) {
        this.debugRapidFireAccumMs = 0;
      } else {
        this.debugRapidFireAccumMs += delta;
        if (this.debugRapidFireAccumMs >= HEART_FIRE_INTERVAL_MS) {
          this.debugRapidFireAccumMs %= HEART_FIRE_INTERVAL_MS;
          this.spawnProjectileDirectional('heart', true);
          this.spawnProjectileDirectional('heart', false);
        }
      }
    } else {
      this.debugRapidFireAccumMs = 0;
    }

    // Entrances/walk-ins, for whichever cast this.interactiveActors currently holds --
    // Level 1's band, or Level 2's sopranos. Unconditional: this used to be skipped once
    // level2Active flipped, back when only Level 1 had a cast, which left the Theatre
    // roster frozen (never walking in, never animating, never registering a hit).
    // enterLevel2() destroys the exterior cast before building the Theatre's, so nothing
    // Level-1-specific can survive into this call.
    this.updateInteractiveActors(delta);
    // Her walk-in, outside that roster by construction -- see spawnBoss().
    this.updateBoss(delta);

    // Thrown-projectile tick: runs every frame regardless of gesture state, since a
    // projectile keeps flying after its spawning gesture's animation has already ended.
    this.updateProjectiles(delta);

    // Last: the texture is now whatever this tick actually selected. See the comment on
    // resizeBodyForTexture() -- calling it before this point reads a stale frame.
    this.resizeBodyForTexture();

    // Confinement (GAME_PLAN section 0): keep him inside a play area short of the screen
    // edges, not the full canvas width. Both levels' art is a perspective set, so a
    // full-size character standing over the side walls or the band reads as
    // a giant. Lifts during phone cutscenes (cutsceneActive === true) in both Level 1 and
    // Theatre so he can walk clean off-frame (bounds === null).
    const bounds = this.cutsceneActive ? null
      : (this.level3Active ? PARTY : this.level2Active ? THEATRE : FARA7);
    if (bounds) {
      const clampedX = Phaser.Math.Clamp(this.player.x, bounds.walkMinX, bounds.walkMaxX);
      if (clampedX !== this.player.x) {
        const velocityY = this.player.body.velocity.y;
        const animationKey = this.player.anims.currentAnim ? this.player.anims.currentAnim.key : null;
        const animationWasPlaying = this.player.anims.isPlaying;
        this.player.body.reset(clampedX, this.player.y);
        this.player.setVelocity(0, velocityY);
        if (animationWasPlaying && animationKey) this.player.anims.play(animationKey, true);
      }
    }
  }
}

window.game = new Phaser.Game({
  // CANVAS, not AUTO/WEBGL: iOS Safari has a persistent, still-current (WebKit bug
  // #261331, reports through Safari 18.7.2 in 2026) WebGL context-loss bug on
  // backgrounding a tab -- the canvas freezes on its last frame (sometimes
  // permanently, no restore) when the tab is reactivated. This game has no shaders,
  // no post-processing, no particle-heavy VFX -- sprite sheets, static images, Arcade
  // physics only -- so there's nothing WebGL buys here. Canvas2D doesn't suffer this
  // bug class at all, and is also MORE pixel-accurate for pixelArt (WebGL can smear
  // 1px into 2px or wrap texture edges; Canvas always renders 1px as 1px -- see
  // phaserjs/phaser#3698). Only tradeoff is CPU-bound draw perf at high sprite counts,
  // which doesn't apply to this game's handful of sprites.
  type: Phaser.CANVAS,
  parent: 'game-container',
  width: STAGE_VIEW.width,
  height: STAGE_VIEW.height,
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: GRAVITY_Y },
      debug: false,
    },
  },
  scene: [LevelScene],
});
