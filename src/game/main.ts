// ---------------------------------------------------------------------------
// OMO ORISHA — A Lagos Saga
// 2D side-scrolling platformer with combat mechanics in Phaser 4.
// Features: Kolade hero with multi-frame spritesheets (idle, run, punch, surge),
// enemy enforcers with walk/hurt/defeat animations, Lagos vehicles (Danfo bus,
// Keke Napep, sedans, trucks), NPC passersby, and Orisha shrine gate.
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
    HEALTH_STATE: 'health-state',
    BANNER: 'banner',
    PAUSE: 'pause',
    RESUME: 'resume',
    BACK_TO_MENU: 'back-to-menu',
    ATTACK_ACTION: 'attack-action',
    CURRENT_SCENE_READY: 'current-scene-ready',
} as const;

export type Phase = 'MENU' | 'INTRO' | 'PLAYING' | 'WIN' | 'LOSS';
export type DeathReason = 'FELL_INTO_PIT' | 'CAUGHT_BY_ENEMY';

// ---------------------------------------------------------------------------
// GAME MANAGER — checkpoint / save persistence
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
// planks, checkpoints (stone plinths), enemies, shrine gate goal.
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

const ENEMY_PATROLS: BoxDef[] = [
    [39, -1.5, 7, 3],
    [46.5, -2, 6, 4],
];
const ENEMY_START_POSITIONS = [37, 44];
const ENEMY_CHASE_RANGE = 7;
const SHRINE_TRIGGER: BoxDef = [54, -1.8, 3.5, 4];

const WORLD_MIN_X = -62;
const WORLD_MAX_X = 62;
const KILL_Y = 10;

// Player kinematics
const PLAYER_SPEED = 7.5;
const JUMP_VELOCITY = 10;
const GRAVITY = 24;
const POWER_DURATION = 3;
const POWER_COOLDOWN = 6;
const POWER_SPEED_MULT = 1.6;
const PLAYER_HALF = 0.4;
const PLAYER_HEIGHT = 1.6;
const PLAYER_MAX_HP = 100;
const ATTACK_RANGE = 1.8;
const ATTACK_DAMAGE = 35;
const SURGE_DAMAGE = 100;

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

type EnemyState = 'patrol' | 'chase' | 'hurt' | 'defeated';
interface Enemy {
    x: number;
    y: number;
    dir: number;
    hp: number;
    state: EnemyState;
    patrolIndex: number;
    sprite: Phaser.GameObjects.Container;
    body: Phaser.GameObjects.Rectangle;
    head: Phaser.GameObjects.Arc;
}

interface NPC {
    x: number;
    y: number;
    sprite: Phaser.GameObjects.Container;
    bobPhase: number;
}

export class Game extends Scene
{
    // world / visuals
    private worldContainer!: Phaser.GameObjects.Container;
    private platforms: Platform[] = [];
    private triggers: Trigger[] = [];
    private playerSprite!: Phaser.GameObjects.Container;
    private playerBody!: Phaser.GameObjects.Sprite;
    private enemies: Enemy[] = [];
    private npcs: NPC[] = [];
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
    private hp = PLAYER_MAX_HP;
    private attackCooldown = 0;
    private isAttacking = false;
    private attackType: 'punch' | 'surge' | null = null;
    private attackTimer = 0;
    private lastAnimState = 'idle';

    // sequence state
    private phase: Phase = 'MENU';
    private paused = false;
    private deathReason: DeathReason = 'FELL_INTO_PIT';
    private introDone = false;
    private introT = 0;
    private lastPowerEmit = -1;
    private lastHpEmit = -1;

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
        this.load.audio('sfx_hit', 'assets/audio/sfx_hit.mp3');
        this.load.image('fx_glow', 'assets/fx/glow.png');
        this.load.image('fx_spark', 'assets/fx/spark.png');
    }

    create ()
    {
        // Generate all procedural sprite textures
        this.generatePlayerTextures();
        this.generateEnemyTextures();
        this.generateVehicleTextures();
        this.generateNPCTextures();
        this.generateShrineTextures();

        // Gradient sky
        const sky = this.add.graphics();
        sky.fillGradientStyle(0x120b24, 0x120b24, 0x963816, 0x963816, 1);
        sky.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        sky.setScrollFactor(0);
        sky.setDepth(-100);

        // Parallax skyline layers
        this.buildSkyline(0.15, 0x1b1230, 0.5);
        this.buildSkyline(0.35, 0x241a3a, 0.75);
        this.buildSkyline(0.6, 0x2a1f42, 1);

        // World container
        this.worldContainer = this.add.container(0, 0);
        this.worldContainer.setDepth(0);

        this.buildWorld();
        this.buildPlayer();
        this.buildEnemies();
        this.buildNPCs();
        this.buildShrine();
        this.buildAura();

        // Phaser input (keyboard) + audio
        this.keys = this.input.keyboard!.addKeys('W,A,S,D,SPACE,F,SHIFT,J,K,Z,X,E,ARROW_LEFT,ARROW_RIGHT,ARROW_UP,ARROW_DOWN') as Record<string, Phaser.Input.Keyboard.Key>;
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
        const onAttackAction = (type: 'punch' | 'surge') =>
        {
            if (this.inputEnabled && this.phase === 'PLAYING')
            {
                this.performAttack(type);
            }
        };

        EventBus.on(EV.START_GAME, onStart);
        EventBus.on(EV.SKIP_INTRO, onSkip);
        EventBus.on(EV.PAUSE, onPause);
        EventBus.on(EV.RESUME, onResume);
        EventBus.on(EV.BACK_TO_MENU, onBackToMenu);
        EventBus.on(EV.ATTACK_ACTION, onAttackAction);

        this.events.once('shutdown', () =>
        {
            EventBus.off(EV.START_GAME, onStart);
            EventBus.off(EV.SKIP_INTRO, onSkip);
            EventBus.off(EV.PAUSE, onPause);
            EventBus.off(EV.RESUME, onResume);
            EventBus.off(EV.BACK_TO_MENU, onBackToMenu);
            EventBus.off(EV.ATTACK_ACTION, onAttackAction);
            this.time.removeAllEvents();
            this.tweens.killAll();
            this.input.keyboard?.removeAllListeners();
            this.sound.stopAll();
        });

        // Boot into MENU
        this.phase = 'MENU';
        EventBus.emit(EV.PHASE_CHANGED, 'MENU' as Phase);
        EventBus.emit(EV.CURRENT_SCENE_READY, this);
    }

    // -----------------------------------------------------------------
    // PROCEDURAL TEXTURE GENERATORS
    // -----------------------------------------------------------------
    private generatePlayerTextures()
    {
        // Kolade idle frame
        const idle = this.add.graphics();
        idle.fillStyle(0x3d2b1f, 1); // dark brown body
        idle.fillRect(-16, -64, 32, 64);
        idle.fillStyle(0xe5a93c, 1); // amber wrap
        idle.fillEllipse(0, -64, 40, 12);
        idle.fillStyle(0xf2e3c8, 1); // face
        idle.fillRect(-8, -58, 16, 10);
        idle.generateTexture('kolade_idle', 64, 80);
        idle.destroy();

        // Kolade run frames (4-frame cycle)
        for (let i = 0; i < 4; i++)
        {
            const run = this.add.graphics();
            run.fillStyle(0x3d2b1f, 1);
            run.fillRect(-16, -64, 32, 64);
            run.fillStyle(0xe5a93c, 1);
            run.fillEllipse(0, -64, 40, 12);
            run.fillStyle(0xf2e3c8, 1);
            run.fillRect(-8, -58, 16, 10);
            // Leg swing animation
            const legOffset = Math.sin(i * Math.PI / 2) * 8;
            run.fillStyle(0x2a1f15, 1);
            run.fillRect(-12, 0, 8, 16 + legOffset);
            run.fillRect(4, 0, 8, 16 - legOffset);
            run.generateTexture(`kolade_run_${i}`, 64, 96);
            run.destroy();
        }

        // Kolade punch frame
        const punch = this.add.graphics();
        punch.fillStyle(0x3d2b1f, 1);
        punch.fillRect(-16, -64, 32, 64);
        punch.fillStyle(0xe5a93c, 1);
        punch.fillEllipse(0, -64, 40, 12);
        punch.fillStyle(0xf2e3c8, 1);
        punch.fillRect(-8, -58, 16, 10);
        // Extended arm
        punch.fillStyle(0x3d2b1f, 1);
        punch.fillRect(16, -50, 24, 8);
        punch.fillStyle(0xffa500, 0.6);
        punch.fillCircle(44, -46, 12);
        punch.generateTexture('kolade_punch', 96, 80);
        punch.destroy();

        // Kolade surge frame
        const surge = this.add.graphics();
        surge.fillStyle(0x3d2b1f, 1);
        surge.fillRect(-16, -64, 32, 64);
        surge.fillStyle(0xe5a93c, 1);
        surge.fillEllipse(0, -64, 40, 12);
        surge.fillStyle(0xf2e3c8, 1);
        surge.fillRect(-8, -58, 16, 10);
        // Energy aura
        surge.fillStyle(0xff6600, 0.4);
        surge.fillCircle(0, -32, 48);
        surge.lineStyle(3, 0xffaa00, 0.8);
        surge.strokeCircle(0, -32, 40);
        surge.generateTexture('kolade_surge', 128, 128);
        surge.destroy();

        // (Run-cycle animation is driven manually by swapping kolade_run_0..3
        //  textures in updatePlayer — avoids the load.spritesheet requirement.)
    }

    private generateEnemyTextures()
    {
        // Enforcer patrol frame
        const patrol = this.add.graphics();
        patrol.fillStyle(0x8f1d1d, 1); // dark red body
        patrol.fillRect(-20, -52, 40, 52);
        patrol.fillStyle(0x520b0b, 1); // head
        patrol.fillCircle(0, -60, 16);
        patrol.fillStyle(0xff0000, 1); // glowing eyes
        patrol.fillCircle(-6, -62, 3);
        patrol.fillCircle(6, -62, 3);
        patrol.generateTexture('enemy_patrol', 64, 80);
        patrol.destroy();

        // Enforcer chase frame (leaning forward)
        const chase = this.add.graphics();
        chase.fillStyle(0x8f1d1d, 1);
        chase.fillRect(-20, -52, 40, 52);
        chase.fillStyle(0x520b0b, 1);
        chase.fillCircle(4, -58, 16);
        chase.fillStyle(0xff0000, 1);
        chase.fillCircle(-2, -60, 3);
        chase.fillCircle(10, -60, 3);
        chase.generateTexture('enemy_chase', 64, 80);
        chase.destroy();

        // Enforcer hurt frame (flashing)
        const hurt = this.add.graphics();
        hurt.fillStyle(0xff6666, 1);
        hurt.fillRect(-20, -52, 40, 52);
        hurt.fillStyle(0x520b0b, 1);
        hurt.fillCircle(0, -60, 16);
        hurt.fillStyle(0xffffff, 1);
        hurt.fillCircle(-6, -62, 3);
        hurt.fillCircle(6, -62, 3);
        hurt.generateTexture('enemy_hurt', 64, 80);
        hurt.destroy();

        // Enforcer defeated frame (fading)
        const defeated = this.add.graphics();
        defeated.fillStyle(0x520b0b, 0.3);
        defeated.fillRect(-20, -52, 40, 52);
        defeated.fillStyle(0x2a0505, 0.3);
        defeated.fillCircle(0, -60, 16);
        defeated.generateTexture('enemy_defeated', 64, 80);
        defeated.destroy();
    }

    private generateVehicleTextures()
    {
        // Danfo bus (yellow with black stripes)
        const danfo = this.add.graphics();
        danfo.fillStyle(0xe8b420, 1); // Lagos yellow
        danfo.fillRect(0, 0, 240, 80);
        danfo.fillStyle(0x000000, 1); // black stripes
        danfo.fillRect(0, 20, 240, 8);
        danfo.fillRect(0, 52, 240, 8);
        danfo.fillStyle(0x333333, 1); // windows
        danfo.fillRect(20, 5, 30, 15);
        danfo.fillRect(60, 5, 30, 15);
        danfo.fillRect(100, 5, 30, 15);
        danfo.fillRect(140, 5, 30, 15);
        danfo.fillRect(180, 5, 30, 15);
        danfo.fillStyle(0x222222, 1); // wheels
        danfo.fillCircle(40, 80, 12);
        danfo.fillCircle(200, 80, 12);
        danfo.generateTexture('danfo_bus', 240, 92);
        danfo.destroy();

        // Keke Napep (tricycle)
        const keke = this.add.graphics();
        keke.fillStyle(0xe8b420, 1);
        keke.fillRect(0, 0, 100, 60);
        keke.fillStyle(0x1a1a1a, 1);
        keke.fillRect(0, 10, 100, 30);
        keke.fillStyle(0x222222, 1);
        keke.fillCircle(20, 60, 10);
        keke.fillCircle(80, 60, 10);
        keke.generateTexture('keke_napep', 100, 70);
        keke.destroy();

        // Sedan car
        const sedan = this.add.graphics();
        sedan.fillStyle(0x274c77, 1);
        sedan.fillRect(0, 10, 120, 40);
        sedan.fillStyle(0x3a6ea5, 1);
        sedan.fillRect(20, 0, 80, 20);
        sedan.fillStyle(0x222222, 1);
        sedan.fillCircle(30, 50, 10);
        sedan.fillCircle(90, 50, 10);
        sedan.generateTexture('sedan_car', 120, 60);
        sedan.destroy();

        // Container truck
        const truck = this.add.graphics();
        truck.fillStyle(0x8a3b1e, 1);
        truck.fillRect(40, 0, 160, 70);
        truck.fillStyle(0x2a1f15, 1);
        truck.fillRect(0, 20, 40, 50);
        truck.fillStyle(0x222222, 1);
        truck.fillCircle(20, 70, 12);
        truck.fillCircle(80, 70, 12);
        truck.fillCircle(160, 70, 12);
        truck.generateTexture('container_truck', 200, 82);
        truck.destroy();
    }

    private generateNPCTextures()
    {
        // Market trader woman
        const trader = this.add.graphics();
        trader.fillStyle(0x96683c, 1);
        trader.fillRect(-14, -56, 28, 56);
        trader.fillStyle(0xff69b4, 1); // colorful gele
        trader.fillEllipse(0, -60, 32, 16);
        trader.fillStyle(0xf2e3c8, 1);
        trader.fillRect(-7, -52, 14, 8);
        trader.fillStyle(0x8b4513, 1); // tray
        trader.fillRect(-20, -70, 40, 6);
        trader.generateTexture('npc_trader', 64, 80);
        trader.destroy();

        // Lagos commuter
        const commuter = this.add.graphics();
        commuter.fillStyle(0x4a5568, 1);
        commuter.fillRect(-14, -56, 28, 56);
        commuter.fillStyle(0x1a202c, 1);
        commuter.fillEllipse(0, -60, 28, 12);
        commuter.fillStyle(0xf2e3c8, 1);
        commuter.fillRect(-7, -52, 14, 8);
        commuter.fillStyle(0x000000, 1); // sunglasses
        commuter.fillRect(-8, -48, 16, 4);
        commuter.generateTexture('npc_commuter', 64, 80);
        commuter.destroy();

        // Elder baba
        const elder = this.add.graphics();
        elder.fillStyle(0xffffff, 1); // flowing white robe
        elder.fillRect(-16, -56, 32, 56);
        elder.fillStyle(0x2a1f15, 1); // fila cap
        elder.fillEllipse(0, -62, 26, 10);
        elder.fillStyle(0xf2e3c8, 1);
        elder.fillRect(-7, -52, 14, 8);
        elder.fillStyle(0x654321, 1); // staff
        elder.fillRect(18, -60, 4, 70);
        elder.generateTexture('npc_elder', 64, 80);
        elder.destroy();
    }

    private generateShrineTextures()
    {
        // Shrine gate structure
        const gate = this.add.graphics();
        gate.fillStyle(0xd99b26, 1); // golden wood
        gate.fillRect(0, 0, 320, 16); // lintel
        gate.fillRect(0, 0, 24, 280); // left post
        gate.fillRect(296, 0, 24, 280); // right post
        // Carved details
        gate.fillStyle(0x8b4513, 1);
        for (let i = 0; i < 5; i++)
        {
            gate.fillRect(4, 40 + i * 40, 16, 8);
            gate.fillRect(300, 40 + i * 40, 16, 8);
        }
        // Iron totems
        gate.fillStyle(0x4a4a4a, 1);
        gate.fillRect(80, 16, 8, 100);
        gate.fillRect(232, 16, 8, 100);
        gate.generateTexture('shrine_gate', 320, 280);
        gate.destroy();

        // Lantern
        const lantern = this.add.graphics();
        lantern.fillStyle(0xffa500, 0.8);
        lantern.fillCircle(0, 0, 12);
        lantern.lineStyle(2, 0xff6600, 1);
        lantern.strokeCircle(0, 0, 10);
        lantern.generateTexture('lantern', 24, 24);
        lantern.destroy();
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
        const front = this.add.rectangle(cx, topY + sy / 2, sx, sy, color);
        this.worldContainer.add(front);
        if (capColor !== undefined)
        {
            const cap = this.add.rectangle(cx, topY - 0.06, sx + 0.06, 0.12, capColor);
            this.worldContainer.add(cap);
        }
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
        const ground = this.add.rectangle(0, KILL_Y + 2, 260, 20, 0x1c1430);
        this.worldContainer.add(ground);

        this.addPlatform(SPAWN, 0x4a4552, 0x6b6472);

        for (const d of DANFOS) this.addPlatform(d, 0xe8b420, 0xc98d12);

        this.addPlatform(CONTAINERS[0], 0x8a3b1e, 0xa8512c);
        this.addPlatform(CONTAINERS[1], 0x274c77, 0x3a6ea5);

        this.addPlatform(MARKET[0], 0x7a5230, 0x96683c);
        this.addPlatform(MARKET[1], 0x6b4423, 0x8a5a2e);

        this.addPlatform(SHRINE, 0x514a63, 0xe5a93c);

        CHECKPOINTS.forEach((cp, i) =>
        {
            const [x, top] = cp.pos;
            const plinth = this.add.rectangle(x + 1.6, top + 0.35, 0.9, 0.7, 0x8d8794);
            this.worldContainer.add(plinth);
            const orb = this.add.circle(x + 1.6, top + 0.9, 0.16, 0xe5a93c);
            this.worldContainer.add(orb);
            this.addInvisibleTrigger(cp.trigger, 'checkpoint', i);
        });

        ENEMY_PATROLS.forEach((patrol, i) =>
        {
            this.addInvisibleTrigger(patrol, 'enemy', i);
        });

        this.addInvisibleTrigger(SHRINE_TRIGGER, 'shrine', 0);
    }

    private buildPlayer()
    {
        this.playerSprite = this.add.container(0, 0);
        this.playerBody = this.add.sprite(0, 0, 'kolade_idle');
        this.playerBody.setOrigin(0.5, 1);
        this.playerSprite.add(this.playerBody);
        this.worldContainer.add(this.playerSprite);
    }

    private buildEnemies()
    {
        ENEMY_START_POSITIONS.forEach((startX, i) =>
        {
            const patrol = ENEMY_PATROLS[i];
            const enemy: Enemy = {
                x: startX,
                y: patrol[1] - PLAYER_HEIGHT / 2,
                dir: 1,
                hp: 100,
                state: 'patrol',
                patrolIndex: i,
                sprite: this.add.container(startX, patrol[1] - PLAYER_HEIGHT / 2),
                body: this.add.rectangle(0, 0, 0.84, 1.3, 0x8f1d1d),
                head: this.add.circle(0, -0.75, 0.3, 0x520b0b),
            };

            // Replace rectangles with sprites
            enemy.sprite.removeAll(true);
            const enemySprite = this.add.sprite(0, 0, 'enemy_patrol');
            enemySprite.setOrigin(0.5, 1);
            enemy.sprite.add(enemySprite);

            this.worldContainer.add(enemy.sprite);
            this.enemies.push(enemy);
        });
    }

    private buildNPCs()
    {
        const npcPositions = [
            { x: 39, y: -1.5, type: 'trader' },
            { x: 42, y: -1.5, type: 'commuter' },
            { x: 46, y: -2, type: 'elder' },
        ];

        npcPositions.forEach(pos =>
        {
            const npc: NPC = {
                x: pos.x,
                y: pos.y,
                bobPhase: Math.random() * Math.PI * 2,
                sprite: this.add.container(pos.x, pos.y),
            };

            const npcSprite = this.add.sprite(0, 0, `npc_${pos.type}`);
            npcSprite.setOrigin(0.5, 1);
            npc.sprite.add(npcSprite);

            this.worldContainer.add(npc.sprite);
            this.npcs.push(npc);
        });
    }

    private buildShrine()
    {
        const gateSprite = this.add.image(54, -2, 'shrine_gate');
        gateSprite.setOrigin(0.5, 1);
        gateSprite.setAlpha(0.9);
        this.worldContainer.add(gateSprite);

        this.shrineGlow = this.add.image(54, -2, 'fx_glow');
        this.shrineGlow.setScale(2.6, 3.6).setAlpha(0.35).setTint(0xffd874);
        this.worldContainer.add(this.shrineGlow);
        this.physics.add.existing(this.shrineGlow);
        (this.shrineGlow.body as Phaser.Physics.Arcade.Body)?.setAllowGravity(false);

        // Add lanterns
        for (let i = 0; i < 3; i++)
        {
            const lantern = this.add.image(52 + i * 2, -3.5, 'lantern');
            lantern.setAlpha(0.7 + Math.random() * 0.3);
            this.worldContainer.add(lantern);
        }
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
        this.hp = PLAYER_MAX_HP;
        this.lastHpEmit = -1;
        this.powerActive = false;
        this.powerTimer = 0;
        this.powerCooldown = 0;
        this.powerFired = false;
        this.attackCooldown = 0;
        this.isAttacking = false;
        this.attackType = null;
        this.inputEnabled = false;
        this.introDone = false;
        this.introT = 0;
        this.phase = 'INTRO';

        // Reset enemies
        this.enemies.forEach((enemy, i) =>
        {
            const patrol = ENEMY_PATROLS[i];
            enemy.x = ENEMY_START_POSITIONS[i];
            enemy.y = patrol[1] - PLAYER_HEIGHT / 2;
            enemy.dir = 1;
            enemy.hp = 100;
            enemy.state = 'patrol';
            enemy.sprite.setVisible(true);
            enemy.sprite.setAlpha(1);
        });

        this.aura.start();
        EventBus.emit(EV.PHASE_CHANGED, 'INTRO' as Phase);
        EventBus.emit(EV.HEALTH_STATE, { hp: this.hp, maxHp: PLAYER_MAX_HP });
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

    private performAttack(type: 'punch' | 'surge')
    {
        if (this.attackCooldown > 0) return;

        this.isAttacking = true;
        this.attackType = type;
        this.attackTimer = type === 'punch' ? 0.3 : 0.5;
        this.attackCooldown = type === 'punch' ? 0.5 : 1.2;

        this.playerBody.setTexture(type === 'punch' ? 'kolade_punch' : 'kolade_surge');
        this.playerBody.setOrigin(0.5, 1);

        // Check for enemy hits
        this.enemies.forEach(enemy =>
        {
            if (enemy.state === 'defeated') return;

            const dx = enemy.x - this.px;
            const dy = enemy.y - this.py;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < ATTACK_RANGE && Math.sign(dx) === this.facing)
            {
                const damage = type === 'surge' ? SURGE_DAMAGE : ATTACK_DAMAGE;
                enemy.hp -= damage;
                enemy.state = 'hurt';
                enemy.sprite.setAlpha(0.6);
                this.safePlay('sfx_hit', 0.7);

                // Knockback
                enemy.x += this.facing * 0.5;

                if (enemy.hp <= 0)
                {
                    enemy.state = 'defeated';
                    this.tweens.add({
                        targets: enemy.sprite,
                        alpha: 0,
                        duration: 800,
                        onComplete: () => enemy.sprite.setVisible(false),
                    });
                }
            }
        });
    }

    // -----------------------------------------------------------------
    // PER-FRAME
    // -----------------------------------------------------------------
    update (time: number, delta: number)
    {
        const dt = Math.min(delta / 1000, 0.05);
        if (this.paused) return;
        const t = time / 1000;

        // Shrine glow pulse
        if (this.shrineGlow)
        {
            this.shrineGlow.setAlpha(0.28 + Math.sin(t * 2.4) * 0.14);
        }

        // NPC bobbing
        this.npcs.forEach(npc =>
        {
            npc.bobPhase += dt * 2;
            const bob = Math.sin(npc.bobPhase) * 0.05;
            npc.sprite.y = npc.y + bob;
        });

        if (this.phase === 'INTRO')
        {
            this.introT += dt;
            const k = Math.min(this.introT / 10, 1);
            const e = 1 - Math.pow(1 - k, 3);
            const cx = 2.2 + (this.px - 2.2) * e;
            const cy = -2.1 + (this.py - 1 - (-2.1)) * e;
            this.cameras.main.scrollX = cx - GAME_WIDTH / 2 / 40;
            this.cameras.main.scrollY = cy + GAME_HEIGHT / 2 / 40;
            if (k >= 1) this.finishIntro();
        }
        else if (this.phase === 'PLAYING')
        {
            this.updatePlayer(dt);
            this.updateEnemies(dt);
            this.updateCamera();
        }
        else if (this.phase === 'MENU')
        {
            this.menuT += dt;
            const a = this.menuT * 0.12;
            this.cameras.main.scrollX = 27 + Math.cos(a) * 30 - GAME_WIDTH / 2 / 40;
            this.cameras.main.scrollY = -9 - Math.sin(a * 0.7) * 2 + GAME_HEIGHT / 2 / 40;
        }

        // Visual sync
        this.playerSprite.x = this.px;
        this.playerSprite.y = this.py;
        this.aura.x = this.px;
        this.aura.y = this.py;
    }

    private updatePlayer(dt: number)
    {
        // Attack timer
        if (this.attackTimer > 0)
        {
            this.attackTimer -= dt;
            if (this.attackTimer <= 0)
            {
                this.isAttacking = false;
                this.attackType = null;
                this.playerBody.setTexture('kolade_idle');
            }
        }

        // Attack cooldown
        if (this.attackCooldown > 0)
        {
            this.attackCooldown -= dt;
        }

        // Combat input (J = punch, K = surge)
        if (this.inputEnabled && !this.isAttacking)
        {
            if (this.keys.J?.isDown || this.keys.Z?.isDown)
            {
                this.performAttack('punch');
            }
            else if (this.keys.K?.isDown || this.keys.X?.isDown)
            {
                this.performAttack('surge');
            }
        }

        // Power (Ogun's Iron Surge)
        if (this.keys.F?.isDown || this.keys.SHIFT?.isDown || this.keys.E?.isDown)
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

        // Power state -> React HUD
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

        // Health state -> React HUD
        const hpRounded = Math.round(this.hp / 10) * 10;
        if (hpRounded !== this.lastHpEmit)
        {
            this.lastHpEmit = hpRounded;
            EventBus.emit(EV.HEALTH_STATE, { hp: this.hp, maxHp: PLAYER_MAX_HP });
        }

        // Movement input (WASD + Arrow keys)
        let ix = 0;
        if (this.inputEnabled)
        {
            if (this.keys.A?.isDown || this.keys.ARROW_LEFT?.isDown) ix -= 1;
            if (this.keys.D?.isDown || this.keys.ARROW_RIGHT?.isDown) ix += 1;
        }
        if (ix !== 0) this.facing = ix;

        const speed = PLAYER_SPEED * (this.powerActive ? POWER_SPEED_MULT : 1);
        const accel = 14;
        this.vx += (ix * speed - this.vx) * Math.min(accel * dt, 1);

        // Jump (SPACE, W, or ARROW_UP)
        if (this.inputEnabled && (this.keys.SPACE?.isDown || this.keys.W?.isDown || this.keys.ARROW_UP?.isDown) && this.onGround)
        {
            this.vy = -JUMP_VELOCITY;
            this.onGround = false;
            this.safePlay('sfx_jump', 0.6);
        }

        // Gravity + integrate
        this.vy += GRAVITY * dt;
        this.px += this.vx * dt;
        this.py += this.vy * dt;

        // World bounds
        this.px = Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X, this.px));

        // Platform resolution
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

        // Kill plane
        if (this.py > KILL_Y)
        {
            this.die('FELL_INTO_PIT');
            return;
        }

        // Animation state — manual texture cycling (no Phaser anims).
        if (!this.isAttacking)
        {
            if (Math.abs(this.vx) > 0.5 && this.onGround)
            {
                const frame = Math.floor(this.time.now / 110) % 4;
                const key = 'kolade_run_' + frame;
                if (this.lastAnimState !== 'run' || (this.playerBody.texture && this.playerBody.texture.key !== key))
                {
                    this.playerBody.setTexture(key);
                    this.lastAnimState = 'run';
                }
            }
            else if (this.lastAnimState !== 'idle')
            {
                this.playerBody.setTexture('kolade_idle');
                this.lastAnimState = 'idle';
            }
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
                    // Check if any enemy in this patrol zone is still alive
                    const enemyInZone = this.enemies.find(e => e.patrolIndex === tr.index && e.state !== 'defeated');
                    if (enemyInZone)
                    {
                        if (this.powerActive)
                        {
                            enemyInZone.state = 'defeated';
                            this.tweens.add({
                                targets: enemyInZone.sprite,
                                alpha: 0,
                                duration: 800,
                                onComplete: () => enemyInZone.sprite.setVisible(false),
                            });
                        }
                        else
                        {
                            this.hp -= 20;
                            if (this.hp <= 0)
                            {
                                this.die('CAUGHT_BY_ENEMY');
                                return;
                            }
                        }
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

    private updateEnemies(dt: number)
    {
        this.enemies.forEach(enemy =>
        {
            if (enemy.state === 'defeated') return;

            const patrol = ENEMY_PATROLS[enemy.patrolIndex];
            const dx = this.px - enemy.x;
            const dist = Math.abs(dx);
            const chasing = dist < ENEMY_CHASE_RANGE && Math.abs(this.py - patrol[1]) < 2;

            if (chasing && enemy.state !== 'hurt')
            {
                enemy.state = 'chase';
                const spd = 3.2;
                enemy.x += Math.sign(dx) * spd * dt;
            }
            else if (!chasing && enemy.state !== 'hurt')
            {
                enemy.state = 'patrol';
                const spd = 1.6;
                enemy.x += enemy.dir * spd * dt;
                if (Math.abs(enemy.x - ENEMY_START_POSITIONS[enemy.patrolIndex]) > 2.6)
                {
                    enemy.dir *= -1;
                }
            }

            if (enemy.state === 'hurt')
            {
                enemy.sprite.setAlpha(0.6);
                this.time.delayedCall(200, () =>
                {
                    if (enemy.state === 'hurt')
                    {
                        enemy.state = 'patrol';
                        enemy.sprite.setAlpha(1);
                    }
                });
            }

            enemy.y = patrol[1] - PLAYER_HEIGHT / 2 - 0.1;
            enemy.sprite.x = enemy.x;
            enemy.sprite.y = enemy.y;

            // Update enemy sprite texture based on state
            const enemySprite = enemy.sprite.list[0] as Phaser.GameObjects.Sprite;
            if (enemySprite && enemySprite.texture)
            {
                const textureKey = enemy.state === 'chase' ? 'enemy_chase' :
                                   enemy.state === 'hurt' ? 'enemy_hurt' :
                                   'enemy_patrol';
                if (enemySprite.texture.key !== textureKey)
                {
                    enemySprite.setTexture(textureKey);
                }
            }
        });
    }

    private updateCamera()
    {
        const targetX = this.px - GAME_WIDTH / 2 / 40;
        const targetY = this.py + GAME_HEIGHT / 2 / 40 - 40;
        this.cameras.main.scrollX += (targetX - this.cameras.main.scrollX) * 0.1;
        this.cameras.main.scrollY += (targetY - this.cameras.main.scrollY) * 0.1;
    }
}

export default StartGame;