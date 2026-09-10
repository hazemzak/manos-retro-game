// Manos Retro Game -- Milestone 1: walk, jump, RTL scroll, ground collision.
// No enemies, no goal, no lyric-as-world-object system yet -- later milestones.

const SPEED = 260;
const JUMP_VELOCITY = -750;
const GRAVITY_Y = 1800;
const PROJECTILE_SPEED = 700;
const PROJECTILE_DESCENT_SPEED = 140;
// Real tempo of assets/audio/manos_theme.mp3, measured via beat-tracking (2 independent
// methods agreed exactly: 123.05 BPM). ms-per-minute / BPM = ms per beat. Try once-per-beat
// first; halve the BPM (123.05/2) instead for a once-per-2-beats feel if that reads better
// in practice -- Hazem compares both by ear.
const HEART_FIRE_INTERVAL_MS = 60000 / 123.05; // ~487.6067ms (once per beat)
// const HEART_FIRE_INTERVAL_MS = 60000 / (123.05 / 2); // ~975.2133ms (half-tempo alternative)
// The design canvas both fixed-screen levels are composed against (matches the
// Phaser.Game width/height at the bottom of this file). Neither level scrolls, so this
// doubles as the world bounds, the camera bounds and the background's display size.
const STAGE_VIEW = { width: 1376, height: 768 };
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
// Manos's level-agnostic performance loop. Kept in the same grouped loader/animation
// path as the cast performance sheets so it is loaded and registered once for every level.
const PLAYER_PERFORMANCE_ANIM_GROUP = {
  frameRate: 8,
  repeat: -1,
  sheets: { manos_stage_singing: 'manosStageSingingAnim' },
};
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
function bandPerformanceVisual(textureKey) {
  const animationKey = BAND_PERFORMANCE_ANIM_GROUP.sheets[textureKey];
  return animationKey ? { kind: 'instrument', textureKey, animationKey } : null;
}
// Every Level 1 actor is drawn at this on-screen content height regardless of how much
// transparent padding its own sheet happens to carry (same root cause as
// resizeBodyForTexture()'s content-height scaling for the player).
const ACTOR_DISPLAY_CONTENT_HEIGHT = 214.52;

// Level 1 (El Fara7) geometry. Every number is a design-canvas pixel (1376x768) measured
// off the rendered level1_fara7_bg art itself (frame 0 blown up to 1376x768 with a 10px
// grid, see .foreman/scratch/fara7_stage_zoom.png) -- none of it is carried over from
// THEATRE, whose art is a completely different room and perspective.
//
// ONE floor Y, not Theatre's stage/apron pair: the Fara7 art is a shallow raised wedding
// deck (carpet top surface runs y 585 at the back to y 628 at the front lip, then a dark
// ~70px front face down to the pavement). There is no second standable tier -- the only
// other plane is the pavement in front, where nobody performs. So the whole cast shares
// the deck's front-lip line.
const FARA7 = {
  // The carpet's front lip. Deck spans roughly x 185..1175 at this line.
  stageFootY: 628,
  // Play area, short of the deck's own edges: the band's marks occupy 250..520 and the
  // seated bride/groom 1030..1115, so the hero is boxed between them (this is the
  // "confinement" GAME_PLAN section 0 asks for; it LIFTS for the scripted exit).
  walkMinX: 610,
  walkMaxX: 950,
  // Centre stage, directly under the heart marquee (its centre reads at x~690).
  playerSpawnX: 690,
  // Stage-RIGHT entry mark, just off the right screen edge: every walk-in sheet in this
  // project draws the character walking LEFT (verified by eye against frame 0 of
  // musician_drums_walkin/tabla_player_walkin), so an actor entering from here travels
  // left onto its mark with the art unflipped.
  wingX: 1330,
  // Stage-LEFT entry mark, the mirror of wingX: the deck's left edge is 185 at the lip and
  // the right wing sits 155px beyond its own edge (1330 - 1175), so 30 gives the left wing
  // the identical clearance. An actor entering from here has its walk-in sheet flipped
  // (setFlipX) so the left-facing art reads as walking RIGHT onto its mark.
  leftWingX: 30,
  entranceSpeedPxPerSecond: 220,
};
// Background furthest back; the band and wedding-party dressing sit behind the hero.
// crowd sits in FRONT of the band/dressing/hero (RUN 21's foreground crowd, per
// the reference photo's own composition) -- see the Fara7-only projectile
// depth override in spawnProjectileDirectional() for why thrown projectiles
// need their own depth above this, or a low throw would render behind it.
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
  // The GIF this sheet was converted from ran at 120ms per frame; frameRate is fps.
  background: {
    frameRate: 1000 / 120,
    repeat: -1,
    sheets: { level1_fara7_bg: 'fara7BgAnim' },
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

// Level 2 (Theatre) geometry. Every number is a design-canvas pixel (1376x768) measured
// off the theatre background art itself, not derived: stageFootY is the lit stage floor's
// front lip, apronFootY the strip one step downstage of it where the player stands, and
// walkMinX/walkMaxX the stage's own width, so he can't wander in front of the side walls
// where the art's perspective would make him read as a giant.
//
// Why the player shares the sopranos' height band at all: thrown hearts/flowers descend
// at a shallow fixed slope (see updateProjectiles()), so a player standing back in the
// auditorium aisle -- the "correct" place for an audience member -- could never land a
// hit on anyone on stage. Standing him at the apron, a couple of feet below the lip, is
// the only placement where the projectile system reaches the cast.
const THEATRE = {
  stageFootY: 498,
  // Recalibrated via the Stage Blocking Board tool (Hazem, 2026-09-09): was 520.
  apronFootY: 502,
  // The proscenium opening's own edges at floor level -- one step further in than the
  // stage's full width, so he can't end up drawn over the gold arch or the curtain legs.
  walkMinX: 480,
  walkMaxX: 930,
  // RUN 22 (2026-09-10): another -10% off the current value per Hazem, not off the
  // original 0.806 baseline. 0.7254 * 0.9 = 0.65286 (19% below the original baseline).
  playerScale: 0.65286,
  // Recalibrated via the Stage Blocking Board tool (Hazem, 2026-09-09): was 500.
  playerSpawnX: 507,
  // Was 170. Matched to PARTY.castContentHeight (140) so a soprano is the same size in
  // both levels she appears in -- at 170 she read a head taller than the same sheet does
  // on the Party deck, and taller than she needs to against this stage.
  sopranoContentHeight: 140,
  // Stage-left entry mark, just inside the proscenium opening's left edge.
  wingX: 470,
  entranceSpeedPxPerSecond: 130,
  // The shared mic stand's world x. Was 560 in the plan; MEASURED live in-browser and
  // moved, because the composite grows AROUND this line rather than standing on it: at the
  // 3-state its drawn content runs anchor-61 to anchor+72, so 560 put the leftmost singer
  // at 499 -- on the player's own spawn mark (500), 19px inside the proscenium edge (480),
  // with Manos standing through her and the whole trio crowded into the left curtain leg
  // while two thirds of the stage sat empty. 700 is the centre of the visible stage floor
  // (~465..940): it lands the trio at 639..772 under the background art's own centre
  // spotlight beam, clears the spawn and both prosceniums, and gives gold a real walk to
  // the mic instead of a 60px shuffle.
  micX: 700,
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

// Rest offsets relative to THEATRE.micX (700) when resting around the empty stand
const THEATRE_SOPRANO_REST_OFFSETS = {
  soprano_gold: -10,
  soprano_green: -55,
  soprano_red: 45,
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
  // The GIF this sheet was converted from ran at 140ms per frame; frameRate is fps.
  background: {
    frameRate: 1000 / 140,
    repeat: -1,
    sheets: { level2_theatre_bg: 'theatreBgAnim' },
  },
};

// Level 3 (The Party) geometry. Every number is a design-canvas pixel (1376x768) measured
// off the real Party art itself -- the static base plate
// (level3_party/lighting_effects/hanging_lights_no_heart/base_plate.png, 2730x1536) and the
// animated level3_party_bg sheet (700x393/frame), both stretched to the canvas. The two
// plates were checked against each other numerically (a luminance-edge scan down the stage
// at x 380..440): BOTH put the deck's front-lip highlight on the same row, so the 2:40
// static->animated swap moves no geometry and none of these numbers change with it.
//
// ONE floor Y, like FARA7 and unlike THEATRE's stage/apron pair: the party deck is a single
// flat riverside platform (top surface ends at the lip, then a dark front face down to the
// paved floor where the tables are). Nobody performs on the table floor, so the whole cast
// -- hero included -- shares the deck's front lip.
const PARTY = {
  // The deck's front lip: the bright highlight row measured at y 566-567 on BOTH plates,
  // with the dark front face starting at 568. Deck spans x ~262..1140 at this line.
  stageFootY: 567,
  // Play area between the two cast blocks (band 300..540 stage-left, sopranos 880..1040
  // stage-right), so the hero is boxed centre-stage exactly as the locked composition
  // stages him -- this is GAME_PLAN section 0's "confinement".
  walkMinX: 610,
  walkMaxX: 780,
  // Centre of that box, and within a few px of where Manos actually stands in the locked
  // populated reference (`environemt 3 , clean , no text.jpg`, x~680).
  playerSpawnX: 700,
  // Stage-RIGHT entry mark, same reasoning as FARA7.wingX: every walk-in sheet in this
  // project draws its character walking LEFT, so an actor entering here travels left with
  // the art unflipped.
  wingX: 1330,
  // Stage-LEFT entry mark, mirroring wingX exactly as FARA7.leftWingX does: the deck runs
  // 262..1140 at the lip, the right wing sits 190px past its own edge (1330 - 1140), so
  // 262 - 190 = 72. Actors entering here are setFlipX'd so the art walks rightward.
  leftWingX: 72,
  // Faster than either earlier level (FARA7 220, THEATRE 130): SEVEN actors have to clear
  // a single shared wing between the 2:12 boot and the 2:40 boss, and they can only be
  // staggered one behind another. At 300px/s the last soprano is on her mark by ~14s in.
  entranceSpeedPxPerSecond: 300,
  // Provisional until Ticket E confirms it in a live browser: this keeps the re-used mic
  // composite around the Party soprano block, on the same deck line as the cast.
  micX: 960,
  // Her own dial, deliberately slower than the cast's -- the entrance is the level's one
  // dramatic beat, not another walk-on.
  bossEntranceSpeedPxPerSecond: 200,
  // Measured off the locked populated reference: Manos's silhouette there runs y~405 (hat)
  // to the deck line, ~160px. The cast reads a touch smaller (they stand further upstage),
  // and the boss matches the hero so she reads as his equal rather than as scenery.
  playerContentHeight: 160,
  castContentHeight: 140,
  bossContentHeight: 160,
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
  // The GIF this sheet was converted from ran at 110ms per frame; frameRate is fps.
  background: {
    frameRate: 1000 / 110,
    repeat: -1,
    sheets: {
      level3_party_bg: 'partyBgAnim',
      level3_party_bg_prelit: 'partyBgPrelitAnim',
    },
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
  PLAYER_PERFORMANCE_ANIM_GROUP,
  ...Object.values(KEYBOARD_SOLO_ANIM_GROUPS),
];

// Level 3's static (heart-marquee UNLIT) background. A plain image, not a registered
// sprite-sheet key -- loaded by hand in create() the same way heart_icon/flowers_icon are.
const LEVEL3_BASE_PLATE_KEY = 'level3_party_base';
const LEVEL3_BASE_PLATE_FILE =
  'assets/generated/environments/level3_party/lighting_effects/hanging_lights_no_heart/base_plate.png';

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
    this.load.spritesheet('idle', s.idle.file, { frameWidth: s.idle.frameWidth, frameHeight: s.idle.frameHeight });
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
    // Level 3's pre-boss (heart-marquee unlit) plate. Deliberately a plain image rather
    // than an assets.json sprite entry: it has no frames and no animation, and assets.json
    // is outside this ticket's write set. The lit/animated counterpart IS a registered
    // sheet (level3_party_bg, loaded by the ALL_ANIM_GROUPS pass above) and replaces this
    // one at the 2:40 boss cue -- see swapToLitPartyBackground().
    this.load.image(LEVEL3_BASE_PLATE_KEY, LEVEL3_BASE_PLATE_FILE);

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
    // playerScale is the ONE value still read out of cfg.level1: it is a real, tuned
    // number (0.806 as of RUN17's 1.3x bump -- was 0.62 originally) and nothing else in
    // this file recomputes it. Every other key that block still carries -- panelsRightToLeft,
    // kiosk.*, groundY, panelW/panelH, spawnX -- described the deleted scrolling street
    // and is now dead data; assets.json is outside this ticket's write set, so it is left
    // in place unread rather than edited out.
    const { playerScale } = cfg.level1;

    // Fixed single-screen level: the world IS the canvas, in both axes and both levels.
    // Kept as fields because updateProjectiles() culls against them.
    this.worldMinX = 0;
    this.worldMaxX = STAGE_VIEW.width;

    // Ground: one invisible static collider along the wedding deck's front lip.
    this.ground = this.add.rectangle(
      STAGE_VIEW.width / 2, FARA7.stageFootY + 20, STAGE_VIEW.width, 40, 0x000000, 0
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
      key: 'idleAnim',
      frames: this.anims.generateFrameNumbers('idle', { start: 0, end: cfg.sprites.idle.frames - 1 }),
      frameRate: 4,
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

    // The animated wedding-stage plate. 1000x563 source frames stretched onto the
    // 1376x768 canvas -- 1.376x in X against 1.364x in Y, a 0.9% aspect difference that
    // is not visible on this art (verified in-browser against the straight vertical
    // banner poles and the round lantern bodies, which stay round).
    this.level1Bg = this.add.sprite(0, 0, 'level1_fara7_bg')
      .setOrigin(0, 0)
      .setDepth(FARA7_DEPTH.background);
    this.level1Bg.anims.play('fara7BgAnim', true);
    this.level1Bg.setDisplaySize(STAGE_VIEW.width, STAGE_VIEW.height);

    // Player spawns centre stage, under the heart marquee.
    // Spawn ABOVE the ground line (not on/inside it) so Arcade Physics resolves a real
    // fall-and-land collision -- spawning already overlapping the collider leaves the body
    // "embedded" and onFloor() never becomes true.
    this.player = this.physics.add.sprite(FARA7.playerSpawnX, FARA7.stageFootY - 150, 'walk', 0);
    this.player.setOrigin(0.5, 1);
    this.baseScale = playerScale;
    this.resizeBodyForTexture();
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
    this.partyBg = null;
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
    // Set once her attack lands. Gates every movement/gesture branch in update().
    this.manosDefeated = false;
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

  // Every generated sheet has its own canvas size (idle 336x376, jump 414x414, the walk
  // sheet has swapped between 336x376 and 443x443 versions across regenerations, and gesture
  // sheets also use different dimensions. A single fixed setScale() makes the character
  // visibly grow/shrink every time the texture swaps to a differently-sized canvas -- the
  // exact "why does he get smaller and bigger" bug already hit once. Fix at the root:
  // rescale relative to a reference frame height (idle's, since that's what playerScale
  // was originally tuned to look right at) so on-screen character size stays constant
  // regardless of how much canvas padding a given generation happened to have. Then
  // recompute the physics body from the CURRENT (unscaled) frame dimensions -- Arcade
  // Physics anchors body size/offset to the texture frame's native pixel size, and
  // skipping this after a texture swap drags the body's world position with it (the same
  // bug already logged twice before for the jump texture).
  //
  // Two rules make this safe, both learned the hard way (see playbook, "idle/walk pulsing"):
  //  1. Call it AFTER the anims.play() decision, never before -- anims.play() is what swaps
  //     the texture, so reading p.frame.height at the top of update() reads the PREVIOUS
  //     tick's frame and applies a stale scale.
  //  2. Only touch the sprite when the texture key actually changed. Arcade's Body picks up
  //     the GameObject's scale one physics step late, so re-running setScale/setSize every
  //     tick leaves body height permanently one step behind -- the body's bottom edge then
  //     wanders a few px around the ground line, onFloor() flickers, and the update() branch
  //     below flips idle/walk <-> jump forever. That feedback loop is self-sustaining.
  resizeBodyForTexture() {
    const p = this.player;
    if (p.texture.key === this.sizedForTexture) return;
    this.sizedForTexture = p.texture.key;
    // Scale off measured CONTENT height, not raw canvas frameHeight -- some sheets
    // can have a lot of transparent padding below the character, so scaling
    // to match idle's raw canvas under-sizes the actual silhouette. contentHeight is
    // the real alpha-bbox height, measured per-sheet by prep_assets.ps1.
    const REF_CONTENT_HEIGHT = this.cfg.sprites.idle.contentHeight;
    const curContentHeight = this.cfg.sprites[p.texture.key].contentHeight;
    p.setScale(this.baseScale * (REF_CONTENT_HEIGHT / curContentHeight));
    p.body.setSize(p.width * 0.5, p.height * 0.9);
    p.body.setOffset(p.width * 0.25, p.height * 0.1);
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
    const bandMember = (id, targetX, visuals, earliestStartMs, side) => ({
      id,
      targetX,
      footY: FARA7.stageFootY,
      displayContentHeight: ACTOR_DISPLAY_CONTENT_HEIGHT,
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
        path: [
          { x: side === 'left' ? FARA7.leftWingX : FARA7.wingX, y: FARA7.stageFootY },
          { x: targetX, y: FARA7.stageFootY },
        ],
        speedPxPerSecond: FARA7.entranceSpeedPxPerSecond,
        earliestStartMs,
        // buildInteractiveActors() turns this into the sprite's flipX. 'left' means the
        // left-facing walk-in art is mirrored so it reads as walking rightward.
        side,
      },
      clipBottomY: null,
    });
    // The three sheets the old street build already used, plus the playing loop.
    const musician = (sheet, anim) => ({
      idle: { textureKey: `musician_${sheet}_idle`, animationKey: `musician${anim}IdleAnim` },
      walkIn: { textureKey: `musician_${sheet}_walkin`, animationKey: ACTOR_WALK_IN_ANIMS[`musician_${sheet}_walkin`] },
      dizzy: { textureKey: `musician_${sheet}_love`, animationKey: `musician${anim}LoveAnim` },
      performance: bandPerformanceVisual(`musician_${sheet}_playing`),
    });

    // Starts are spread across ~20s rather than bunched at boot, per GAME_PLAN section 0
    // ("hit windows spread evenly across the level's actual running time"): the last man
    // reaches his mark around 0:21, leaving half the level to land the remaining hits
    // before the 0:50 solo / 0:53 exit. The level still opens with only Manos on stage --
    // buildInteractiveActors() parks every entrance actor hidden on its wing mark.
    //
    // Marks recalibrated (RUN 21, Hazem, 2026-09-10) to match the original reference photo's
    // grouping (`02_Assets/New Environments/Level 1 - fara7/Fara7 - Lights - People.jpg`):
    // accordion + keyboard together on the LEFT, tabla + drums together on the RIGHT,
    // flanking Manos/the wedding couple in the middle. Both left marks (344/498) sit below
    // FARA7.walkMinX(610); both right marks (980/1100) sit above walkMaxX(950) -- this also
    // fixes a pre-existing issue where the old tabla mark (923) sat INSIDE that box.
    // Entrance ordering re-derived per wing under the same furthest-from-wing-goes-first
    // invariant: left entry x=30 -- keyboard travels 468px vs. accordion's 314px, so
    // keyboard starts first and parks farther inward; right entry x=1330 -- tabla travels
    // 350px vs. drums' 230px, so tabla starts first. Same start-time SET as before
    // (1500/7000/13500/20000, same ~18.5s spread), just reassigned to the new grouping.
    // Known tradeoff, not yet live-verified: the tabla/drums PLAYING poses have measured
    // ~31px of horizontal silhouette overlap and drums overhangs the deck edge by ~17px --
    // acceptable to keep current character scale, but flagged for a visual check once this
    // is actually on screen; revisit spacing/scale if it reads as merged bodies.
    this.buildInteractiveActors([
      bandMember('keyboard', 498, musician('keyboard', 'Keyboard'), 1500, 'left'),
      bandMember('accordion', 344, musician('accordion', 'Accordion'), 7000, 'left'),
      // The tabla player -- a genuinely new fourth band member (GAME_PLAN section 0), and
      // the one the old street roster was missing entirely. His sheets do not follow the
      // musician_* naming, hence the literal keys, including his playing loop.
      bandMember('tabla', 980, {
        idle: { textureKey: 'tabla_player_standing_idle', animationKey: loops.tabla_player_standing_idle },
        walkIn: { textureKey: 'tabla_player_walkin', animationKey: ACTOR_WALK_IN_ANIMS.tabla_player_walkin },
        dizzy: { textureKey: 'tabla_player_dizzy_love', animationKey: loops.tabla_player_dizzy_love },
        performance: bandPerformanceVisual('tabla_player_playing'),
      }, 13500, 'right'),
      bandMember('drums', 1100, musician('drums', 'Drums'), 20000, 'right'),
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
  // past the bottom of the 768-tall canvas for all 4 -- the camera's own edge crops their
  // lower bodies, matching the reference photo's own foreground-crowd framing, no
  // clipBottomY needed for this (contrast with the old pre-RUN-20 audience, which DID use
  // clipBottomY to crop at a background seat-line -- there's no such line here).
  // Staggered starting frames (explicit indices, not setProgress() fractions) so the 4
  // groups don't clap in lockstep.
  buildFara7Crowd() {
    const sheets = LEVEL1_ANIM_GROUPS.crowd.sheets;
    const placements = [
      // [textureKey, centreX, topY, nativeContentWidth, nativeContentHeight, startFrame]
      ['fara7_crowd_group_a', 172, 636, 644, 304, 0],
      ['fara7_crowd_group_b', 516, 642, 672, 314, 1],
      ['fara7_crowd_group_c', 860, 638, 675, 318, 2],
      ['fara7_crowd_group_d', 1204, 644, 647, 300, 3],
    ];
    for (const [textureKey, x, topY, nativeW, nativeH, startFrame] of placements) {
      if (!this.cfg.sprites[textureKey]) continue;
      const scale = Math.min(180 / nativeH, 336 / nativeW);
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
    // RUN 21, since the shipped background has no heart-chair prop of its own). Centre-x is
    // the midpoint of the two old marks (795 + 880) / 2 = 837.5, so the couple lands in the
    // same place they already read correctly beside Manos. Caps 230x185 per the accepted
    // raw art's measured content box (546x477 native, content-height-bound at this cap).
    const coupleKey = 'fara7_couple_heart_chair_idle';
    if (this.cfg.sprites[coupleKey] && dressingSheets[coupleKey]) {
      const meta = this.cfg.sprites[coupleKey];
      const scale = Math.min(185 / meta.contentHeight, 230 / meta.contentWidth);
      const displayContentHeight = meta.contentHeight * scale;
      const sprite = this.add.sprite(837.5, FARA7.stageFootY, coupleKey, 0)
        .setDepth(FARA7_DEPTH.dressing);
      this.setActorVisual(
        { sprite, spec: { displayContentHeight, clipBottomY: null } },
        { textureKey: coupleKey, animationKey: dressingSheets[coupleKey] }
      );
      sprite.anims.setProgress(0.5);
      this.passiveAudience.push(sprite);
      return;
    }
    // Fallback: the two separate sprites, kept working if the combined asset is ever
    // missing/unregistered.
    const placements = [
      ['wife_bride_seated_idle', 795, 165],
      ['husband_groom_seated_idle', 880, 150],
    ];
    for (const [textureKey, x, contentHeight] of placements) {
      if (!this.cfg.sprites[textureKey]) continue;
      const sprite = this.add.sprite(x, FARA7.stageFootY, textureKey, 0).setDepth(FARA7_DEPTH.dressing);
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
        displayContentHeight: THEATRE.sopranoContentHeight,
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
    // Green clears gold's mark (620) at (620-470)/130 = 1.15s; gold's 1600ms start is
    // safely after that.
    this.buildInteractiveActors([
      soprano('green', 780, 0),
      soprano('gold', 620, 1600),
      soprano('red', 895, null),
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
      floorY: THEATRE.stageFootY,
      speedPxPerSecond: THEATRE.entranceSpeedPxPerSecond,
      contentHeight: THEATRE.sopranoContentHeight,
      depth: THEATRE_DEPTH.soprano,
    });
  }

  destroyTheatreMic() {
    this.destroyMic('theatreMic');
  }

  buildPartyMic() {
    this.buildMic('partyMic', {
      x: PARTY.micX,
      floorY: PARTY.stageFootY,
      speedPxPerSecond: PARTY.entranceSpeedPxPerSecond,
      contentHeight: PARTY.castContentHeight,
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
    const partyActor = (id, targetX, visuals, earliestStartMs, side = 'right') => ({
      id,
      targetX,
      footY: PARTY.stageFootY,
      displayContentHeight: PARTY.castContentHeight,
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
          { x: side === 'left' ? PARTY.leftWingX : PARTY.wingX, y: PARTY.stageFootY },
          { x: targetX, y: PARTY.stageFootY },
        ],
        speedPxPerSecond: PARTY.entranceSpeedPxPerSecond,
        earliestStartMs,
        side,
      },
      clipBottomY: null,
    });
    const musician = (sheet, anim) => ({
      idle: { textureKey: `musician_${sheet}_idle`, animationKey: `musician${anim}IdleAnim` },
      walkIn: { textureKey: `musician_${sheet}_walkin`, animationKey: ACTOR_WALK_IN_ANIMS[`musician_${sheet}_walkin`] },
      dizzy: { textureKey: `musician_${sheet}_love`, animationKey: `musician${anim}LoveAnim` },
      performance: bandPerformanceVisual(`musician_${sheet}_playing`),
    });
    const soprano = (colour) => {
      const walkInKey = `soprano_${colour}_walkin`;
      return {
        idle: { textureKey: `soprano_${colour}_idle`, animationKey: l2[`soprano_${colour}_idle`] },
        walkIn: walkIns[walkInKey] ? { textureKey: walkInKey, animationKey: walkIns[walkInKey] } : null,
        dizzy: { textureKey: `soprano_${colour}_dizzy`, animationKey: l2[`soprano_${colour}_dizzy`] },
        performance: { kind: 'mic', textureKey: 'theatre_mic_empty', micInstance: 'partyMic' },
      };
    };

    // Marks: the band stage-LEFT (300..540), the sopranos stage-RIGHT (880..1040), the hero's
    // own box (PARTY.walkMinX..walkMaxX) between them -- the locked composition's staging.
    //
    // The BAND now enters from the left wing (PARTY.leftWingX, travelling right, art
    // flipped); the sopranos keep the right wing they already used. Same furthest-mark-
    // first invariant per wing, mirrored: on the LEFT that is the LARGEST target x
    // (accordion 380 before drums 300 -- accordion parks by ~1.8s and drums stops short at
    // 300, so it never reaches it); on the RIGHT it is the smallest (keyboard 460 before
    // tabla 540, then the sopranos further right still). Every earliestStartMs below is
    // UNCHANGED from the single-wing build -- only which mark each start belongs to moved,
    // so the right wing's spacing maths (tabla clears x=880 at 11.4s, green starts 11.6s)
    // holds exactly as before. The last soprano lands ~14.2s after boot, leaving ~14s of
    // hit window before the 2:40 boss cue.
    //
    this.buildInteractiveActors([
      partyActor('accordion', 380, musician('accordion', 'Accordion'), 800, 'left'),
      partyActor('drums', 300, musician('drums', 'Drums'), 4100, 'left'),
      partyActor('keyboard', 460, musician('keyboard', 'Keyboard'), 7100, 'right'),
      partyActor('tabla', 540, {
        idle: { textureKey: 'tabla_player_standing_idle', animationKey: l1.tabla_player_standing_idle },
        walkIn: { textureKey: 'tabla_player_walkin', animationKey: ACTOR_WALK_IN_ANIMS.tabla_player_walkin },
        dizzy: { textureKey: 'tabla_player_dizzy_love', animationKey: l1.tabla_player_dizzy_love },
        performance: bandPerformanceVisual('tabla_player_playing'),
      }, 9900, 'right'),
      partyActor('soprano_green', 880, soprano('green'), 11600),
      partyActor('soprano_gold', 960, soprano('gold'), 13000),
      partyActor('soprano_red', 1040, soprano('red'), 14400),
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
    const scale = actor.spec.displayContentHeight
      / (fixed ? fixed.refContentHeight : meta.contentHeight);
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

  // Extracted from updateProjectiles() so the collision search has one owner. Returns
  // whether a hit was ACCEPTED -- the caller consumes the projectile on true, including
  // for a below-threshold hit that leaves the actor standing.
  tryHitInteractiveActor(projectileBounds) {
    // The boss is checked FIRST and outside the loop below, because she is not in
    // this.interactiveActors at all. She absorbs the projectile (it is consumed exactly as
    // a normal hit would consume it) and nothing else happens -- no flinch, no hit count,
    // no dizzy. This is the only place a projectile can reach her, and it is the single
    // owner of every projectile collision in the game, so no sibling caller can bypass it.
    if (this.tryHitBoss(projectileBounds)) return true;
    for (const actor of this.interactiveActors) {
      if (!this.canHitActor(actor)) continue;
      const rect = this.getActorHitRect(actor);
      if (rect.width > 0 && rect.height > 0
        && projectileBounds.right > rect.left
        && projectileBounds.left < rect.left + rect.width
        && projectileBounds.bottom > rect.top
        && projectileBounds.top < rect.top + rect.height) {
        return this.strikeActor(actor);
      }
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
      targetX: 810,   // just outside the hero's box (walkMaxX 780) -- she walks up to him
      footY: PARTY.stageFootY,
      displayContentHeight: PARTY.bossContentHeight,
      idle: { textureKey: 'femme_fatale_idle', animationKey: LEVEL3_ANIM_GROUPS.loops.sheets.femme_fatale_idle },
      walkIn: this.cfg.sprites.femme_fatale_entrance
        ? { textureKey: 'femme_fatale_entrance', animationKey: LEVEL3_ANIM_GROUPS.walkIns.sheets.femme_fatale_entrance }
        : null,
      clipBottomY: null,
    };
    const sprite = this.add.sprite(PARTY.wingX, PARTY.stageFootY, spec.idle.textureKey, 0)
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

  // STUB BOUNDARY, flagged as temporary: GAME_PLAN's asset ledger still lists her
  // "killer-look attack" as ungenerated, so there is no attack animation and no impact
  // frame to time the kill off. Arrival on her mark IS the attack for now -- one named
  // seam a real attack sequence slots into later, with nothing invented in between.
  arriveBoss() {
    this.boss.state = 'on_mark';
    this.setActorVisual(this.boss, this.boss.spec.idle);
    this.killManos();
  }

  // A projectile overlapping her is consumed and nothing else -- she has no hitsReceived,
  // no dizzy sheet and no state to enter. The flag is recorded only so the future
  // no-flinch reaction (also ungenerated) has something to hang off.
  tryHitBoss(projectileBounds) {
    const boss = this.boss;
    if (!boss) return false;
    const rect = this.getActorHitRect(boss);
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (projectileBounds.right <= rect.left || projectileBounds.left >= rect.left + rect.width
      || projectileBounds.bottom <= rect.top || projectileBounds.top >= rect.top + rect.height) {
      return false;
    }
    this.bossNoFlinchRequested = true;
    return true;
  }

  destroyBoss() {
    if (!this.boss) return;
    this.boss.sprite.destroy();
    this.boss = null;
  }

  // Manos's death. STUB VISUAL, flagged as temporary: GAME_PLAN's asset ledger line 262
  // still lists the dizzy-to-collapse sheet as not generated, so the existing (non-fatal)
  // dizzy_love loop stands in for it -- clean reuse, nothing invented.
  //
  // The freeze is a flag read by update()'s FIRST movement branch, not a one-off velocity
  // write: after this point no input, gesture, jump or cutscene branch can move him again.
  // Everything else in the scene keeps running untouched (the cast keeps idling, the song
  // keeps playing) so a later song-end/credits pass has a live scene to end.
  killManos() {
    if (this.manosDefeated) return;
    this.manosDefeated = true;
    this.cancelGesture();
    this.player.setVelocity(0, 0);
    this.player.anims.play('dizzyLoveAnim', true);
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
      this.player.anims.play('giveHeartAnim', true);
      this.gestureCompleteEvent = 'animationcomplete-giveHeartAnim';
      this.gestureCompleteHandler = () => {
        this.gestureCompleteEvent = null;
        this.gestureCompleteHandler = null;
        this.gesture = null;
      };
      this.player.once(this.gestureCompleteEvent, this.gestureCompleteHandler);
    } else if (type === 'flowers') {
      this._projSpawned = false;
      this.player.anims.play('giveFlowersAnim', true);
      this.gestureCompleteEvent = 'animationcomplete-giveFlowersAnim';
      this.gestureCompleteHandler = () => {
        this.gestureCompleteEvent = null;
        this.gestureCompleteHandler = null;
        this.gesture = null;
      };
      this.player.once(this.gestureCompleteEvent, this.gestureCompleteHandler);
    } else if (type === 'dizzy') {
      this.player.anims.play('dizzyLoveAnim', true);
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
    actor.keyboardSoloTargetX = Phaser.Math.Clamp(this.player.x - 135, 475, 815);
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
    const spec = {
      targetX: 555,
      footY: THEATRE.stageFootY,
      displayContentHeight: 180,
      depth: THEATRE_DEPTH.soprano + 1,
      clipBottomY: null,
    };
    const sprite = this.add.sprite(1010, spec.footY, KEYBOARD_SOLO_VISUALS.walking.textureKey, 0)
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
    const walkScale = THEATRE.playerScale * (this.cfg.sprites.idle.contentHeight / walk.contentHeight);
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
    this.player.anims.play('phonePullAnim', true);
    this.phonePullCompleteHandler = () => {
      this.phonePullCompleteHandler = null;
      if (!this.isPhonePresentationCurrent()) return;
      // Level 1 holds still checking his phone (real art, RUN18 Ticket G) while the
      // movement branch keeps him on his mark. Theatre uses the same standing loop until
      // its dynamically computed walk cue, then returns to its read-while-walking stride.
      if (this.phoneOwner === 'theatre' && this.theatreWalkOffSeconds !== null
        && this.getLevelElapsed() < this.theatreWalkOffSeconds) {
        this.player.anims.play('phoneCheckIdleAnim', true);
      } else {
        this.player.anims.play(this.phoneOwner === 'level1' ? 'phoneCheckIdleAnim' : 'phoneReadAnim', true);
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
        this.player.anims.play('phoneCheckIdleAnim', true);
      } else {
        this.player.anims.play('walkAnim', true);
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

    for (const projectile of this.projectiles) projectile.sprite.destroy();
    this.projectiles = [];
    this.destroyInteractiveActors();
    // Level 1's wedding-party dressing and animated background are Fara7-only scenery
    // that would otherwise leak straight into the Theatre.
    this.destroyPassiveAudience();
    if (this.level1Bg) { this.level1Bg.destroy(); this.level1Bg = null; }
    this.cancelGesture();

    const interiorGroundY = THEATRE.apronFootY;
    this.worldMinX = 0;
    this.worldMaxX = STAGE_VIEW.width;
    this.physics.world.setBounds(0, 0, STAGE_VIEW.width, STAGE_VIEW.height);
    this.cameras.main.stopFollow();
    this.cameras.main.setFollowOffset(0, 0);
    this.cameras.main.setBounds(0, 0, STAGE_VIEW.width, STAGE_VIEW.height);
    this.cameras.main.centerOn(STAGE_VIEW.width / 2, STAGE_VIEW.height / 2);
    // 700x390 source frames stretched to the 1376x768 canvas -- a 1.966x scale in both
    // axes (the two aspect ratios agree to within 0.2%, so nothing is visibly distorted).
    this.level2Bg = this.add.sprite(0, 0, 'level2_theatre_bg')
      .setOrigin(0, 0)
      .setDepth(THEATRE_DEPTH.background);
    this.level2Bg.anims.play('theatreBgAnim', true);
    this.level2Bg.setDisplaySize(STAGE_VIEW.width, STAGE_VIEW.height);
    this.buildTheatreActors();

    this.ground.setPosition(STAGE_VIEW.width / 2, interiorGroundY + 20);
    this.ground.setSize(STAGE_VIEW.width, 40);
    this.ground.body.updateFromGameObject();
    this.baseScale = THEATRE.playerScale;
    this.sizedForTexture = null;
    this.player.anims.play('idleAnim', true);
    this.resizeBodyForTexture();
    this.player.body.allowGravity = true;
    this.player.body.reset(THEATRE.playerSpawnX, interiorGroundY - 2);
    this.player.setVelocity(0, 0);
    // He arrives still flipped from the leftward walk off the wedding stage; the whole
    // Theatre cast stands to his RIGHT, so face him at it rather than at the side wall.
    this.player.setFlipX(false);
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
    for (const projectile of this.projectiles) projectile.sprite.destroy();
    this.projectiles = [];
    this.destroyInteractiveActors();
    // The Theatre mic group and its join state are Level-2-only and outside the roster, so
    // nothing above reaches it. Party builds a fresh, separate mic below.
    this.destroyTheatreMic();
    // Clear the shared scenery list and Theatre's animated background before Party.
    this.destroyPassiveAudience();
    if (this.level2Bg) { this.level2Bg.destroy(); this.level2Bg = null; }
    this.cancelGesture();

    this.worldMinX = 0;
    this.worldMaxX = STAGE_VIEW.width;
    this.physics.world.setBounds(0, 0, STAGE_VIEW.width, STAGE_VIEW.height);
    this.cameras.main.stopFollow();
    this.cameras.main.setFollowOffset(0, 0);
    this.cameras.main.setBounds(0, 0, STAGE_VIEW.width, STAGE_VIEW.height);
    this.cameras.main.centerOn(STAGE_VIEW.width / 2, STAGE_VIEW.height / 2);

    // The pre-lit plate: heart-free twin of swapToLitPartyBackground()'s animated sheet, same
    // string-light/sparkle timing. Falls back to the old static unlit plate (kept loaded for
    // exactly this) if the generated sheet is ever missing at runtime.
    if (this.cfg.sprites.level3_party_bg_prelit) {
      this.partyBg = this.add.sprite(0, 0, 'level3_party_bg_prelit')
        .setOrigin(0, 0)
        .setDepth(PARTY_DEPTH.background);
      this.partyBg.anims.play(LEVEL3_ANIM_GROUPS.background.sheets.level3_party_bg_prelit, true);
    } else {
      this.partyBg = this.add.image(0, 0, LEVEL3_BASE_PLATE_KEY)
        .setOrigin(0, 0)
        .setDepth(PARTY_DEPTH.background);
    }
    this.partyBg.setDisplaySize(STAGE_VIEW.width, STAGE_VIEW.height);

    this.buildPartyActors();

    this.ground.setPosition(STAGE_VIEW.width / 2, PARTY.stageFootY + 20);
    this.ground.setSize(STAGE_VIEW.width, 40);
    this.ground.body.updateFromGameObject();
    // The Party is a WIDER shot than either earlier level (its deck lip sits at y 567
    // against Fara7's 628, and its cast reads ~150px tall against Fara7's 214.5), so the
    // hero is re-scaled to the art rather than carried over at Level 1/2's size -- at 214.5
    // his head would cover the "فرح شعبي" banner. sizedForTexture is cleared because
    // resizeBodyForTexture() short-circuits on an unchanged texture key and would otherwise
    // never notice the new baseScale.
    this.baseScale = PARTY.playerContentHeight / this.cfg.sprites.idle.contentHeight;
    this.sizedForTexture = null;
    this.player.anims.play('idleAnim', true);
    this.resizeBodyForTexture();
    this.player.body.allowGravity = true;
    this.player.body.reset(PARTY.playerSpawnX, PARTY.stageFootY - 2);
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

  // The heart marquee powers on. Guarded by partyBgLit so the swap only fires once
  // even if called from both the 143s cue and 160s spawnBoss(). Both plates were measured
  // to share the same stage geometry, so nothing on stage has to move across this swap.
  swapToLitPartyBackground() {
    if (this.partyBgLit) return;
    this.partyBgLit = true;
    if (this.partyBg) { this.partyBg.destroy(); this.partyBg = null; }
    if (!this.cfg.sprites.level3_party_bg) return;
    this.partyBg = this.add.sprite(0, 0, 'level3_party_bg')
      .setOrigin(0, 0)
      .setDepth(PARTY_DEPTH.background);
    this.partyBg.anims.play(LEVEL3_ANIM_GROUPS.background.sheets.level3_party_bg, true);
    this.partyBg.setDisplaySize(STAGE_VIEW.width, STAGE_VIEW.height);
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

  spawnProjectileDirectional(type, flip) {
    const isHeart = type === 'heart';
    const texKey = isHeart ? 'heart_icon' : 'flowers_icon';
    const trajectoryMode = this.level3Active ? 'partyArc' : 'descending';
    let spawnX;
    let spawnY;
    if (trajectoryMode === 'partyArc') {
      // update() only calls resizeBodyForTexture() at its own end, so a shot spawned the
      // same tick a texture just changed (e.g. the M-key's singing animation) would
      // otherwise read the PREVIOUS texture's stale displayWidth/displayHeight here.
      this.resizeBodyForTexture();
      // Ratios are the held-object's approximate center within its gesture frame,
      // measured from the same crop used to produce the icon assets (see ticket).
      // No PROJECTILE_Y_OFFSET here (RUN19 Ticket C) -- that flat 120px shift was
      // calibrated against Level 1's much larger on-screen scale and dragged Party's
      // spawn point down near his feet; removing it restores the hand-relative position
      // these ratios were originally measured against.
      const ratioX = isHeart ? 0.877 : 0.861;
      const ratioY = isHeart ? 0.197 : 0.167;
      const rx = flip ? (1 - ratioX) : ratioX;
      spawnX = this.player.x - this.player.displayWidth / 2 + rx * this.player.displayWidth;
      spawnY = this.player.y - this.player.displayHeight + ratioY * this.player.displayHeight;
    } else {
      spawnX = this.player.body.center.x;
      spawnY = this.player.body.center.y;
    }

    const icon = this.add.sprite(spawnX, spawnY, texKey);
    icon.setFlipX(flip);
    // RUN 21: Fara7's new foreground crowd sits at FARA7_DEPTH.crowd (1), in front
    // of the default depth-0 world -- without this, a low-arcing throw could
    // render BEHIND the crowd and visually vanish. Theatre/Party have no such
    // foreground layer, so their projectiles keep the existing default depth.
    if (!this.level2Active && !this.level3Active) icon.setDepth(2);
    this.projectiles.push({
      sprite: icon,
      vx: flip ? -PROJECTILE_SPEED : PROJECTILE_SPEED,
      trajectoryMode,
      ageMs: 0,
      spawnX,
      spawnY,
    });
  }

  updateProjectiles(delta) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      // Accumulate age from the smoothed/capped `delta` Phaser already hands every
      // update() tick, NOT raw wall-clock `this.time.now - spawnTime` -- a backgrounded
      // tab resuming after real time has passed would otherwise make the projectile
      // jump straight to its full-flight end position in one frame (Codex second-opinion
      // review catch, RUN 11 Seq 1 -- confirmed via Phaser's own Clock/TimeStep source:
      // `delta` is deliberately capped, `time.now` is not).
      proj.ageMs += delta;
      const ageSeconds = proj.ageMs / 1000;
      proj.sprite.x = proj.spawnX + proj.vx * ageSeconds;
      proj.sprite.y = proj.trajectoryMode === 'descending'
        ? proj.spawnY + PROJECTILE_DESCENT_SPEED * ageSeconds
        : proj.spawnY - 16 * Math.sin(Math.PI * ageSeconds);

      // One projectile is spent by one ACCEPTED hit -- including a below-threshold one
      // that leaves the actor standing, which is what makes three hits cost three throws.
      if (this.tryHitInteractiveActor(proj.sprite.getBounds())) {
        proj.sprite.destroy();
        this.projectiles.splice(i, 1);
        continue;
      }

      const outOfBounds = proj.sprite.x < this.worldMinX - 50 || proj.sprite.x > this.worldMaxX + 50;
      const expired = proj.ageMs > 3000;
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
      && !this.exitSettling && !this.cutsceneActive && !this.gesture && !this.manosDefeated;

    this.updateIntro(elapsed);
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
      && !this.gesture && onFloor && !this.cutsceneActive) {
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
      // branch -- can reach him again once the boss's attack has landed. No anims.play()
      // here either; killManos() started the (repeat:-1) death-stub loop and this branch
      // must not restart it every tick.
      this.player.setVelocityX(0);
    } else if (this.level2Revealing || this.level3Revealing) {
      this.player.setVelocityX(0);
      this.player.anims.play('idleAnim', true);
    } else if (this.gesture) {
      this.player.setVelocityX(0);
    } else if (this.exitSettling) {
      // A phone handoff caught him mid-jump: gravity finishes the arc (Y untouched), X is
      // already pinned by updateStageExit() -- arrow keys must not drag him off it.
      this.player.setVelocityX(0);
      this.player.anims.play('jumpAnim', true);
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
            this.player.anims.play(this.phonePresentationDone ? 'walkAnim' : 'phoneReadAnim', true);
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
        this.player.anims.play('manosStageSingingAnim', true);
      } else if (!onFloor) {
        this.player.anims.play('jumpAnim', true);
      } else if (left || right) {
        this.player.anims.play('walkAnim', true);
      } else {
        this.player.anims.play('idleAnim', true);
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
  width: 1376,
  height: 768,
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
