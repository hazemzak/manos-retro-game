// Manos Retro Game -- Milestone 1: walk, jump, RTL scroll, ground collision.
// No enemies, no goal, no lyric-as-world-object system yet -- later milestones.

const SPEED = 260;
const JUMP_VELOCITY = -750;
const GRAVITY_Y = 1800;
const PROJECTILE_SPEED = 700;

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
    this.load.spritesheet('dizzy_body', s.dizzy_body.file, { frameWidth: s.dizzy_body.frameWidth, frameHeight: s.dizzy_body.frameHeight });
    this.load.spritesheet('dizzy_hearts', s.dizzy_hearts.file, { frameWidth: s.dizzy_hearts.frameWidth, frameHeight: s.dizzy_hearts.frameHeight });
    this.load.image('heart_icon', s.heart_icon.file);
    this.load.image('flowers_icon', s.flowers_icon.file);

    const panels = cfg.level1.panelsRightToLeft;
    panels.forEach((file, i) => this.load.image('panel' + i, 'assets/approved/' + file));

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
    const { panelW, panelH, groundY, playerScale } = cfg.level1;

    // Panel textures, in the order they repeat as the belt extends ("logical index" 0,
    // 1, 2, 3... maps to panelTextures[0,1,0,1...]). panelsRightToLeft[0] (shops) is
    // where the player spawns, matching the original fixed-layout design.
    this.panelTextures = cfg.level1.panelsRightToLeft.map((_, i) => 'panel' + i);

    // Level 1's real end condition is TIME (the song reaching 60s), not distance --
    // see onLevel1Complete(). A large-but-finite world (not truly unbounded/
    // re-based coordinates -- unnecessary complexity for a time-gated level) comfortably
    // covers any real play session in either direction. Panels are tile-recycled across
    // this range in updatePanels(), not placed once.
    const WORLD_HALF_PANELS = 20;
    this.worldMinX = -WORLD_HALF_PANELS * panelW;
    this.worldMaxX = WORLD_HALF_PANELS * panelW;

    // Ground: one invisible static collider spanning the whole (large-but-finite) world.
    const ground = this.add.rectangle(0, groundY + 20, this.worldMaxX - this.worldMinX, 40, 0x000000, 0);
    this.physics.add.existing(ground, true);

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
      key: 'dizzyBodyAnim',
      frames: this.anims.generateFrameNumbers('dizzy_body', { start: 0, end: cfg.sprites.dizzy_body.frames - 1 }),
      frameRate: 6,
      repeat: -1,
    });
    this.anims.create({
      key: 'dizzyHeartsAnim',
      frames: this.anims.generateFrameNumbers('dizzy_hearts', { start: 0, end: cfg.sprites.dizzy_hearts.frames - 1 }),
      frameRate: 6,
      repeat: -1,
    });

    // Player spawns inside logical panel index 0 (shops), near its right edge -- same
    // relative spawn position as the original fixed layout, just re-expressed against
    // the new index-based panel coordinate system (panelX(k) = -k * panelW).
    // Spawn ABOVE the ground line (not on/inside it) so Arcade Physics resolves a real
    // fall-and-land collision -- spawning already overlapping the collider leaves the body
    // "embedded" and onFloor() never becomes true.
    this.player = this.physics.add.sprite(panelW - 200, groundY - 150, 'walk', 0);
    this.player.setOrigin(0.5, 1);
    this.baseScale = playerScale;
    this.resizeBodyForTexture();
    this.player.setCollideWorldBounds(true);

    this.physics.add.collider(this.player, ground);

    this.physics.world.setBounds(this.worldMinX, 0, this.worldMaxX - this.worldMinX, panelH);
    this.cameras.main.setBounds(this.worldMinX, 0, this.worldMaxX - this.worldMinX, panelH);

    // RTL camera follow: positive offset seats the player right-of-centre so the
    // space he's walking INTO (leftward) is visible. Verify sign in-browser.
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.setFollowOffset(260, 0);

    // Panel pool: populated on the first updatePanels() call in update() (camera's
    // worldView isn't meaningful until after the first render pass), not here.
    this.panelPool = [];

    // Dizzy's circling-hearts overlay -- a separate sprite, not baked into the player
    // texture (see GAME_PLAN.md's "two separate assets" call), so its loop timing is
    // independent of the body-stagger animation. Hidden until the dizzy gesture fires.
    this.dizzyHearts = this.add.sprite(this.player.x, this.player.y, 'dizzy_hearts', 0);
    const dh = this.cfg.sprites.dizzy_hearts;
    // Origin anchored to the measured glyph center, not the canvas center (default 0.5,0.5)
    // -- the heart glyph occupies a small area near the top of a mostly-transparent canvas,
    // so the default origin anchors empty space, not the heart itself.
    this.dizzyHearts.setOrigin(dh.contentCenterX / dh.frameWidth, dh.contentCenterY / dh.frameHeight);
    // Scale independently of the player's body scale (GAME_PLAN.md already calls these
    // two separate assets) -- target a legible on-screen glyph height rather than reusing
    // playerScale, since the raw canvas is mostly transparent padding around a small icon.
    const TARGET_HEART_PX = 55; // starting point -- adjust after a live look if it reads too small/large
    this.dizzyHearts.setScale(TARGET_HEART_PX / dh.contentHeight);
    this.dizzyHearts.setVisible(false);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyA = this.input.keyboard.addKey('A');
    // Note: 'D' used to double as a right-movement key (WASD-style) alongside the arrow
    // keys. Repurposed to the dizzy gesture below -- arrow keys already cover movement
    // fully, so nothing is lost, and D now has one unambiguous meaning.
    this.keyL = this.input.keyboard.addKey('L');
    this.keyF = this.input.keyboard.addKey('F');
    this.keyD = this.input.keyboard.addKey('D');

    this.gesture = null; // null | 'heart' | 'flowers' | 'dizzy'

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

    this.level1Complete = false;
    this.movementLocked = false;

    // Lyric cues: [{start, end, text}, ...], real timestamps against the final mix (see
    // MANOS_RETRO_GAME_SUPPORT_PLAYBOOK.md for the alignment methodology). Missing/
    // malformed data degrades to "no lyrics shown", not a crash.
    this.lyrics = this.cache.json.get('lyricsData') || [];
    this.lyricEl = document.getElementById('lyric-bubble');
    this._lastLyricText = '';

    // Thrown-projectile state (heart/flowers gestures). Listeners registered ONCE here,
    // not inside startGesture() -- registering per-play would stack duplicate listeners
    // and multi-spawn on every subsequent gesture.
    this.projectiles = [];
    this.player.on('animationupdate', (anim, frame) => {
      if (!frame.isLast || this._projSpawned) return;
      if (anim.key === 'giveHeartAnim') { this._projSpawned = true; this.spawnProjectile('heart'); }
      else if (anim.key === 'giveFlowersAnim') { this._projSpawned = true; this.spawnProjectile('flowers'); }
    });

    this.ready = true;
  }

  // Every generated sheet has its own canvas size (idle 336x376, jump 414x414, the walk
  // sheet has swapped between 336x376 and 443x443 versions across regenerations, gesture
  // sheets 405x408, dizzy_body 539x720...). A single fixed setScale() makes the character
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
    // (dizzy_body) have a lot of transparent padding below the character, so scaling
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
    // corrupt the level clock (see getLevelElapsed()). Level 1 completes at 60s, well
    // before the 183.9s track would ever reach its end anyway.
    const slider = document.getElementById('music-volume');
    const initialVolume = slider ? parseFloat(slider.value) : 0.5;
    this.music = this.sound.add('theme', { loop: false, volume: initialVolume });
    // Guard against level1Complete too: without it, a stray keydown after
    // onLevel1Complete() has paused the music (Codex review caught this -- the keyboard
    // listener below is a SEPARATE `once` from the pointer one, so if the player only
    // ever used touch/mouse, that keyboard listener is still armed and can fire after
    // completion, silently resuming the paused track).
    const startMusic = () => { if (!this.level1Complete && !this.music.isPlaying) this.music.play(); };
    if (this.levelClockStart !== null) {
      // The player's first real gesture already happened before this (async) audio
      // load finished -- start immediately rather than waiting for a SECOND gesture
      // that may never come (e.g. a held movement button doesn't re-fire pointerdown/
      // pointerup/keydown). Also caught by the Codex review.
      startMusic();
    } else {
      // document, not this.input -- same canvas-vs-DOM-button gap as startLevelClock
      // above, and same pointerdown/pointerup pointer-type split.
      onFirstRealGesture(startMusic);
      this.input.keyboard.once('keydown', startMusic);
    }
  }

  // Single sampled source of truth for "how far into Level 1 are we", read once per
  // update() tick and reused for both the lyric lookup and the completion check (not
  // two separate live reads that could disagree within the same frame).
  getLevelElapsed() {
    if (this.music && this.music.isPlaying) return this.music.seek;
    if (this.levelClockStart !== null) return (this.time.now - this.levelClockStart) / 1000;
    return 0;
  }

  // Named extension point for the real cinema-transition/Level 2 hookup (Hazem's own
  // future art/work) -- deliberately minimal placeholder for now. Latched: called
  // exactly once via the level1Complete flag in update(), never re-entered.
  onLevel1Complete() {
    if (this.music) this.music.pause();
    this.movementLocked = true;
    if (this.lyricEl) {
      this.lyricEl.textContent = 'to be continued...';
      this.lyricEl.hidden = false;
    }
  }

  // Reconciles the panel sprite pool against whatever logical panel indices the camera
  // can currently see (+1 buffer each side), in EITHER scroll direction -- not a one-
  // directional "recycle when it scrolls off the left" check, which would leave gaps if
  // the player walks back right. panelX(k) = -k * panelW places index 0 at the original
  // spawn panel, increasing k further left (matching the original RTL layout's
  // convention), decreasing k (negative) further right.
  updatePanels() {
    const panelW = this.cfg.level1.panelW;
    const cam = this.cameras.main;
    const camLeft = cam.worldView.x;
    const camRight = camLeft + cam.worldView.width;
    // indexAtX: which logical panel index contains world position x, given panelX(k) =
    // -k*panelW spans [-k*panelW, -k*panelW + panelW). Derived and checked against
    // concrete examples (x=0 -> k=0, x=panelW-1 -> k=0, x=panelW -> k=-1, x=-1 -> k=1).
    const indexAtX = (x) => -Math.floor(x / panelW);
    // camLeft (smallest visible x) maps to the LARGEST needed k (furthest-left panel);
    // camRight maps to the smallest. +-1 is a one-panel buffer on each side.
    const kMax = indexAtX(camLeft) + 1;
    const kMin = indexAtX(camRight) - 1;

    const spare = this.panelPool.filter((p) => p.index < kMin || p.index > kMax);
    let spareI = 0;
    for (let k = kMin; k <= kMax; k++) {
      if (this.panelPool.some((p) => p.index === k)) continue;
      let p = spare[spareI++];
      if (!p) {
        // depth:-1 -- panels are now created lazily here in update(), long after the
        // player/gesture sprites already exist in buildLevel(). Without an explicit
        // depth, Phaser's default render order (display-list insertion order) would put
        // every newly-recycled panel ON TOP of the player instead of behind it -- caught
        // via an actual screenshot showing no character at all, not by code review.
        p = { sprite: this.add.image(0, 0, this.panelTextures[0]).setOrigin(0, 0).setDepth(-1), index: null };
        this.panelPool.push(p);
      }
      const texIdx = ((k % this.panelTextures.length) + this.panelTextures.length) % this.panelTextures.length;
      p.sprite.setTexture(this.panelTextures[texIdx]);
      p.sprite.x = -k * panelW;
      p.index = k;
    }
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
      this.player.once('animationcomplete-giveHeartAnim', () => { this.gesture = null; });
    } else if (type === 'flowers') {
      this._projSpawned = false;
      this.player.anims.play('giveFlowersAnim', true);
      this.player.once('animationcomplete-giveFlowersAnim', () => { this.gesture = null; });
    } else if (type === 'dizzy') {
      this.player.anims.play('dizzyBodyAnim', true);
      this.dizzyHearts.setVisible(true);
      this.dizzyHearts.anims.play('dizzyHeartsAnim', true);
      this.time.delayedCall(2000, () => {
        this.gesture = null;
        this.dizzyHearts.setVisible(false);
        this.dizzyHearts.anims.stop();
      });
    }
  }

  spawnProjectile(type) {
    const isHeart = type === 'heart';
    const texKey = isHeart ? 'heart_icon' : 'flowers_icon';
    // Ratios are the held-object's approximate center within its gesture frame,
    // measured from the same crop used to produce the icon assets (see ticket).
    const ratioX = isHeart ? 0.877 : 0.861;
    const ratioY = isHeart ? 0.197 : 0.167;
    const flip = this.player.flipX;
    const rx = flip ? (1 - ratioX) : ratioX;
    const spawnX = this.player.x - this.player.displayWidth / 2 + rx * this.player.displayWidth;
    const spawnY = this.player.y - this.player.displayHeight + ratioY * this.player.displayHeight;

    const icon = this.add.sprite(spawnX, spawnY, texKey);
    icon.setFlipX(flip);
    this.projectiles.push({
      sprite: icon,
      vx: flip ? -PROJECTILE_SPEED : PROJECTILE_SPEED,
      spawnTime: this.time.now,
    });
  }

  update(time, delta) {
    if (!this.ready) return;

    this.updatePanels();

    // Single sampled value, reused below for both the lyric lookup and the completion
    // check -- see the comment on getLevelElapsed().
    const elapsed = this.getLevelElapsed();

    if (!this.level1Complete) {
      if (elapsed >= 60) {
        this.level1Complete = true; // latched -- onLevel1Complete() runs exactly once
        this.onLevel1Complete();
      } else if (this.lyricEl) {
        let activeText = '';
        for (const cue of this.lyrics) {
          if (elapsed >= cue.start && elapsed < cue.end) { activeText = cue.text; break; }
        }
        // Only touch the DOM when the selected cue actually changes -- and this full
        // re-scan every tick (cheap at 54 cues) is deliberately NOT a forward-only
        // pointer, which would break on a backward seek or a level restart.
        if (activeText !== this._lastLyricText) {
          this.lyricEl.textContent = activeText;
          this.lyricEl.hidden = !activeText;
          this._lastLyricText = activeText;
        }
      }
    }

    const onFloor = this.player.body.onFloor();

    // Gestures are a deliberate stationary beat (GAME_PLAN.md Milestone 3: "press a
    // button, character performs a scripted gesture") -- only start one when grounded
    // and no gesture is already playing; skip movement/jump entirely while one runs.
    if (!this.gesture && onFloor) {
      if (Phaser.Input.Keyboard.JustDown(this.keyL) || this.touchState.heart) this.startGesture('heart');
      else if (Phaser.Input.Keyboard.JustDown(this.keyF) || this.touchState.flowers) this.startGesture('flowers');
      else if (Phaser.Input.Keyboard.JustDown(this.keyD) || this.touchState.dizzy) this.startGesture('dizzy');
    }
    // Edge-triggered touch gesture flags: consumed above (or dropped, if a gesture was
    // already playing) -- reset every tick so a tap fires at most once, same as JustDown.
    this.touchState.heart = false;
    this.touchState.flowers = false;
    this.touchState.dizzy = false;

    if (this.gesture) {
      this.player.setVelocityX(0);
      if (this.gesture === 'dizzy') {
        this.dizzyHearts.x = this.player.x;
        this.dizzyHearts.y = this.player.y - this.player.displayHeight + 15;
      }
    } else if (this.movementLocked) {
      // Enforced HERE, every tick, inside the real velocity branch -- not a one-time
      // setVelocityX(0) at completion, which the next tick's normal movement code would
      // just overwrite right back.
      this.player.setVelocityX(0);
      if (onFloor) this.player.anims.play('idleAnim', true);
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

      if (!onFloor) {
        this.player.anims.play('jumpAnim', true);
      } else if (left || right) {
        this.player.anims.play('walkAnim', true);
      } else {
        this.player.anims.play('idleAnim', true);
      }
    }

    // Thrown-projectile tick: runs every frame regardless of gesture state, since a
    // projectile keeps flying after its spawning gesture's animation has already ended.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.sprite.x += proj.vx * (delta / 1000);
      proj.sprite.rotation += 0.25;
      const outOfBounds = proj.sprite.x < this.worldMinX - 50 || proj.sprite.x > this.worldMaxX + 50;
      const expired = (this.time.now - proj.spawnTime) > 3000;
      if (outOfBounds || expired) {
        proj.sprite.destroy();
        this.projectiles.splice(i, 1);
      }
    }

    // Last: the texture is now whatever this tick actually selected. See the comment on
    // resizeBodyForTexture() -- calling it before this point reads a stale frame.
    this.resizeBodyForTexture();
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
