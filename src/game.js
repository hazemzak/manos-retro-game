// Manos Retro Game -- Milestone 1: walk, jump, RTL scroll, ground collision.
// No enemies, no goal, no lyric-as-world-object system yet -- later milestones.

const SPEED = 260;
const JUMP_VELOCITY = -750;
const GRAVITY_Y = 1800;
const PROJECTILE_SPEED = 700;

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
    const { panelW, panelH, groundY, playerScale, panelsRightToLeft } = cfg.level1;
    const panelCount = panelsRightToLeft.length;
    const worldW = panelW * panelCount;
    this.worldW = worldW;

    // Place panels reversed: index 0 (the start, shops) at the HIGHEST x.
    // panelsRightToLeft[0] is where the player spawns; the level reads right-to-left.
    for (let i = 0; i < panelCount; i++) {
      const x = worldW - (i + 1) * panelW;
      this.add.image(x, 0, 'panel' + i).setOrigin(0, 0);
    }

    // Ground: one invisible static collider spanning the whole level width.
    const ground = this.add.rectangle(worldW / 2, groundY + 20, worldW, 40, 0x000000, 0);
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

    // Player spawns inside the shops segment (panelsRightToLeft[0]), near the right edge of the world.
    // Spawn ABOVE the ground line (not on/inside it) so Arcade Physics resolves a real
    // fall-and-land collision -- spawning already overlapping the collider leaves the body
    // "embedded" and onFloor() never becomes true.
    this.player = this.physics.add.sprite(worldW - 200, groundY - 150, 'walk', 0);
    this.player.setOrigin(0.5, 1);
    this.baseScale = playerScale;
    this.resizeBodyForTexture();
    this.player.setCollideWorldBounds(true);

    this.physics.add.collider(this.player, ground);

    this.physics.world.setBounds(0, 0, worldW, panelH);
    this.cameras.main.setBounds(0, 0, worldW, panelH);

    // RTL camera follow: positive offset seats the player right-of-centre so the
    // space he's walking INTO (leftward) is visible. Verify sign in-browser.
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.setFollowOffset(260, 0);

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
    this.music = this.sound.add('theme', { loop: true, volume: 0.5 });
    const startMusic = () => { if (!this.music.isPlaying) this.music.play(); };
    this.input.once('pointerdown', startMusic);
    this.input.keyboard.once('keydown', startMusic);
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
      const outOfBounds = proj.sprite.x < -50 || proj.sprite.x > this.worldW + 50;
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
