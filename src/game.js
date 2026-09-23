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
// C5 "everything on the beat": the two subdivisions a repeating musical loop is quantised to.
// An 8fps loop (125ms/frame) becomes one frame per 16th note, a 4fps loop (250ms) one per 8th.
const SIXTEENTH_NOTE_MS = BEAT_MS / 4;   // ~120.97ms
const EIGHTH_NOTE_MS = BEAT_MS / 2;      // ~241.94ms == BAR_MS / 8, the backgrounds' own frame period
// Each value is 8 separate 1280x720 images, not a sheet: an 8-frame strip (10240px) or a
// 4x2 grid (5120x1440) would exceed the 4096px texture limit of mobile GPUs.
const LEVEL_BACKGROUND_KEYS = ['level1_fara7_bg', 'level2_theatre_bg', 'level3_party_bg'];
const THEATRE_POOL_TEXTURES = {
  trio: 'assets/game/environments/level2_theatre/pool_trio.png',
  manos: 'assets/game/environments/level2_theatre/pool_manos.png',
  solo: 'assets/game/environments/level2_theatre/pool_solo.png',
};
const THEATRE_BEAM_TEXTURES = {
  trio: 'assets/game/environments/level2_theatre/beam_trio.png',
  manos: 'assets/game/environments/level2_theatre/beam_manos.png',
  solo: 'assets/game/environments/level2_theatre/beam_solo.png',
};
const THEATRE_BEAM_MARKS = {
  trio: 491.08,
  manos: 641.0,
  solo: 801.71,
};
const THEATRE_BEAM_CONE = {
  topY: 256,
  topWidth: 40,
  bottomY: 454,
  bottomWidth: 180,
};
const THEATRE_BEAM_FADE_SECONDS = 60 / 124;
// Composited relative luminance where white and black ink have equal contrast (~4.58:1).
// Lyric pixels with no beam light keep cream; lit pixels below take white, at/above take black.
const THEATRE_INK_LUMINANCE_SPLIT = 0.17913;
// The cream pass colour (index.html #cinema-screen-lyrics) and its owner contrast floor, used
// only to confirm a displayed unlit pixel still holds cream at the real on-screen scale.
const THEATRE_LYRIC_CREAM_RGB = [0xf5, 0xe6, 0xc8];
const THEATRE_LYRIC_CREAM_MIN_CONTRAST = 7.0;
const THEATRE_LYRIC_INK_MIN_CONTRAST = 4.5;
const THEATRE_SRGB_LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const THEATRE_CINEMA_LYRIC_RECT = { x: 469, y: 240, width: 342, height: 40 };

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
// Walk-in facing, single owner. The old rule assumed EVERY walk-in sheet is authored walking
// LEFT, so "entered from the left wing" alone decided the mirror. That is false: rendering
// frame 4 of each sheet shows the soprano walk-ins really are drawn walking left, but all four
// Level 1 band walk-ins (musician_{keyboard,accordion,drums}_walkin, tabla_player_walkin) are
// drawn walking RIGHT. Under the old rule the flip inverted art that was already correct and
// the band moonwalked -- body facing one way, sliding the other.
//
// Owner ruling 2026-09-20: "just make them face whatever direction they are going". So facing
// is now travel direction XOR the sheet's own authored facing, and a spec states that authored
// facing with `walkInFacesRight`. Undeclared = false = the historical left-authored assumption,
// so every actor that did not opt in keeps byte-for-byte its previous flip.
//
// Both flip sites go through here -- buildInteractiveActors() (spawn) and startActorEntrance()
// (the walk itself). They used to duplicate the expression, and fixing only one gives a sprite
// that spawns facing correctly and then flips back the moment it starts walking.
function actorWalkInFlipX(spec) {
  // No entrance = no walk to face along; the sprite spawns on its mark unflipped, exactly as
  // the degraded "walk-in sheet not registered yet" path has always done.
  if (!spec || !spec.entrance) return false;
  // A left-wing entrant travels screen-RIGHT toward its mark; a right-wing entrant travels left.
  const travellingRight = spec.entrance.side === 'left';
  return travellingRight !== !!spec.walkInFacesRight;
}
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
  sheets: { supine_collapse: 'collapseAnim' },
};
const PLAYER_TERMINAL_ANIM_GROUP = {
  frameRate: 8,
  repeat: 0,
  sheets: { terminal_stillness: 'terminalStillnessAnim' },
};
const PLAYER_HEARTS_ANIM_GROUP = {
  frameRate: 8,
  repeat: -1,
  sheets: { floor_hearts: 'floorHeartsAnim' },
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
  sheets: { dizzy_singing: 'dizzySingingAnim', supine_floor_singing: 'floorSingingAnim' },
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
  dizzy_death: Object.freeze({ textureKey: 'supine_collapse', animationKey: 'collapseAnim' }),
  // --- Package G boss-kiss sequence (docs/LEVEL3_BOSS_SEQUENCE_SPEC.md) -----------------
  // State 3 -- the kiss lands: one-shot stagger that recovers to standing on its last frame.
  dizzy_hit: Object.freeze({ textureKey: 'dizzy_hit', animationKey: 'dizzyHitAnim' }),
  // State 4 -- dizzy-in-love and singing at once (loop, ended by BOSS_KISS_SINGING_HOLD_MS).
  dizzy_singing: Object.freeze({ textureKey: 'dizzy_singing', animationKey: 'dizzySingingAnim' }),
  // State 6 -- singing on the floor after the collapse (loop). Its scale is pinned to
  // dizzy_death's in assets.json so the death -> floor cut keeps the same body size.
  floor_singing: Object.freeze({ textureKey: 'supine_floor_singing', animationKey: 'floorSingingAnim' }),
  terminal_stillness: Object.freeze({ textureKey: 'terminal_stillness', animationKey: 'terminalStillnessAnim' }),
});
// Boss-kiss sequence timing (docs/LEVEL3_BOSS_SEQUENCE_SPEC.md). One-shot reactions hand off on
// animationcomplete; only the musical dizzy-singing hold is deliberately timed because that loop
// has no natural end.
const BOSS_KISS_SINGING_HOLD_MS = 3000;
// "From her forehead" (spec), as a fraction of her measured content height above her foot
// line. No measured forehead anchor exists -- her attack art is still ungenerated -- so this
// is a stand-in approximation, not a plate mark.
// Measured forehead socket on approved release frame (kiss frame index 5):
// cell (86, 52), foot anchor (96, 376), reference height 352 source px.
// Old BOSS_KISS_FOREHEAD_HEIGHT_RATIO = 0.92 produced (939.198, 359.88).
// The measured socket gives game (934.198, 359.8) when standing at (939.198, 521.8).
const BOSS_KISS_FOREHEAD_HEIGHT_RATIO = 0.92;
const BOSS_KISS_FOREHEAD_SOCKET_CELL = { x: 86, y: 52 };
const BOSS_KISS_TARGET_POINT = { x: 616.2, y: 366.4 };
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
// `anchorYOffset`, when given, is this visual's own vertical slide off the actor's foot line
// (Package K -- see setActorVisual()); the Level 1 face line uses it to lift each playing loop
// without resizing it.
function bandPerformanceVisual(textureKey, performanceHeight, anchorYOffset) {
  const animationKey = BAND_PERFORMANCE_ANIM_GROUP.sheets[textureKey];
  if (!animationKey) return null;
  const visual = { kind: 'instrument', textureKey, animationKey };
  if (performanceHeight !== undefined) visual.displayContentHeight = performanceHeight;
  if (anchorYOffset !== undefined) visual.anchorYOffset = anchorYOffset;
  return visual;
}

// P22 -- one soprano's idle visual, for BOTH levels' rosters. The owner ruled on the
// trigger directly: "that's exactly the idle animation, it's when they are in queue, but
// not singing, so they shoulder dance". So this is not a new state, a timer or a cue --
// the existing idle simply points at different art, and every place that already plays
// spec.idle is a place she is queued and not singing:
//   - on her mark after the entrance (buildInteractiveActors / arriveAtActorTarget),
//   - mic_wait, waiting her turn for the shared stand (beginActorPerformance),
//   - resting at the stand between singing windows (applyTheatreSingingState's else).
// Singing is the one state that is NOT this: arriveAtMic() stops her animation and hides
// her sprite, and the mic composite owns the figure from then on, so the dance cannot run
// underneath it.
//
// The dance sheets are 180x384/8-frame with the same content box as the standing idles to
// within 1px (identical contentTop+contentHeight, so her feet do not move), which is why
// this is a texture swap and nothing else. Falls back to the still idle if a dance sheet
// is ever unregistered or fails to load, the same tolerance the walk-ins get.
function sopranoIdleVisual(scene, sheets, colour) {
  const danceKey = `soprano_${colour}_shoulder_dance`;
  if (sheets[danceKey] && scene.hasSheet(danceKey)) {
    return { textureKey: danceKey, animationKey: sheets[danceKey] };
  }
  const idleKey = `soprano_${colour}_idle`;
  return { textureKey: idleKey, animationKey: sheets[idleKey] };
}

// Level 1 (El Fara7) geometry. Measured numbers come from
// assets/generated/environments/hz-test-regen/blocking_coordinates.json (plate-local
// 1280x720 == world); everything wrapped in interimX/interimY is an old 1376x768 value
// proportionally converted and still waiting on a design call.
//
// The plate is a raised wedding deck with plaza pavement in front; Manos stands on the front
// lip. The crowd frames (2026-09-13) rescale it slightly: last carpet row at the lip 573,
// upstage centre line 516, deck x ~172.7..1105.4 at the lip (fara7_geometry report), which
// is why the placements below were re-measured and no longer match blocking_coordinates.json.
const FARA7 = {
  // Manos's ground line on the deck's front lip. Also the ground collider's top edge and,
  // minus 150, the spawn drop height. Measured 2026-09-13, fara7_geometry report (lip row
  // 573 minus the old foot offset x sy; the transform alone gives 568.90).
  groundY: 570.17,
  // Only the keyboard solo's temporary "walk toward the player" hand-off uses this shared
  // line (updateLevel1KeyboardSolo()) -- the band's own marks are FARA7.band below.
  // Measured 2026-09-13, fara7_geometry report: set to the ground line (the old
  // interimY(628) lay below the deck lip).
  stageFootY: 570.17,
  // Measured (BLOCKING_COORDINATES.md), per band member: footX/footY, the derived
  // STANDING height (idle/walk-in/dizzy) and the plate's measured seated PERFORMANCE
  // height (the playing-instrument loop). Package E: per-visual heights (see
  // bandPerformanceVisual()/setActorVisual()) are what let one actor use both numbers.
  // footX LOCKED by the owner 2026-09-15, derived from the Level 1 Hz construction by
  // hz-test-regen/placement/level1_fara7.py (which asserts the rules): accordion's outer
  // silhouette edge on the focal-frame side (construction x 240), equal gaps (31.48px) between
  // the three left players and up to Manos. footY and heights are the 2026-09-13 fara7_geometry
  // measurements, unchanged.
  // Package I (2026-09-21): the 2026-09-19 restage (level1_fara7_restage.json) is reverted to
  // this 2026-09-15 lock, placement and sizing, per the owner -- with one change: drums and the
  // couple chair trade marks (drums on the chair's old 999.12, chair on drums' old 807.0). Each
  // keeps its own footY and height. Screen order: accordion, keyboard, tabla, Manos, couple, drums.
  // performanceFaceOffsetY (Package K, 2026-09-21): owner ruling -- in the PLAYING state every
  // band member's face sits on one line with the couple's, at Manos's breast (his drawn content
  // top + 0.30 x his drawn height = 405.06 live). Each is targetY minus the playing loop's
  // measured eye line (eye row read off frame 0 of the sheet, as a fraction of its content
  // height: keyboard 0.1365, accordion 0.1195, drums 0.1809, tabla 0.1369) at footY/performance
  // height. A pure slide: heights unchanged, and feet deliberately leave the shared foot line
  // (owner-accepted). Standing idle/walk-in/dizzy stay on footY.
  band: {
    accordion: { footX: 253.09, footY: 566.32, standingHeight: 204.4, performanceHeight: 155.3, performanceFaceOffsetY: -24.52 },
    keyboard: { footX: 391.08, footY: 565.51, standingHeight: 216.5, performanceHeight: 164.5, performanceFaceOffsetY: -18.40 },
    tabla: { footX: 511.85, footY: 565.51, standingHeight: 198.3, performanceHeight: 150.7, performanceFaceOffsetY: -30.38 },
    drums: { footX: 999.12, footY: 566.32, standingHeight: 193.3, performanceHeight: 157.7, performanceFaceOffsetY: -32.09 },
  },
  // Play area ("confinement", GAME_PLAN section 0; it LIFTS for the scripted exit). Owner lock
  // 2026-09-15: Manos may step in front of his nearest neighbour on each side (the band draws
  // behind him) but never past that neighbour's mark -- tabla's footX to the right-hand mark
  // (807.0, the couple chair's since the Package I swap).
  walkMinX: 511.85,
  walkMaxX: 807.0,
  // Manos mark, owner lock 2026-09-15: the construction centre x (the heart's centre,
  // construction 764.4 / 1.2). "Since he is the main guy" -- the hero stands under the heart.
  playerSpawnX: 637.0,
  // INTERIM (band entrances): stage-RIGHT entry mark just off the right screen edge. An actor
  // entering here travels LEFT toward its mark; whether that needs a mirror depends on the
  // sheet's own authored facing, which actorWalkInFlipX() owns.
  wingX: interimX(1330),
  // INTERIM: stage-LEFT entry mark, the mirror of wingX. An actor entering here travels RIGHT.
  leftWingX: interimX(30),
  entranceSpeedPxPerSecond: 220,
  // The bride/groom heart-chair (fara7_couple_heart_chair_idle). footY measured 2026-09-13,
  // fara7_geometry report; content height unchanged (scale 0.2951). x: Package I swap -- the
  // chair takes drums' 2026-09-15 mark (807.0); its own locked mark (999.12) went to drums.
  // footY: the 2026-09-13 measurement, on the deck with the band (band foot lines 565.5-566.3,
  // deck lip 570.17). Package K had raised it 44.95 to 517.52 so the pair's shared eye line
  // (row 102 of 477 content rows: bride 105.5, groom 98.5) met the band's face line at Manos's
  // breast (405.06) -- which left the chair base ~48px up-screen of every other figure on the
  // deck at a front-line scale, and the owner read the couple as floating. That eye-line lock
  // is DELIBERATELY SUPERSEDED by the owner's grounding correction (2026-09-23, planner's
  // ruling: physical grounding outranks Package K's eye-line rule -- a seated couple with a
  // lower eye line than standing musicians is coherent, hovering is not). The band's own
  // face-line lock is untouched. The two-sprite fallback below reads this same footY.
  couple: { x: 807.0, footY: 562.47, contentHeight: 140.8 },
};
// Background furthest back; the band and wedding-party dressing sit behind the hero.
// The crowd is the one thing IN FRONT of him (depth > the player's default 0): the fans
// are the closest bodies to camera, so their raised hands must cross over Manos, not sit
// behind him. It is its own RGBA layer rather than baked into the background loop, which
// is why the background clip deliberately contains no people.
// bandSolo: all four band members share `band`, and Phaser breaks a depth tie by display-list
// insertion order -- the roster inserts drums LAST, so the drummer won every tie and drew on
// top of the keyboard soloist once the solo walked him across the stage. The soloist takes this
// depth for the duration of the solo only (startLevel1KeyboardSolo / finishLevel1KeyboardSolo)
// and is put straight back on `band` afterwards. Deliberately a half-step rather than a
// renumber: it is strictly above every band member and strictly below `dressing` -- and so
// below `crowd`, which must stay the only layer in front of the hero.
const FARA7_DEPTH = { background: -10, band: -5, bandSolo: -4.5, dressing: -4, crowd: 5 };
const FARA7_CROWD_KEY = 'level1_fara7_crowd';
// Astra's facing ruling for Level 1 (matching Level 3, see PARTY_HELD_FLIP_X): held poses use
// the authored, unmirrored art -- flipX = false on arrival and in every stationary state (idle,
// dizzy, playing). Walking stays directional (an actor entering from the left wing is mirrored
// to face right during transit). Level 2 deliberately does NOT set this: its sopranos keep
// their pre-change baseline facing.
const FARA7_HELD_FLIP_X = false;
// Per-member exceptions to FARA7_HELD_FLIP_X, owner ruling 2026-09-21 (Package K): "the drummer
// should be mirrored, so he is facing towards the stage not away from it". His mark is the far
// stage-right one (999.12), so his held poses face LEFT, inward. Held poses only -- his walk-in
// still follows actorWalkInFlipX(). Anyone not listed keeps FARA7_HELD_FLIP_X.
const FARA7_HELD_FLIP_X_BY_MEMBER = { drums: true };
// Authored facing of the four Level 1 band walk-in sheets, owner ruling 2026-09-20 ("just make
// them face whatever direction they are going"). These sheets are drawn walking RIGHT, unlike
// the left-authored sopranos -- see actorWalkInFlipX(), which consumes this via bandMember().
// This is the WALK only; FARA7_HELD_FLIP_X above still owns every stationary pose.
const FARA7_BAND_WALK_IN_FACES_RIGHT = true;

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
  // RUN 22: the combined bride/groom heart-chair sprite. A slow 4fps secondary-motion
  // loop -- a subtle idle blink, not full character animation.
  dressing: {
    frameRate: 4,
    repeat: -1,
    sheets: {
      fara7_couple_heart_chair_idle: 'fara7CoupleHeartChairIdleAnim',
    },
  },
};

// Level 0 (cassette shop) intro -- docs/LEVEL0_CONTRACT.json (v2). One finished film
// (level0_cutscene_full: 21.000 s, 24 fps, with its own audio) starts with sound inside the first
// real gesture. Two clocks. Before PLAY the film runs free on the intro clock
// (this.introClockStart) while getLevelElapsed() stays 0; when the film reaches its on-screen PLAY
// frame the song starts at 0 (startSongClock()) and the film is held to the song clock from then
// on. The film's end is the Fara7 reveal (song 4.75 s). Band entrances stay on song time
// (LEVEL1_BAND_ENTRANCE_SONG_SECONDS), as do solo 50s, phone 53s and walk-off 62s.
// Any film failure falls back to the sprite shop scene, which presses PLAY itself.
const LEVEL0_FILM_SECONDS = 21;
// docs/level0_dialogue_final_2026-09-22/sfx_cues.json play_down: the button travels in on frame 390.
const LEVEL0_FILM_PLAY_SECONDS = 390 / 24;
const LEVEL0_REVEAL_SONG_SECONDS = LEVEL0_FILM_SECONDS - LEVEL0_FILM_PLAY_SECONDS;
// The reveal used to be song 0:15; the band's entrance offsets still count from there.
const LEVEL1_BAND_ENTRANCE_SONG_SECONDS = 15;
// Sprite fallback: pre-song shop beats (intro clock, not beat-bound), then PLAY.
const LEVEL0_SHOP_ASK_MS = 3000;       // Manos asks, caption shown; shopkeeper leans
const LEVEL0_SHOP_HANDOVER_MS = 3000;  // shopkeeper hands the tape over (cassette: shopkeeper)
const LEVEL0_SHOP_RECEIVE_MS = 3000;   // Manos receives and holds it (cassette: manos)
const LEVEL0_SHOP_MS = LEVEL0_SHOP_ASK_MS + LEVEL0_SHOP_HANDOVER_MS + LEVEL0_SHOP_RECEIVE_MS;
// Hand-over pacing (intro-clock ms -> sheet frame). Arms step through their 8 drawn poses; the tape
// glides between the same poses' sockets (getIntroCassetteWorldPos) so it stays in the hand.
const LEVEL0_SHOPKEEPER_HANDOVER_FRAMES = [[3000, 0], [3400, 1], [3750, 2], [4100, 3], [4400, 4], [4900, 5], [6000, 6], [6400, 7]];
const LEVEL0_SHOPKEEPER_HOLD_FRAMES = LEVEL0_SHOPKEEPER_HANDOVER_FRAMES.slice(3, 7); // tape in hand: f3-f6
const LEVEL0_MANOS_RECEIVE_FRAMES = [[4800, 0], [5150, 1], [5500, 2], [5800, 3], [6050, 4], [6500, 5], [7200, 6], [8000, 7]];
const LEVEL0_CASSETTE_VISIBLE_MS = 4100; // shopkeeper lifts it into view (f3)
const LEVEL0_CASSETTE_GLIDE_MS = 350;    // max half-width of each glide around a frame switch
const introFrameIndex = (table, ms) => {
  let i = -1;
  while (i + 1 < table.length && table[i + 1][0] <= ms) i += 1;
  return i;
};
const introFrameAt = (table, ms) => table[Math.max(introFrameIndex(table, ms), 0)][1];
const introSmoothstep = (a, b, v) => {
  const x = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
const introLerp = (a, b, t) => (a && b ? { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } : a || b);
// Film fallbacks on the film clock (intro clock before PLAY, PLAY + song time after it, so a
// paused song never trips them): no playback progress for STALL ms (also covers a play()
// promise that never settles), or not ended by MAX ms (the 21 s film plus 3 s of slack).
const LEVEL0_FILM_STALL_MS = 2500;
const LEVEL0_FILM_MAX_MS = 24000;
// Song-synced film drift correction: sampled this often (not every tick), seeks past tolerance.
const LEVEL0_MEDIA_DRIFT_CHECK_MS = 500;
const LEVEL0_MEDIA_DRIFT_TOLERANCE_SECONDS = 0.1;
const LEVEL0_CUTSCENE_FULL_KEY = 'level0_cutscene_full';
const LEVEL0_SHOP_BG_KEY = 'level0_shop_bg';
// The old static shop image, drawn only while level0_shop_bg is not registered.
const LEVEL0_PLACEHOLDER_BG_KEY = 'level0_cassette_shop';
const LEVEL0_COUNTER_FG_KEY = 'level0_counter_fg';
const LEVEL0_CASSETTE_KEY = 'level0_manos_cassette';
// Sprite fallback captions: Manos asks, shopkeeper replies.
const LEVEL0_CAPTION_TEXT = 'الجديد؟';
const LEVEL0_REPLY_TEXT = 'أنا مالي ومالو';
// Frame-space geometry from assets/game/environments/level0_shop/frame_space_geometry.json.
const LEVEL0_SHOP = {
  // Marks come from the Level 0 Hz construction (hz-test-regen/construction.json, design px x5/6).
  // Manos stands in front of the counter, so he draws above the counter layer; the shopkeeper is behind it.
  depth: { background: 100, actors: 101, counter: 102, manos: 103, cassette: 104 },
  manos: { x: 500, footY: 640, contentHeight: 440 }, // manos_mark.center (600,768), standing_height 528
  // Bust anchor is the counter hand; x812 puts the hand-over hand (socket f4) on the frame centre x640,
  // inside handover_zone x560-800. footY = counter_front_top_edge y528 -> 440.
  shopkeeper: { x: 812, footY: 440, contentHeight: 200 },
  handoverPoint: { x: 640, y: 340 }, // centre x768 + handover_zone centre y408 -> (640, 340)
  counter: {
    occlusionTopY: 380,    // staging.counter.occlusion_top_y
    frontTopEdgeY: 436,    // staging.counter.front_top_edge_y
    floorContactY: 611,    // staging.counter.floor_contact_y
    clipLimit: { y380_435_max_x: 859, y436_611_max_x: 424 }, // staging.manos.counter_clip_limit
    leftX: { slabY436_440: 425, faceY441_607: 425, plinthY608_611: 425 }, // staging.counter.left_x
    rightX: 1054,          // staging.counter.right_x
  },
  cassetteHeight: 34,
};
// Level 0 actor sheets (contract animKeys). Grouped by cadence like the other levels' tables;
// every consumer skips a key that is not registered yet.
const LEVEL0_ANIM_GROUPS = {
  loops: {
    frameRate: 8,
    repeat: -1,
    sheets: { manos_back_ask: 'manosBackAskAnim', manos_back_listen: 'manosBackListenAnim' },
  },
  lean: {
    frameRate: 4,
    repeat: -1,
    sheets: { shopkeeper_idle_lean: 'shopkeeperIdleLeanAnim' },
  },
  // Finite poses: the frame comes from beat progress (setIntroActorProgress()), clamped at the
  // terminal pose, never from Phaser's timer.
  oneShots: {
    frameRate: 8,
    repeat: 0,
    sheets: { manos_back_receive: 'manosBackReceiveAnim', shopkeeper_handover: 'shopkeeperHandoverAnim' },
  },
};
const LEVEL0_HELD_STATES = new Set(['ask', 'lean', 'listen']);
const level0Visual = (textureKey, animationKey) => Object.freeze({ textureKey, animationKey });
const LEVEL0_ACTOR_VISUALS = Object.freeze({
  manos: {
    ask: level0Visual('manos_back_ask', 'manosBackAskAnim'),
    receive: level0Visual('manos_back_receive', 'manosBackReceiveAnim'),
    listen: level0Visual('manos_back_listen', 'manosBackListenAnim'),
  },
  shopkeeper: {
    lean: level0Visual('shopkeeper_idle_lean', 'shopkeeperIdleLeanAnim'),
    handover: level0Visual('shopkeeper_handover', 'shopkeeperHandoverAnim'),
  },
});

// Ground-truth cue timings: the Level 1 keyboard solo begins at 0:50 and Manos's existing
// phone exit follows at 0:53. The solo overlaps the call instead of delaying it.
const KEYBOARD_SOLO_SECONDS = 50;
const LEVEL1_PHONE_SECONDS = 53;
const LEVEL1_WALK_OFF_SECONDS = 62;
const THEATRE_KEYBOARD_SOLO_SECONDS = 118;
const THEATRE_EXIT_CLEARANCE_PX = 1;
const KEYBOARD_SOLO_WALK_SPEED = 260;
// The phone pull is the registered 8-frame sheet at 10fps (0.8s). After it completes,
// Level 1 showPhonePanel() runs 0.4 + 1.5 + 1.5 + 1 + 4 + 0.4 = 8.8s before the read hold ends.
const PHONE_PULL_FRAME_RATE = 10;
const PHONE_PULL_FRAME_COUNT = 8;
const PHONE_PRESENTATION_COMPLETE_MS = 400 + 1500 + 1500 + 1000 + 4000 + 400;

// Level 2 (Theatre) short phone exit sequence (notification at 2:08 / 128s):
// slide-in (400ms) -> notification (500ms) -> app opening (500ms) -> message revealed
// -> read hold (1500ms, single constant tunable 2-4s) -> slide-out (400ms) = 3300ms (3.3s).
// Total pre-walk = 0.8s pull + 3.3s presentation = 4.1s; walk starts at 128 + 4.1 = 132.1s.
const THEATRE_PHONE_SECONDS = 128;
const THEATRE_PHONE_SLIDE_IN_MS = 400;
const THEATRE_PHONE_NOTIFICATION_MS = 500;
const THEATRE_PHONE_OPENING_MS = 500;
const THEATRE_PHONE_READ_HOLD_MS = 1500; // Single setting: adjust read duration here (owner nudge 2-4 s)
const THEATRE_PHONE_SLIDE_OUT_MS = 400;
const THEATRE_PHONE_PRESENTATION_COMPLETE_MS = THEATRE_PHONE_SLIDE_IN_MS
  + THEATRE_PHONE_NOTIFICATION_MS
  + THEATRE_PHONE_OPENING_MS
  + THEATRE_PHONE_READ_HOLD_MS
  + THEATRE_PHONE_SLIDE_OUT_MS;
const THEATRE_PHONE_PREWALK_SECONDS = (PHONE_PULL_FRAME_COUNT / PHONE_PULL_FRAME_RATE)
  + (THEATRE_PHONE_PRESENTATION_COMPLETE_MS / 1000);
// Used only when the non-blocking audio path never starts playback, so the silent
// fallback timeline can still reach the GAME_PLAN's song-end credits beat.
const SILENT_TRACK_SECONDS = 183.92816326530613;
// Credits scroll at a reading speed in stage px, so a longer roll takes longer instead of rushing.
const CREDITS_SCROLL_STAGE_PX_PER_SEC = 60;
// The ending's authored root x (docs/ASTRA_PLAN_ENDING_SUPINE.md: root (620, 521.8)) --
// the P34 settle walks Manos here before the kiss. The hearts below are placed against it.
const ENDING_MARK_X = 620.0;
const ENDING_MARK_TOLERANCE_PX = 0.5;
const FLOOR_HEARTS_POSITION = Object.freeze({ x: 625, y: 439 });
const FLOOR_HEARTS_FADE_MS = 1000;

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
  apronFootY: 454.0,
  // Player movement limits remain wider than the final centred performance mark.
  walkMinX: interimX(480),
  walkMaxX: 790.7,
  // Measured: Manos 143.2px tall on the plate / idle contentHeight 346.
  playerScale: 0.414,
  // Final P4 mark: centred on the stage-backdrop axis, right of the trio.
  playerSpawnX: 641.0,
  // Measured per soprano (the engine allows one height per actor). Green leans into the
  // mic on the plate, so she takes gold's standing height.
  sopranoContentHeights: { gold: 139.4, green: 139.4, red: 145.5 },
  // The mic composite's content height in setActorVisual()'s fixed-anchor form: the
  // measured scale 0.3181 x MIC_ANCHOR.refContentHeight (441). Correct for `empty`, `_1`
  // and `_2` -- gold spans 440 frame rows in both sheets that carry her, so she draws at
  // 139.9px against the 139.4 she stands at -- and NOT correct for `_3`; see below.
  micContentHeight: 140.3,
  // Package G, the 3-joined state only. The owner's trio sheet draws its singers smaller
  // relative to the frame than the first three sheets do, so at the shared height above it
  // came out ~20% short. Derived from the sheet's own pixels with tools/_pkgG_figures.py,
  // measuring each singer head-top-to-floor inside her own column band across all 8 frames
  // -- the same span that reads 440 rows -> 139.9px for gold in `_1`/`_2`, which is what
  // makes those two states right and what this number reproduces:
  //   gold 354 rows every frame  -> needs 139.4/354 x 441 = 173.7
  //   blue 366..371, mean 369.9  -> needs 145.5/369.9 x 441 = 173.5
  // 173.6 splits them: gold lands at 139.3 (-0.1) and blue at 145.6 (+0.1), so the pair's
  // worst case is ~0.1px. Green cannot be satisfied by the same scale and is not meant to
  // be: she LEANS into the mic on this sheet (317..341 rows against gold's flat 354), so
  // she lands at 129.7px, 9.7px under her standing height. That is the pose, not the
  // scale -- she leans in `theatre_mic_2` too and draws 126.9px there today, which has
  // always been accepted, and 129.7 is 2.8px TALLER than that. Any scale that stood her
  // at 139.4 would blow gold and blue up to ~150 and ~157.
  micThreeContentHeight: 173.6,
  // INTERIM: stage-left entry mark (old 470), converted.
  wingX: interimX(470),
  entranceSpeedPxPerSecond: 220,
  // Final P4 trio/mic composite mark.
  micX: 491.08,
  // P10's two peek marks, one per red stage-curtain leg. MEASURED off frame_00 of
  // level2_theatre and off a live capture (docs/verify_pkgD2_2026-09-20/), not guessed.
  // anchorY/rightX were corrected in D2; the first pass put the busts on the floor.
  //  - anchorY 370 is a STANDING head height, derived not chosen. The sprite's origin is
  //    THEATRE_PEEK_ANCHOR's frame point (215, 253) and every sheet's content ends at row
  //    252, so at scale contentHeight/refContentHeight = 55/225 = 0.2444 a head top lands
  //    at anchorY + (contentTop - 253) * 0.2444, i.e. anchorY - 56.2 (drums, contentTop
  //    23) .. anchorY - 54.0 (keyboard, 32). The sopranos' own heads sit at 313.8 in the
  //    capture (feet 454, contentHeight 139.4), so anchorY = 315 + 55 = 370 puts all four
  //    peeking heads at 313.8..316.0 -- level with the cast. The old 458 sat the bust
  //    bottom on the stage's front lip, which hid the frames' hard horizontal cut but read
  //    as four men crouching on the floor (heads at 402.5, measured).
  //  - the cost of raising them is that the cut no longer lands on the lip. It now lands
  //    at y 370, which is where both legs break into a fold band (the vertical fold
  //    pattern is interrupted at rows ~368-374 on both), so it reads as a gather rather
  //    than a clean line -- but on the right leg its last ~10px cross the gold
  //    proscenium moulding and stay visible. Accepted: the curtain is painted into the
  //    background plate, so nothing at THEATRE_DEPTH.curtainPeek can ever be occluded BY
  //    a drape, and no amount of x/y can hide the cut completely.
  //  - Package H moved both marks OFF the stage legs and out to the DOORWAY drapes ("not
  //    from this part of the curtain, but from the other part, here they enter and get
  //    out"). The old marks 427/887 sat inside both walk corridors: the cast enters at
  //    THEATRE_LEFT_DOOR_X/THEATRE_RIGHT_DOOR_X (316/963) and walks to 555/740/815, so a
  //    head at 427 or 887 is directly on that path at head height.
  //  - what the scenery actually offers across the peek band (y 315..370), re-measured per
  //    column off frame_00 (tools/_pkgH_drape_profile.py) rather than taken from the
  //    earlier count, which scored the gold proscenium's own dark-red inlay as drape:
  //      left   red stage leg 404..439 | GOLD COLUMN 351..403 | door drape 324..345 |
  //             door arch (dark) 308..323 | door drape 284..307
  //      right  red stage leg 838..878 | GOLD COLUMN 879..922 | door drape 923..955 |
  //             door arch (dark) 956..971 | door drape 972..995
  //    The columns are ~45-50px wide -- wider than a peeker's 38-41px drawn box -- so no
  //    mark between a leg and a door can avoid hanging him over gilt, which is the one
  //    thing that cannot be accepted. The marks below clear them on the door side.
  //  - the marks are set from the DRAWN BOX, never the centre line, because the box is not
  //    centred on the mark. Phaser draws an UNFLIPPED peeker's content to the LEFT of his
  //    mark (widest frame accordion, content columns 50..214, scale 55/225): box =
  //    [x - 40.3, x - 0.2]. A FLIPPED one mirrors inside the frame, not about the mark:
  //    box = [x - 21.8, x + 16.6]. That 40px leftward draw is why the owner's pointed-at
  //    x 925 is not the mark -- a mark of 925 would put his body at 884.7..924.8, i.e.
  //    squarely on the gold column. The mark that lands his body on the drape he pointed
  //    at is 954.
  //  - rightX 954: box 913.7..953.8, 33/41 columns red drape (the band's maximum; the best
  //    the old leg could do was 30/41 at 878..884). Stops 2.2px short of the door arch at
  //    956, so he leans out of the doorway's near drape instead of standing in the opening.
  //    The blue soprano, who set the old mark, is now irrelevant: she reaches x 836.8 and
  //    he starts at 913.7, clearing her by 76.9px.
  //  - leftX 348: box 326.2..364.6, 30/39 columns red. Exact mirror of the right mark (the
  //    two box centres, 345.4 and 933.7, mirror about 640 to within 0.9px), so the pair
  //    reads as one symmetrical piece of staging. Clears the left door arch (ends 323) by
  //    3.2px on the same side its mirror clears the right one.
  //  - contentHeight 55 against the sopranos' 139.4 puts a peeking head at ~1.2x a
  //    soprano's, which reads as standing just downstage of the performer line at the
  //    tormentor -- true of a wing peeker -- while staying legible at 1280x720.
  //  - P32 SUPERSEDES every mark above. The owner placed all four men himself in the
  //    Curtain Call Rig over the real stage plate and signed off; these are his numbers,
  //    verbatim. The history above is kept for the measurements, not the marks.
  //    x/y is THEATRE_PEEK_ANCHOR's frame point in world px; spin is degrees, clockwise
  //    positive, about that same point; height is displayContentHeight over 220 rows;
  //    frame is the frame he placed on; flipX mirrors ABOUT THE ANCHOR COLUMN (see
  //    peekOriginX()), not inside the frame.
  //    Deliberately asymmetric -- left gap 48, right gap 63, per-man x, per-man spin -- and
  //    the mirror state is the reverse of P30's (left as drawn, right mirrored) so the men
  //    lean the other way. Do not average, snap or "correct" any of it.
  curtainPeek: [
    { role: 'keyboard', side: 'left', x: 337, y: 381, spin: 0, height: 55, frame: 0, flipX: false },
    { role: 'tabla', side: 'left', x: 333, y: 429, spin: 11.5, height: 55, frame: 0, flipX: false },
    { role: 'drums', side: 'right', x: 945, y: 361, spin: -6, height: 55, frame: 0, flipX: true },
    { role: 'accordion', side: 'right', x: 954, y: 424, spin: -18.5, height: 55, frame: 0, flipX: true },
  ],
};
// Measured door geometry (game px, 1280x720, from the shipped Theatre frames):
// - Left door: arched, curtained doorway left of the proscenium; dark opening between the
//   curtains centred at x 316 (dark gap ~300-335, y ~300-460). Bottom hidden by audience heads.
// - Right door: mirror image, dark opening centred at x 963 (~940-985).
// - Performers' foot line is THEATRE.stageFootY = 454; used in the doorways too (feet naturally hidden there).
// - Proscenium frame between each door and stage (~362-418 left, ~862-918 right) is fine to walk in front of.
const THEATRE_LEFT_DOOR_X = 316;
const THEATRE_RIGHT_DOOR_X = 963;
const THEATRE_DOOR_FADE_MS = 200;
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
// Package G. The four states do NOT draw their singers at the same size relative to the
// frame, so one shared scale cannot serve all four -- the owner's trio sheet draws a singer
// ~354 frame rows tall where the first three sheets draw gold 440, and at the shared 0.3181
// that put her on screen at 112.6px against the 139.4px she stands at ("the sopranos singing
// animation is smaller in size than their idle animation"). So the 3-joined state takes
// setActorVisual()'s per-visual displayContentHeight (Package E's mechanism) instead of
// inheriting the mic spec's.
//
// PER MIC, not global, because both levels share MIC_VISUALS and want different sizes: the
// Theatre's sopranos stand 139.4/145.5px and the Party's 166.0/166.8px. Each passes its own
// (THEATRE.micThreeContentHeight, PARTY.micThreeContentHeight); the Party's empty/`_1`/`_2`
// states still inherit PARTY.micContentHeight unchanged.
function micVisuals(threeContentHeight) {
  if (threeContentHeight === undefined) return MIC_VISUALS;
  return MIC_VISUALS.map((visual, i) => (
    i === 3 ? { ...visual, displayContentHeight: threeContentHeight } : visual
  ));
}
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
// curtainPeek sits between the pools and the cast on purpose: in front of the background
// (the curtain itself is painted into that plate, so anything above -10 is in front of the
// curtain) and behind every performer, so a soprano standing near a leg occludes the
// peeker rather than the other way round.
// P32: the peekers stack in TIERS down each side (upper man = tier 0). Each tier is one
// man and then his own fabric, curtainPeekTierStep apart, so a lower man's head is drawn in
// front of the drape hiding the man above him -- no cut-outs in that drape needed -- while
// his own fabric still hides his own cut. Two tiers span -8 .. -7.25, under the cast.
const THEATRE_DEPTH = {
  background: -10,
  beams: -9.5,
  pools: -9,
  curtainPeek: -8,
  curtainPeekTierStep: 0.5,
  soprano: -5,
};
// Package H / P30 / P33: all four band members appear together 30 seconds later inside
// level 2, behind real curtain drapery, for a single 5s appearance with no rotation or swapping.
// THE THEATRE'S OWN clock, not song time and not wall clock. The elapsed these methods
// are handed is getLevelElapsed(), which is the SONG's seek -- it already reads ~62-65s at
// the moment enterLevel2() installs the Theatre, so comparing it to 30 directly would show
// the peekers instantly. createTheatreCurtainPeekers() therefore records its own install
// elapsed and the delay is measured from that. Before 30s: nothing on screen. From 30s all
// four peekers and their fabric occluders make ONE appearance together: a linear fade in over
// THEATRE_PEEK_FADE_S, held at alpha 1 for THEATRE_PEEK_HOLD_S, a linear fade out over
// THEATRE_PEEK_FADE_S (30 -> 31 -> 34 -> 35s), then they are destroyed and never return.
// Hold 3, owner 2026-09-23: "look good, lets just make them span 5 seconds shorter" -- the
// whole appearance halved from 10s (hold 8) to 5s; start and fades unchanged.
const THEATRE_PEEK_START_S = 30;
const THEATRE_PEEK_FADE_S = 1;
const THEATRE_PEEK_HOLD_S = 3;
// setActorVisual()'s fixed-anchor form for the peekers, in frame space, MEASURED off the
// landed v3 sheets (P29, docs/p29_registration_truth_2026-09-22/) rather than assumed: the
// alpha > 0 box of every one of the 12 frames ends at column 314 and row 234 (inclusive),
// so column 315 is the curtain plane the man leans out of and row 235 is the plane his bust
// is cut on. 220 is the accordion sheet's own bust height (union rows 15..234), used as the
// single scale reference for all four the way MIC_ANCHOR uses the gold-solo sheet's for all
// four mic composites. The v3 art is not built by tools/build_theatre_curtain_peek.py; the
// docs/p29_registration_truth_2026-09-22/check_peek_alignment.py check asserts this alignment.
const THEATRE_PEEK_ANCHOR = { anchorFrameX: 315, anchorFrameY: 235, refContentHeight: 220 };
// Phaser's flipX mirrors a sprite INSIDE its own frame box, so with the origin left on column
// 315 a flipped peeker would land ~26 frame columns away from his mark. Mirroring about the
// anchor column means the anchor boundary maps to column frameWidth - 315 of the mirrored
// frame; putting the origin there keeps the curtain plane on x, with the man on its far side.
function peekOriginX(frameWidth, flipX) {
  return (flipX ? frameWidth - THEATRE_PEEK_ANCHOR.anchorFrameX : THEATRE_PEEK_ANCHOR.anchorFrameX) / frameWidth;
}
// C1 Theatre push-in: one slow, constant camera zoom-in across the Theatre ("no breathe, just
// cinematic, constant zoom in, just a little bit"). Linear in song time from the moment
// enterLevel2() installs the Theatre. The rate puts a normal ~70s Theatre (install ~62-65s,
// Party install ~132.6s) near 1.06 -- a NOMINAL endpoint, not a plateau; the max is only a
// safety clamp for an abnormally long Theatre. Fara7 and Party never zoom.
const THEATRE_PUSH_IN_RATE = 0.06 / 70;   // zoom per song second (~0.000857)
const THEATRE_PUSH_IN_MAX_ZOOM = 1.08;

// Ground-truth singing windows for Theatre sopranos: marked by Hazem directly against the
// real track (docs/choral_cue_sheet/, 2026-09-18) via the Choral Cue Sheet tool, replacing
// the old guessed two-phase approximation. Outside these windows, joined sopranos rest at
// their mic positions. Two later marks from that same pass (133.71-141.31, 165.27-180.85)
// are Level 3's, not Theatre's -- see PARTY_SINGING_WINDOWS.
const THEATRE_SINGING_WINDOWS = [
  { start: 71.99, end: 76.57 },
  { start: 79.9, end: 87.02 },
  { start: 102.96, end: 118.05 },
];

function isTheatreSingingWindow(elapsed) {
  return THEATRE_SINGING_WINDOWS.some((w) => elapsed >= w.start && elapsed < w.end);
}

// Level 3's two marks from that same Choral Cue Sheet pass, on the ABSOLUTE song clock (not
// measured from the Party's install): inclusive start, exclusive end, like the Theatre's.
// Fork A (owner, 2026-09-21: "let the soprano sing always, in their cue, it's okay"): the
// Party trio is staged at the mic from install and sings in these windows whatever the
// player does -- see buildPartySopranos().
const PARTY_SINGING_WINDOWS = [
  { start: 133.71, end: 141.31 },
  { start: 165.27, end: 180.85 },
];

function isPartySingingWindow(elapsed) {
  return PARTY_SINGING_WINDOWS.some((w) => elapsed >= w.start && elapsed < w.end);
}

// Shared by isTheatreSingingWindow's beam-fade sibling below: a fade-in/hold/fade-out
// envelope (0..1) over an arbitrary list of {start,end} windows, replacing the old
// hardcoded two-phase branch in getTheatreBeamOpacities().
function singingFadeEnvelope(windows, elapsed, fade) {
  for (const w of windows) {
    if (elapsed >= w.start && elapsed < w.end + fade) {
      if (elapsed < w.start + fade) return (elapsed - w.start) / fade;
      if (elapsed < w.end) return 1.0;
      return 1.0 - (elapsed - w.end) / fade;
    }
  }
  return 0.0;
}

const THEATRE_SOLO_POOL_RISE_SECONDS = 60 / 124;

function getTheatrePoolOpacities(elapsed) {
  const soloProgress = Math.max(0, Math.min(
    1,
    (elapsed - THEATRE_KEYBOARD_SOLO_SECONDS) / THEATRE_SOLO_POOL_RISE_SECONDS
  ));
  return {
    trio: isTheatreSingingWindow(elapsed) ? 0.22 : 0.16,
    manos: 0.24,
    solo: 0.10 + (0.20 * soloProgress),
  };
}

// Rest offsets relative to THEATRE.micX when resting around the empty stand: each
// soprano's measured body centre relative to the shared stand, so resting and singing
// preserve the composite spacing at the final P4 mic mark.
const THEATRE_SOPRANO_REST_OFFSETS = {
  soprano_gold: 1.6,
  soprano_green: -42.1,
  soprano_red: 42.1,
};

function getTheatreBeamOpacities(elapsed) {
  const manos = 1.0;

  const fade = THEATRE_BEAM_FADE_SECONDS;
  const trio = singingFadeEnvelope(THEATRE_SINGING_WINDOWS, elapsed, fade);

  const soloProgress = Math.max(0, Math.min(
    1,
    (elapsed - THEATRE_KEYBOARD_SOLO_SECONDS) / fade
  ));
  const solo = soloProgress;

  return { trio, manos, solo };
}

// Ink region of every design pixel of the lyric rect, from the composited luminance the ADD
// beams produce: bg + rgb * textureAlpha * spriteAlpha, summed over overlapping beams.
// bg/beams are RGBA byte arrays of the rect (width x height). Returns 0 cream (no beam
// light), 1 white, 2 black -- one region per pixel, so the three masks are disjoint.
function computeTheatreLyricInkRegions(bg, beams, opacities, width, height) {
  const linear = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lit = Object.keys(beams).filter((key) => opacities[key] > 0);
  const regions = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const p = i * 4;
    let r = bg[p];
    let g = bg[p + 1];
    let b = bg[p + 2];
    let light = false;
    for (const key of lit) {
      const a = (beams[key][p + 3] / 255) * opacities[key];
      if (a <= 0) continue;
      light = true;
      r += beams[key][p] * a;
      g += beams[key][p + 1] * a;
      b += beams[key][p + 2] * a;
    }
    if (!light) continue;
    const lum = 0.2126 * linear(Math.min(255, r)) + 0.7152 * linear(Math.min(255, g))
      + 0.0722 * linear(Math.min(255, b));
    regions[i] = lum < THEATRE_INK_LUMINANCE_SPLIT ? 1 : 2;
  }
  return regions;
}

// Regions -> one clip path per ink, built from disjoint rectangles (row runs merged
// downward), so no fill rule can open holes. null means the ink has no pixels.
function theatreLyricInkPaths(regions, width, height) {
  const rects = [[], [], []];
  let open = new Map();
  for (let y = 0; y <= height; y += 1) {
    const runs = new Map();
    if (y < height) {
      let x0 = 0;
      for (let x = 1; x <= width; x += 1) {
        if (x < width && regions[y * width + x] === regions[y * width + x0]) continue;
        const region = regions[y * width + x0];
        runs.set(`${region}|${x0}|${x}`, { region, x0, x1: x, y0: y });
        x0 = x;
      }
    }
    for (const [key, rect] of open) {
      if (runs.has(key)) runs.set(key, rect);
      else rects[rect.region].push(`M${rect.x0} ${rect.y0}H${rect.x1}V${y}H${rect.x0}Z`);
    }
    open = runs;
  }
  const [cream, white, black] = rects.map((list) => (list.length ? list.join('') : null));
  return { cream, white, black };
}


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
      // P22: the shoulder dance IS the soprano idle ("that's exactly the idle animation,
      // it's when they are in queue, but not singing, so they shoulder dance"). Same
      // 180x384/8-frame format and the same content box as the standing idles above to
      // within 1px, so they are a drop-in swap at every use site -- see soprano() in
      // buildTheatreActors()/buildPartyActors(). The still idles stay registered here
      // because soprano() falls back to them if a dance sheet ever goes missing.
      soprano_green_shoulder_dance: 'sopranoGreenShoulderDanceAnim',
      soprano_gold_shoulder_dance: 'sopranoGoldShoulderDanceAnim',
      soprano_red_shoulder_dance: 'sopranoRedShoulderDanceAnim',
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
  // P10: the four band members peeking round the stage curtains. THREE frames each, and
  // each sheet is ONE man -- the authored 1024x1024 sheet is a 3x4 grid whose ROWS are
  // the four musicians and whose COLUMNS are that man's peek_in -> hold -> peek_out
  // (its own processing_report.json names the layout; tools/build_theatre_curtain_peek.py
  // splits it). Animating across the rows would flip between four different faces, so
  // they are four separate sprites and never one animation.
  //
  // 3fps: peek_in and peek_out are near-identical narrow poses either side of the wide
  // "hold", so the cycle reads as one lean-out-and-back per second -- a peek, not a
  // flutter. Deliberately NOT in LEVEL_POLISH_BEAT_LOOPS: this is set dressing at the
  // proscenium, not one of the song-clock-phased musical loops.
  curtainPeek: {
    frameRate: 3,
    repeat: -1,
    sheets: {
      theatre_curtain_peek_accordion: 'theatreCurtainPeekAccordionAnim',
      theatre_curtain_peek_drums: 'theatreCurtainPeekDrumsAnim',
      theatre_curtain_peek_keyboard: 'theatreCurtainPeekKeyboardAnim',
      theatre_curtain_peek_tabla: 'theatreCurtainPeekTablaAnim',
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
  // Fallback only now -- every band member below carries its own measured footY. Measured
  // 2026-09-13, party_geometry report: set to the kept ground line (the old interimY(567)
  // lay below the deck lip).
  stageFootY: 521.8,
  // The trio + mic stand line (plate row 677) -- sopranos and the stand foot.
  micFootY: 518.0,
  // footX LOCKED by the owner: the final set in
  // assets/generated/environments/hz-test-regen/placement/level3_party_final/level3_party_final.json
  // (band order left to right tabla | drums | keyboard | accordion, R1 Manos on the banner
  // focal axis 620.0, R2 the measured deck extent 339.1..888.0, R3 equal gaps per side and
  // no overlapping silhouettes except the drummer directly behind Manos). drums shares
  // Manos's x -- that is the lock's one permitted overlap, not an accident. footY 509.6 and
  // every height are the 2026-09-13 party_geometry measurements, unchanged.
  band: {
    accordion: { footX: 844.855, footY: 509.6, standingHeight: 166.1, performanceHeight: 126.2 },
    keyboard: { footX: 738.802, footY: 509.6, standingHeight: 154.0, performanceHeight: 117.1 },
    tabla: { footX: 367.694, footY: 509.6, standingHeight: 160.1, performanceHeight: 121.7 },
    drums: { footX: 620.0, footY: 509.6, standingHeight: 145.8, performanceHeight: 118.9 },
  },
  // Play area between the two cast blocks that FLANK him, derived from the lock's own
  // silhouette_game boxes rather than from marks: the trio composite's right edge
  // (560.759) and the keyboard's left edge (700.779). Those are the two silhouettes that
  // bound the gap Manos stands in -- the drummer's box (564.107..676.232) is deliberately
  // NOT a bound, because the lock places him directly behind Manos (R3's one permitted
  // overlap), so treating him as a wall would leave no play area at all.
  walkMinX: 560.759,
  walkMaxX: 700.779,
  // Manos mark: the lock's R1 banner focal axis. Inside walkMinX..walkMaxX above.
  playerSpawnX: 620.0,
  // Entrance wings. Both are OFF-FRAME by the same rule the boss's locked entry uses (her
  // whole silhouette past the frame edge, level3_boss.json): the right wing IS her locked
  // 1320.0 entry line, which clears the widest right-wing walk sheet (accordion, 72.9px
  // wide -> left edge 1283.6); the left wing is further out than the mirror of it because
  // the widest left-wing walk sheet is soprano_red's at 99.2px (half-width 49.6), so -60
  // keeps her right edge at -10.4, still off frame. Measured from the running game with
  // tools/level3_check.mjs. Every walk-in sheet draws its character walking LEFT, so an
  // actor entering at the right wing travels left with the art unflipped and one entering
  // at the left wing is mirrored for the walk only (see PARTY_HELD_FLIP_X).
  wingX: 1320.0,
  leftWingX: -60.0,
  // Faster than either earlier level (FARA7 220, THEATRE 130): SEVEN actors have to clear
  // a single shared wing between the 2:12 boot and the 2:40 boss, and they can only be
  // staggered one behind another.
  entranceSpeedPxPerSecond: 300,
  // The trio/mic composite's LOCKED mark (level3_party_final.json "trio": one Fibonacci
  // 13px beat left of Manos, between the tabla and the focal axis). Was 722.82, the old
  // unlocked value -- Astra 3C: the runtime still had the pre-lock mic mark.
  micX: 475.107,
  // The three sopranos' rest marks around the stand between singing windows (Fork A: they no
  // longer walk in, see buildPartySopranos()), INSIDE the locked trio envelope
  // (silhouette_game 402.66..560.759) rather than off on their own: the lock's final set
  // fills the measured deck 339.1..888.0 end to end, so the deck has no third place for
  // three more standing bodies, and off the deck's left edge the plate is a stone parapet,
  // not a floor. They therefore wait around the empty stand exactly as Level 2's sopranos
  // rest around theirs (THEATRE_SOPRANO_REST_OFFSETS), at that composite's own measured
  // spacing scaled to this level's mic (166.4/140.3 = 1.186 -> 49.93px between neighbours),
  // with the cluster pinned so green's idle silhouette starts on the envelope's left edge
  // (402.66 + 62.0/2) and red's ends 2.1px inside its right edge. Consequences, both
  // deliberate: they overlap EACH OTHER while waiting, which is what a trio around one
  // stand looks like and what Level 2 already ships; and their dizzy sheets (~110px) are
  // wider than the envelope, which is transit, not a held mark -- the same treatment the
  // boss lock gives dizzy_death frame 7.
  sopranoWaitingX: { green: 433.66, gold: 485.49, red: 533.52 },
  // Her own dial, deliberately slower than the cast's -- the entrance is the level's one
  // dramatic beat, not another walk-on. At 200px/s her locked walk 1320.0 -> 939.198 takes
  // 1.904s, which is the figure level3_boss.json's walk_to_on_mark_seconds records.
  bossEntranceSpeedPxPerSecond: 200,
  // Her LOCKED entry mark (level3_boss.json "boss_entry"), off-frame right. Deliberately
  // its own value rather than the cast's wingX: the cast wing only has to clear the frame,
  // hers is a constructed mark on the construction grid.
  bossEntryX: 1320.0,
  // Measured: Manos 176.0px tall on the plate (playerScale 0.5086).
  playerContentHeight: 176.0,
  // INTERIM (band scale held): old 140, converted.
  castContentHeight: interimY(140),
  // Measured per soprano; green leans in on the plate, so she takes gold's height.
  sopranoContentHeights: { gold: 166.8, green: 166.8, red: 166.0 },
  // The mic composite, fixed-anchor form: scale 0.3774 x 441. Empty, `_1` and `_2` only.
  micContentHeight: 166.4,
  // The trio sheet only (owner 2026-09-23: "the sopranos change size when they are singing and
  // not, lock them to the size where they are not singing"). At 166.4 the trio drew gold 132.6,
  // red 137.5, green 122.5 against the 166.8/166.0/166.8 above. Measured on the live sheet by
  // tools/level3_singing_check.mjs (same head-top-to-floor bands as tools/_pkgG_figures.py):
  //   gold  351..352 rows, mean 351.5  -> needs 166.8/351.5 x 441 = 209.3
  //   red   360..366 rows, mean 364.4  -> needs 166.0/364.4 x 441 = 200.9
  //   green 312..338 rows (she leans)  -> needs 226.5
  // One sprite takes one scale, and the three +/-1px bands do not overlap, so only one
  // soprano can be locked. 209.3 locked gold (166.8) but drew red 172.9 (+6.9). Planner's
  // ruling: 205.0 splits it, gold ~163.4 (-3.4) and red ~169.4 (+3.4), ~2% each, below where
  // it reads as a size change. Green is not sized by this (her rows swing with her lean). The
  // Theatre's gold/blue split works because its roster stands red 4% taller than gold, as this
  // sheet draws her; the Party's stands her 0.5% shorter, so no split lands both.
  micThreeContentHeight: 205.0,
  // Not measured (no plate figure): kept at "matches the hero", the rule this value has
  // always followed, so she reads as his equal rather than as scenery.
  bossContentHeight: 176.0,
};
// Background behind everything, cast behind the hero, and the boss between them when she
// arrives downstage of the cast.
// crowd: the owner's rotoscoped Party audience (tools/build_party_crowd_layer.py), drawn in front of
// everyone like Fara7's -- the closest bodies to camera.
const PARTY_DEPTH = { background: -10, cast: -5, boss: -3, crowd: 5 };
// Astra's facing ruling for Level 3: the placement renderers compose the AUTHORED,
// unmirrored sheets, so that is the orientation every held pose has to show. An actor's
// entrance side may no longer leak into its idle/dizzy/playing orientation -- entering from
// the left wing must not mirror an asymmetric instrument for the rest of the level. Walking
// stays directional (the walk sheets are drawn walking left, so a rightward walk is
// mirrored); only the stationary states are pinned here. Level 1 uses FARA7_HELD_FLIP_X; Level 2
// deliberately does NOT set this: its sopranos keep their pre-change baseline facing.
const PARTY_HELD_FLIP_X = false;
const PARTY_CROWD_KEY = 'level3_party_crowd';

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
  // Kiss: one-shot, 10 fps -- frame 6 (index 5) is the release
  kiss: {
    frameRate: 10,
    repeat: 0,
    sheets: { femme_fatale_kiss: 'femmeFataleKissAnim' },
  },
  // Final: one-shot, 8 fps, holds the last frame
  final: {
    frameRate: 8,
    repeat: 0,
    sheets: { femme_fatale_final: 'femmeFataleFinalAnim' },
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
  PLAYER_TERMINAL_ANIM_GROUP,
  PLAYER_HEARTS_ANIM_GROUP,
  PLAYER_BOSS_HIT_ANIM_GROUP,
  PLAYER_BOSS_SINGING_ANIM_GROUP,
  ...Object.values(KEYBOARD_SOLO_ANIM_GROUPS),
  ...Object.values(LEVEL0_ANIM_GROUPS),
];

// C5: the EXPLICIT list of repeating musical loops whose frame comes from the shared song
// clock -- frame = floor(elapsed / subdivision) % frameCount, the backgrounds' own formula --
// instead of Phaser's free-running timer. buildLevel() pauses each listed Animation so Phaser
// never advances it; applyMusicalLoopPhases() sets the frame every tick. NOT listed, on
// purpose: walks/jumps (10fps, physics-driven), finite gestures (projectile spawn listens to
// animationupdate), phone actions, dizzy loops (the soprano perform trigger listens to
// animationrepeat), femme fatale idle/entrance, dizzy_hit and death (completion events).
// LEVEL_POLISH_BEAT_LOOPS is the one list (the Q6 harness reads it by this name, also on
// window); MUSICAL_LOOP_SUBDIVISIONS below is only its animation-key lookup.
// `category` is one of: manos, band, couple, sopranos, boss, intro_manos, intro_shopkeeper,
// heart_emission.
const beatLoop = (category, name, subdivisionMs) => Object.freeze({ category, name, subdivisionMs });
const LEVEL_POLISH_BEAT_LOOPS = Object.freeze([
  // Manos idle (4fps) and singing (8fps), per level.
  beatLoop('manos', 'idleFara7Anim', EIGHTH_NOTE_MS),
  beatLoop('manos', 'idleTheatreAnim', EIGHTH_NOTE_MS),
  beatLoop('manos', 'idlePartyAnim', EIGHTH_NOTE_MS),
  beatLoop('manos', 'singingFara7Anim', SIXTEENTH_NOTE_MS),
  beatLoop('manos', 'singingTheatreAnim', SIXTEENTH_NOTE_MS),
  beatLoop('manos', 'singingPartyAnim', SIXTEENTH_NOTE_MS),
  // Band idle loops (8fps).
  beatLoop('band', 'musicianDrumsIdleAnim', SIXTEENTH_NOTE_MS),
  beatLoop('band', 'musicianKeyboardIdleAnim', SIXTEENTH_NOTE_MS),
  beatLoop('band', 'musicianAccordionIdleAnim', SIXTEENTH_NOTE_MS),
  beatLoop('band', 'tablaPlayerIdleAnim', SIXTEENTH_NOTE_MS),
  // Band performance loops (8fps), including the keyboard solo's standing rock.
  beatLoop('band', 'musicianDrumsPlayingAnim', SIXTEENTH_NOTE_MS),
  beatLoop('band', 'musicianKeyboardPlayingAnim', SIXTEENTH_NOTE_MS),
  beatLoop('band', 'musicianAccordionPlayingAnim', SIXTEENTH_NOTE_MS),
  beatLoop('band', 'tablaPlayerPlayingAnim', SIXTEENTH_NOTE_MS),
  beatLoop('band', 'musicianKeyboardSoloStandingAnim', SIXTEENTH_NOTE_MS),
  // Fara7 couple heart-chair (4fps) and its two-sprite fallback (8fps).
  beatLoop('couple', 'fara7CoupleHeartChairIdleAnim', EIGHTH_NOTE_MS),
  beatLoop('couple', 'brideSeatedAnim', SIXTEENTH_NOTE_MS),
  beatLoop('couple', 'groomSeatedAnim', SIXTEENTH_NOTE_MS),
  // Sopranos idle (8fps) and the mic composites, which ARE their singing loops (8fps).
  // The shoulder dances are the idle the sopranos actually play now (P22); the still
  // idles stay listed because soprano() still falls back to them.
  beatLoop('sopranos', 'sopranoGreenIdleAnim', SIXTEENTH_NOTE_MS),
  beatLoop('sopranos', 'sopranoGoldIdleAnim', SIXTEENTH_NOTE_MS),
  beatLoop('sopranos', 'sopranoRedIdleAnim', SIXTEENTH_NOTE_MS),
  beatLoop('sopranos', 'sopranoGreenShoulderDanceAnim', SIXTEENTH_NOTE_MS),
  beatLoop('sopranos', 'sopranoGoldShoulderDanceAnim', SIXTEENTH_NOTE_MS),
  beatLoop('sopranos', 'sopranoRedShoulderDanceAnim', SIXTEENTH_NOTE_MS),
  beatLoop('sopranos', 'theatreMicEmptyAnim', SIXTEENTH_NOTE_MS),
  beatLoop('sopranos', 'theatreMicOneAnim', SIXTEENTH_NOTE_MS),
  beatLoop('sopranos', 'theatreMicTwoAnim', SIXTEENTH_NOTE_MS),
  beatLoop('sopranos', 'theatreMicThreeAnim', SIXTEENTH_NOTE_MS),
  // Pre-collapse boss singing is clock-phased. The floor-ending loop is deliberately omitted:
  // credits request its natural animationcomplete so terminal stillness can begin without a timer.
  beatLoop('boss', 'dizzySingingAnim', SIXTEENTH_NOTE_MS),
  // Level 0 shop listen phase (song [3 bars, 15s)): back-view Manos head-bob (8fps) and the
  // shopkeeper's lean (4fps). Before PLAY, updateIntro() phases the lean on the intro clock.
  beatLoop('intro_manos', 'manosBackListenAnim', SIXTEENTH_NOTE_MS),
  beatLoop('intro_shopkeeper', 'shopkeeperIdleLeanAnim', EIGHTH_NOTE_MS),
  // Not an animation: the M-key heart volley, one per beat (see update()).
  beatLoop('heart_emission', 'mHeartEmission', HEART_FIRE_INTERVAL_MS),
]);
const MUSICAL_LOOP_SUBDIVISIONS = Object.freeze(Object.fromEntries(
  LEVEL_POLISH_BEAT_LOOPS
    .filter((loop) => loop.category !== 'heart_emission')
    .map((loop) => [loop.name, loop.subdivisionMs])
));

// One bar per loop, frameCount frames per bar: the level backgrounds' (and the shop's) formula.
function barLoopFrameIndex(seconds, frameCount) {
  return Math.floor(Math.max(0, seconds) * 1000 / (BAR_MS / frameCount)) % frameCount;
}

function musicalLoopFrameIndex(animationKey, frameCount, elapsed) {
  return Math.floor(Math.max(0, elapsed) * 1000 / MUSICAL_LOOP_SUBDIVISIONS[animationKey]) % frameCount;
}

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

// The phone panel's screens are DOM <img> sources, not Phaser textures. Holding decoded Image
// objects for the whole page keeps them in the document's list of available images, so setting
// the panel's src completes synchronously and a message reveal never waits on a first load.
const PHONE_SCREEN_FILES = [
  'assets/game/sms_stage_1_notification.png',
  'assets/game/sms_stage_2_select.png',
  'assets/game/sms_stage_3_opening.png',
  'assets/game/sms_stage_4_blank.png',
];
const PHONE_SCREEN_IMAGES = [];

class LevelScene extends Phaser.Scene {
  constructor() {
    super('Level');
  }

  preload() {
    this.load.json('assetsConfig', 'assets/assets.json');
    if (!PHONE_SCREEN_IMAGES.length) {
      for (const file of PHONE_SCREEN_FILES) {
        const image = new Image();
        image.src = file;
        PHONE_SCREEN_IMAGES.push(image);
      }
    }
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
    for (const [key, file] of Object.entries(THEATRE_POOL_TEXTURES)) {
      this.load.image(`theatre_pool_${key}`, file);
    }
    for (const [key, file] of Object.entries(THEATRE_BEAM_TEXTURES)) {
      this.load.image(`theatre_beam_${key}`, file);
    }
    // Level 1's audience, the one layer drawn in front of the hero. Guarded like the Level 0
    // art below: an older assets.json has no such key and the level must still run without it.
    for (const crowdKey of [FARA7_CROWD_KEY, PARTY_CROWD_KEY]) {
      if (!s[crowdKey]) continue;
      (s[crowdKey].files || []).forEach((file, i) => {
        this.load.image(`${crowdKey}_${i}`, file);
      });
    }
    // Level 0 shop art, each only once registered (package L6); startIntro() falls back per piece.
    if (s[LEVEL0_SHOP_BG_KEY]) {
      (s[LEVEL0_SHOP_BG_KEY].files || []).forEach((file, i) => this.load.image(`${LEVEL0_SHOP_BG_KEY}_${i}`, file));
    }
    if (s[LEVEL0_COUNTER_FG_KEY]) {
      (s[LEVEL0_COUNTER_FG_KEY].files || []).forEach((file, i) => {
        this.load.image(`${LEVEL0_COUNTER_FG_KEY}_${i}`, file);
      });
    }
    if (s[LEVEL0_CASSETTE_KEY] && s[LEVEL0_CASSETTE_KEY].file) {
      this.load.image(LEVEL0_CASSETTE_KEY, s[LEVEL0_CASSETTE_KEY].file);
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

    // Animations -- all through createSheetAnimation(), which skips a sheet that did not load.
    this.createSheetAnimation('walk', { key: 'walkAnim', frameRate: 10, repeat: -1 });
    this.createSheetAnimation('jump', { key: 'jumpAnim', frameRate: 10, repeat: -1 });
    this.createSheetAnimation('gesture_heart', { key: 'giveHeartAnim', frameRate: 8, repeat: 0 });
    this.createSheetAnimation('gesture_flowers', { key: 'giveFlowersAnim', frameRate: 8, repeat: 0 });
    this.createSheetAnimation('phone_pull', {
      key: 'phonePullAnim',
      frameRate: PHONE_PULL_FRAME_RATE,   // matches walkAnim's rate -- the swap must be seamless mid-stride
      repeat: 0,
    });
    this.createSheetAnimation('phone_read', { key: 'phoneReadAnim', frameRate: 10, repeat: -1 });
    this.createSheetAnimation('phone_check_idle', {
      key: 'phoneCheckIdleAnim',
      frameRate: 8,   // standing idle loop, matches this file's 8fps idle-loop convention
      repeat: -1,
    });
    this.createSheetAnimation('musician_drums_idle', { key: 'musicianDrumsIdleAnim', end: 7, frameRate: 8, repeat: -1 });
    this.createSheetAnimation('musician_drums_love', { key: 'musicianDrumsLoveAnim', end: 7, frameRate: 8, repeat: -1 });
    this.createSheetAnimation('musician_keyboard_idle', { key: 'musicianKeyboardIdleAnim', end: 7, frameRate: 8, repeat: -1 });
    this.createSheetAnimation('musician_keyboard_love', { key: 'musicianKeyboardLoveAnim', end: 7, frameRate: 8, repeat: -1 });
    this.createSheetAnimation('musician_accordion_idle', { key: 'musicianAccordionIdleAnim', end: 7, frameRate: 8, repeat: -1 });
    this.createSheetAnimation('musician_accordion_love', { key: 'musicianAccordionLoveAnim', end: 7, frameRate: 8, repeat: -1 });
    // frameRate 10 matches walkAnim -- these are walk cycles, not the 8fps idle/love loops.
    for (const [walkInKey, animKey] of Object.entries(ACTOR_WALK_IN_ANIMS)) {
      this.createSheetAnimation(walkInKey, { key: animKey, frameRate: 10, repeat: -1 });
    }
    // Both casts + both backgrounds, from the same grouped tables the loader above reads.
    for (const group of ALL_ANIM_GROUPS) {
      for (const [key, animKey] of Object.entries(group.sheets)) {
        this.createSheetAnimation(key, { key: animKey, frameRate: group.frameRate, repeat: group.repeat });
      }
    }
    this.createSheetAnimation('dizzy_love', { key: 'dizzyLoveAnim', end: 7, frameRate: 8, repeat: -1 });
    // C5: Phaser must never advance a song-clock-phased loop on its own timer. Pausing the
    // Animation (not the sprite) keeps anims.isPlaying true, so play(key, true) stays a no-op.
    for (const key of Object.keys(MUSICAL_LOOP_SUBDIVISIONS)) {
      const animation = this.anims.get(key);
      if (animation) animation.pause();
    }

    // The wedding-stage loop, 1280x720 frames drawn 1:1 on the canvas.
    this.levelBg = null;
    this.crowdFg = null;
    this.theatrePools = null;
    this.showLevelBackground('level1_fara7_bg', FARA7_DEPTH.background);
    this.showCrowdForeground(FARA7_CROWD_KEY, FARA7_DEPTH.crowd);

    // Player spawns centre stage, under the heart marquee.
    // Spawn ABOVE the ground line (not on/inside it) so Arcade Physics resolves a real
    // fall-and-land collision -- spawning already overlapping the collider leaves the body
    // "embedded" and onFloor() never becomes true.
    this.player = this.physics.add.sprite(FARA7.playerSpawnX, FARA7.groundY - 150, 'walk', 0);
    this.player.setOrigin(0.5, 1);
    this.player.setDepth(0);
    this.playerReferenceHeight = PLAYER_LEVEL_REFERENCE_HEIGHTS.fara7;
    this.playPlayerVisual('idle', 'fara7');
    this.player.setCollideWorldBounds(true);

    this.physics.add.collider(this.player, this.ground);

    // No scroll, in either level: fixed bounds on the canvas, camera parked on its centre.
    this.physics.world.setBounds(0, 0, STAGE_VIEW.width, STAGE_VIEW.height);
    // Survives scene restarts on purpose (never reset to 0), so a callback captured by a
    // previous run can never match a new run's generation.
    this.transitionGeneration = (this.transitionGeneration || 0) + 1;
    this.theatreZoomStartElapsed = null;
    this.resetStageCamera();

    this.passiveAudience = [];
    this.buildFara7Actors();
    this.buildFara7Dressing();   // pushes into the array initialized above

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
    this.mHeartBeatIndex = null;

    this.gesture = null; // null | 'heart' | 'flowers' | 'dizzy'
    this.gestureCompleteEvent = null;
    this.gestureCompleteHandler = null;
    this.gestureTimer = null;

    // Touch overlay state (mobile, no keyboard). Movement/jump are held-button flags
    // (set true on pointerdown, false on pointerup/leave/cancel) mirroring how the
    // keyboard's isDown checks already work. Gesture flags are edge-triggered -- set
    // true on pointerdown, read once by update() and reset to false there, mirroring
    // Phaser.Input.Keyboard.JustDown semantics for the L/F/D keys.
    // `sing` is the M key's twin (edge-triggered, see update()).
    this.touchState = { left: false, right: false, jump: false, heart: false, flowers: false, dizzy: false, sing: false };
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
    // L7 (Level 0): the first real gesture now starts the PRE-SONG intro clock
    // (beginIntroClock()); the song clock starts later, at PLAY (startSongClock()). With no
    // intro running, the gesture starts the song clock directly, exactly as before.
    this.levelClockStart = null;
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
    // One handler over pointerdown/pointerup/keydown (see onFirstRealGesture() for why both
    // pointer edges); the first to fire aborts the rest, and shutdown aborts all of them, so a
    // restart never stacks a second set.
    this.firstGestureAbort = new AbortController();
    const onFirstGesture = (event) => this.handleFirstGesture(event);
    for (const type of ['pointerdown', 'pointerup', 'keydown']) {
      document.addEventListener(type, onFirstGesture, { signal: this.firstGestureAbort.signal });
    }
    onFirstRealGesture(requestFullscreenOnce);
    this.input.keyboard.once('keydown', requestFullscreenOnce);

    // Level 0 (Intro) state. introPhase: 'waiting' (before the first gesture) -> 'film' through
    // the film's end -> 'done'. Sprite fallback: 'shop' on the intro clock -> 'listen' on the song
    // clock -> 'done' (a failure after PLAY goes straight to 'listen').
    this.introActive = false;
    this.introDone = false;
    this.introPhase = null;
    this.introClockStart = null;
    this.introPlayReason = null;     // what pressed PLAY: film (its PLAY frame) | shop (sprite fallback)
    this.introFilmFailure = null;    // why the film gave way: missing | error | play-rejected | stalled | overlong
    this.introBg = null;
    this.introBgKey = null;          // LEVEL0_SHOP_BG_KEY once registered, null = placeholder image
    this.introBgFrame = 0;
    this.introActors = {};           // { manos, shopkeeper }: non-player actors, never in interactiveActors/passiveAudience
    this.introCounterFg = null;
    this.introSignText = null;
    this.introPoster = null;
    this.introCassette = null;       // the ONE cassette prop
    this.introCassetteOwner = null;  // null | 'shopkeeper' | 'manos'
    this.introMedia = null;          // the open film; DOM callbacks act only while they own it

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
    // Fork A: the Party's staged trio, outside this.interactiveActors (see buildPartySopranos()),
    // and its own singing flag -- never theatreSingingActive.
    this.partySopranos = [];
    this.partySingingActive = false;
    this.theatreSingingActive = false;  // gated to [79, 88) and [96, 132)
    this.bossRequested = false;
    this.bossNoFlinchRequested = false;   // recorded for a future real no-flinch reaction
    // Package G: one-shot latch so the kiss projectile is never spawned twice, plus the
    // dizzy -> dizzy-singing hold state between "kiss lands" and "the actual collapse" (see
    // handleBossKissImpact()). Gates the same movement/gesture branches manosDefeated does,
    // but is set BEFORE manosDefeated so he can visibly react before he is actually defeated.
    this.bossKissRequested = false;
    this.bossKissFired = false;
    this.bossKissAnimationUpdateHandler = null;
    this.bossKissCompleteHandler = null;
    this.bossSequenceActive = false;
    // P34: from her spawn until the kiss lands, Manos is walked onto the authored ending
    // mark (see updateBossSettle()). Input is locked for the whole window.
    this.bossSettleActive = false;
    this.bossSettleDirection = 0;   // -1/+1 while walking to the mark, 0 otherwise
    this.bossSettleOnMark = false;
    this.bossKissHitCompleteHandler = null;
    this.bossKissSingingTimer = null;
    // Set once her attack lands. Gates every movement/gesture branch in update().
    this.manosDefeated = false;
    this.deathPending = false;
    this.deathStarted = false;
    this.deathCompleteHandler = null;
    this.floorSingingCompleteHandler = null;
    this.terminalStarted = false;
    this.floorHearts = null;
    this.floorHeartsFadeTween = null;
    // Scripted keyboard beats. Level 1 takes over the real roster keyboardist at 0:50;
    // Theatre creates its own non-interactive performer at 1:58. The phone latches stay
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
    this.cinemaLyricDarkEl = document.getElementById('cinema-screen-lyrics-dark');
    this.cinemaLyricWhiteEl = document.getElementById('cinema-screen-lyrics-white');
    this.heartLyricEl = document.getElementById('heart-lyrics');
    this.partyLyricEl = document.getElementById('party-lyrics');
    this.introDialogueEl = document.getElementById('intro-dialogue');
    this.introMediaEls = {
      container: document.getElementById('intro-cutscene'),
      poster: document.getElementById('intro-cutscene-poster'),
      video: document.getElementById('intro-cutscene-video'),
    };
    // C2/C3: the world-anchored lyric boxes are placed from the camera transform the renderer
    // just used, so they are positioned once per rendered frame, after render (index.html owns
    // the helper). Removed in the shutdown handler below.
    this.onGamePostRender = () => { if (window.positionWorldLyrics) window.positionWorldLyrics(); };
    this.game.events.on(Phaser.Core.Events.POST_RENDER, this.onGamePostRender);

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
      this.shutdownIntro();
      this.cancelGesture();
      this.cancelPhonePresentation();
      this.destroyTheatrePools();
      this.destroyTheatreBeams();
      this.destroyTheatreCurtainPeekers();
      this.destroyTheatreKeyboardSolo();
      this.destroyInteractiveActors();
      this.destroyTheatreMic();
      this.destroyPartyMic();
      this.destroyPartySopranos();
      this.destroyBoss();
      this.destroyPassiveAudience();
      this.destroyProjectiles();
      this.destroyFloorHearts();
      this.clearDeathCompletionHandler();
      this.clearFloorSingingCompletionHandler();
      this.clearBossKissHitCompletionHandler();
      if (this.bossKissSingingTimer) { this.bossKissSingingTimer.remove(false); this.bossKissSingingTimer = null; }
      this.bossSequenceActive = false;
      this.endBossSettle();
      this.mSequenceActive = false;
      this.mHeartBeatIndex = null;
      for (const el of [this.lyricEl, this.cinemaLyricEl, this.cinemaLyricDarkEl, this.cinemaLyricWhiteEl, this.heartLyricEl, this.partyLyricEl]) {
        if (!el) continue;
        el.textContent = '';
        el.hidden = true;
      }
      this.game.events.off(Phaser.Core.Events.POST_RENDER, this.onGamePostRender);
      if (this.touchControlsAbort) this.touchControlsAbort.abort();
      this.touchControlsAbort = null;
      // Invalidates every fade callback this run captured.
      this.transitionGeneration += 1;
    });

    if (this.getLevelElapsed() < LEVEL0_REVEAL_SONG_SECONDS) {
      this.startIntro();
    } else {
      this.introDone = true;
    }

    this.ready = true;
  }

  // Level 0 presentation over the Fara7 stage already built underneath (which keeps running,
  // hidden). Every piece is optional until registered: loop -> placeholder image, missing actor
  // sheets -> no actor, missing counter/cassette -> none. The intro SMS phone panel is gone.
  startIntro() {
    if (this.introDone || this.introActive) return;
    this.introActive = true;
    this.introPhase = 'waiting';
    const s = this.cfg.sprites;
    const loopReady = !!s[LEVEL0_SHOP_BG_KEY] && this.textures.exists(`${LEVEL0_SHOP_BG_KEY}_0`);
    this.introBgKey = loopReady ? LEVEL0_SHOP_BG_KEY : null;
    this.introBgFrame = 0;
    this.introBg = this.add.image(0, 0, loopReady ? `${LEVEL0_SHOP_BG_KEY}_0` : LEVEL0_PLACEHOLDER_BG_KEY)
      .setOrigin(0, 0)
      .setDisplaySize(STAGE_VIEW.width, STAGE_VIEW.height)
      .setDepth(LEVEL0_SHOP.depth.background);

    this.introActors = {
      manos: this.createIntroActor(LEVEL0_SHOP.manos, LEVEL0_ACTOR_VISUALS.manos),
      shopkeeper: this.createIntroActor(LEVEL0_SHOP.shopkeeper, LEVEL0_ACTOR_VISUALS.shopkeeper),
    };
    this.introActors.manos?.sprite.setDepth(LEVEL0_SHOP.depth.manos);
    if (s[LEVEL0_COUNTER_FG_KEY] && this.textures.exists(`${LEVEL0_COUNTER_FG_KEY}_0`)) {
      this.introCounterFg = this.add.image(0, 0, `${LEVEL0_COUNTER_FG_KEY}_0`)
        .setOrigin(0, 0)
        .setDisplaySize(STAGE_VIEW.width, STAGE_VIEW.height)
        .setDepth(LEVEL0_SHOP.depth.counter);
    }
    if (s[LEVEL0_CASSETTE_KEY] && this.textures.exists(LEVEL0_CASSETTE_KEY)) {
      const cassette = this.add.image(0, 0, LEVEL0_CASSETTE_KEY).setDepth(LEVEL0_SHOP.depth.cassette);
      cassette.setScale(LEVEL0_SHOP.cassetteHeight / cassette.height).setVisible(false);
      this.introCassette = cassette;
    }
    this.introCassetteOwner = null;
    this.introPlayReason = null;
    this.introFilmFailure = null;
    if (this.player) this.player.setVisible(false);
    // The film's poster (its first frame) covers the waiting screen while the video preloads.
    this.openIntroFilm();
  }

  handleFirstGesture(event) {
    // The film starts with sound, which needs user activation: a touch/pen pointerdown and an
    // Escape keydown grant none (onFirstRealGesture()), so the intro waits for the next edge.
    if (this.introActive && event && ((event.type === 'pointerdown' && event.pointerType !== 'mouse')
      || (event.type === 'keydown' && event.key === 'Escape'))) return;
    if (this.firstGestureAbort) this.firstGestureAbort.abort();
    if (this.introActive) this.beginIntroClock();
    else this.startSongClock();
  }

  // Called inside the activating gesture, so the film's play() carries it.
  beginIntroClock() {
    if (!this.introActive || this.introClockStart !== null) return;
    this.introClockStart = this.time.now;
    const media = this.introMedia;
    if (media && media.video && !this.introFilmFailure) {
      this.startIntroFilm(media);
    } else {
      this.closeIntroMedia();
      this.introPhase = 'shop';
    }
  }

  // PLAY: the song clock starts at atSeconds (0, or how far the film already is past its PLAY
  // frame) -- the fallback clock from now, the real track through the existing startMusic route
  // (setupMusic()), which seeks to this same elapsed so it never rewinds. Audio not loaded yet:
  // setupMusic() joins this timeline when it lands. play() refused: the next real gesture
  // retries, while the fallback clock keeps song time.
  startSongClock(atSeconds = 0) {
    if (this.levelClockStart !== null) return;
    this.levelClockStart = this.time.now - atSeconds * 1000;
    if (this.startMusic && !this.startMusic()) {
      onFirstRealGesture(this.startMusic);
      this.input.keyboard.once('keydown', this.startMusic);
    }
  }

  // The Fara7 reveal: the film's end, or the fallback's song time; also an immediate, idempotent
  // shortcut (the harnesses call it directly). It never seeks the song: after PLAY the song keeps
  // its time; before PLAY but after the first gesture it presses PLAY (song from 0); before any
  // gesture that gesture still starts the song.
  endIntro() {
    if (!this.introActive) return;
    this.teardownIntro();
    if (this.levelClockStart === null && this.introClockStart !== null) this.startSongClock();
    if (this.player) {
      // A direct reveal can happen before Arcade Physics has had a frame to resolve the
      // intentional spawn fall. Settle above the collider, never inside it, so every reveal
      // path starts in the same grounded idle pose.
      this.playPlayerVisual('idle', 'fara7');
      const groundTop = this.ground && this.ground.body ? this.ground.body.top : null;
      if (Number.isFinite(groundTop) && this.player.body) {
        this.player.y += groundTop - this.player.body.bottom;
        this.player.body.updateFromGameObject();
        this.player.setVelocity(0, 0);
      }
      this.player.setVisible(true);
    }
  }

  // Shutdown/restart: the same cleanup without the reveal or the song start. Late media events
  // and play() promises check this.introMedia identity, so nothing can resurrect the intro.
  shutdownIntro() {
    if (this.firstGestureAbort) this.firstGestureAbort.abort();
    this.teardownIntro();
  }

  teardownIntro() {
    this.introActive = false;
    this.introDone = true;
    this.introPhase = 'done';
    this.closeIntroMedia();
    this.setIntroCaption('');
    for (const actor of Object.values(this.introActors || {})) {
      if (actor) actor.sprite.destroy();
    }
    this.introActors = {};
    for (const field of ['introBg', 'introSignText', 'introPoster', 'introCounterFg', 'introCassette']) {
      if (this[field]) this[field].destroy();
      this[field] = null;
    }
    this.introCassetteOwner = null;
  }

  // The phase comes from absolute clocks every tick, so a resumed tab that jumps several
  // boundaries lands in the right phase, and the Fara7 handover never waits for media.
  updateIntro(elapsed) {
    if (!this.introActive) return;
    if (this.introPhase === 'film') {
      this.updateIntroFilm();
      return;
    }
    // Sprite fallback.
    if (this.levelClockStart === null) {
      if (this.introClockStart === null) return;
      const introMs = this.time.now - this.introClockStart;
      if (this.introPhase === 'shop' && introMs >= LEVEL0_SHOP_MS) {
        this.introPlayReason = 'shop';
        this.startSongClock();
        this.enterIntroListen();
        return;
      }
      this.updateIntroShop(introMs);
      this.updateIntroBackground(introMs / 1000);
      // Song time is still 0: the shop's musical loops phase on the intro clock until PLAY.
      this.phaseMusicalLoops(this.getIntroActorSprites(), introMs / 1000);
      return;
    }
    if (elapsed >= LEVEL0_REVEAL_SONG_SECONDS) {
      this.endIntro();
      return;
    }
    if (this.introPhase !== 'listen') this.enterIntroListen();
    this.updateIntroBackground(elapsed);
  }

  // Sprite fallback's pre-song choreography by intro-clock progress: ask (caption) -> hand-over
  // (reply caption) -> receive + hold.
  // Smooth, calm movement: shopkeeper lifts tape, holds it out to meeting point; Manos reaches
  // to meet it; hand-off at contact; Manos draws tape back to chest while shopkeeper returns to counter.
  updateIntroShop(introMs) {
    const { manos, shopkeeper } = this.introActors;
    const handoverStart = LEVEL0_SHOP_ASK_MS;
    const receiveStart = handoverStart + LEVEL0_SHOP_HANDOVER_MS;
    const asking = introMs < handoverStart;
    const handingOver = !asking && introMs < receiveStart;

    if (this.introPhase === 'shop') {
      if (asking) {
        this.setIntroCaption(LEVEL0_CAPTION_TEXT, 'manos');
      } else if (handingOver) {
        this.setIntroCaption(LEVEL0_REPLY_TEXT, 'shopkeeper');
      } else {
        this.setIntroCaption('');
      }
    } else {
      this.setIntroCaption('');
    }

    // Shopkeeper movement: lean -> reaches down behind counter (f0-f2) -> lifts tape (f3)
    // -> holds out (f4) -> holds forward at meeting point (f5) -> releases (f6) -> returns to counter (f7).
    if (asking) {
      this.setIntroActorState(shopkeeper, 'lean');
    } else {
      this.setIntroActorState(shopkeeper, 'handover');
      const skFrame = introFrameAt(LEVEL0_SHOPKEEPER_HANDOVER_FRAMES, introMs);
      this.setIntroActorFrame(shopkeeper, skFrame);
    }

    // Manos movement: stands in ask f0 through ask and early handover -> reaches out (receive f0-f3)
    // to meet shopkeeper's hand at 6.0s -> takes grip (f4) -> draws back to chest (f5-f7).
    if (introMs < LEVEL0_MANOS_RECEIVE_FRAMES[0][0]) {
      this.setIntroActorState(manos, 'ask');
    } else {
      this.setIntroActorState(manos, 'receive');
      const mFrame = introFrameAt(LEVEL0_MANOS_RECEIVE_FRAMES, introMs);
      this.setIntroActorFrame(manos, mFrame);
    }

    // Tape ownership: hidden when hands are empty (< 4100ms), shopkeeper holds it out (4100-6000ms),
    // hands off to Manos at meeting point (6000ms), Manos holds it through receive.
    const owner = asking || introMs < LEVEL0_CASSETTE_VISIBLE_MS ? null : (introMs < receiveStart ? 'shopkeeper' : 'manos');
    if (owner !== this.introCassetteOwner) this.setIntroCassetteOwner(owner);

    // Continuous smooth cassette positioning between sockets across the 3-9s window
    const cassette = this.introCassette;
    if (cassette) {
      const pos = this.getIntroCassetteWorldPos(introMs);
      if (pos && owner) {
        cassette.setVisible(true);
        cassette.setPosition(pos.x, pos.y);
      } else {
        cassette.setVisible(false);
      }
    }
  }

  setIntroActorFrame(actor, frameIndex) {
    if (!actor || !actor.sprite) return;
    const anims = actor.sprite.anims;
    const frames = anims.currentAnim ? anims.currentAnim.frames : null;
    if (!frames || !frames.length) return;
    const frame = frames[Phaser.Math.Clamp(frameIndex, 0, frames.length - 1)];
    if (!anims.isPaused) anims.pause();
    if (anims.currentFrame !== frame) anims.setCurrentFrame(frame);
  }

  getIntroSocketWorld(actor, frameIndex) {
    if (!actor || !actor.sprite || !actor.sprite.texture) return null;
    const meta = this.cfg.sprites[actor.sprite.texture.key];
    const sockets = meta && meta.poseGuide && (meta.poseGuide.cassetteSockets || meta.poseGuide.walkmanSockets);
    const socket = sockets && sockets[Math.max(0, Math.min(Number(frameIndex) || 0, sockets.length - 1))];
    if (!socket) return null;
    const fixed = meta.fixedAnchor || actor.spec.fixedAnchor;
    if (!fixed) return null;
    const scale = actor.sprite.scaleY;
    return {
      x: actor.sprite.x + (socket.x - fixed.anchorFrameX) * scale,
      y: actor.sprite.y + (socket.y - fixed.anchorFrameY) * scale,
      state: socket.state,
    };
  }

  // The tape follows the same frame tables as the arms: it sits on the drawn socket and glides to the
  // next one across each frame switch, so it never trails the hand by more than half a socket step.
  // Hand-off: a cross-fade from the shopkeeper's track to Manos's around contact.
  getIntroCassetteWorldPos(introMs) {
    const { manos, shopkeeper } = this.introActors || {};
    if (!manos || !shopkeeper || introMs < LEVEL0_CASSETTE_VISIBLE_MS) return null;
    const track = (actor, table) => {
      const at = (k) => this.getIntroSocketWorld(actor, table[k][1]);
      // Each glide is centred on its frame switch and at most half the gap to either neighbour,
      // so glides never overlap and the path stays continuous.
      const halfWidth = (j) => Math.min(
        LEVEL0_CASSETTE_GLIDE_MS,
        (table[j][0] - table[j - 1][0]) / 2,
        j + 1 < table.length ? (table[j + 1][0] - table[j][0]) / 2 : Infinity,
      );
      for (let j = 1; j < table.length; j += 1) {
        const w = halfWidth(j);
        if (Math.abs(introMs - table[j][0]) < w) {
          return introLerp(at(j - 1), at(j), introSmoothstep(table[j][0] - w, table[j][0] + w, introMs));
        }
      }
      return at(Math.max(introFrameIndex(table, introMs), 0));
    };
    const handoff = LEVEL0_SHOP_ASK_MS + LEVEL0_SHOP_HANDOVER_MS;
    const blend = introSmoothstep(handoff - LEVEL0_CASSETTE_GLIDE_MS, handoff + LEVEL0_CASSETTE_GLIDE_MS, introMs);
    const sk = blend < 1 ? track(shopkeeper, LEVEL0_SHOPKEEPER_HOLD_FRAMES) : null;
    const m = blend > 0 ? track(manos, LEVEL0_MANOS_RECEIVE_FRAMES) : null;
    if (!m) return sk;
    if (!sk) return m;
    return introLerp(sk, m, blend);
  }


  // Sprite fallback, song [PLAY, reveal): back in the shop, listening.
  enterIntroListen() {
    this.introPhase = 'listen';
    this.closeIntroMedia();
    this.setIntroCaption('');
    this.setIntroCassetteOwner(null);  // the tape is in the Walkman now
    this.setIntroActorState(this.introActors.manos, 'listen');
    this.setIntroActorState(this.introActors.shopkeeper, 'lean');
  }

  // Same one-bar/eight-frame formula as the level backgrounds, on whichever clock is running.
  updateIntroBackground(seconds) {
    if (!this.introBg || !this.introBgKey) return;
    const frame = barLoopFrameIndex(seconds, this.cfg.sprites[this.introBgKey].files.length);
    if (frame === this.introBgFrame) return;
    this.introBgFrame = frame;
    this.introBg.setTexture(`${this.introBgKey}_${frame}`);
    if (this.introCounterFg && this.textures.exists(`${LEVEL0_COUNTER_FG_KEY}_${frame}`)) {
      this.introCounterFg.setTexture(`${LEVEL0_COUNTER_FG_KEY}_${frame}`);
    }
  }

  // A Level 0 non-player actor in the couple's shape ({sprite, spec} for setActorVisual()). Only
  // states whose sheet, texture and animation all exist are kept; null when none do, so a
  // missing sheet costs that actor (or that state) and never throws.
  createIntroActor(mark, visuals) {
    const available = {};
    for (const [state, visual] of Object.entries(visuals)) {
      if (this.cfg.sprites[visual.textureKey] && this.textures.exists(visual.textureKey)
        && this.anims.exists(visual.animationKey)) available[state] = visual;
    }
    const first = Object.keys(available)[0];
    if (!first) return null;
    const meta = this.cfg.sprites[available[first].textureKey];
    const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);
    // L6's fixedAnchor is the common authored root. refContentHeight is the median centre-band
    // body height, so mark.contentHeight uses the same measurement rather than the alpha-box
    // height reported in the registry's contentHeight field.
    const fixedAnchor = meta.fixedAnchor || {
      refContentHeight: num(meta.contentHeight, meta.frameHeight),
      anchorFrameX: num(meta.contentCenterX, meta.frameWidth / 2),
      anchorFrameY: num(meta.contentTop, 0) + num(meta.contentHeight, meta.frameHeight),
    };
    const sprite = this.add.sprite(mark.x, mark.footY, available[first].textureKey, 0)
      .setDepth(LEVEL0_SHOP.depth.actors);
    const actor = {
      sprite,
      state: null,
      visuals: available,
      spec: { displayContentHeight: mark.contentHeight, clipBottomY: null, fixedAnchor },
    };
    this.setIntroActorState(actor, first);
    return actor;
  }

  // A state whose sheet isn't registered leaves the actor on its current pose.
  setIntroActorState(actor, state) {
    if (!actor || actor.state === state || !actor.visuals[state]) return;
    actor.state = state;
    this.setActorVisual(actor, actor.visuals[state]);
    // Owner 2026-09-16: the shop is almost still. Idle states hold their first frame; a stopped
    // animation is skipped by phaseMusicalLoops(). Only handover/receive move (the tape changes hands).
    if (LEVEL0_HELD_STATES.has(state)) {
      const anims = actor.sprite.anims;
      const first = anims.currentAnim && anims.currentAnim.frames[0];
      anims.stop();
      if (first) anims.setCurrentFrame(first);
    }
  }

  setIntroActorProgress(actor, state, progress) {
    if (!actor || actor.state !== state) return;
    const anims = actor.sprite.anims;
    const frames = anims.currentAnim ? anims.currentAnim.frames : null;
    if (!frames || !frames.length) return;
    const frame = frames[Phaser.Math.Clamp(Math.floor(progress * frames.length), 0, frames.length - 1)];
    if (!anims.isPaused) anims.pause();
    if (anims.currentFrame !== frame) anims.setCurrentFrame(frame);
    if (this.introCassetteOwner === (actor === this.introActors.manos ? 'manos' : 'shopkeeper')) {
      this.updateIntroCassetteSocket(actor, frame.index - 1);
    }
  }

  getIntroActorSprites() {
    return Object.values(this.introActors || {}).filter(Boolean).map((actor) => actor.sprite);
  }

  // The cassette has exactly one owner (or none, hidden) and sits at that owner's hand socket.
  setIntroCassetteOwner(owner) {
    this.introCassetteOwner = owner;
    const cassette = this.introCassette;
    if (!cassette) return;
    const mark = owner ? LEVEL0_SHOP[owner] : null;
    cassette.setVisible(!!mark);
    if (mark) {
      const actor = this.introActors[owner];
      const frame = actor && actor.sprite.anims.currentFrame;
      this.updateIntroCassetteSocket(actor, frame ? frame.index - 1 : 0);
    }
  }

  updateIntroCassetteSocket(actor, frameIndex) {
    const cassette = this.introCassette;
    if (!cassette || !actor || !this.introCassetteOwner) return;
    const meta = this.cfg.sprites[actor.sprite.texture.key];
    const sockets = meta && meta.poseGuide && (meta.poseGuide.cassetteSockets || meta.poseGuide.walkmanSockets);
    const socket = sockets && sockets[Math.max(0, Math.min(Number(frameIndex) || 0, sockets.length - 1))];
    if (!socket) return;
    const fixed = meta.fixedAnchor || actor.spec.fixedAnchor;
    if (!fixed) return;
    const scale = actor.sprite.scaleY;
    cassette.setPosition(
      actor.sprite.x + (socket.x - fixed.anchorFrameX) * scale,
      actor.sprite.y + (socket.y - fixed.anchorFrameY) * scale
    );
  }

  // Sole writer of #intro-dialogue: comic speech bubbles for Level 0 shop scene.
  setIntroCaption(text, speaker = 'manos') {
    const el = this.introDialogueEl;
    if (!el) return;
    if (el.textContent !== text || el.dataset.speaker !== speaker) {
      el.hidden = true;
      el.dataset.speaker = speaker;
      el.className = text ? `speaker-${speaker}` : '';
      el.textContent = text;
      if (text) {
        void el.offsetWidth;
        if (window.positionIntroOverlays) window.positionIntroOverlays();
      }
    }
    el.hidden = !text;
  }

  // Registry lookup (package L6 owns the shape): the key's entry in any assets.json section, its
  // video as `video` or `file`, its poster as `poster` or a separate `<key>_poster` file entry.
  getIntroCutsceneFiles(key) {
    const find = (name) => {
      for (const section of Object.values(this.cfg)) {
        if (section && typeof section === 'object' && section[name]) return section[name];
      }
      return null;
    };
    const entry = find(key) || {};
    const posterEntry = find(`${key}_poster`) || {};
    return { video: entry.video || entry.file || null, poster: entry.poster || posterEntry.file || null };
  }

  // Shows the opaque layer with the clip's poster and loads its video, unmuted (there is no
  // muted fallback: sound refused means the sprite fallback), hidden until it is playing.
  // Returns the media record; record.video is null when no video is registered.
  openIntroMedia(key) {
    this.closeIntroMedia(true);
    const files = this.getIntroCutsceneFiles(key);
    const { container, poster, video } = this.introMediaEls;
    const media = {
      key,
      files,
      video: null,
      abort: new AbortController(),
      playStartMs: null,     // intro-clock ms of the gesture's play(): the film clock before PLAY
      progressFilmMs: 0,     // film-clock ms of the last currentTime change
      lastTime: -1,
      playPending: false,
      nextDriftCheckMs: 0,
      driftCorrections: 0,
    };
    this.introMedia = media;
    // Listener that only acts while this record is still the open cutscene.
    media.on = (type, fn) => {
      if (media.video) media.video.addEventListener(type, (event) => { if (this.introMedia === media) fn(event); }, { signal: media.abort.signal });
    };
    // Nothing registered at all: no layer, the shop stays visible for the slot.
    if (!container || (!files.video && !files.poster)) return media;
    container.hidden = false;
    if (window.positionIntroOverlays) window.positionIntroOverlays();
    if (poster) {
      if (files.poster) poster.src = files.poster;
      else poster.removeAttribute('src');
      poster.hidden = !files.poster;
    }
    if (!video || !files.video) return media;
    media.video = video;
    video.style.opacity = '0';
    video.muted = false;
    video.defaultMuted = false;
    video.playsInline = true;
    video.src = files.video;
    video.load();
    return media;
  }

  // keepLayer: reopening keeps the opaque layer up (no shop flash) while the next record loads.
  closeIntroMedia(keepLayer = false) {
    const media = this.introMedia;
    this.introMedia = null;
    const { container, poster, video } = this.introMediaEls || {};
    if (media) media.abort.abort();
    if (media && media.video) {
      video.pause();
      video.removeAttribute('src');
      video.load();  // releases the decoder and network
    }
    if (video) video.style.opacity = '0';
    if (keepLayer) return;
    if (poster) {
      poster.hidden = true;
      poster.removeAttribute('src');
    }
    if (container) container.hidden = true;
  }

  playIntroMedia(media, onFail) {
    media.playPending = true;
    let result;
    try {
      result = media.video.play();
    } catch (error) {
      result = Promise.reject(error);
    }
    Promise.resolve(result).then(() => {
      if (this.introMedia === media) media.playPending = false;
    }, (error) => {
      if (this.introMedia !== media) return;
      media.playPending = false;
      // Interrupted by our own pause/seek: not a failure (the stall/drift checks still run).
      if (error && error.name === 'AbortError') return;
      onFail(error);
    });
  }

  // Opened with the intro (before any gesture): poster up, video preloading. A film that is not
  // registered, or fails to load, drops the layer and the first gesture runs the sprite fallback.
  openIntroFilm() {
    const media = this.openIntroMedia(LEVEL0_CUTSCENE_FULL_KEY);
    if (!media.video) {
      this.failIntroFilm('missing');
      return;
    }
    media.on('playing', () => { media.video.style.opacity = '1'; });
    media.on('ended', () => this.onIntroFilmEnded(media));
    media.on('error', () => this.failIntroFilm('error'));
  }

  // Inside the activating gesture: play() with sound, synchronously. Refused -> sprite fallback.
  startIntroFilm(media) {
    this.introPhase = 'film';
    this.setIntroCaption('');
    media.playStartMs = this.time.now;
    media.video.muted = false;
    media.video.defaultMuted = false;
    this.playIntroMedia(media, () => this.failIntroFilm('play-rejected'));
  }

  // Film clock: intro-clock time since play() until PLAY, then PLAY + song time, so the guards
  // stop with a paused song.
  getIntroFilmMs(media) {
    if (this.levelClockStart === null) return this.time.now - media.playStartMs;
    return (LEVEL0_FILM_PLAY_SECONDS + this.getLevelElapsed()) * 1000;
  }

  // Before PLAY the film runs free; on its PLAY frame the song starts. After PLAY the film is
  // held to the song: drift corrected periodically, paused with a paused song.
  updateIntroFilm() {
    const media = this.introMedia;
    if (!media || !media.video) {
      this.failIntroFilm('missing');
      return;
    }
    const video = media.video;
    if (this.levelClockStart === null && video.currentTime >= LEVEL0_FILM_PLAY_SECONDS) this.pressIntroFilmPlay(media);
    const filmMs = this.getIntroFilmMs(media);
    if (video.currentTime !== media.lastTime) {
      media.lastTime = video.currentTime;
      media.progressFilmMs = filmMs;
    }
    if (filmMs >= LEVEL0_FILM_MAX_MS) {
      this.failIntroFilm('overlong');
      return;
    }
    if (filmMs - media.progressFilmMs >= LEVEL0_FILM_STALL_MS) {
      this.failIntroFilm('stalled');
      return;
    }
    if (this.levelClockStart === null) return;
    if (this.music && this.music.isPaused) {
      if (!video.paused) video.pause();
      return;
    }
    const now = this.time.now;
    const target = LEVEL0_FILM_PLAY_SECONDS + this.getLevelElapsed();
    if (now >= media.nextDriftCheckMs) {
      media.nextDriftCheckMs = now + LEVEL0_MEDIA_DRIFT_CHECK_MS;
      if (target < video.duration && Math.abs(video.currentTime - target) > LEVEL0_MEDIA_DRIFT_TOLERANCE_SECONDS) {
        video.currentTime = target;
        media.driftCorrections += 1;
      }
    }
    if (video.paused && !media.playPending) this.playIntroMedia(media, () => this.failIntroFilm('play-rejected'));
  }

  // PLAY frame reached: the song starts where the film already is past it (the tick that sees the
  // frame is up to one frame late), so song time and film time agree from the first sample.
  pressIntroFilmPlay(media) {
    if (!this.introActive || this.levelClockStart !== null) return;
    this.introPlayReason = 'film';
    this.startSongClock(Math.max(0, media.video.currentTime - LEVEL0_FILM_PLAY_SECONDS));
  }

  // The film's end is the Fara7 reveal. An end that ran ahead of the song is drift, not the end:
  // seek back (the next tick resumes play).
  onIntroFilmEnded(media) {
    if (!this.introActive || this.introPhase !== 'film') return;
    if (this.levelClockStart === null) this.pressIntroFilmPlay(media);
    const elapsed = this.getLevelElapsed();
    if (elapsed < LEVEL0_REVEAL_SONG_SECONDS - LEVEL0_MEDIA_DRIFT_TOLERANCE_SECONDS) {
      media.video.currentTime = LEVEL0_FILM_PLAY_SECONDS + elapsed;
      media.driftCorrections += 1;
      return;
    }
    this.endIntro();
  }

  // Film gone (missing | error | play-rejected | stalled | overlong): the sprite fallback. Before
  // the gesture the shop just shows until it; before PLAY the shop scene starts over and presses
  // PLAY itself; after PLAY the shop listens until the reveal's song time.
  failIntroFilm(reason) {
    if (!this.introActive || this.introFilmFailure) return;
    this.introFilmFailure = reason;
    this.closeIntroMedia();
    if (this.introClockStart === null) return;
    if (this.levelClockStart === null) {
      this.introClockStart = this.time.now;
      this.introPhase = 'shop';
    } else {
      this.enterIntroListen();
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
    // Same guard as setActorVisual(): a hero sheet that did not load keeps the current pose.
    if (!this.hasSheet(visual.textureKey) || !this.anims.exists(visual.animationKey)) return visual;
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
    this.destroyTheatrePools();
    this.destroyTheatreBeams();
    this.destroyTheatreCurtainPeekers();
    if (this.levelBg) this.levelBg.destroy();
    // Every level change routes through here, so this is the one place the foreground
    // layer has to be cleared -- leaving it up would paint Level 1's crowd over Level 2.
    this.hideCrowdForeground();
    this.levelBgKey = key;
    this.levelBgFrame = 0;
    this.levelBg = this.add.image(0, 0, `${key}_0`).setOrigin(0, 0).setDepth(depth);
  }

  // The audience loop: same clock, same frame count, same 8-frames-per-bar cadence as the
  // background, just drawn in front. Skipped silently when the art is not registered.
  showCrowdForeground(key, depth) {
    this.hideCrowdForeground();
    if (!this.cfg.sprites[key] || !this.textures.exists(`${key}_0`)) return;
    this.crowdFgKey = key;
    this.crowdFgFrame = 0;
    this.crowdFg = this.add.image(0, 0, `${key}_0`).setOrigin(0, 0).setDepth(depth);
  }

  hideCrowdForeground() {
    if (this.crowdFg) this.crowdFg.destroy();
    this.crowdFg = null;
    this.crowdFgKey = null;
  }

  // Beat-locked, not a free-running animation: the frame is derived from the song clock
  // every tick, so it cannot drift from the track. getLevelElapsed() IS the audio's own
  // playback position (music.seek) while it plays; it is 0 until the first real gesture
  // (the moment the music starts), so frame 0 holds until then. If audio is slow or never
  // loads, it falls back to the same wall-clock timeline the music joins (setupMusic()
  // seeks to it), so the loop keeps its phase either way.
  updateLevelBackground(elapsed) {
    if (this.crowdFg) {
      const cf = barLoopFrameIndex(elapsed, this.cfg.sprites[this.crowdFgKey].files.length);
      if (cf !== this.crowdFgFrame) {
        this.crowdFgFrame = cf;
        this.crowdFg.setTexture(`${this.crowdFgKey}_${cf}`);
      }
    }
    if (!this.levelBg) return;
    const frame = barLoopFrameIndex(elapsed, this.cfg.sprites[this.levelBgKey].files.length);
    if (frame === this.levelBgFrame) return;
    this.levelBgFrame = frame;
    this.levelBg.setTexture(`${this.levelBgKey}_${frame}`);
  }

  createTheatrePools(elapsed) {
    this.destroyTheatrePools();
    this.theatrePools = {};
    for (const key of Object.keys(THEATRE_POOL_TEXTURES)) {
      const textureKey = `theatre_pool_${key}`;
      if (!this.textures.exists(textureKey)) continue;
      this.theatrePools[key] = this.add.image(0, 0, textureKey)
        .setOrigin(0, 0)
        .setDepth(THEATRE_DEPTH.pools)
        .setBlendMode(Phaser.BlendModes.NORMAL);
    }
    this.updateTheatrePools(elapsed);
  }

  updateTheatrePools(elapsed) {
    if (!this.theatrePools) return;
    const opacities = getTheatrePoolOpacities(elapsed);
    for (const [key, sprite] of Object.entries(this.theatrePools)) {
      sprite.setAlpha(opacities[key]);
    }
  }

  destroyTheatrePools() {
    for (const sprite of Object.values(this.theatrePools || {})) sprite.destroy();
    this.theatrePools = null;
  }

  createTheatreBeams(elapsed) {
    this.destroyTheatreBeams();
    this.theatreBeams = {};
    for (const key of Object.keys(THEATRE_BEAM_TEXTURES)) {
      const textureKey = `theatre_beam_${key}`;
      if (!this.textures.exists(textureKey)) continue;
      this.theatreBeams[key] = this.add.image(0, 0, textureKey)
        .setOrigin(0, 0)
        .setDepth(THEATRE_DEPTH.beams)
        .setBlendMode(Phaser.BlendModes.ADD);
    }
    // Draws nothing. Rendered after the beams and before pools/actors, it reads back the backdrop
    // the player actually sees under the lyric box (see captureTheatreLyricBackdrop()).
    this.theatreLyricBackdropProbe = this.add.rectangle(0, 0, 1, 1)
      .setOrigin(0, 0)
      .setDepth(THEATRE_DEPTH.beams + 0.25);
    this.theatreLyricBackdropProbe.renderCanvas = (renderer, src, camera) => this.captureTheatreLyricBackdrop(renderer, camera);
    this.updateTheatreBeams(elapsed);
  }

  updateTheatreBeams(elapsed) {
    if (!this.theatreBeams) return;
    const opacities = getTheatreBeamOpacities(elapsed);
    for (const [key, sprite] of Object.entries(this.theatreBeams)) {
      sprite.setAlpha(opacities[key]);
    }
  }

  destroyTheatreBeams() {
    for (const sprite of Object.values(this.theatreBeams || {})) sprite.destroy();
    this.theatreBeams = null;
    this.theatreLyricInk = null;
    if (this.theatreLyricBackdropProbe) this.theatreLyricBackdropProbe.destroy();
    this.theatreLyricBackdropProbe = null;
    this.theatreLyricBackdrop = null;
    this.theatreLyricDeviceInk = null;
  }

  getTheatreBeamOpacities(elapsed) {
    return getTheatreBeamOpacities(elapsed ?? this.getLevelElapsed());
  }

  // P30 / P32 -- the four band members peeking from the door drapes in Level 2, placed per
  // man from THEATRE.curtainPeek (the owner's own rig numbers: x, y, spin, height, frame,
  // flip). All four appear together after the 30s delay (THEATRE_PEEK_START_S), once: fade
  // in, hold, fade out, then destroyed for the rest of the Theatre. No alternation, no swapping.
  // One fabric occluder canvas per man, drawn directly above him (theatrePeekDepth()),
  // covering his bust cut with red velvet sampled from the background plate's own drape.

  // Tier = how many men on his side sit higher (smaller y); see THEATRE_DEPTH.
  theatrePeekDepth(man) {
    const tier = THEATRE.curtainPeek.filter((o) => o.side === man.side && o.y < man.y).length;
    const depth = THEATRE_DEPTH.curtainPeek + tier * THEATRE_DEPTH.curtainPeekTierStep;
    return { man: depth, fabric: depth + THEATRE_DEPTH.curtainPeekTierStep / 2 };
  }

  // World pixel -> the man's frame cell, through exactly the transform the sprite is drawn
  // with: translate to his anchor, un-rotate by his spin about it, un-scale, un-mirror about
  // the anchor column (peekOriginX()). Null outside the frame.
  theatrePeekFrameCell(man, frameWidth, frameHeight, px, py) {
    const S = man.height / THEATRE_PEEK_ANCHOR.refContentHeight;
    const a = Phaser.Math.DegToRad(man.spin);
    const dx = px + 0.5 - man.x;
    const dy = py + 0.5 - man.y;
    const u = (dx * Math.cos(a) + dy * Math.sin(a)) / S;
    const v = (-dx * Math.sin(a) + dy * Math.cos(a)) / S;
    const c = Math.floor(man.flipX ? THEATRE_PEEK_ANCHOR.anchorFrameX - u : THEATRE_PEEK_ANCHOR.anchorFrameX + u);
    const r = Math.floor(THEATRE_PEEK_ANCHOR.anchorFrameY + v);
    if (c < 0 || c >= frameWidth || r < 0 || r >= frameHeight) return null;
    return { c, r };
  }

  // World-space box of the man's whole frame after spin and flip -- the forward transform of
  // the four frame corners -- so the occluder scan follows the placement instead of a
  // hand-tuned window.
  theatrePeekWorldBounds(man, frameWidth, frameHeight) {
    const S = man.height / THEATRE_PEEK_ANCHOR.refContentHeight;
    const a = Phaser.Math.DegToRad(man.spin);
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const [fx, fy] of [[0, 0], [frameWidth, 0], [0, frameHeight], [frameWidth, frameHeight]]) {
      const lx = (man.flipX ? THEATRE_PEEK_ANCHOR.anchorFrameX - fx : fx - THEATRE_PEEK_ANCHOR.anchorFrameX) * S;
      const ly = (fy - THEATRE_PEEK_ANCHOR.anchorFrameY) * S;
      const wx = man.x + lx * Math.cos(a) - ly * Math.sin(a);
      const wy = man.y + lx * Math.sin(a) + ly * Math.cos(a);
      box.minX = Math.min(box.minX, wx);
      box.maxX = Math.max(box.maxX, wx);
      box.minY = Math.min(box.minY, wy);
      box.maxY = Math.max(box.maxY, wy);
    }
    return box;
  }

  ensureTheatreCurtainOccluderTextures() {
    const men = THEATRE.curtainPeek;
    const keyFor = (man) => `theatre_curtain_occluder_${man.role}`;
    if (men.every((man) => this.textures.exists(keyFor(man)))) return;

    const bgTex = this.textures.get('level2_theatre_bg_0');
    if (!bgTex) return;
    const bgImg = bgTex.getSourceImage();
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 1280;
    bgCanvas.height = 720;
    const bgCtx = bgCanvas.getContext('2d', { willReadFrequently: true });
    bgCtx.drawImage(bgImg, 0, 0);
    const bgData = bgCtx.getImageData(0, 0, 1280, 720).data;

    // Frame-space drape line: at or below this row (per frame column) the bust is behind
    // fabric, above it the man is in the open. Being in FRAME space, it spins and mirrors
    // with him, so the fabric always lands on his own cut.
    const CURVE = [
      [0, 174], [140, 174], [160, 174], [190, 176], [220, 178],
      [240, 180], [250, 182], [265, 178], [280, 160], [300, 148], [341, 145],
    ];
    const getCurveRow = (col) => {
      if (col <= CURVE[0][0]) return CURVE[0][1];
      for (let i = 1; i < CURVE.length; i += 1) {
        if (col <= CURVE[i][0]) {
          const [x0, y0] = CURVE[i - 1];
          const [x1, y1] = CURVE[i];
          const t = (col - x0) / (x1 - x0);
          return y0 + t * (y1 - y0);
        }
      }
      return CURVE[CURVE.length - 1][1];
    };
    // 18-column strips of the plate's door drapes (the bands P30 sampled), tiled across each
    // side's fabric so it carries the painted fold rhythm. Scenery, not placement.
    const FABRIC_SRC_X = { left: 330, right: 937 };
    const FABRIC_TILE = 18;

    const sheets = {};
    for (const man of men) {
      const textureKey = `theatre_curtain_peek_${man.role}`;
      const meta = this.cfg.sprites[textureKey];
      if (!this.textures.exists(textureKey) || !meta) continue;
      const img = this.textures.get(textureKey).getSourceImage();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const sheet = {
        data: ctx.getImageData(0, 0, img.width, img.height).data,
        width: img.width,
        fw: meta.frameWidth,
        fh: meta.frameHeight,
        frames: Math.floor(img.width / meta.frameWidth),
      };
      // The bust's bottom edge is a V-shaped cut whose outer arm tips (bottom ~171 at column
      // ~146) end ABOVE CURVE's 174, so CURVE alone leaves them in the open. Per frame and
      // column, the drape line is pulled up to 3 rows above that column's own bottom pixel,
      // which puts the whole V behind fabric.
      sheet.line = [];
      for (let fr = 0; fr < sheet.frames; fr += 1) {
        const line = new Float32Array(sheet.fw);
        for (let col = 0; col < sheet.fw; col += 1) {
          let bottom = -1;
          for (let row = sheet.fh - 1; row >= 0 && bottom < 0; row -= 1) {
            if (sheet.data[(row * sheet.width + fr * sheet.fw + col) * 4 + 3] > 0) bottom = row;
          }
          line[col] = bottom < 0 ? getCurveRow(col) : Math.min(getCurveRow(col), bottom - 3);
        }
        sheet.line.push(line);
      }
      sheets[man.role] = sheet;
    }

    // Per man, over his own spun/flipped box + margin, in any of his frames:
    //  - fabric: SOME part of the world pixel holds his alpha at or below the drape line. A
    //    4x4 sub-sample grid (one sample per frame pixel at scale 55/220), because a spun,
    //    downscaled edge pixel can be drawn from a frame pixel its centre misses, and a
    //    centre-only test leaves single-pixel slivers of shirt along the cut.
    //  - head: the pixel CENTRE holds his alpha above the line -- what the renderer draws.
    const MARGIN = 2;
    const SUB = 4;
    const masks = {};
    // Any frame with alpha on the given side of ITS OWN drape line (below = fabric).
    const hasAlpha = (sh, cell, below) => {
      for (let fr = 0; fr < sh.frames; fr += 1) {
        if ((cell.r >= sh.line[fr][cell.c]) === below
          && sh.data[(cell.r * sh.width + fr * sh.fw + cell.c) * 4 + 3] > 0) return true;
      }
      return false;
    };
    for (const man of men) {
      const sh = sheets[man.role];
      if (!sh) continue;
      const b = this.theatrePeekWorldBounds(man, sh.fw, sh.fh);
      const x0 = Math.max(0, Math.floor(b.minX) - MARGIN);
      const x1 = Math.min(1279, Math.ceil(b.maxX) + MARGIN);
      const y0 = Math.max(0, Math.floor(b.minY) - MARGIN);
      const y1 = Math.min(719, Math.ceil(b.maxY) + MARGIN);
      const fabric = new Uint8Array(1280 * 720);
      const head = new Uint8Array(1280 * 720);
      for (let py = y0; py <= y1; py += 1) {
        for (let px = x0; px <= x1; px += 1) {
          const i = py * 1280 + px;
          const centre = this.theatrePeekFrameCell(man, sh.fw, sh.fh, px, py);
          if (centre && hasAlpha(sh, centre, false)) head[i] = 1;
          for (let s = 0; s < SUB * SUB && !fabric[i]; s += 1) {
            const sx = px + ((s % SUB) + 0.5) / SUB - 0.5;
            const sy = py + (Math.floor(s / SUB) + 0.5) / SUB - 0.5;
            const cell = this.theatrePeekFrameCell(man, sh.fw, sh.fh, sx, sy);
            if (cell && hasAlpha(sh, cell, true)) fabric[i] = 1;
          }
        }
      }
      masks[man.role] = { fabric, head, x0, x1, y0, y1 };
    }

    for (const man of men) {
      const own = masks[man.role];
      if (!own) continue;
      // Fabric never covers the head of a man drawn UNDER it. With the tier layering no such
      // head overlaps any drape on today's placement (a lower man is drawn over the drape
      // above him), but a placement that tucks a head under a lower drape stays correct.
      const fabricDepth = this.theatrePeekDepth(man).fabric;
      const others = men
        .filter((o) => o !== man && masks[o.role] && this.theatrePeekDepth(o).man < fabricDepth)
        .map((o) => masks[o.role].head);
      const zone = new Uint8Array(1280 * 720);
      for (let py = own.y0; py <= own.y1; py += 1) {
        for (let px = own.x0; px <= own.x1; px += 1) {
          const i = py * 1280 + px;
          if (own.fabric[i] && !others.some((m) => m[i])) zone[i] = 1;
        }
      }

      const occCanvas = document.createElement('canvas');
      occCanvas.width = 1280;
      occCanvas.height = 720;
      const occCtx = occCanvas.getContext('2d');
      const imgData = occCtx.createImageData(1280, 720);
      const data = imgData.data;
      const srcBase = FABRIC_SRC_X[man.side];

      for (let py = own.y0; py <= own.y1; py += 1) {
        for (let px = own.x0; px <= own.x1; px += 1) {
          const pIdx = py * 1280 + px;
          if (!zone[pIdx]) continue;
          const srcX = srcBase + ((((px - srcBase) % FABRIC_TILE) + FABRIC_TILE) % FABRIC_TILE);
          const bgIdx = (py * 1280 + srcX) * 4;
          let r = bgData[bgIdx];
          let g = bgData[bgIdx + 1];
          let b = bgData[bgIdx + 2];

          const isTop = py > 0 && !zone[(py - 1) * 1280 + px];
          const isTop2 = py > 1 && !zone[(py - 2) * 1280 + px] && !isTop;

          if (isTop) {
            r = Math.min(255, r * 1.6 + 45);
            g = Math.min(255, g * 1.3 + 12);
            b = Math.min(255, b * 1.3 + 20);
          } else if (isTop2) {
            r = Math.min(255, r * 1.25 + 20);
            b = Math.min(255, b * 1.25 + 10);
          }

          const outIdx = pIdx * 4;
          data[outIdx] = r;
          data[outIdx + 1] = g;
          data[outIdx + 2] = b;
          data[outIdx + 3] = 255;

          if (isTop) {
            const shIdx = ((py - 1) * 1280 + px) * 4;
            data[shIdx] = 0;
            data[shIdx + 1] = 0;
            data[shIdx + 2] = 0;
            data[shIdx + 3] = 100;
          }
        }
      }

      occCtx.putImageData(imgData, 0, 0);
      const key = keyFor(man);
      if (this.textures.exists(key)) this.textures.remove(key);
      this.textures.addCanvas(key, occCanvas);
    }
  }

  // P33b: each man and his fabric are NOT drawn to the screen directly. Faded separately, a
  // half-strength man is blended onto the scene first and a half-strength fabric then covers
  // only half of him, so his bust cut shows through mid-fade. Instead both are drawn at full
  // opacity into one RenderTexture per man (the "pair"), redrawn every frame just before the
  // scene renders, and only the pair is faded. The sprite and fabric image live off the
  // display list; the sprite stays on the update list so it keeps animating.
  createTheatreCurtainPeekers(elapsed) {
    this.destroyTheatreCurtainPeekers();
    const sheets = LEVEL2_ANIM_GROUPS.curtainPeek.sheets;
    this.ensureTheatreCurtainOccluderTextures();
    this.theatreCurtainPeekers = [];
    this.theatreCurtainOccluders = [];
    this.theatreCurtainPeekStart = elapsed;

    for (const man of THEATRE.curtainPeek) {
      const textureKey = `theatre_curtain_peek_${man.role}`;
      if (!sheets[textureKey] || !this.hasSheet(textureKey)) continue;
      const depth = this.theatrePeekDepth(man);
      const sprite = this.make.sprite({ x: man.x, y: man.y, key: textureKey, frame: 0 }, false)
        .setDepth(depth.man);
      this.sys.updateList.add(sprite);
      sprite.setFlipX(man.flipX);
      this.setActorVisual(
        { sprite, spec: { displayContentHeight: man.height, clipBottomY: null, fixedAnchor: THEATRE_PEEK_ANCHOR } },
        { textureKey, animationKey: sheets[textureKey] }
      );
      // After setActorVisual(), which puts the origin on column 315 of the UNmirrored frame.
      sprite.setOrigin(peekOriginX(this.cfg.sprites[textureKey].frameWidth, man.flipX), sprite.originY);
      sprite.setAngle(man.spin);
      if (man.frame) sprite.anims.setCurrentFrame(sprite.anims.currentAnim.frames[man.frame]);

      // The pair covers his whole spun/flipped frame box plus the fabric's margin and drop
      // shadow row (ensureTheatreCurtainOccluderTextures()), on whole world pixels, at his
      // man depth -- so tier order is unchanged: upper pair, then lower pair over it.
      const meta = this.cfg.sprites[textureKey];
      const b = this.theatrePeekWorldBounds(man, meta.frameWidth, meta.frameHeight);
      const x0 = Math.floor(b.minX) - 4;
      const y0 = Math.floor(b.minY) - 4;
      const pair = this.add.renderTexture(x0, y0, Math.ceil(b.maxX) + 4 - x0, Math.ceil(b.maxY) + 4 - y0)
        .setOrigin(0, 0)
        .setDepth(depth.man)
        .setName(`theatre_curtain_pair_${man.role}`);
      this.theatreCurtainPeekers.push({ role: man.role, side: man.side, sprite, pair });

      const texKey = `theatre_curtain_occluder_${man.role}`;
      if (!this.textures.exists(texKey)) continue;
      const image = this.make.image({ x: 0, y: 0, key: texKey }, false)
        .setOrigin(0, 0)
        .setDepth(depth.fabric);
      this.theatreCurtainOccluders.push({ side: man.side, role: man.role, image });
    }

    this.events.on('prerender', this.drawTheatreCurtainPeekPairs, this);
    this.updateTheatreCurtainPeekers(elapsed);
  }

  // Every frame, before the scene renders: man, then his fabric, both at full opacity, into
  // his pair. RenderTexture.draw() ignores `visible`, so hidden objects are skipped here.
  drawTheatreCurtainPeekPairs() {
    for (const p of this.theatreCurtainPeekers || []) {
      if (!p.pair) continue;
      const o = (this.theatreCurtainOccluders || []).find((q) => q.role === p.role);
      p.pair.clear();
      if (p.sprite.visible) p.pair.draw(p.sprite, p.sprite.x - p.pair.x, p.sprite.y - p.pair.y);
      if (o && o.image.visible) p.pair.draw(o.image, -p.pair.x, -p.pair.y);
    }
  }

  updateTheatreCurtainPeekers(elapsed) {
    if (!this.theatreCurtainPeekers) return;
    const active = elapsed - this.theatreCurtainPeekStart - THEATRE_PEEK_START_S;
    const fadeOutAt = THEATRE_PEEK_FADE_S + THEATRE_PEEK_HOLD_S;
    if (active >= fadeOutAt + THEATRE_PEEK_FADE_S) {
      // The one appearance is over: nothing is left on screen or ticking.
      this.destroyTheatreCurtainPeekers();
      return;
    }
    // Only the composited pair fades; the man and his fabric inside it stay at alpha 1, so
    // the fabric hides his bust cut at every alpha (see createTheatreCurtainPeekers()).
    let alpha = 0;
    if (active >= fadeOutAt) alpha = 1 - (active - fadeOutAt) / THEATRE_PEEK_FADE_S;
    else if (active >= THEATRE_PEEK_FADE_S) alpha = 1;
    else if (active > 0) alpha = active / THEATRE_PEEK_FADE_S;
    const on = alpha > 0;
    for (const p of this.theatreCurtainPeekers) {
      if (!p.sprite) continue;
      p.sprite.setVisible(on);
      p.sprite.setAlpha(1);
      p.pair.setVisible(on);
      p.pair.setAlpha(alpha);
    }
    for (const o of this.theatreCurtainOccluders || []) {
      if (!o.image) continue;
      o.image.setVisible(on);
      o.image.setAlpha(1);
    }
  }

  destroyTheatreCurtainPeekers() {
    this.events.off('prerender', this.drawTheatreCurtainPeekPairs, this);
    for (const p of this.theatreCurtainPeekers || []) {
      // Made off the display list, so nothing else takes the sprite off the update list.
      if (p.sprite) {
        this.sys.updateList.remove(p.sprite);
        p.sprite.destroy();
      }
      if (p.pair) p.pair.destroy();
    }
    for (const o of this.theatreCurtainOccluders || []) {
      if (o.image) o.image.destroy();
    }
    this.theatreCurtainPeekers = null;
    this.theatreCurtainOccluders = null;
    this.theatreCurtainPeekStart = null;
  }

  // RGBA bytes of a texture under the lyric rect, read once per texture.
  getTheatreLyricPixels(textureKey) {
    if (!this.theatreLyricPixels) this.theatreLyricPixels = {};
    if (!this.theatreLyricPixels[textureKey]) {
      const rect = THEATRE_CINEMA_LYRIC_RECT;
      const canvas = document.createElement('canvas');
      canvas.width = rect.width;
      canvas.height = rect.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(this.textures.get(textureKey).getSourceImage(), -rect.x, -rect.y);
      this.theatreLyricPixels[textureKey] = context.getImageData(0, 0, rect.width, rect.height).data;
    }
    return this.theatreLyricPixels[textureKey];
  }

  // Clip paths for the cream/white/black lyric passes, from what was just rendered: the
  // current background frame and each beam sprite's applied alpha (not a re-evaluated clock),
  // so masks and beams can never disagree mid-fade. Called by index.html after each render.
  getTheatreLyricInkPaths() {
    if (!this.level2Active || !this.theatreBeams || !this.levelBg) return null;
    const bgKey = this.levelBg.texture.key;
    const beams = {};
    const opacities = {};
    for (const [key, sprite] of Object.entries(this.theatreBeams)) {
      beams[key] = this.getTheatreLyricPixels(sprite.texture.key);
      opacities[key] = sprite.visible ? sprite.alpha : 0;
    }
    const cacheKey = `${bgKey}|${Object.entries(opacities).map(([key, value]) => `${key}:${value}`).join('|')}`;
    if (this.theatreLyricInk && this.theatreLyricInk.cacheKey === cacheKey) return this.theatreLyricInk.paths;
    const { width, height } = THEATRE_CINEMA_LYRIC_RECT;
    const regions = computeTheatreLyricInkRegions(this.getTheatreLyricPixels(bgKey), beams, opacities, width, height);
    const paths = theatreLyricInkPaths(regions, width, height);
    this.theatreLyricInk = { cacheKey, paths };
    return paths;
  }

  // Main-camera canvas render, after background and beams, before pools and actors: the pixels
  // actually drawn under the lyric box (camera zoom, nearest-neighbour sampling, additive beams).
  // Read back only when the draw could differ: box placement, camera transform, frame, beam alphas.
  captureTheatreLyricBackdrop(renderer, camera) {
    if (camera !== this.cameras.main || !this.levelBg || !this.cinemaLyricEl || this.cinemaLyricEl.hidden) return;
    const context = renderer.currentContext;
    const canvas = context.canvas;
    const rect = THEATRE_CINEMA_LYRIC_RECT;
    const m = camera.matrix;
    const a = m.transformPoint(rect.x - camera.scrollX, rect.y - camera.scrollY);
    const b = m.transformPoint(rect.x + rect.width - camera.scrollX, rect.y + rect.height - camera.scrollY);
    const x = Math.max(0, Math.floor(Math.min(a.x, b.x)) - 2);
    const y = Math.max(0, Math.floor(Math.min(a.y, b.y)) - 2);
    const w = Math.min(canvas.width, Math.ceil(Math.max(a.x, b.x)) + 2) - x;
    const h = Math.min(canvas.height, Math.ceil(Math.max(a.y, b.y)) + 2) - y;
    if (w <= 0 || h <= 0) return;
    const alphas = Object.values(this.theatreBeams || {}).map((sprite) => (sprite.visible ? sprite.alpha : 0)).join(',');
    const key = `${x},${y},${w},${h}|${m.a},${m.d},${m.e},${m.f}|${this.levelBg.texture.key}|${alphas}|${canvas.width}x${canvas.height}`;
    if (this.theatreLyricBackdrop && this.theatreLyricBackdrop.key === key) return;
    this.theatreLyricBackdropCaptures = (this.theatreLyricBackdropCaptures || 0) + 1;
    this.theatreLyricBackdrop = {
      key, x, y, w, h, canvasWidth: canvas.width, canvasHeight: canvas.height,
      data: context.getImageData(x, y, w, h).data,
    };
  }

  // Ink per DEVICE pixel of the lyric box, from the rendered backdrop displayed at that pixel
  // (canvas px under its centre; the canvas is scaled pixelated). Cream where the design px under
  // the centre has no beam light and the displayed pixel still holds the cream floor; otherwise
  // white/black by displayed luminance against the unchanged split. Nearest-neighbour zoom and
  // canvas scaling can show a neighbouring texel, so classifying the texture px (as
  // getTheatreLyricInkPaths() does) can miss the floor at the real scale; this cannot. Paths are
  // device-pixel indices from (originX, originY), mapped to local design px by index.html.
  getTheatreLyricDeviceInkPaths(box, canvasRect, dpr) {
    const backdrop = this.theatreLyricBackdrop;
    if (!this.level2Active || !this.theatreBeams || !backdrop || !box || !canvasRect || !canvasRect.width) return null;
    const cacheKey = `${backdrop.key}|${box.left}|${box.top}|${box.scaleX}|${box.scaleY}|${canvasRect.left}|${canvasRect.top}|${canvasRect.width}|${canvasRect.height}|${dpr}`;
    if (this.theatreLyricDeviceInk && this.theatreLyricDeviceInk.cacheKey === cacheKey) return this.theatreLyricDeviceInk;
    const { width, height } = THEATRE_CINEMA_LYRIC_RECT;
    const originX = Math.floor(box.left * dpr);
    const originY = Math.floor(box.top * dpr);
    const cols = Math.ceil((box.left + width * box.scaleX) * dpr) - originX;
    const rows = Math.ceil((box.top + height * box.scaleY) * dpr) - originY;
    const beams = Object.values(this.theatreBeams)
      .filter((sprite) => sprite.visible && sprite.alpha > 0)
      .map((sprite) => this.getTheatreLyricPixels(sprite.texture.key));
    const lin = THEATRE_SRGB_LINEAR;
    const [cr, cg, cb] = THEATRE_LYRIC_CREAM_RGB;
    const creamLum = 0.2126 * lin[cr] + 0.7152 * lin[cg] + 0.0722 * lin[cb];
    const creamLimit = (creamLum + 0.05) / THEATRE_LYRIC_CREAM_MIN_CONTRAST - 0.05;
    // The compositor scales the canvas from its layer snapped to whole device pixels, and samples it
    // nearest (image-rendering: pixelated), so this maps a device px to the source px it displays.
    const leftSnapped = Math.round(canvasRect.left * dpr) / dpr;
    const topSnapped = Math.round(canvasRect.top * dpr) / dpr;
    const toCanvasX = backdrop.canvasWidth / (Math.round(canvasRect.width * dpr) / dpr);
    const toCanvasY = backdrop.canvasHeight / (Math.round(canvasRect.height * dpr) / dpr);
    // Right on a source-px boundary the compositor may take either side, so judge both: a blend or
    // a choice is per channel within their min/max, and luminance rises with every channel.
    const EDGE = 0.05;
    const d = backdrop.data;
    const regions = new Uint8Array(cols * rows);
    const whiteLimit = 1.05 / THEATRE_LYRIC_INK_MIN_CONTRAST - 0.05;
    const blackLimit = 0.05 * THEATRE_LYRIC_INK_MIN_CONTRAST - 0.05;
    for (let row = 0; row < rows; row += 1) {
      const cy = (originY + row + 0.5) / dpr;
      const v = Math.min(height - 1, Math.max(0, Math.floor((cy - box.top) / box.scaleY)));
      const fy = (cy - topSnapped) * toCanvasY;
      const by = Math.floor(fy) - backdrop.y;
      if (by < 0 || by >= backdrop.h) continue;
      const fracY = fy - Math.floor(fy);
      const y0 = Math.max(0, by - (fracY < EDGE ? 1 : 0));
      const y1 = Math.min(backdrop.h - 1, by + (fracY > 1 - EDGE ? 1 : 0));
      for (let col = 0; col < cols; col += 1) {
        const cx = (originX + col + 0.5) / dpr;
        const fx = (cx - leftSnapped) * toCanvasX;
        const bx = Math.floor(fx) - backdrop.x;
        if (bx < 0 || bx >= backdrop.w) continue;
        const u = Math.min(width - 1, Math.max(0, Math.floor((cx - box.left) / box.scaleX)));
        const p = (by * backdrop.w + bx) * 4;
        const centre = 0.2126 * lin[d[p]] + 0.7152 * lin[d[p + 1]] + 0.0722 * lin[d[p + 2]];
        let lo = centre;
        let hi = centre;
        const fracX = fx - Math.floor(fx);
        const x0 = Math.max(0, bx - (fracX < EDGE ? 1 : 0));
        const x1 = Math.min(backdrop.w - 1, bx + (fracX > 1 - EDGE ? 1 : 0));
        if (x0 !== x1 || y0 !== y1) {
          let rLo = 255; let gLo = 255; let bLo = 255;
          let rHi = 0; let gHi = 0; let bHi = 0;
          for (let sy = y0; sy <= y1; sy += 1) {
            for (let sx = x0; sx <= x1; sx += 1) {
              const q = (sy * backdrop.w + sx) * 4;
              if (d[q] < rLo) rLo = d[q];
              if (d[q] > rHi) rHi = d[q];
              if (d[q + 1] < gLo) gLo = d[q + 1];
              if (d[q + 1] > gHi) gHi = d[q + 1];
              if (d[q + 2] < bLo) bLo = d[q + 2];
              if (d[q + 2] > bHi) bHi = d[q + 2];
            }
          }
          lo = 0.2126 * lin[rLo] + 0.7152 * lin[gLo] + 0.0722 * lin[bLo];
          hi = 0.2126 * lin[rHi] + 0.7152 * lin[gHi] + 0.0722 * lin[bHi];
        }
        const t = (v * width + u) * 4 + 3;
        const lit = beams.some((beam) => beam[t] > 0);
        if (!lit && hi <= creamLimit) continue;
        // The unchanged split decides whenever its ink clears the floor for every value that can be
        // displayed here; otherwise take the ink that does, or the better worst case if neither can.
        const bySplit = centre < THEATRE_INK_LUMINANCE_SPLIT ? 1 : 2;
        if (bySplit === 1 ? hi <= whiteLimit : lo >= blackLimit) regions[row * cols + col] = bySplit;
        else if (hi <= whiteLimit) regions[row * cols + col] = 1;
        else if (lo >= blackLimit) regions[row * cols + col] = 2;
        else regions[row * cols + col] = 1.05 / (hi + 0.05) >= (lo + 0.05) / 0.05 ? 1 : 2;
      }
    }
    this.theatreLyricDeviceInk = { cacheKey, originX, originY, dpr, paths: theatreLyricInkPaths(regions, cols, rows) };
    return this.theatreLyricDeviceInk;
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
      // L7: the song starts at PLAY (startSongClock()), never on a pre-song intro gesture.
      if (this.levelClockStart === null) return false;
      const elapsed = this.getLevelElapsed();
      const duration = this.music.duration;
      const seek = Number.isFinite(duration) && duration > 0
        ? Math.min(elapsed, Math.max(0, duration - 0.01))
        : 0;
      const played = this.music.play({ seek });
      if (played) this.musicStarted = true;
      return played;
    };
    this.startMusic = startMusic;  // PLAY (startSongClock()) calls the same route
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
    // C1: an abnormal song end while still in the Theatre must not leave the push-in applied.
    if (this.level2Active) {
      this.theatreZoomStartElapsed = null;
      this.cameras.main.setZoom(1);
    }
    this.showCredits();
  }

  showCredits() {
    if (this.creditsShown) return;
    this.creditsShown = true;
    this.requestTerminalStillness();
    this.fadeFloorHearts();
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
    const stagePxToCss = overlay.clientWidth / 1280;
    const scrollMs = Math.round(((startY - endY) / (CREDITS_SCROLL_STAGE_PX_PER_SEC * stagePxToCss)) * 1000);
    content.style.transition = `transform ${scrollMs}ms linear`;
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
    const existingBubbleText = !fading && !inCinemaWindow ? activeText : '';
    // C3: in Fara7 exactly what the bubble would have shown goes inside the lit heart marquee
    // instead. Theatre (outside its screen window) keeps the bubble; Party uses its banner from
    // the 132s handoff through the end of the song.
    const isFara7 = !this.level2Active && !this.level3Active;
    const heartText = isFara7 ? existingBubbleText : '';
    const bubbleText = isFara7 || this.level3Active ? '' : existingBubbleText;
    const cinemaText = !fading && this.level2Active && inCinemaWindow ? activeText : '';
    const partyText = !fading && this.level3Active && elapsed >= LEVEL3_ENTRANCE_SECONDS
      ? activeText : '';

    // Hide all first on a route change so matching/stale text can never leave two
    // destinations visible during a seek or a transition. The world-anchored boxes are
    // fitted and placed by the post-render hook (index.html positionWorldLyrics()) before
    // this frame is painted.
    const pairs = [
      [this.lyricEl, bubbleText],
      [this.cinemaLyricEl, cinemaText],
      [this.cinemaLyricDarkEl, cinemaText],
      [this.cinemaLyricWhiteEl, cinemaText],
      [this.heartLyricEl, heartText],
      [this.partyLyricEl, partyText],
    ];
    for (const [el, text] of pairs) {
      if (el && !text) el.hidden = true;
    }
    for (const [el, text] of pairs) {
      if (!el) continue;
      if (el.textContent !== text) el.textContent = text;
      el.hidden = !text;
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
    // Marks: three players left of Manos, the drums right of him (owner lock 2026-09-15). The
    // band enters from BOTH wings rather than filing in
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
      // Level 1 held facing -- see FARA7_HELD_FLIP_X and FARA7_HELD_FLIP_X_BY_MEMBER.
      heldFlipX: FARA7_HELD_FLIP_X_BY_MEMBER[id] !== undefined ? FARA7_HELD_FLIP_X_BY_MEMBER[id] : FARA7_HELD_FLIP_X,
      // All four Level 1 band walk-in sheets are authored walking RIGHT -- see
      // actorWalkInFlipX(). Only this factory sets it, so only these four are affected.
      walkInFacesRight: FARA7_BAND_WALK_IN_FACES_RIGHT,
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
        // Which wing this actor walks on from, and therefore which way it travels. It is
        // actorWalkInFlipX() that turns this plus walkInFacesRight into the sprite's flipX.
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
      performance: bandPerformanceVisual(`musician_${sheet}_playing`, mark.performanceHeight, mark.performanceFaceOffsetY),
    });

    // Starts are spread across ~20s rather than bunched at boot, per GAME_PLAN section 0
    // ("hit windows spread evenly across the level's actual running time"). The level still
    // opens with only Manos on stage -- buildInteractiveActors() parks every entrance actor
    // hidden on its wing mark. Tabla/keyboard/accordion sit left of Manos and enter from the
    // left wing; drums sits alone right of Manos and enters from the right wing.
    this.buildInteractiveActors([
      // The tabla player -- a genuinely new fourth band member (GAME_PLAN section 0), and
      // the one the old street roster was missing entirely. His sheets do not follow the
      // musician_* naming, hence the literal keys, including his playing loop.
      bandMember('tabla', FARA7.band.tabla, {
        idle: { textureKey: 'tabla_player_standing_idle', animationKey: loops.tabla_player_standing_idle },
        walkIn: { textureKey: 'tabla_player_walkin', animationKey: ACTOR_WALK_IN_ANIMS.tabla_player_walkin },
        dizzy: { textureKey: 'tabla_player_dizzy_love', animationKey: loops.tabla_player_dizzy_love },
        performance: bandPerformanceVisual('tabla_player_playing', FARA7.band.tabla.performanceHeight, FARA7.band.tabla.performanceFaceOffsetY),
      }, 1500, 'left'),
      bandMember('keyboard', FARA7.band.keyboard, musician('keyboard', 'Keyboard', FARA7.band.keyboard), 7000, 'left'),
      bandMember('accordion', FARA7.band.accordion, musician('accordion', 'Accordion', FARA7.band.accordion), 13500, 'left'),
      bandMember('drums', FARA7.band.drums, musician('drums', 'Drums', FARA7.band.drums), 20000, 'right'),
    ]);
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
    if (dressingSheets[coupleKey] && this.hasSheet(coupleKey)) {
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
    // missing/unregistered, on the couple's line. x measured 2026-09-13, fara7_geometry report;
    // heights are still the old converted values (KEEP).
    const placements = [
      ['wife_bride_seated_idle', 742.59, interimY(165)],
      ['husband_groom_seated_idle', 824.23, interimY(150)],
    ];
    for (const [textureKey, x, contentHeight] of placements) {
      if (!this.hasSheet(textureKey)) continue;
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
    const soprano = (colour, targetX, doorX, side, entranceStartMs) => {
      const walkInKey = `soprano_${colour}_walkin`;
      return {
        id: `soprano_${colour}`,
        targetX,
        footY: THEATRE.stageFootY,
        displayContentHeight: THEATRE.sopranoContentHeights[colour],
        depth: THEATRE_DEPTH.soprano,
        idle: sopranoIdleVisual(this, loops, colour),
        walkIn: walkIns[walkInKey] ? { textureKey: walkInKey, animationKey: walkIns[walkInKey] } : null,
        dizzy: { textureKey: `soprano_${colour}_dizzy`, animationKey: loops[`soprano_${colour}_dizzy`] },
        // The textureKey is the mic group's first state, and it is here for a real reason
        // rather than decoration: buildInteractiveActors() drops a performance whose sheet
        // isn't registered, so if the composites ever go missing these three degrade to the
        // old stub instead of walking to a mic that was never built.
        performance: { kind: 'mic', textureKey: 'theatre_mic_empty', micInstance: 'theatreMic' },
        hitsRequired: 3,
        entrance: {
          path: [
            { x: doorX, y: THEATRE.stageFootY },
            { x: targetX, y: THEATRE.stageFootY },
          ],
          speedPxPerSecond: THEATRE.entranceSpeedPxPerSecond,
          earliestStartMs: entranceStartMs,
          side,
          fadeMs: THEATRE_DOOR_FADE_MS,
        },
        clipBottomY: null,
      };
    };

    // Staged waiting marks clear of Manos at 641 and the empty mic stand at 491.
    // Gold enters from left door (316) -> mark 555; green and red enter from right door (963).
    // Green (mark 740) leaves first at 0ms; red (mark 815) follows at 600ms.
    this.buildInteractiveActors([
      soprano('gold', 555, THEATRE_LEFT_DOOR_X, 'left', 0),
      soprano('green', 740, THEATRE_RIGHT_DOOR_X, 'right', 0),
      soprano('red', 815, THEATRE_RIGHT_DOOR_X, 'right', 600),
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
  buildMic(micInstance, { x, floorY, speedPxPerSecond, contentHeight, threeContentHeight, depth }) {
    this.destroyMic(micInstance);
    if (!this.hasSheet('theatre_mic_empty')) return;
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
      visuals: micVisuals(threeContentHeight),
      // Arrived actor ids, in arrival order. Its LENGTH is the only join count in this
      // file -- never a roster index, never "how many are dizzy".
      joined: [],
      // The one soprano currently walking, or null. One at a time, always.
      walkerId: null,
    };
    this.setActorVisual(this[micInstance], this[micInstance].visuals[0]);
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
      speedPxPerSecond: 130,
      contentHeight: THEATRE.micContentHeight,
      threeContentHeight: THEATRE.micThreeContentHeight,
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
      threeContentHeight: PARTY.micThreeContentHeight,
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
      // Level 3 held facing -- see PARTY_HELD_FLIP_X.
      heldFlipX: PARTY_HELD_FLIP_X,
      walkInFacesRight: visuals.performance?.kind === 'instrument' ? FARA7_BAND_WALK_IN_FACES_RIGHT : undefined,
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
    // Fork A: the three sopranos are NOT in this roster -- buildPartySopranos() stages them at
    // the mic on install, outside hit admission. Their old left-wing slots (3600/6100/8400 in
    // the table below) are simply vacant; the band's own starts are unchanged.
    //
    // Marks: the locked final set (PARTY.band + PARTY.micX + PARTY.sopranoWaitingX), with
    // the hero's own box (PARTY.walkMinX..walkMaxX) between the trio and the keyboard.
    //
    // WINGS (Astra section 2): drummer and tabla enter from the LEFT wing, keyboard and
    // accordion from the RIGHT.
    //
    // STAGGER: every start below is derived, not inherited. At PARTY.entranceSpeedPxPerSecond
    // (300) the travel from a wing to a mark is |mark - wing| / 300 (the soprano rows are the
    // pre-Fork-A walk-ins the left-wing starts were spaced around):
    //   RIGHT wing 1320.0   keyboard  581.198px 1.937s | LEFT wing -60.0  drums 680.000px 2.267s
    //                       accordion 475.145px 1.584s |                  red   593.520px 1.978s
    //                                                  |                  gold  545.490px 1.818s
    //                                                  |                  green 493.660px 1.645s
    //                                                  |                  tabla 427.694px 1.425s
    // Each wing is walked by ONE actor at a time: every start is its predecessor's arrival on
    // that wing plus a ~0.5s clearance beat, so no two actors ever share a wing. Within a wing
    // the furthest-mark-first invariant still holds (LEFT = largest target x first, RIGHT =
    // smallest first): drums(620) -> tabla(367.694) on the left, keyboard(738.802) ->
    // accordion(844.855) on the right. The drummer precedes the tabla and the keyboard
    // precedes the accordion, as the ruling requires. One consequence of Fork A: the trio is
    // now parked from install, so the drummer's walk to 620 crosses behind it (his line
    // 509.6 is upstage of the trio's 518.0, and the trio is drawn over him).
    //
    // The last arrival is the tabla at 10600 + 1425 = 12.03s after the Party installs
    // (~134.0s, R2_GATE_FINDINGS) -- ~146.1s, so everyone is on their mark with ~14s to spare
    // before the 160s boss cue, which is on the absolute song clock and reachable regardless
    // of any of this (updateBossEntrance()).
    this.buildInteractiveActors([
      partyActor('drums', PARTY.band.drums.footX, musician('drums', 'Drums', PARTY.band.drums), 800, 'left'),
      partyActor('keyboard', PARTY.band.keyboard.footX, musician('keyboard', 'Keyboard', PARTY.band.keyboard), 1500, 'right'),
      partyActor('accordion', PARTY.band.accordion.footX, musician('accordion', 'Accordion', PARTY.band.accordion), 4000, 'right'),
      partyActor('tabla', PARTY.band.tabla.footX, {
        idle: { textureKey: 'tabla_player_standing_idle', animationKey: l1.tabla_player_standing_idle },
        walkIn: { textureKey: 'tabla_player_walkin', animationKey: ACTOR_WALK_IN_ANIMS.tabla_player_walkin },
        dizzy: { textureKey: 'tabla_player_dizzy_love', animationKey: l1.tabla_player_dizzy_love },
        performance: bandPerformanceVisual('tabla_player_playing', PARTY.band.tabla.performanceHeight),
        footY: PARTY.band.tabla.footY,
        contentHeight: PARTY.band.tabla.standingHeight,
      }, 10600, 'left'),
    ]);
    this.buildPartyMic();
    this.buildPartySopranos();
  }

  // Fork A: all three sopranos are at the mic from the moment the Party installs, and the
  // song clock alone decides whether they sing. Like the mic and the boss they are NOT in
  // this.interactiveActors, which is what structurally keeps them out of hit admission --
  // no projectile can target them and strikeActor() refuses them (canHitActor() only admits
  // walking_in/engageable). `spec`/`sprite` shaped only so setActorVisual() consumes them.
  // Built after the band so, on the shared cast depth, the downstage trio draws over them.
  buildPartySopranos() {
    this.destroyPartySopranos();
    const mic = this.partyMic;
    if (!mic) return;
    const l2 = LEVEL2_ANIM_GROUPS.loops.sheets;
    // PARTY.sopranoWaitingX are the rest marks around the empty stand, in join order.
    const colours = { soprano_gold: 'gold', soprano_green: 'green', soprano_red: 'red' };
    this.partySopranos = mic.joinOrder.map((id) => {
      const colour = colours[id];
      const idle = sopranoIdleVisual(this, l2, colour);
      const sprite = this.add.sprite(PARTY.sopranoWaitingX[colour], mic.floorY, idle.textureKey, 0)
        .setDepth(PARTY_DEPTH.cast)
        .setFlipX(PARTY_HELD_FLIP_X);
      const soprano = {
        spec: {
          id,
          restX: PARTY.sopranoWaitingX[colour],
          displayContentHeight: PARTY.sopranoContentHeights[colour],
          clipBottomY: null,
          heldFlipX: PARTY_HELD_FLIP_X,
          idle,
        },
        sprite,
        state: 'staged_mic',
      };
      this.setActorVisual(soprano, idle);
      return soprano;
    });
    // Admitted once, here, and never again: with the join list full, releaseNextMicWalker()
    // and arriveAtMic() have nothing left to do for this mic.
    mic.joined = [...mic.joinOrder];
    // Land straight in whichever state the song is in -- the Party can install inside a window.
    this.partySingingActive = isPartySingingWindow(this.getLevelElapsed());
    this.applyPartySingingState();
  }

  destroyPartySopranos() {
    for (const soprano of this.partySopranos) soprano.sprite.destroy();
    this.partySopranos = [];
    this.partySingingActive = false;
  }

  destroyPassiveAudience() {
    this.cancelTheatreAudienceFlourish();
    for (const sprite of this.passiveAudience) sprite.destroy();
    this.passiveAudience = [];
    this.theatreSoloAudienceSprite = null;
  }

  buildInteractiveActors(roster) {
    // An actor with no loaded idle sheet has nothing to stand in; it is left out of the
    // roster rather than built on a texture that is not there (see hasSheet()).
    this.interactiveActors = roster.filter((spec) => this.hasSheet(spec.idle.textureKey)).map((spec) => {
      // An actor whose walk-in sheet isn't registered in assets.json (or didn't load)
      // degrades to spawning in place rather than throwing on an undefined metadata read --
      // the sheets are registered by a separate asset pass, so "not there yet" is a real,
      // reachable state.
      const hasWalkIn = !!(spec.walkIn && spec.entrance && this.hasSheet(spec.walkIn.textureKey));
      // Same tolerance, same reason, for the playing-instrument sheets: three of the four
      // are registered by that separate asset pass, so "declared in the roster but not on
      // disk yet" is a real reachable state. Dropping the field is enough -- everything
      // downstream dispatches on spec.performance, so a band member without its sheet just
      // holds the old dizzy loop instead of crashing on an undefined metadata read.
      const hasPerformance = !!(spec.performance && this.hasSheet(spec.performance.textureKey));
      const usableSpec = (hasWalkIn && hasPerformance) ? spec : {
        ...spec,
        walkIn: hasWalkIn ? spec.walkIn : null,
        entrance: hasWalkIn ? spec.entrance : null,
        performance: hasPerformance ? spec.performance : null,
      };
      const sprite = this.add.sprite(usableSpec.targetX, usableSpec.footY, usableSpec.idle.textureKey, 0);
      sprite.setDepth(usableSpec.depth);
      // Facing for the walk, from actorWalkInFlipX(): travel direction against the sheet's own
      // authored facing. setActorVisual() deliberately does not reset flipX, so for a roster
      // WITHOUT spec.heldFlipX (Level 2) that mirror persists through
      // walk-in -> idle -> dizzy -> playing exactly as it always has. A roster WITH
      // spec.heldFlipX (Levels 1 and 3) states its facing per state instead: directional while
      // walking, the authored orientation in every stationary pose, applied by
      // applyActorHeldFacing() at each transition.
      sprite.setFlipX(actorWalkInFlipX(usableSpec));

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

  // THE sheet guard: registered in assets.json AND actually loaded. Registration alone is
  // the wrong question -- a registered sheet whose file 404s (untracked art in a clean
  // checkout) has no texture, Phaser builds a 0-frame Animation on it, and anims.play()
  // then throws reading `duration` off a frame that does not exist. Every skip-if-missing
  // test on a sprite sheet in this file routes through here, so a missing sheet costs what
  // uses it, never the level. Registered-but-absent is warned about once per key.
  hasSheet(textureKey) {
    if (!textureKey || !this.cfg.sprites[textureKey]) return false;
    if (this.textures.exists(textureKey)) return true;
    this.missingSheetWarned = this.missingSheetWarned || new Set();
    if (!this.missingSheetWarned.has(textureKey)) {
      this.missingSheetWarned.add(textureKey);
      console.warn(`[manos] sheet "${textureKey}" is registered but did not load -- skipping what uses it`);
    }
    return false;
  }

  // Every anims.create() in this file goes through here, so no Animation is ever built on
  // a texture that is not there. `end` defaults to the sheet's registered last frame.
  createSheetAnimation(textureKey, { key, end, frameRate, repeat }) {
    if (!this.hasSheet(textureKey)) return null;
    return this.anims.create({
      key,
      frames: this.anims.generateFrameNumbers(textureKey, {
        start: 0, end: end === undefined ? this.cfg.sprites[textureKey].frames - 1 : end,
      }),
      frameRate,
      repeat,
    });
  }

  // Single owner of the scale/origin/crop maths for actor sprites (it used to be
  // duplicated between the build pass and the strike pass, which is how they drifted).
  setActorVisual(actor, visual) {
    const sprite = actor.sprite;
    // The play choke point for every non-player sprite: a visual whose sheet is missing
    // leaves the sprite on what it was showing instead of throwing inside Phaser.
    if (!visual || !this.hasSheet(visual.textureKey) || !this.anims.exists(visual.animationKey)) return;
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
    const fixed = meta.fixedAnchor || actor.spec.fixedAnchor || null;
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
    // Package K: a visual may also carry its OWN anchorYOffset, a vertical slide off that
    // anchor (the Level 1 playing loops use it for the face line). Because the anchor is read
    // back off sprite.y, the offset currently in effect is tracked on the actor and taken off
    // before the new one goes on -- re-applying a visual never accumulates, and a visual with
    // no offset (everything else) returns the sprite to its unshifted line.
    const anchorYOffset = visual.anchorYOffset !== undefined ? visual.anchorYOffset : 0;
    const anchorX = sprite.x;
    const anchorY = sprite.y - (actor.anchorYOffset || 0) + anchorYOffset;
    actor.anchorYOffset = anchorYOffset;
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

  // Facing for a STATIONARY pose. A roster that declares spec.heldFlipX (Levels 1 and 3) gets it
  // set explicitly on arrival and on every later held state, so nothing is inherited from
  // the entrance side; a roster that does not (Level 2) is left untouched.
  applyActorHeldFacing(actor) {
    if (!actor.spec || actor.spec.heldFlipX === undefined) return;
    actor.sprite.setFlipX(actor.spec.heldFlipX);
  }

  startActorEntrance(actor) {
    const start = actor.spec.entrance.path[0];
    // Facing for the WALK, stated here rather than inherited from build time -- same
    // actorWalkInFlipX() the spawn uses, so the two can no longer disagree. Only rosters that
    // pin their held facing state it again here; the others keep the flip
    // buildInteractiveActors() gave them, unchanged.
    if (actor.spec.heldFlipX !== undefined) {
      actor.sprite.setFlipX(actorWalkInFlipX(actor.spec));
    }
    actor.sprite.setPosition(start.x, start.y);
    actor.sprite.setVisible(true);
    if (actor.spec.entrance.fadeMs) {
      actor.entranceFadeElapsedMs = 0;
      actor.sprite.setAlpha(0);
    } else {
      actor.sprite.setAlpha(1);
    }
    actor.pathSegmentIndex = 1;   // 0 is where it stands now; walk towards 1 onwards
    actor.state = 'walking_in';
    this.setActorVisual(actor, actor.spec.walkIn);
  }

  updateInteractiveActors(delta) {
    if (this.introActive) return;
    if (this.actorEntranceTriggerX !== null && this.actorEntranceElapsedMs === null) {
      // Fara7: the reveal is now song 4.75 (the film's end); the band keeps its song times by
      // counting its entrance offsets from LEVEL1_BAND_ENTRANCE_SONG_SECONDS, the old reveal.
      const triggered = this.level2Active
        ? !this.level2Revealing
        : (this.cameras.main.worldView.x <= this.actorEntranceTriggerX
          && this.getLevelElapsed() >= LEVEL1_BAND_ENTRANCE_SONG_SECONDS);
      if (triggered) {
        this.actorEntranceElapsedMs = 0;
      }
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
      if (entrance.fadeMs && actor.entranceFadeElapsedMs !== undefined
        && actor.entranceFadeElapsedMs < entrance.fadeMs) {
        actor.entranceFadeElapsedMs += delta;
        actor.sprite.setAlpha(Math.min(1, actor.entranceFadeElapsedMs / entrance.fadeMs));
      }
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
        actor.sprite.setAlpha(1);
        // An actor that took its last hit mid-walk (strikeActor() lets it finish the route
        // rather than freezing it there) goes straight to dizzy on arrival instead of
        // standing idle first -- same helper the standing-hit path uses.
        // Arrival ends the walk, so the directional walk mirror ends with it.
        this.applyActorHeldFacing(actor);
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
      this.applyActorHeldFacing(actor);
      this.setActorVisual(actor, actor.spec.idle);
      return;
    }
    actor.state = 'joined_mic';
    // The mic walk is over, so its directional mirror is too -- stated before she is hidden,
    // because Level 2's rest path (applyTheatreSingingState()) shows these same sprites again
    // between singing windows and must not resurrect a walk facing.
    this.applyActorHeldFacing(actor);
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

  // The Party's twin of applyTheatreSingingState(), over its own staged trio. One synchronous
  // pass, so no frame shows the trio composite AND a resting individual: singing is the
  // 3-joined composite alone, resting is the empty stand plus the three on their rest marks.
  applyPartySingingState() {
    const mic = this.partyMic;
    if (!mic) return;
    if (this.partySingingActive) {
      this.setActorVisual(mic, mic.visuals[3]);
      for (const soprano of this.partySopranos) {
        soprano.sprite.anims.stop();
        soprano.sprite.setVisible(false);
      }
      return;
    }
    this.setActorVisual(mic, mic.visuals[0]);
    for (const soprano of this.partySopranos) {
      soprano.sprite.setPosition(soprano.spec.restX, mic.floorY);
      soprano.sprite.setFlipX(soprano.spec.heldFlipX);
      soprano.sprite.setVisible(true);
      this.setActorVisual(soprano, soprano.spec.idle);
    }
  }

  // Polled every frame on the absolute song clock. Only an edge re-applies the visuals, so
  // repeated calls at one timestamp restart nothing, and a jump across any number of
  // boundaries lands in the state of wherever it lands.
  updatePartySopranosSingingGate(elapsed) {
    if (!this.level3Active || !this.partyMic) return;
    const shouldSing = isPartySingingWindow(elapsed);
    if (this.partySingingActive !== shouldSing) {
      this.partySingingActive = shouldSing;
      this.applyPartySingingState();
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
    if (target.point) return target.point;
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
    this.applyActorHeldFacing(actor);
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
      this.applyActorHeldFacing(actor);
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
        // It does not touch flipX, so the facing for this held pose is stated here.
        this.applyActorHeldFacing(actor);
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
  // landed all 12 band hits -- same reasoning as Level 1's keyboard solo: a fixed musical
  // beat must never become unreachable because someone missed a throw.
  spawnBoss() {
    if (this.boss || !this.hasSheet('femme_fatale_idle')) return;
    const spec = {
      id: 'femme_fatale',
      // Her LOCKED on-mark (level3_boss.json "boss_on_mark"): one right-band beat (24.55px)
      // past the accordion, off the deck's right edge, so the band's rhythm runs
      // drums | keyboard | accordion | boss and her forehead has a clear line to Manos's
      // head over the keyboard and accordion. The old staged 767.04 stood her 36.8px over
      // the keyboard's locked silhouette.
      targetX: 939.198,
      footY: PARTY.groundY,
      displayContentHeight: PARTY.bossContentHeight,
      idle: { textureKey: 'femme_fatale_idle', animationKey: LEVEL3_ANIM_GROUPS.loops.sheets.femme_fatale_idle },
      walkIn: this.hasSheet('femme_fatale_entrance')
        ? { textureKey: 'femme_fatale_entrance', animationKey: LEVEL3_ANIM_GROUPS.walkIns.sheets.femme_fatale_entrance }
        : null,
      kiss: this.hasSheet('femme_fatale_kiss')
        ? { textureKey: 'femme_fatale_kiss', animationKey: LEVEL3_ANIM_GROUPS.kiss.sheets.femme_fatale_kiss }
        : null,
      final: this.hasSheet('femme_fatale_final')
        ? { textureKey: 'femme_fatale_final', animationKey: LEVEL3_ANIM_GROUPS.final.sheets.femme_fatale_final }
        : null,
      clipBottomY: null,
    };
    // Her LOCKED entry (level3_boss.json "boss_entry"): the first construction grid line
    // with her WHOLE silhouette past the frame edge. The old runtime spawn at PARTY.wingX's
    // interim 1237.209 was not off-screen -- her walk sheet spans 1206.9..1267.9 there, so
    // she popped into existence over the bay and the audience, on a side of the set that is
    // water, not a floor she could have walked in from.
    const sprite = this.add.sprite(PARTY.bossEntryX, PARTY.groundY, spec.idle.textureKey, 0)
      .setDepth(PARTY_DEPTH.boss);
    this.boss = { spec, sprite, state: spec.walkIn ? 'walking_in' : 'on_mark' };
    this.startBossSettle();
    // The right-wing walk is the authored left-facing sheet. State the directional walk
    // orientation here, then arriveBoss() states the unmirrored held orientation explicitly.
    sprite.setFlipX(false);
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

  // P34: the ending is an authored composition -- root ENDING_MARK_X, head-left/boots-right
  // (docs/ASTRA_PLAN_ENDING_SUPINE.md), which FLOOR_HEARTS_POSITION is placed against -- so
  // it must not inherit wherever the player happened to stand. Her walk-in is the window:
  // input locks at her spawn and Manos walks himself to the mark with the ordinary walk.
  // Worst case is 0.83s of jump airtime or 140px of walk (0.54s), against her 1.904s walk.
  startBossSettle() {
    if (this.manosDefeated || this.bossSequenceActive) return;
    this.bossSettleActive = true;
    this.bossSettleDirection = 0;
    this.bossSettleOnMark = false;
    this.mSequenceActive = false;
    this.mHeartBeatIndex = null;
    this.touchState.left = false;
    this.touchState.right = false;
    this.touchState.jump = false;
    // The dizzy gesture is a 2s held loop, long enough to eat the whole budget; the
    // one-shot heart/flowers gestures are allowed to finish (update() waits on this.gesture).
    if (this.gesture === 'dizzy') this.cancelGesture();
  }

  // One tick of the settle, from update(). Airborne: gravity finishes the arc, X held, as
  // killManos() does. Grounded: the ordinary physics walk at SPEED toward the mark.
  //
  // Arrival has to respect Arcade's order: the step has already moved the BODY when
  // update() runs, but the sprite only receives that displacement in postUpdate, after us
  // -- so player.x lags one step and a setX() here gets the step added on top (measured:
  // he oscillated around 620 and never settled). The body centre IS the root (the body
  // is centred on it, see applyPlayerFrameAnchor()), so arrival is judged on it. On the
  // step that reaches or crosses the mark the body is taken off the integrator
  // (moves = false: no gravity, no postUpdate write-back) and the sprite is put on the
  // mark directly; the drawn change that frame is never more than that step's own walk.
  updateBossSettle(onFloor) {
    const player = this.player;
    if (this.bossSettleOnMark) {
      // The tick after arrival: the arrival step itself was drawn mid-walk, now he turns and
      // stands. Unmirrored on purpose (owner): he is singing to HER at the end. Unflipped,
      // floor_singing lies head-left/boots-right with his face turned up and to the right,
      // and her mark is locked at 939.198, always to the right of this one -- so he faces
      // her. Mirroring him would leave him singing at the wall. p34_ending_staging_check
      // asserts she is on the side he faces.
      player.setFlipX(false);
      // He SINGS on the mark, right up until her kiss lands -- he does not stand idle waiting
      // for her (owner 2026-09-23: "he needs to be singing until the moment the kiss lands,
      // currently he stops for a bit"). The facing comment above already said he is singing to
      // her at the end; the pose was the one thing that disagreed.
      this.playPlayerVisual('singing');
      return;
    }
    if (!onFloor) {
      player.setVelocityX(0);
      this.playPlayerVisual('jump');
      return;
    }
    const dx = ENDING_MARK_X - player.body.center.x;
    const crossed = this.bossSettleDirection !== 0 && Math.sign(dx) !== this.bossSettleDirection;
    if (Math.abs(dx) <= ENDING_MARK_TOLERANCE_PX || crossed) {
      this.bossSettleOnMark = true;
      this.bossSettleDirection = 0;
      player.setVelocity(0, 0);
      player.body.moves = false;
      player.setX(ENDING_MARK_X);
      player.body.updateFromGameObject();
      return;
    }
    this.bossSettleDirection = Math.sign(dx);
    player.setVelocityX(this.bossSettleDirection * SPEED);
    player.setFlipX(dx < 0);
    this.playPlayerVisual('walk');
  }

  // Hands the body back to physics. Called when the kiss lands, and by destroyBoss() for a
  // restart mid-settle.
  endBossSettle() {
    this.bossSettleActive = false;
    this.bossSettleOnMark = false;
    this.bossSettleDirection = 0;
    const body = this.player && this.player.body;
    if (!body || body.moves) return;
    // While moves was false Arcade stopped refreshing prev/prevFrame, and postUpdate adds
    // (position - prevFrame) to the sprite: left stale, that pushed him 2.9px off the mark
    // the moment the kiss landed. Re-base both on where he actually stands.
    body.moves = true;
    body.updateFromGameObject();
    body.prev.set(body.position.x, body.position.y);
    body.prevFrame.set(body.position.x, body.position.y);
  }

  // On arrival she plays the kiss one-shot. The kiss projectile spawns once, on frame
  // index 5, from her measured forehead socket (86, 52) -> game (934.198, 359.8), and
  // flies toward Manos's head at (616.2, 366.4). When the kiss finishes, she holds idle.
  arriveBoss() {
    const boss = this.boss;
    if (!boss) return;
    boss.state = 'on_mark';
    boss.sprite.setFlipX(false);
    this.clearBossKissListeners();
    if (boss.spec.kiss) {
      this.setActorVisual(boss, boss.spec.kiss);
      this.bossKissFired = false;
      this.bossKissAnimationUpdateHandler = (anim, frame) => {
        if (anim.key !== LEVEL3_ANIM_GROUPS.kiss.sheets.femme_fatale_kiss) return;
        const frameIndex = frame.textureFrame !== undefined ? frame.textureFrame : (frame.index - 1);
        if (frameIndex >= 5 && !this.bossKissFired) {
          this.spawnBossKiss();
        }
      };
      boss.sprite.on('animationupdate', this.bossKissAnimationUpdateHandler);
      this.bossKissCompleteHandler = () => {
        this.clearBossKissListeners();
        if (!this.bossKissFired) {
          this.spawnBossKiss();
        }
        if (this.boss && this.boss.sprite && this.boss.state === 'on_mark') {
          this.setActorVisual(this.boss, this.boss.spec.idle);
        }
      };
      boss.sprite.once(`animationcomplete-${LEVEL3_ANIM_GROUPS.kiss.sheets.femme_fatale_kiss}`, this.bossKissCompleteHandler);
    } else {
      this.setActorVisual(boss, boss.spec.idle);
      this.spawnBossKiss();
    }
  }

  // Driven by real measured socket on kiss frame index 5: cell (86, 52), foot anchor (96, 376),
  // reference height 352 source px -> game (934.198, 359.8) when standing at (939.198, 521.8).
  spawnBossKiss() {
    const boss = this.boss;
    if (!boss || this.bossKissRequested) return;
    this.bossKissRequested = true;
    this.bossKissFired = true;
    const meta = this.cfg.sprites[boss.spec.kiss ? boss.spec.kiss.textureKey : boss.spec.idle.textureKey];
    const fixed = (meta && meta.fixedAnchor) || { anchorFrameX: 96, anchorFrameY: 376, refContentHeight: 352 };
    const scale = boss.spec.displayContentHeight / fixed.refContentHeight;
    const spawn = {
      x: boss.sprite.x + (BOSS_KISS_FOREHEAD_SOCKET_CELL.x - fixed.anchorFrameX) * scale,
      y: boss.sprite.y + (BOSS_KISS_FOREHEAD_SOCKET_CELL.y - fixed.anchorFrameY) * scale,
    };
    const flip = this.player.x <= boss.sprite.x; // true == travelling toward -x
    this.spawnProjectileDirectional('kiss', flip, {
      team: 'hostile',
      emitter: boss.sprite,
      textureKey: 'heart_icon',
      spawn,
      target: { kind: 'player', entity: this.player, point: BOSS_KISS_TARGET_POINT },
      onImpact: () => this.handleBossKissImpact(),
    });
  }

  playBossFinal() {
    const boss = this.boss;
    if (!boss || !boss.sprite || !boss.spec.final) return;
    boss.state = 'final';
    boss.sprite.setFlipX(false);
    boss.sprite.setPosition(boss.spec.targetX, boss.spec.footY);
    this.setActorVisual(boss, boss.spec.final);
  }

  // The kiss landing (spec steps 3-6): dizzy -> dizzy WHILE singing -> the existing
  // non-looping collapse -> floor singing. Locks input immediately, same as killManos(),
  // but defers the actual defeat/collapse until the hit anim completes and the singing hold
  // below finishes. Idempotent
  // against a duplicate onImpact call.
  handleBossKissImpact() {
    if (this.manosDefeated || this.bossSequenceActive) return;
    this.bossSequenceActive = true;
    this.endBossSettle();
    this.cancelGesture();
    this.mSequenceActive = false;
    this.mHeartBeatIndex = null;
    this.touchState.left = false;
    this.touchState.right = false;
    this.touchState.jump = false;
    this.player.setVelocityX(0);
    this.playPlayerVisual('dizzy_hit');
    this.clearBossKissHitCompletionHandler();
    this.bossKissHitCompleteHandler = () => this.advanceBossKissToSinging();
    this.player.once('animationcomplete-dizzyHitAnim', this.bossKissHitCompleteHandler);
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

  clearBossKissListeners() {
    if (this.boss && this.boss.sprite) {
      if (this.bossKissAnimationUpdateHandler) {
        this.boss.sprite.off('animationupdate', this.bossKissAnimationUpdateHandler);
      }
      if (this.bossKissCompleteHandler) {
        this.boss.sprite.off(`animationcomplete-${LEVEL3_ANIM_GROUPS.kiss.sheets.femme_fatale_kiss}`, this.bossKissCompleteHandler);
        this.boss.sprite.off('animationcomplete', this.bossKissCompleteHandler);
      }
    }
    this.bossKissAnimationUpdateHandler = null;
    this.bossKissCompleteHandler = null;
  }

  destroyBoss() {
    this.clearBossKissListeners();
    this.clearBossKissHitCompletionHandler();
    if (this.bossKissSingingTimer) {
      this.bossKissSingingTimer.remove(false);
      this.bossKissSingingTimer = null;
    }
    this.bossKissFired = false;
    this.bossKissRequested = false;
    this.bossSequenceActive = false;
    this.endBossSettle();
    this.bossRequested = false;
    if (this.boss) {
      if (this.boss.sprite) this.boss.sprite.destroy();
      this.boss = null;
    }
  }

  clearDeathCompletionHandler() {
    if (!this.deathCompleteHandler || !this.player) return;
    this.player.off('animationcomplete-collapseAnim', this.deathCompleteHandler);
    this.deathCompleteHandler = null;
  }

  clearFloorSingingCompletionHandler() {
    if (!this.floorSingingCompleteHandler || !this.player) return;
    this.player.off('animationcomplete-floorSingingAnim', this.floorSingingCompleteHandler);
    this.floorSingingCompleteHandler = null;
  }

  createFloorHearts() {
    if (this.floorHearts || !this.textures.exists('floor_hearts')) return;
    this.floorHearts = this.add.sprite(FLOOR_HEARTS_POSITION.x, FLOOR_HEARTS_POSITION.y, 'floor_hearts', 0)
      .setOrigin(0.5, 0.5)
      .setScale(0.5)
      .setDepth(1)
      .setBlendMode(Phaser.BlendModes.NORMAL);
    this.floorHearts.play('floorHeartsAnim');
  }

  fadeFloorHearts() {
    if (!this.floorHearts || this.floorHeartsFadeTween) return;
    this.floorHeartsFadeTween = this.tweens.add({
      targets: this.floorHearts,
      alpha: 0,
      duration: FLOOR_HEARTS_FADE_MS,
      ease: 'Linear',
      onComplete: () => {
        if (this.floorHearts) this.floorHearts.destroy();
        this.floorHearts = null;
        this.floorHeartsFadeTween = null;
      },
    });
  }

  destroyFloorHearts() {
    if (this.floorHeartsFadeTween) {
      this.floorHeartsFadeTween.stop();
      this.floorHeartsFadeTween = null;
    }
    if (this.floorHearts) this.floorHearts.destroy();
    this.floorHearts = null;
  }

  // State 6 (spec): singing on the floor, cut to from the collapse's final pose. Plays the real
  // floor_singing loop from frame 0.
  startFloorSinging() {
    const visual = this.getPlayerVisual('floor_singing');
    const animation = this.anims.get(visual.animationKey);
    if (animation) animation.repeat = -1;
    this.terminalStarted = false;
    this.clearFloorSingingCompletionHandler();
    if (!animation || !this.hasSheet(visual.textureKey)) return;
    this.player.anims.play(visual.animationKey, true);
    this.resizeBodyForTexture();
  }

  requestTerminalStillness() {
    if (this.terminalStarted || !this.player || !this.player.active) return;
    const current = this.player.anims.currentAnim;
    if (!current || current.key !== 'floorSingingAnim') return;
    const floorSinging = this.anims.get('floorSingingAnim');
    if (!floorSinging) return;
    this.clearFloorSingingCompletionHandler();
    this.floorSingingCompleteHandler = () => {
      this.floorSingingCompleteHandler = null;
      this.startTerminalStillness();
    };
    this.player.once('animationcomplete-floorSingingAnim', this.floorSingingCompleteHandler);
    // The floor beat remains a loop until the credits path requests its authored exit. Its
    // current cycle is allowed to complete, and only that animationcomplete event enters T1.
    floorSinging.repeat = 0;
    this.player.anims.repeatCounter = 0;
    this.player.anims.setCurrentFrame(floorSinging.frames[floorSinging.frames.length - 1]);
  }

  startTerminalStillness() {
    if (this.terminalStarted || !this.manosDefeated || !this.player || !this.player.active) return;
    this.terminalStarted = true;
    this.clearFloorSingingCompletionHandler();
    this.playPlayerVisual('terminal_stillness');
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
      this.createFloorHearts();
      // Spec step 6: keeps singing on the floor, from the collapse's own final pose.
      this.startFloorSinging();
      this.playBossFinal();
    };
    this.player.once('animationcomplete-collapseAnim', this.deathCompleteHandler);
  }

  // Defeat takes input ownership immediately. A grounded impact starts the one-shot
  // collapse now; an airborne impact keeps the current vertical velocity and gravity so
  // Manos completes the real physics arc before that grounded animation begins.
  killManos() {
    if (this.manosDefeated) return;
    this.manosDefeated = true;
    this.cancelGesture();
    this.mSequenceActive = false;
    this.mHeartBeatIndex = null;
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
  // One listener set per scene run: every listener shares one AbortController that the
  // shutdown handler aborts, so a restart can never stack a second set on the same buttons.
  setupTouchControls() {
    if (this.touchControlsAbort) this.touchControlsAbort.abort();
    this.touchControlsAbort = new AbortController();
    const signal = this.touchControlsAbort.signal;
    const bind = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); onDown(); }, { signal });
      if (onUp) {
        el.addEventListener('pointerup', onUp, { signal });
        el.addEventListener('pointerleave', onUp, { signal });
        el.addEventListener('pointercancel', onUp, { signal });
      }
    };
    bind('btn-left', () => { this.touchState.left = true; }, () => { this.touchState.left = false; });
    bind('btn-right', () => { this.touchState.right = true; }, () => { this.touchState.right = false; });
    bind('btn-jump', () => { this.touchState.jump = true; }, () => { this.touchState.jump = false; });
    bind('btn-heart', () => { this.touchState.heart = true; });
    bind('btn-flowers', () => { this.touchState.flowers = true; });
    bind('btn-dizzy', () => { this.touchState.dizzy = true; });
    bind('btn-sing', () => { this.touchState.sing = true; });
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
    if (!this.hasSheet(KEYBOARD_SOLO_VISUALS.walking.textureKey)
      || !this.hasSheet(KEYBOARD_SOLO_VISUALS.standing.textureKey)) return;

    const priorState = actor.state;
    // Cancels a bounded dizzy callback or either half of the playing-sheet alpha fade.
    // Neither is allowed to wake up after the solo has claimed this sprite.
    this.clearActorPerformanceTrigger(actor);
    actor.keyboardSoloRestore = {
      state: this.getKeyboardSoloRestoreState(actor, priorState),
      flipX: actor.sprite.flipX,
      // Read off the sprite, not the spec, so the restore returns exactly what was there.
      depth: actor.sprite.depth,
    };
    // Out of the band's shared depth for the duration of the solo -- otherwise the drummer,
    // inserted last into the display list, wins the tie and draws over the soloist. See
    // FARA7_DEPTH.bandSolo.
    actor.sprite.setDepth(FARA7_DEPTH.bandSolo);
    actor.keyboardSoloTargetX = Phaser.Math.Clamp(this.player.x - 129.67, 435.21, 761.80);
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
    // The raised depth is the solo's, not the actor's: hand it back before letting go of the
    // restore record, so the keyboardist rejoins the band's shared layer.
    if (actor.sprite.active) actor.sprite.setDepth(actor.keyboardSoloRestore.depth);
    actor.keyboardSoloRestore = null;
    actor.keyboardSoloTargetX = null;
  }

  // Theatre's keyboardist is deliberately standalone, like the mic composite: it has the
  // actor/spec shape needed by setActorVisual(), but is never inserted into
  // interactiveActors and therefore can never enter the projectile hit-test loop.
  startTheatreKeyboardSolo() {
    if (this.theatreKeyboardSolo || !this.hasSheet(KEYBOARD_SOLO_VISUALS.walking.textureKey)
      || !this.hasSheet(KEYBOARD_SOLO_VISUALS.standing.textureKey)) return;
    // Final P4 placement: measured solo mark/height, entering from the left door.
    const spec = {
      targetX: 801.71,
      footY: THEATRE.stageFootY,
      displayContentHeight: 143.2,
      depth: THEATRE_DEPTH.soprano + 1,
      clipBottomY: null,
    };
    const spawnX = THEATRE_LEFT_DOOR_X;
    const sprite = this.add.sprite(spawnX, spec.footY, KEYBOARD_SOLO_VISUALS.walking.textureKey, 0)
      .setDepth(spec.depth)
      .setFlipX(true)
      .setAlpha(0);
    this.theatreKeyboardSolo = {
      spec,
      sprite,
      state: 'walking',
      speedPxPerSecond: KEYBOARD_SOLO_WALK_SPEED,
      fadeElapsedMs: 0,
    };
    this.setActorVisual(this.theatreKeyboardSolo, KEYBOARD_SOLO_VISUALS.walking);
  }

  updateTheatreKeyboardSolo(delta) {
    const solo = this.theatreKeyboardSolo;
    if (!solo || solo.state !== 'walking') return;
    if (solo.fadeElapsedMs < THEATRE_DOOR_FADE_MS) {
      solo.fadeElapsedMs += delta;
      solo.sprite.setAlpha(Math.min(1, solo.fadeElapsedMs / THEATRE_DOOR_FADE_MS));
    }
    const step = solo.speedPxPerSecond * (delta / 1000);
    const dx = solo.spec.targetX - solo.sprite.x;
    if (Math.abs(dx) <= step) {
      solo.sprite.setPosition(solo.spec.targetX, solo.spec.footY);
      // The standing sheet's source art faces left, toward centre stage from this mark.
      solo.sprite.setFlipX(false);
      solo.sprite.setAlpha(1);
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

    const exitTiming = this.getTheatreExitTiming();
    if (!this.theatrePhoneRequested && elapsed >= exitTiming.phoneStartSeconds) {
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
    // Recompute at the settled position in case the cue first arrived while he was airborne.
    this.theatreWalkOffSeconds = this.getTheatreExitTiming().walkOffSeconds;
    this.cutsceneActive = true;
    this.player.setCollideWorldBounds(false);
    this.startPhoneCutscene(() => this.enterLevel3(), 'theatre');
  }

  getTheatreExitTiming() {
    const travelSeconds = Math.max(0, this.player.x - THEATRE_LEFT_DOOR_X) / SPEED;
    const phoneStartSeconds = THEATRE_PHONE_SECONDS;
    const walkOffSeconds = phoneStartSeconds + THEATRE_PHONE_PREWALK_SECONDS;
    return {
      travelSeconds,
      walkOffSeconds,
      phoneStartSeconds,
    };
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
    // Level 3 is excluded from both halves as explicitly as Level 2 is. Without that, the
    // Party -- where level2Active is false and the song clock is already past 50s -- ran
    // Level 1's 0:50 keyboard-solo cue on the PARTY keyboardist, walking him off his locked
    // mark onto Level 1's foot line (observed at x 461.8 / y 570.2 in tools/level3_check.mjs).
    // Levels 1 and 2 are unaffected: level3Active is false in both.
    if (!this.level2Active && !this.level3Active) this.updateLevel1KeyboardSolo(delta);
    if (this.level2Active || this.level3Active || this.cutsceneActive || this.fadedOut) return;

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
  // measured, not a distance-travelled guess. Deliberately WORLD x=0, not the visible edge:
  // under the Theatre push-in he leaves the view a little before this, and keeping world
  // x=0 keeps the walk-off/fade timing exactly as it was (C1).
  isPlayerOffscreen() {
    return this.player.getBounds().right < 0;
  }

  isPlayerThroughTheatreDoor() {
    return this.player.x <= THEATRE_LEFT_DOOR_X;
  }

  // The one neutral stage camera every level installs: no follow, bounds on the canvas, zoom
  // 1, default centre origin, parked on the canvas centre (scroll 0,0). Also drops any running
  // camera effect and the fade listeners of a transition being abandoned (the generation
  // guard on those callbacks covers anything already queued).
  resetStageCamera() {
    const cam = this.cameras.main;
    cam.resetFX();
    cam.off('camerafadeoutcomplete');
    cam.off('camerafadeincomplete');
    cam.stopFollow();
    cam.setFollowOffset(0, 0);
    cam.setZoom(1);
    cam.setOrigin(0.5, 0.5);
    cam.setBounds(0, 0, STAGE_VIEW.width, STAGE_VIEW.height);
    cam.centerOn(STAGE_VIEW.width / 2, STAGE_VIEW.height / 2);
  }

  // C1: 1 everywhere except an installed Theatre, where it rises linearly with song time.
  getTheatreZoom(elapsed) {
    if (!this.level2Active || this.theatreZoomStartElapsed === null) return 1;
    return Math.min(
      THEATRE_PUSH_IN_MAX_ZOOM,
      1 + THEATRE_PUSH_IN_RATE * Math.max(0, elapsed - this.theatreZoomStartElapsed)
    );
  }

  // Recomputed from the tick's one sampled song time, like the background frame, so it stays
  // linear through the reveal, phone sequence and outgoing fade, and follows in-Theatre seeks.
  // Zoom only: focus stays (640,360) with scroll (0,0) -- no second camera move.
  updateTheatreCamera(elapsed) {
    const cam = this.cameras.main;
    const zoom = this.getTheatreZoom(elapsed);
    if (cam.zoom !== zoom) cam.setZoom(zoom);
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

    if (this.phoneOwner === 'theatre') {
      schedulePhoneStep(THEATRE_PHONE_SLIDE_IN_MS, () => {
        img.src = 'assets/game/sms_stage_1_notification.png';
      });
      schedulePhoneStep(THEATRE_PHONE_SLIDE_IN_MS + THEATRE_PHONE_NOTIFICATION_MS, () => {
        img.src = 'assets/game/sms_stage_3_opening.png';
      });
      schedulePhoneStep(THEATRE_PHONE_SLIDE_IN_MS + THEATRE_PHONE_NOTIFICATION_MS + THEATRE_PHONE_OPENING_MS, () => {
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
      schedulePhoneStep(THEATRE_PHONE_SLIDE_IN_MS + THEATRE_PHONE_NOTIFICATION_MS + THEATRE_PHONE_OPENING_MS + THEATRE_PHONE_READ_HOLD_MS, () => {
        panel.classList.remove('phone-panel-visible');
      });
      schedulePhoneStep(THEATRE_PHONE_PRESENTATION_COMPLETE_MS, () => {
        if (this.phoneImageLoadHandler) {
          img.removeEventListener('load', this.phoneImageLoadHandler);
          this.phoneImageLoadHandler = null;
        }
        msg.hidden = true;
        if (this.phoneOwner === 'theatre' && this.theatreWalkOffSeconds !== null
          && this.getLevelElapsed() < this.theatreWalkOffSeconds) {
          this.playPlayerVisual('phone_check_idle');
        } else {
          this.playPlayerVisual('walk');
        }
        this.phonePresentationDone = true;
      });
    } else {
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
      schedulePhoneStep(PHONE_PRESENTATION_COMPLETE_MS, () => {
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
    // A restart or a direct level jump bumps the generation, so this destination can never
    // fire into a scene state it was not captured for.
    const generation = this.transitionGeneration;
    this.cameras.main.once('camerafadeoutcomplete', () => {
      if (generation !== this.transitionGeneration) return;
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
    this.transitionGeneration += 1;
    this.resetStageCamera();
    // C1: the push-in's song-clock anchor is the moment the Theatre is installed.
    this.theatreZoomStartElapsed = this.getLevelElapsed();
    this.showLevelBackground('level2_theatre_bg', THEATRE_DEPTH.background);
    this.createTheatrePools(this.theatreZoomStartElapsed);
    this.createTheatreBeams(this.theatreZoomStartElapsed);
    // After the beams, before the cast: THEATRE_DEPTH orders the draw regardless, but
    // building in depth order keeps this list readable as the stage's back-to-front stack.
    this.createTheatreCurtainPeekers(this.theatreZoomStartElapsed);
    this.buildTheatreActors();

    this.ground.setPosition(STAGE_VIEW.width / 2, interiorGroundY + 20);
    this.ground.setSize(STAGE_VIEW.width, 40);
    this.ground.body.updateFromGameObject();
    this.sizedForTexture = null;
    this.anchoredPlayerFrame = null;
    this.playPlayerVisual('idle', 'theatre');
    this.player.setAlpha(1);
    this.player.body.allowGravity = true;
    this.player.body.reset(THEATRE.playerSpawnX, interiorGroundY - 2);
    this.player.setVelocity(0, 0);
    // The final centred mark remains right of the trio, so face left toward the mic.
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
    this.mHeartBeatIndex = null;

    const touch = document.getElementById('touch-controls');
    if (touch) touch.style.removeProperty('display');

    this.renderLyrics(this.getLevelElapsed());
    const generation = this.transitionGeneration;
    this.cameras.main.once('camerafadeincomplete', () => {
      if (generation !== this.transitionGeneration || !this.level2Active) return;
      this.level2Revealing = false;
      this.renderLyrics(this.getLevelElapsed());
    });
    this.cameras.main.fadeIn(600, 10, 14, 26);
  }

  // Install the Party stage while the camera is fully faded out -- same method shape,
  // same order of operations and the same scene/'Level' key as enterLevel2().
  enterLevel3() {
    if (this.level3Active) return;

    this.destroyTheatreKeyboardSolo();
    this.destroyTheatrePools();
    this.destroyTheatreBeams();
    this.destroyTheatreCurtainPeekers();
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
    // C1: neutral camera while fully faded, before Party renders; the push-in ends here.
    this.transitionGeneration += 1;
    this.theatreZoomStartElapsed = null;
    this.resetStageCamera();

    this.showLevelBackground('level3_party_bg', PARTY_DEPTH.background);
    if (this.cfg.sprites[PARTY_CROWD_KEY]) this.showCrowdForeground(PARTY_CROWD_KEY, PARTY_DEPTH.crowd);

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
    this.player.setAlpha(1);
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
    this.mHeartBeatIndex = null;

    this.renderLyrics(this.getLevelElapsed());
    const generation = this.transitionGeneration;
    this.cameras.main.once('camerafadeincomplete', () => {
      if (generation !== this.transitionGeneration || !this.level3Active) return;
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
    icon.setDepth(options.depth === undefined ? 0 : options.depth);
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

  // C5: sets each listed musical loop's frame from the song clock. Only sprites whose CURRENT
  // animation is listed in MUSICAL_LOOP_SUBDIVISIONS and still playing are touched.
  // setCurrentFrame() emits animationupdate, so the player's frame-anchor listener re-roots
  // him exactly as a naturally advanced frame would.
  getMusicalLoopSprites() {
    return [
      this.player,
      ...this.interactiveActors.map((actor) => actor.sprite),
      ...this.passiveAudience,
      this.theatreMic && this.theatreMic.sprite,
      this.partyMic && this.partyMic.sprite,
      ...this.partySopranos.map((soprano) => soprano.sprite),
      this.theatreKeyboardSolo && this.theatreKeyboardSolo.sprite,
      // Level 0 shop actors join the song-clock phasing from PLAY on; before that updateIntro()
      // phases them on the intro clock (song time is still 0).
      ...(this.levelClockStart !== null ? this.getIntroActorSprites() : []),
    ];
  }

  // Q6 harness seam (C5): one row per LEVEL_POLISH_BEAT_LOOPS entry whose animation is
  // registered. A loop some active sprite is playing reports the frame that sprite is
  // DISPLAYING (live: true); otherwise the song-clock formula value (live: false).
  // heart_emission reports beatIndex instead of frame: the index the M volley logic holds
  // while it is armed (live: true), else the formula value.
  //   { category, name, frame | beatIndex, frameCount, subdivisionMs, live }
  getLevelPolishBeatSnapshot(elapsed = this.getLevelElapsed()) {
    const sprites = this.getMusicalLoopSprites();
    const rows = [];
    for (const { category, name, subdivisionMs } of LEVEL_POLISH_BEAT_LOOPS) {
      if (category === 'heart_emission') {
        const live = this.mHeartBeatIndex !== null && this.mHeartBeatIndex !== undefined;
        const beatIndex = live ? this.mHeartBeatIndex : Math.floor(Math.max(0, elapsed) * 1000 / subdivisionMs);
        rows.push({ category, name, beatIndex, frameCount: null, subdivisionMs, live });
        continue;
      }
      const animation = this.anims.get(name);
      if (!animation) continue;
      const frameCount = animation.frames.length;
      const sprite = sprites.find((s) => s && s.active && s.anims.isPlaying
        && s.anims.currentAnim && s.anims.currentAnim.key === name);
      const frame = sprite
        ? animation.frames.indexOf(sprite.anims.currentFrame)
        : musicalLoopFrameIndex(name, frameCount, elapsed);
      rows.push({ category, name, frame, frameCount, subdivisionMs, live: !!sprite });
    }
    return rows;
  }

  applyMusicalLoopPhases(elapsed) {
    this.phaseMusicalLoops(this.getMusicalLoopSprites(), elapsed);
  }

  phaseMusicalLoops(sprites, elapsed) {
    for (const sprite of sprites) {
      const phase = this.getPhasedFrame(sprite, elapsed);
      if (phase && phase.actual !== phase.expected) {
        sprite.anims.setCurrentFrame(sprite.anims.currentAnim.frames[phase.expected]);
      }
    }
  }

  // Also the harness seam: the frame a sprite's musical loop SHOULD show at `elapsed` and the
  // one it shows now (both 0-based). null when the sprite is not running a listed loop.
  getPhasedFrame(sprite, elapsed = this.getLevelElapsed()) {
    const anims = sprite && sprite.active ? sprite.anims : null;
    const animation = anims && anims.isPlaying ? anims.currentAnim : null;
    if (!animation || !MUSICAL_LOOP_SUBDIVISIONS[animation.key]) return null;
    return {
      key: animation.key,
      subdivisionMs: MUSICAL_LOOP_SUBDIVISIONS[animation.key],
      expected: musicalLoopFrameIndex(animation.key, animation.frames.length, elapsed),
      actual: animation.frames.indexOf(anims.currentFrame),
    };
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
    // C4: the touch Sing tap is the M key's twin. Both edges are captured HERE, before any
    // scripted update can change eligibility, and the touch edge is cleared every ready tick,
    // so a tap made while ineligible is dropped exactly like an ineligible M press. JustDown
    // is always evaluated (never short-circuited), and OR-ing the two edges makes a
    // simultaneous M + tap a single toggle.
    const mJustDown = Phaser.Input.Keyboard.JustDown(this.keyM);
    const singTapped = this.touchState.sing;
    this.touchState.sing = false;
    const singToggleRequested = mJustDown || singTapped;
    const mSequenceEligibleAtInput = !this.introActive && !this.level2Revealing && !this.level3Revealing
      && !this.exitSettling && !this.cutsceneActive && !this.gesture && !this.manosDefeated
      && !this.bossSequenceActive && !this.bossSettleActive;

    this.updateIntro(elapsed);
    this.updateLevelBackground(elapsed);
    this.updateTheatrePools(elapsed);
    this.updateTheatreBeams(elapsed);
    this.updateTheatreCurtainPeekers(elapsed);
    this.updateTheatreCamera(elapsed);
    // Level 1: real keyboard solo at 0:50, with the existing phone exit still fixed at
    // 0:53. Theatre owns its separate 1:58 solo and 1:53 phone presentation.
    this.updateStageExit(elapsed, delta);
    this.updateTheatreKeyboardBeat(elapsed, delta);
    // Party's own scripted beats remain fixed to the absolute song clock once it is up.
    this.updateHeartMarquee(elapsed);
    this.updateBossEntrance(elapsed);
    this.updateTheatreSopranosSingingGate(elapsed);
    this.updatePartySopranosSingingGate(elapsed);

    // The fade waits on BOTH halves: he has gone through the door in Theatre (or fully cleared the frame
    // in Level 1) AND the phone panel has finished its own staged sequence. Theatre additionally
    // waits for the absolute 2:12 handoff floor; Level 1 retains its independent eligibility rules.
    const phoneCanFade = this.phoneOwner === 'theatre'
      ? (this.cutsceneActive && !this.phoneFadedOut && this.level2Active && !this.level3Active
        && elapsed >= LEVEL3_ENTRANCE_SECONDS)
      : (this.cutsceneActive && !this.fadedOut && !this.level2Active);

    const playerExited = this.phoneOwner === 'theatre'
      ? this.isPlayerThroughTheatreDoor()
      : this.isPlayerOffscreen();

    if (phoneCanFade && this.phonePresentationDone && playerExited) {
      this.onFadeOut();
    }

    this.renderLyrics(elapsed);

    const onFloor = this.player.body.onFloor();

    // Gestures are a deliberate stationary beat (GAME_PLAN.md Milestone 3: "press a
    // button, character performs a scripted gesture") -- only start one when grounded,
    // no gesture is already playing, and the cutscene hasn't taken over movement; skip
    // movement/jump entirely while one runs.
    if (!this.introActive && !this.level2Revealing && !this.level3Revealing && !this.manosDefeated
      && !this.bossSequenceActive && !this.bossSettleActive && !this.gesture && onFloor && !this.cutsceneActive) {
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
    if (mSequenceEligible && singToggleRequested) {
      this.mSequenceActive = !this.mSequenceActive;
      if (this.mSequenceActive) this.mHeartBeatIndex = null;
    }

    if (this.introActive) {
      // The player is hidden during the shop presentation, but must land before reveal.
      // Input is gated above, so only horizontal motion needs suppressing here.
      this.player.setVelocityX(0);
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
        } else if (this.isPlayerThroughTheatreDoor()) {
          this.player.setVelocity(0, 0);
          this.player.setPosition(THEATRE_LEFT_DOOR_X, this.player.y);
          this.player.setAlpha(0);
        } else {
          this.player.setVelocityX(-SPEED);
          this.player.setFlipX(true);
          const fadeDistance = SPEED * (THEATRE_DOOR_FADE_MS / 1000);
          if (this.player.x < THEATRE_LEFT_DOOR_X + fadeDistance) {
            const a = Math.max(0, (this.player.x - THEATRE_LEFT_DOOR_X) / fadeDistance);
            this.player.setAlpha(a);
          }
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
    } else if (this.bossSettleActive) {
      // After the gesture branch on purpose: a one-shot gesture in progress finishes first.
      // No input is read here, so nothing the player holds can fight the walk to the mark.
      this.updateBossSettle(onFloor);
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

    // C5: M hearts fire on the song's beat grid, not on a delta accumulator started at the
    // toggle. One volley per beat-index change, so a stall that skips several beats fires
    // once, never a catch-up burst. null = re-anchor on the current beat (next boundary fires).
    const heartBeatIndex = Math.floor(Math.max(0, elapsed) * 1000 / HEART_FIRE_INTERVAL_MS);
    if (this.mSequenceActive && mSequenceEligible) {
      const allActorsDone = this.interactiveActors.every((actor) => (
        actor.hitsReceived >= actor.spec.hitsRequired
        || actor.state === 'keyboard_solo_walking'
        || actor.state === 'keyboard_solo_standing'
      ));
      if (allActorsDone || this.mHeartBeatIndex === null) {
        this.mHeartBeatIndex = heartBeatIndex;
      } else if (heartBeatIndex !== this.mHeartBeatIndex) {
        this.mHeartBeatIndex = heartBeatIndex;
        this.spawnProjectileDirectional('heart', true);
        this.spawnProjectileDirectional('heart', false);
      }
    } else {
      this.mHeartBeatIndex = null;
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

    // C5: every visual swap for this tick has happened (timers, tweens, fades and anim
    // events all run before scene.update()), so phase the musical loops now.
    this.applyMusicalLoopPhases(elapsed);

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
// Q6 harness mirrors (top-level const bindings are not window properties).
window.LEVEL_POLISH_BEAT_LOOPS = LEVEL_POLISH_BEAT_LOOPS;
window.getLevelPolishBeatSnapshot = (elapsed) => window.game.scene.keys.Level.getLevelPolishBeatSnapshot(elapsed);
