// ---------------------------------------------------------------------------
// OMO ORISHA — A Lagos Saga
// 2D side-scrolling platformer in Phaser 4. The "3D" look is pseudo-3D:
// platforms are drawn as extruded boxes (top face + front face + side),
// layered parallax skyline, and a vertex-coloured gradient sky.
//
// The whole game lives in this file: constants, EventBus, checkpoint
// persistence (the `GameManager` autoload equivalent from the design plan),
// the StartGame factory and the single `Game` scene (world, kinematic
// character physics, enemy AI, awakening intro, win/loss triggers).
// All menus / intro slides / HUD / win & loss screens are React DOM overlays
// in src/App.tsx driven through the EventBus.
// ---------------------------------------------------------------------------
import { AUTO, BlendModes, Events, Game as PhaserGame, Scale, Scene } from 'phaser';

// ---------------------------------------------------------------------------
// GAME CONSTANTS
// ---------------------------------------------------------------------------
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

export const COLORS = {
    BACKGROUND: 0x120b24,
    TEXT: '#ffffff',
} as const;

// ---------------------------------------------------------------------------
// EVENT NAMES — defined once, imported by both the scene and App.tsx so the
// React <-> Phaser contract can never drift.
// ---------------------------------------------------------------------------
export const EV = {
    PHASE_CHANGED: 'phase-changed',
    DEATH_REASON: 'death-reason',
    CHECKPOINT: 'checkpoint',
    START_GAME: 'start-game',
    SKIP_INTRO: 'skip-intro',
    POWER_STATE: 'power-state',
    BANNER: 'banner',
    PAUSE: 'pause',
    RESUME: 'resume',
    BACK_TO_MENU: 'back-to-menu',
    CURRENT_SCENE_READY: 'current-scene-ready',
} as const;

export type Phase = 'MENU' | 'INTRO' | 'PLAYING' | 'WIN' | 'LOSS';
export type DeathReason = 'FELL_INTO_PIT' | 'CAUGHT_BY_ENEMY';

// ---------------------------------------------------------------------------
// GAME MANAGER — checkpoint / save persistence (the Godot autoload singleton
// equivalent). Stores the last checkpoint position + whether a save exists.
// ---------------------------------------------------------------------------
const SAVE_KEY = 'omo_orisha_save';

export const GameManager = {
    hasSavedGame(): boolean {
        try { return localStorage.getItem(SAVE_KEY) !== null; } catch { return false; }
    },
    getCheckpoint(): { x: number; y: number } | null {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return null;
            const d = JSON.parse(raw) as { x: number; y: number };
            return { x: d.x, y: d.y };
        } catch { return null; }
    },
    setCheckpoint(p: { x: number; y: number }): void {
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(p)); } catch { /* private mode */ }
    },
};

// ---------------------------------------------------------------------------
// EVENT BUS — shared React <-> Phaser bridge (named export).
// ---------------------------------------------------------------------------
export const EventBus = new Events.EventEmitter();

// ---------------------------------------------------------------------------
// WORLD DATA — Lagos street: danfo rooftops, container stacks, market
// planks, checkpoints (stone plinths), one enforcer, shrine gate goal.
// Box definitions are [centerX, topY, sizeX, sizeY] in WORLD units.
// WORLD_Y = 0 is the top of the spawn pad; the camera is flipped so +Y goes
// DOWN the screen. Platform "top" is the surface the player stands on.
// ---------------------------------------------------------------------------
type BoxDef = [number, number, number, number];

const SPAWN: BoxDef = [0, 0, 10, 1];
const DANFOS: BoxDef[] = [
    [8, -0.5, 6, 2],
    [15.5, -1, 6, 3],
    [23, -1.5, 6, 4],
];
const CONTAINERS: BoxDef[] = [
    [31, -1, 6, 2],
    [31, -2.5, 6, 1],
];
const MARKET: BoxDef[] = [
    [39, -1.5, 7, 3],
    [46.5, -2, 6, 4],
];
const SHRINE: BoxDef = [54, 0, 8, 1];
const ALL_PLATFORMS: BoxDef[] = [SPAWN, ...DANFOS, ...CONTAINERS, ...MARKET, SHRINE];

const CHECKPOINTS: { pos: [number, number]; trigger: BoxDef }[] = [
    { pos: [23, -1.5], trigger: [23, -1.5, 3, 1.6] },
    { pos: [31, -2.5], trigger: [31, -2.5, 3, 1.8] },
    { pos: [46.5, -2], trigger: [46.5, -2, 3, 1.6] },
];

const ENEMY_PATROL: BoxDef = [39, -1.5, 7, 3];
const ENEMY_START_X = 37;
const ENEMY_CHASE_RANGE = 7;
const SHRINE_TRIGGER: BoxDef = [54, -1.8, 3.5, 4];

const WORLD_MIN_X = -62;
const WORLD_MAX_X = 62;
const KILL_Y = 10;   // below the platforms (camera flipped, +Y is down)

// Player kinematics (mirrors kolade.gd exports: speed 7.5, jump 9, gravity 24)
const PLAYER_SPEED = 7.5;
const JUMP_VELOCITY = 10;
const GRAVITY = 24;
const POWER_DURATION = 3;
const POWER_COOLDOWN = 6;
const POWER_SPEED_MULT = 1.6;
const PLAYER_HALF = 0.4;
const PLAYER_HEIGHT = 1.6;

// ---------------------------------------------------------------------------
// PHASER CONFIG / FACTORY
// ---------------------------------------------------------------------------
const StartGame = (parent: string) =>
{
    const config: Phaser.Types.Core.GameConfig = {
        type: AUTO,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        parent,
        backgroundColor: '#050508',
        scale: {
            mode: Scale.FIT,
            autoCenter: Scale.CENTER_BOTH,
        },
        physics: {
            default: 'arcade',
            arcade: { gravity: { x: 0, y: 0 } },
        },
        scene: [Game],
    };

    const game = new PhaserGame(config);
    if (typeof window !== 'undefined') {
        (window as any).__PHASER_GAME__ = game;
        (window as any).__PHASER_EVENT_BUS__ = EventBus;
    }
    return game;
};

// ---------------------------------------------------------------------------
// THE GAME SCENE — 2D world + Phaser input/audio/EventBus bridge.
// ---------------------------------------------------------------------------
type Platform = { minX: number; maxX: number; top: number };
type TriggerKind = 'checkpoint' | 'checkpoint-done' | 'enemy' | 'enemy-done' | 'shrine';
type Trigger = { minX: number; maxX: number; top: number; kind: TriggerKind; index: number };

export class Game extends Scene
{
    // world / visuals
    private worldContainer!: Phaser.GameObjects.Container;
    private platforms: Platform[] = [];
    private triggers: Trigger[] = [];
    private playerSprite!: Phaser.GameObjects.Container;
    private enemySprite!: Phaser.GameObjects.Container;
    private shrineGlow!: Phaser.GameObjects.Image;
    private aura!: Phaser.GameObjects.Particles.ParticleEmitter;
    private menuT = 0;

    // player state
    private px = 0; private py = -0.2;
    private vx = 0; private vy = 0;
    private onGround = false;
    private inputEnabled = false;
    private powerActive = false;
    private powerTimer = 0;
    private powerCooldown = 0;
    private powerFired = false;
    private facing = 1;

    // enemy state
    private ex = ENEMY_START_X; private ey = -1.5 - PLAYER_HEIGHT / 2;
    private enemyDir = 1;
    private enemyDispelled = false;

    // sequence state
    private phase: Phase = 'MENU';
    private paused = false;
    private deathReason: DeathReason = 'FELL_INTO_PIT';
    private introDone = false;
    private introT = 0;
    private lastPowerEmit = -1;

    // input
    private keys!: Record<string, Phaser.Input.Keyboard.Key>;

    constructor ()
    {
        super('Game');
    }

    preload ()
    {
        // Pre-packaged universal audio (public/assets/audio/)
        this.load.audio('sfx_jump', 'assets/audio/sfx_jump.mp3');
        this.load.audio('sfx_powerup', 'assets/audio/sfx_powerup.mp3');
        this.load.audio('sfx_button', 'assets/audio/sfx_button.mp3');
        this.load.audio('sfx_win', 'assets/audio/sfx_win.mp3');
        this.load.audio('sfx_gameover', 'assets/audio/sfx_gameover.mp3');
        this.load.image('fx_glow', 'assets/fx/glow.png');
    }

    create ()
    {
        // -------------------------------------------------------------
        // Gradient sky (full-screen, fixed, behind everything)
        // -------------------------------------------------------------
        const sky = this.add.graphics();
        sky.fillGradientStyle(0x120b24, 0x120b24, 0x963816, 0x963816, 1);
        sky.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        sky.setScrollFactor(0);
        sky.setDepth(-100);

        // -------------------------------------------------------------
        // Parallax skyline layers (fixed containers, scrolled by camera)
        // -------------------------------------------------------------
        this.buildSkyline(0.15, 0x1b1230, 0.5);   // far
        this.buildSkyline(0.35, 0x241a3a, 0.75);  // mid
        this.buildSkyline(0.6, 0x2a1f42, 1);      // near

        // -------------------------------------------------------------
        // World container (everything that scrolls with the camera)
        // -------------------------------------------------------------
        this.worldContainer = this.add.container(0, 0);
        this.worldContainer.setDepth(0);

        this.buildWorld();
        this.buildPlayer();
        this.buildEnemy();
        this.buildShrine();
        this.buildAura();

        // -------------------------------------------------------------
        // Phaser input (keyboard) + audio
        // -------------------------------------------------------------
        this.keys = this.input.keyboard!.addKeys('W,A,S,D,SPACE,F,SHIFT') as Record<string, Phaser.Input.Keyboard.Key>;
        this.input.keyboard!.on('keydown-SPACE', () =>
        {
            if (this.phase === 'INTRO') EventBus.emit(EV.SKIP_INTRO);
        });
        this.input.keyboard!.on('keydown-ENTER', () =>
        {
            if (this.phase === 'INTRO') EventBus.emit(EV.SKIP_INTRO);
        });

        // React -> scene commands
        const onStart = (data: { fromCheckpoint: boolean }) => this.beginLevel(data?.fromCheckpoint ?? false);
        const onSkip = () =>
        {
            if (this.phase === 'INTRO') this.finishIntro();
        };
        const onPause = () =>
        {
            if (this.phase !== 'PLAYING') return;
            this.paused = true;
            this.sound.pauseAll();
        };
        const onResume = () =>
        {
            if (!this.paused) return;
            this.paused = false;
            this.sound.resumeAll();
        };
        const onBackToMenu = () =>
        {
            this.paused = false;
            this.phase = 'MENU';
            this.inputEnabled = false;
            this.sound.stopAll();
            EventBus.emit(EV.PHASE_CHANGED, 'MENU' as Phase);
        };
        EventBus.on(EV.START_GAME, onStart);
        EventBus.on(EV.SKIP_INTRO, onSkip);
        EventBus.on(EV.PAUSE, onPause);
        EventBus.on(EV.RESUME, onResume);
        EventBus.on(EV.BACK_TO_MENU, onBackToMenu);

        this.events.once('shutdown', () =>
        {
            EventBus.off(EV.START_GAME, onStart);
            EventBus.off(EV.SKIP_INTRO, onSkip);
            EventBus.off(EV.PAUSE, onPause);
            EventBus.off(EV.RESUME, onResume);
            EventBus.off(EV.BACK_TO_MENU, onBackToMenu);
            this.time.removeAllEvents();
            this.tweens.killAll();
            this.input.keyboard?.removeAllListeners();
            this.sound.stopAll();
        });

        // Boot into MENU; React renders the menu overlay.
        this.phase = 'MENU';
        EventBus.emit(EV.PHASE_CHANGED, 'MENU' as Phase);
        EventBus.emit(EV.CURRENT_SCENE_READY, this);
    }

    // -----------------------------------------------------------------
    // WORLD BUILDERS
    // -----------------------------------------------------------------
    private buildSkyline(factor: number, color: number, heightScale: number)
    {
        const c = this.add.container(0, 0);
        c.setScrollFactor(factor, 0);
        c.setDepth(-50 + factor * 10);
        const g = this.add.graphics();
        g.fillStyle(color, 1);
        const baseY = GAME_HEIGHT * 0.62;
        let x = -100;
        let i = 0;
        while (x < GAME_WIDTH + 100)
        {
            const w = 40 + ((i * 37) % 60);
            const h = (60 + ((i * 53) % 140)) * heightScale;
            g.fillRect(x, baseY - h, w, h + 200);
            x += w + 10 + ((i * 17) % 20);
            i++;
        }
        c.add(g);
    }

    private addPlatform(def: BoxDef, color: number, capColor?: number)
    {
        const [cx, topY, sx, sy] = def;
        // Pseudo-3D: front face + top cap (lighter) + right side (darker)
        const front = this.add.rectangle(cx, topY + sy / 2, sx, sy, color);
        this.worldContainer.add(front);
        if (capColor !== undefined)
        {
            const cap = this.add.rectangle(cx, topY - 0.06, sx + 0.06, 0.12, capColor);
            this.worldContainer.add(cap);
        }
        // Side extrusion (darker) for depth
        const side = this.add.rectangle(cx + sx / 2 + 0.12, topY + sy / 2, 0.24, sy, 0x000000, 0.35);
        this.worldContainer.add(side);

        this.platforms.push({
            minX: cx - sx / 2, maxX: cx + sx / 2,
            top: topY,
        });
    }

    private addInvisibleTrigger(def: BoxDef, kind: Trigger['kind'], index: number)
    {
        const [cx, cy, sx, sy] = def;
        this.triggers.push({
            minX: cx - sx / 2, maxX: cx + sx / 2,
            top: cy - sy / 2,
            kind, index,
        });
    }

    private buildWorld()
    {
        // Ground street (visual only — the kill plane is below it).
        const ground = this.add.rectangle(0, KILL_Y + 2, 260, 20, 0x1c1430);
        this.worldContainer.add(ground);

        // Spawn concrete pad
        this.addPlatform(SPAWN, 0x4a4552, 0x6b6472);

        // Danfo rooftops — Lagos bus yellow with darker trim
        for (const d of DANFOS) this.addPlatform(d, 0xe8b420, 0xc98d12);

        // Shipping containers — rust + blue + amber stack
        this.addPlatform(CONTAINERS[0], 0x8a3b1e, 0xa8512c);
        this.addPlatform(CONTAINERS[1], 0x274c77, 0x3a6ea5);

        // Market planks — wood tones
        this.addPlatform(MARKET[0], 0x7a5230, 0x96683c);
        this.addPlatform(MARKET[1], 0x6b4423, 0x8a5a2e);

        // Shrine platform
        this.addPlatform(SHRINE, 0x514a63, 0xe5a93c);

        // Checkpoint stone plinths (visual) + triggers
        CHECKPOINTS.forEach((cp, i) =>
        {
            const [x, top] = cp.pos;
            const plinth = this.add.rectangle(x + 1.6, top + 0.35, 0.9, 0.7, 0x8d8794);
            this.worldContainer.add(plinth);
            const orb = this.add.circle(x + 1.6, top + 0.9, 0.16, 0xe5a93c);
            this.worldContainer.add(orb);
            this.addInvisibleTrigger(cp.trigger, 'checkpoint', i);
        });

        // Enemy catch zone rides on the market platform
        this.addInvisibleTrigger(ENEMY_PATROL, 'enemy', 0);

        // Shrine gate win trigger
        this.addInvisibleTrigger(SHRINE_TRIGGER, 'shrine', 0);
    }

    private buildPlayer()
    {
        this.playerSprite = this.add.container(0, 0);
        const body = this.add.rectangle(0, -PLAYER_HEIGHT / 2, PLAYER_HALF * 2, PLAYER_HEIGHT, 0x3d2b1f);
        const wrap = this.add.ellipse(0, -PLAYER_HEIGHT + 0.28, 0.6, 0.18, 0xe5a93c);
        const face = this.add.rectangle(0, -PLAYER_HEIGHT + 0.42, 0.18, 0.1, 0xf2e3c8);
        this.playerSprite.add([body, wrap, face]);
        this.worldContainer.add(this.playerSprite);
    }

    private buildEnemy()
    {
        this.enemySprite = this.add.container(0, 0);
        const body = this.add.rectangle(0, -0.65, 0.84, 1.3, 0x8f1d1d);
        const head = this.add.circle(0, -1.4, 0.3, 0x520b0b);
        this.enemySprite.add([body, head]);
        this.worldContainer.add(this.enemySprite);
    }

    private buildShrine()
    {
        const postL = this.add.rectangle(53, -2.1, 0.5, 4.2, 0xd99b26);
        const postR = this.add.rectangle(55, -2.1, 0.5, 4.2, 0xd99b26);
        const lintel = this.add.rectangle(54, -4.4, 3.2, 0.55, 0xd99b26);
        this.worldContainer.add([postL, postR, lintel]);

        this.shrineGlow = this.add.image(54, -2, 'fx_glow');
        this.shrineGlow.setScale(2.6, 3.6).setAlpha(0.35).setTint(0xffd874);
        this.worldContainer.add(this.shrineGlow);
        // Arcade body on the gate glow so the physics world is live alongside
        // the kinematic character controller (gravity-free, purely visual).
        this.physics.add.existing(this.shrineGlow);
        (this.shrineGlow.body as Phaser.Physics.Arcade.Body)?.setAllowGravity(false);
    }

    private buildAura()
    {
        this.aura = this.add.particles(0, 0, 'fx_glow', {
            speed: { min: 20, max: 80 },
            angle: { min: 240, max: 300 },
            scale: { start: 0.3, end: 0 },
            alpha: { start: 0.95, end: 0 },
            lifespan: { min: 600, max: 1200 },
            gravityY: -40,
            emitting: false,
        });
        this.aura.setBlendMode(BlendModes.ADD);
        this.worldContainer.add(this.aura);
    }

    // -----------------------------------------------------------------
    // GAME FLOW
    // -----------------------------------------------------------------
    private beginLevel(fromCheckpoint: boolean)
    {
        this.sound.stopAll();
        const cp = fromCheckpoint ? GameManager.getCheckpoint() : null;
        if (cp)
        {
            this.px = cp.x;
            this.py = cp.y - 0.2;
        }
        else
        {
            this.px = 0;
            this.py = -0.2;
        }
        this.vx = 0; this.vy = 0;
        this.ex = ENEMY_START_X; this.ey = ENEMY_PATROL[1] - PLAYER_HEIGHT / 2;
        this.enemyDir = 1;
        this.enemyDispelled = false;
        this.powerActive = false;
        this.powerTimer = 0;
        this.powerCooldown = 0;
        this.powerFired = false;
        this.inputEnabled = false;
        this.introDone = false;
        this.introT = 0;
        this.phase = 'INTRO';
        this.aura.start();
        EventBus.emit(EV.PHASE_CHANGED, 'INTRO' as Phase);
        this.safePlay('sfx_powerup', 0.6);
    }

    private finishIntro()
    {
        if (this.introDone || this.phase !== 'INTRO') return;
        this.introDone = true;
        this.phase = 'PLAYING';
        this.aura.stop();
        EventBus.emit(EV.PHASE_CHANGED, 'PLAYING' as Phase);
        EventBus.emit(EV.BANNER, 'Harness the power, Reach the gate');
        this.time.delayedCall(1500, () =>
        {
            if (this.phase === 'PLAYING')
            {
                this.inputEnabled = true;
                EventBus.emit(EV.BANNER, '');
            }
        });
    }

    private die(reason: DeathReason)
    {
        if (this.phase !== 'PLAYING') return;
        this.phase = 'LOSS';
        this.deathReason = reason;
        this.inputEnabled = false;
        this.aura.stop();
        EventBus.emit(EV.DEATH_REASON, reason);
        EventBus.emit(EV.PHASE_CHANGED, 'LOSS' as Phase);
        this.safePlay('sfx_gameover', 0.8);
    }

    private win()
    {
        if (this.phase !== 'PLAYING') return;
        this.phase = 'WIN';
        this.inputEnabled = false;
        this.aura.stop();
        EventBus.emit(EV.PHASE_CHANGED, 'WIN' as Phase);
        this.safePlay('sfx_win', 0.9);
    }

    private safePlay(key: string, vol = 0.7)
    {
        if (this.cache.audio.exists(key)) this.sound.play(key, { volume: vol });
    }

    // -----------------------------------------------------------------
    // PER-FRAME
    // -----------------------------------------------------------------
    update (time: number, delta: number)
    {
        const dt = Math.min(delta / 1000, 0.05);
        if (this.paused) return;
        const t = time / 1000;

        // Shrine glow pulse (always alive, even in menu)
        if (this.shrineGlow)
        {
            this.shrineGlow.setAlpha(0.28 + Math.sin(t * 2.4) * 0.14);
        }

        if (this.phase === 'INTRO')
        {
            this.introT += dt;
            const k = Math.min(this.introT / 1.5, 1);
            const e = 1 - Math.pow(1 - k, 3); // ease-out cubic
            const cx = 2.2 + (this.px - 2.2) * e;
            const cy = -2.1 + (this.py - 1 - (-2.1)) * e;
            this.cameras.main.scrollX = cx - GAME_WIDTH / 2 / 40;
            this.cameras.main.scrollY = cy + GAME_HEIGHT / 2 / 40;
            if (k >= 1) this.finishIntro();
        }
        else if (this.phase === 'PLAYING')
        {
            this.updatePlayer(dt);
            this.updateEnemy(dt);
            this.updateCamera();
        }
        else if (this.phase === 'MENU')
        {
            this.menuT += dt;
            const a = this.menuT * 0.12;
            this.cameras.main.scrollX = 27 + Math.cos(a) * 30 - GAME_WIDTH / 2 / 40;
            this.cameras.main.scrollY = -9 - Math.sin(a * 0.7) * 2 + GAME_HEIGHT / 2 / 40;
        }

        // Visual sync (world container is NOT flipped; we just negate Y)
        this.playerSprite.x = this.px;
        this.playerSprite.y = this.py;
        this.enemySprite.x = this.ex;
        this.enemySprite.y = this.ey;
        this.aura.x = this.px;
        this.aura.y = this.py;
    }

    private updatePlayer(dt: number)
    {
        // God power (Ogun's Iron Surge) — edge-detected so holding doesn't retrigger
        if (this.keys.F?.isDown || this.keys.SHIFT?.isDown)
        {
            if (!this.powerFired && this.inputEnabled && this.powerCooldown <= 0 && !this.powerActive)
            {
                this.powerActive = true;
                this.powerTimer = POWER_DURATION;
                this.powerCooldown = POWER_COOLDOWN;
                this.aura.start();
                this.safePlay('sfx_powerup', 0.8);
            }
            this.powerFired = true;
        }
        else
        {
            this.powerFired = false;
        }
        if (this.powerActive)
        {
            this.powerTimer -= dt;
            if (this.powerTimer <= 0)
            {
                this.powerActive = false;
                this.aura.stop();
            }
        }
        if (this.powerCooldown > 0) this.powerCooldown -= dt;

        // Power state -> React HUD (throttled)
        const pct = this.powerActive
            ? Math.max(0, Math.min(100, (this.powerTimer / POWER_DURATION) * 100))
            : this.powerCooldown > 0
                ? Math.max(0, Math.min(100, (1 - this.powerCooldown / POWER_COOLDOWN) * 100))
                : 100;
        const rounded = Math.round(pct / 5) * 5;
        if (rounded !== this.lastPowerEmit)
        {
            this.lastPowerEmit = rounded;
            EventBus.emit(EV.POWER_STATE, { active: this.powerActive, pct });
        }

        // Movement input (WASD: A/D horizontal, W/S ignored in 2D side-scroller)
        let ix = 0;
        if (this.inputEnabled)
        {
            if (this.keys.A?.isDown) ix -= 1;
            if (this.keys.D?.isDown) ix += 1;
        }
        if (ix !== 0) this.facing = ix;

        const speed = PLAYER_SPEED * (this.powerActive ? POWER_SPEED_MULT : 1);
        const accel = 14;
        this.vx += (ix * speed - this.vx) * Math.min(accel * dt, 1);

        // Jump
        if (this.inputEnabled && this.keys.SPACE?.isDown && this.onGround)
        {
            this.vy = -JUMP_VELOCITY; // negative Y = up (screen space)
            this.onGround = false;
            this.safePlay('sfx_jump', 0.6);
        }

        // Gravity + integrate (gravity pulls +Y down)
        this.vy += GRAVITY * dt;
        this.px += this.vx * dt;
        this.py += this.vy * dt;

        // World bounds
        this.px = Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X, this.px));

        // Platform resolution (top-face only)
        this.onGround = false;
        for (const p of this.platforms)
        {
            if (this.px > p.minX - PLAYER_HALF && this.px < p.maxX + PLAYER_HALF)
            {
                const feet = this.py;
                if (this.vy >= 0 && feet >= p.top - 0.05 && feet <= p.top + 0.7)
                {
                    this.py = p.top;
                    this.vy = 0;
                    this.onGround = true;
                }
            }
        }

        // Kill plane (fell below the world)
        if (this.py > KILL_Y)
        {
            this.die('FELL_INTO_PIT');
            return;
        }

        // Trigger zones
        for (const tr of this.triggers)
        {
            if (this.px > tr.minX && this.px < tr.maxX &&
                this.py > tr.top - 0.5 && this.py < tr.top + 4)
            {
                if (tr.kind === 'checkpoint')
                {
                    const cp = CHECKPOINTS[tr.index];
                    GameManager.setCheckpoint({ x: cp.pos[0], y: cp.pos[1] });
                    EventBus.emit(EV.CHECKPOINT, tr.index);
                    this.time.delayedCall(1500, () =>
                    {
                        if (this.phase === 'PLAYING') EventBus.emit(EV.CHECKPOINT, -1);
                    });
                    tr.kind = 'checkpoint-done';
                }
                else if (tr.kind === 'enemy')
                {
                    if (this.powerActive)
                    {
                        // Ogun's surge dispels the enforcer
                        this.enemyDispelled = true;
                        this.enemySprite.setVisible(false);
                        tr.kind = 'enemy-done';
                    }
                    else
                    {
                        this.die('CAUGHT_BY_ENEMY');
                        return;
                    }
                }
                else if (tr.kind === 'shrine')
                {
                    this.win();
                    return;
                }
            }
        }
    }

    private updateEnemy(dt: number)
    {
        if (this.enemyDispelled) return;
        // Patrol along the market platform; chase when Kolade is close & on same deck.
        const dx = this.px - this.ex;
        const dist = Math.abs(dx);
        const chasing = dist < ENEMY_CHASE_RANGE && Math.abs(this.py - ENEMY_PATROL[1]) < 2;
        const spd = chasing ? 3.2 : 1.6;
        if (chasing)
        {
            this.ex += Math.sign(dx) * spd * dt;
        }
        else
        {
            this.ex += this.enemyDir * spd * dt;
            if (Math.abs(this.ex - ENEMY_START_X) > 2.6) this.enemyDir *= -1;
        }
        this.ey = ENEMY_PATROL[1] - PLAYER_HEIGHT / 2 - 0.1;
    }

    private updateCamera()
    {
        // Follow player: center on px, keep py slightly above center.
        const targetX = this.px - GAME_WIDTH / 2 / 40;
        const targetY = this.py + GAME_HEIGHT / 2 / 40 - 40;
        this.cameras.main.scrollX += (targetX - this.cameras.main.scrollX) * 0.1;
        this.cameras.main.scrollY += (targetY - this.cameras.main.scrollY) * 0.1;
    }
}

export default StartGame;