import { Scene, Game as PhaserGame, AUTO, Scale, Events } from 'phaser'

export const EventBus = new Events.EventEmitter()

const W = 960, H = 540
const FOCAL = 280
const HORIZON_Y = 170
const BOTTOM_Y = H + 60
const LANE_W = 90
const SPAWN_Z = 1400
const PLAYER_SCREEN_Y = H - 110

type Phase = 'MENU' | 'COUNTDOWN' | 'PLAYING' | 'PAUSED' | 'LOSS'

interface Obstacle {
  lane: number; z: number; type: 'barrier' | 'arch' | 'pit'; alive: boolean; sprite: Phaser.GameObjects.Graphics
}
interface Coin {
  lane: number; z: number; alive: boolean; sprite: Phaser.GameObjects.Graphics
}
interface Powerup {
  lane: number; z: number; type: 'magnet' | 'shield' | 'boost'; alive: boolean; sprite: Phaser.GameObjects.Graphics
}

function proj(laneX: number, z: number) {
  const s = FOCAL / (FOCAL + z)
  return { x: W / 2 + laneX * s, y: HORIZON_Y + (BOTTOM_Y - HORIZON_Y) * s, s }
}

function drawStickman(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, frame: number, mode: 'run' | 'jump' | 'slide' | 'idle', color: number, headband: number, isEnemy: boolean) {
  g.lineStyle(Math.max(2, 4 * s), color, 1)
  const h = 55 * s, bw = 18 * s
  const headR = 9 * s
  let legA = 0, legB = 0, armA = 0, armB = 0, bodyLean = 0, headY = -h
  if (mode === 'run') {
    const t = frame * 0.18
    legA = Math.sin(t) * 0.7; legB = Math.sin(t + Math.PI) * 0.7
    armA = Math.sin(t + Math.PI) * 0.5; armB = Math.sin(t) * 0.5
    bodyLean = isEnemy ? -0.25 : -0.1
    headY = -h + Math.abs(Math.sin(t)) * 3 * s
  } else if (mode === 'jump') {
    legA = -0.8; legB = -0.4; armA = 0.8; armB = 0.6
    bodyLean = -0.15; headY = -h - 8 * s
  } else if (mode === 'slide') {
    legA = 1.2; legB = 1.0; armA = -0.3; armB = -0.5
    bodyLean = 0.6; headY = -h * 0.45
  }
  const hipX = x, hipY = y - h * 0.38
  const shX = hipX + Math.sin(bodyLean) * h * 0.35, shY = hipY - h * 0.35
  const hx = shX + Math.sin(bodyLean) * headR * 1.5, hy = shY + headY + h * 0.35
  g.fillStyle(color, 1); g.fillCircle(hx, hy, headR)
  if (isEnemy) {
    g.fillStyle(0xff2200, 1)
    g.fillCircle(hx - headR * 0.35, hy - headR * 0.1, headR * 0.22)
    g.fillCircle(hx + headR * 0.35, hy - headR * 0.1, headR * 0.22)
    g.lineStyle(Math.max(1, 3 * s), 0xff4400, 1)
    g.beginPath(); g.moveTo(hx - headR * 0.6, hy - headR); g.lineTo(hx - headR * 1.1, hy - headR * 1.6)
    g.moveTo(hx + headR * 0.6, hy - headR); g.lineTo(hx + headR * 1.1, hy - headR * 1.6); g.strokePath()
  } else if (headband > 0) {
    g.fillStyle(headband, 1)
    g.fillRect(hx - headR, hy - headR * 0.3, headR * 2, headR * 0.5)
    const ribbonX = hx - headR * 1.2 - Math.sin(frame * 0.12) * 4 * s
    g.lineStyle(Math.max(1, 2 * s), headband, 1)
    g.beginPath(); g.moveTo(hx - headR, hy - headR * 0.1); g.lineTo(ribbonX, hy + headR * 0.4); g.strokePath()
  }
  g.lineStyle(Math.max(2, 4 * s), color, 1)
  g.beginPath(); g.moveTo(shX, shY); g.lineTo(hipX, hipY); g.strokePath()
  const legLen = h * 0.38
  g.beginPath()
  g.moveTo(hipX, hipY); g.lineTo(hipX + Math.sin(legA) * legLen, hipY + Math.cos(legA) * legLen)
  g.moveTo(hipX, hipY); g.lineTo(hipX + Math.sin(legB) * legLen, hipY + Math.cos(legB) * legLen)
  g.strokePath()
  const armLen = h * 0.32
  g.beginPath()
  g.moveTo(shX, shY); g.lineTo(shX + Math.sin(armA) * armLen, shY + Math.cos(armA) * armLen * 0.7)
  g.moveTo(shX, shY); g.lineTo(shX + Math.sin(armB) * armLen, shY + Math.cos(armB) * armLen * 0.7)
  g.strokePath()
  if (isEnemy) {
    g.lineStyle(Math.max(1, 2 * s), 0xff6600, 1)
    g.beginPath()
    g.moveTo(shX + Math.sin(armA) * armLen, shY + Math.cos(armA) * armLen * 0.7)
    g.lineTo(shX + Math.sin(armA) * armLen * 1.3, shY + Math.cos(armA) * armLen * 0.7 - 4 * s)
    g.moveTo(shX + Math.sin(armB) * armLen, shY + Math.cos(armB) * armLen * 0.7)
    g.lineTo(shX + Math.sin(armB) * armLen * 1.3, shY + Math.cos(armB) * armLen * 0.7 - 4 * s)
    g.strokePath()
  }
}

function drawTrackSeg(g: Phaser.GameObjects.Graphics, zNear: number, zFar: number, curve: number) {
  const wNear = LANE_W * 3 * proj(0, zNear).s
  const wFar = LANE_W * 3 * proj(0, zFar).s
  const pN = proj(curve * zNear * 0.003, zNear)
  const pF = proj(curve * zFar * 0.003, zFar)
  g.fillStyle(0x8b6914, 1)
  g.beginPath()
  g.moveTo(pN.x - wNear / 2, pN.y)
  g.lineTo(pN.x + wNear / 2, pN.y)
  g.lineTo(pF.x + wFar / 2, pF.y)
  g.lineTo(pF.x - wFar / 2, pF.y)
  g.closePath()
  g.fillPath()
  g.fillStyle(0xa07818, 1)
  const capH = Math.max(2, 6 * pN.s)
  g.fillRect(pN.x - wNear / 2, pN.y - capH, wNear, capH)
  g.lineStyle(2, 0xd8b04a, 0.85)
  for (const d of [-0.5, 0.5]) {
    const ln = proj(d * LANE_W, zNear), lf = proj(d * LANE_W, zFar)
    g.beginPath(); g.moveTo(ln.x, ln.y); g.lineTo(lf.x, lf.y); g.strokePath()
  }
  const pillarH = 80 * pF.s
  for (const side of [-1, 1]) {
    const px = pF.x + side * (wFar / 2 + 20 * pF.s)
    g.fillStyle(0x6b4e12, 1)
    g.fillRect(px - 8 * pF.s, pF.y - pillarH, 16 * pF.s, pillarH)
    g.fillStyle(0xd4a017, 1)
    g.fillRect(px - 12 * pF.s, pF.y - pillarH - 10 * pF.s, 24 * pF.s, 10 * pF.s)
    if (Math.floor(zFar / 200) % 2 === 0) {
      g.fillStyle(0xff6600, 0.8 + Math.sin(Date.now() * 0.005) * 0.2)
      g.fillCircle(px, pF.y - pillarH - 14 * pF.s, 6 * pF.s)
    }
  }
}

export class Game extends Scene {
  private phase: Phase = 'MENU'
  private frame = 0
  private distance = 0
  private coins = 0
  private speed = 6
  private baseSpeed = 6
  private lane = 1
  private targetLaneX = 0
  private playerX = 0
  private playerYOff = 0
  private playerMode: 'run' | 'jump' | 'slide' | 'idle' = 'run'
  private jumpV = 0
  private jumping = false
  private sliding = false
  private slideTimer = 0
  private stumbleTimer = 0
  private chaserZ = 180
  private obstacles: Obstacle[] = []
  private coinItems: Coin[] = []
  private powerups: Powerup[] = []
  private magnetTimer = 0
  private shieldActive = false
  private boostTimer = 0
  private trackG!: Phaser.GameObjects.Graphics
  private playerG!: Phaser.GameObjects.Graphics
  private enemyG!: Phaser.GameObjects.Graphics
  private bgG!: Phaser.GameObjects.Graphics
  private curve = 0
  private spawnTimer = 0
  private countdownVal = 3
  private countdownTimer: Phaser.Time.TimerEvent | null = null
  private touchStartX = 0
  private touchStartY = 0
  private pointerDown = false

  constructor() { super('Game') }

  preload() {
    const a = (k: string, p: string) => { if (!this.cache.audio.exists(k)) this.load.audio(k, p) }
    a('sfx_jump', 'assets/audio/sfx_jump.mp3')
    a('sfx_collect', 'assets/audio/sfx_collect.mp3')
    a('sfx_hit', 'assets/audio/sfx_hit.mp3')
    a('sfx_powerup', 'assets/audio/sfx_powerup.mp3')
    a('sfx_gameover', 'assets/audio/sfx_gameover.mp3')
    a('bgm_action', 'assets/audio/bgm_action.mp3')
  }

  create() {
    this.bgG = this.add.graphics().setDepth(0)
    this.trackG = this.add.graphics().setDepth(1)
    this.enemyG = this.add.graphics().setDepth(3)
    this.playerG = this.add.graphics().setDepth(4)
    this.drawBackground()
    // Discrete single-trigger keyboard listeners (one event per press) — replaces the
    // old per-frame isDown polling that caused multiple lane changes per tick.
    this.input.keyboard!.on('keydown-A', () => this.laneAction('left'))
    this.input.keyboard!.on('keydown-LEFT', () => this.laneAction('left'))
    this.input.keyboard!.on('keydown-D', () => this.laneAction('right'))
    this.input.keyboard!.on('keydown-RIGHT', () => this.laneAction('right'))
    this.input.keyboard!.on('keydown-W', () => this.laneAction('jump'))
    this.input.keyboard!.on('keydown-UP', () => this.laneAction('jump'))
    this.input.keyboard!.on('keydown-SPACE', () => this.laneAction('jump'))
    this.input.keyboard!.on('keydown-S', () => this.laneAction('slide'))
    this.input.keyboard!.on('keydown-DOWN', () => this.laneAction('slide'))
    this.input.keyboard!.on('keydown-ESC', () => { if (this.phase === 'PLAYING') this.setPaused(); else if (this.phase === 'PAUSED') this.setPlaying() })
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { this.touchStartX = p.x; this.touchStartY = p.y; this.pointerDown = true })
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!this.pointerDown) return; this.pointerDown = false
      const dx = p.x - this.touchStartX, dy = p.y - this.touchStartY
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) this.laneAction(dx > 0 ? 'right' : 'left')
      else if (dy < -40) this.laneAction('jump')
      else if (dy > 40) this.laneAction('slide')
    })
    EventBus.on('start-game', this.startGame, this)
    EventBus.on('pause', this.setPaused, this)
    EventBus.on('resume', this.setPlaying, this)
    EventBus.on('back-to-menu', this.toMenu, this)
    EventBus.on('lane-action', this.laneAction, this)
    this.events.once('shutdown', () => {
      EventBus.off('start-game', this.startGame, this)
      EventBus.off('pause', this.setPaused, this)
      EventBus.off('resume', this.setPlaying, this)
      EventBus.off('back-to-menu', this.toMenu, this)
      EventBus.off('lane-action', this.laneAction, this)
    })
    this.setMenu()
    EventBus.emit('current-scene-ready', this)
  }

  private setMenu() { this.phase = 'MENU'; EventBus.emit('phase-changed', 'MENU') }
  private toMenu() { this.clearAll(); this.setMenu() }

  private startGame() {
    this.clearAll()
    this.distance = 0; this.coins = 0; this.speed = this.baseSpeed
    this.lane = 1; this.playerX = 0; this.targetLaneX = 0
    this.playerYOff = 0; this.playerMode = 'run'; this.jumping = false; this.sliding = false
    this.slideTimer = 0; this.stumbleTimer = 0; this.chaserZ = 180
    this.magnetTimer = 0; this.shieldActive = false; this.boostTimer = 0
    this.curve = 0; this.spawnTimer = 0
    this.phase = 'COUNTDOWN'; this.countdownVal = 3
    EventBus.emit('phase-changed', 'COUNTDOWN')
    if (this.countdownTimer) this.countdownTimer.remove()
    this.countdownTimer = this.time.addEvent({
      delay: 900, callback: () => {
        this.countdownVal--
        EventBus.emit('countdown-tick', this.countdownVal)
        if (this.countdownVal <= 0) { this.setPlaying() }
      }, repeat: 2
    })
  }

  private setPlaying() {
    if (this.phase === 'PAUSED') { EventBus.emit('phase-changed', 'PLAYING'); this.phase = 'PLAYING'; return }
    this.phase = 'PLAYING'; EventBus.emit('phase-changed', 'PLAYING')
    this.safePlay('bgm_action', true)
  }

  private setPaused() {
    if (this.phase !== 'PLAYING') return
    this.phase = 'PAUSED'; EventBus.emit('phase-changed', 'PAUSED')
    this.sound.pauseAll()
  }

  private setLoss() {
    this.phase = 'LOSS'; EventBus.emit('phase-changed', 'LOSS')
    this.safePlay('sfx_gameover')
    this.sound.stopAll()
    const total = Math.floor(this.distance) + this.coins * 10
    const best = parseInt(localStorage.getItem('temple_best') || '0')
    if (total > best) localStorage.setItem('temple_best', String(total))
    EventBus.emit('score-update', { score: total, coins: this.coins, distance: Math.floor(this.distance), multiplier: 1 })
  }

  private clearAll() {
    this.obstacles.forEach(o => o.sprite.destroy()); this.obstacles = []
    this.coinItems.forEach(c => c.sprite.destroy()); this.coinItems = []
    this.powerups.forEach(p => p.sprite.destroy()); this.powerups = []
    this.sound.stopAll()
  }

  private laneAction(dir: string) {
    if (this.phase !== 'PLAYING') return
    if (dir === 'left' && this.lane > 0) this.lane--
    else if (dir === 'right' && this.lane < 2) this.lane++
    else if (dir === 'jump' && !this.jumping && !this.sliding) {
      this.jumping = true; this.jumpV = -13; this.playerMode = 'jump'; this.safePlay('sfx_jump')
    } else if (dir === 'slide' && !this.jumping) {
      this.sliding = true; this.slideTimer = 38; this.playerMode = 'slide'
    }
    this.targetLaneX = (this.lane - 1) * LANE_W
  }

  private safePlay(key: string, loop = false) {
    if (!this.cache.audio.exists(key)) return
    const existing = this.sound.get(key) as Phaser.Sound.WebAudioSound | null
    if (existing && existing.isPlaying) return
    this.sound.play(key, { loop, volume: loop ? 0.35 : 0.7 })
  }

  private drawBackground() {
    const g = this.bgG; g.clear()
    g.fillGradientStyle(0x0d0520, 0x0d0520, 0x3a1500, 0x3a1500, 1)
    g.fillRect(0, 0, W, H)
    g.fillStyle(0xffcc44, 0.9); g.fillCircle(W * 0.72, HORIZON_Y - 60, 38)
    g.fillStyle(0x1a0a2e, 1)
    for (let i = 0; i < 8; i++) {
      const bx = i * 140 - 40, bh = 60 + (i % 3) * 40
      g.fillTriangle(bx, HORIZON_Y, bx + 70, HORIZON_Y - bh, bx + 140, HORIZON_Y)
    }
    g.fillStyle(0x120820, 1)
    for (let i = 0; i < 12; i++) {
      const tx = i * 90 + 20
      g.fillRect(tx, HORIZON_Y - 30 - (i % 2) * 20, 14, 30 + (i % 2) * 20)
      g.fillCircle(tx + 7, HORIZON_Y - 34 - (i % 2) * 20, 12)
    }
  }

  private spawnRow() {
    const r = Math.random()
    if (r < 0.38) {
      const lane = Math.floor(Math.random() * 3)
      const type = (['barrier', 'arch', 'pit'] as const)[Math.floor(Math.random() * 3)]
      const g = this.add.graphics().setDepth(2)
      this.obstacles.push({ lane, z: SPAWN_Z, type, alive: true, sprite: g })
    }
    if (r > 0.2) {
      const lane = Math.floor(Math.random() * 3)
      for (let i = 0; i < 3; i++) {
        const g = this.add.graphics().setDepth(2)
        this.coinItems.push({ lane, z: SPAWN_Z + i * 90, alive: true, sprite: g })
      }
    }
    if (Math.random() < 0.08) {
      const g = this.add.graphics().setDepth(2)
      this.powerups.push({ lane: Math.floor(Math.random() * 3), z: SPAWN_Z, type: (['magnet', 'shield', 'boost'] as const)[Math.floor(Math.random() * 3)], alive: true, sprite: g })
    }
  }

  private drawObstacle(o: Obstacle) {
    const g = o.sprite; g.clear()
    const lx = (o.lane - 1) * LANE_W + this.curve * o.z * 0.003
    const p = proj(lx, o.z)
    if (p.s < 0.05 || o.z < -50) return
    const w = LANE_W * 0.85 * p.s, h = 40 * p.s
    if (o.type === 'barrier') {
      g.fillStyle(0x7a5230, 1); g.fillRect(p.x - w / 2, p.y - h, w, h)
      g.fillStyle(0x9a6a40, 1); g.fillRect(p.x - w / 2, p.y - h, w, 6 * p.s)
      g.fillStyle(0x5a3a1a, 1); g.fillRect(p.x - w / 2 + 4 * p.s, p.y - h + 10 * p.s, w - 8 * p.s, h - 16 * p.s)
    } else if (o.type === 'arch') {
      const ah = 90 * p.s
      g.fillStyle(0x6b4e2a, 1)
      g.fillRect(p.x - w / 2, p.y - ah, 10 * p.s, ah)
      g.fillRect(p.x + w / 2 - 10 * p.s, p.y - ah, 10 * p.s, ah)
      g.fillRect(p.x - w / 2, p.y - ah, w, 22 * p.s)
      g.fillStyle(0xff5500, 0.8 + Math.sin(Date.now() * 0.008) * 0.2)
      g.fillCircle(p.x, p.y - ah + 11 * p.s, 8 * p.s)
    } else {
      g.fillStyle(0x050308, 1); g.fillRect(p.x - w / 2, p.y - 8 * p.s, w, 10 * p.s)
      g.lineStyle(2 * p.s, 0x3a2510, 1)
      g.strokeRect(p.x - w / 2, p.y - 8 * p.s, w, 10 * p.s)
    }
  }

  private drawCoin(c: Coin) {
    const g = c.sprite; g.clear()
    const lx = (c.lane - 1) * LANE_W + this.curve * c.z * 0.003
    const p = proj(lx, c.z)
    if (p.s < 0.05) return
    const r = 11 * p.s
    const bob = Math.sin(Date.now() * 0.004 + c.z) * 4 * p.s
    g.fillStyle(0xffd700, 1); g.fillCircle(p.x, p.y - 28 * p.s + bob, r)
    g.fillStyle(0xffec80, 1); g.fillCircle(p.x - r * 0.3, p.y - 28 * p.s + bob - r * 0.3, r * 0.35)
    g.lineStyle(2 * p.s, 0xb8860b, 1); g.strokeCircle(p.x, p.y - 28 * p.s + bob, r)
  }

  private drawPowerup(pw: Powerup) {
    const g = pw.sprite; g.clear()
    const lx = (pw.lane - 1) * LANE_W + this.curve * pw.z * 0.003
    const p = proj(lx, pw.z)
    if (p.s < 0.05) return
    const r = 16 * p.s, bob = Math.sin(Date.now() * 0.003) * 5 * p.s
    const col = pw.type === 'magnet' ? 0xff4488 : pw.type === 'shield' ? 0x44aaff : 0x44ff88
    g.fillStyle(col, 0.9); g.fillCircle(p.x, p.y - 34 * p.s + bob, r)
    g.lineStyle(2 * p.s, 0xffffff, 0.8); g.strokeCircle(p.x, p.y - 34 * p.s + bob, r)
    g.fillStyle(0xffffff, 1)
    g.fillCircle(p.x, p.y - 34 * p.s + bob, r * 0.5)
  }

  update(time: number, delta: number) {
    this.frame++
    const dt = Math.min(delta / 16.67, 2)

    if (this.phase === 'PLAYING') {
      this.distance += this.speed * dt * 0.35
      this.speed = this.baseSpeed + Math.min(4, this.distance / 600) + (this.boostTimer > 0 ? 3 : 0)
      this.curve = Math.sin(this.distance * 0.008) * 28

      if (this.jumping) {
        this.playerYOff += this.jumpV * dt; this.jumpV += 0.65 * dt
        if (this.playerYOff >= 0) { this.playerYOff = 0; this.jumping = false; this.playerMode = 'run' }
      }
      if (this.sliding) {
        this.slideTimer -= dt
        if (this.slideTimer <= 0) { this.sliding = false; this.playerMode = 'run' }
      }
      if (this.stumbleTimer > 0) this.stumbleTimer -= dt

      this.playerX += (this.targetLaneX - this.playerX) * 0.18 * dt

      this.magnetTimer = Math.max(0, this.magnetTimer - dt)
      this.boostTimer = Math.max(0, this.boostTimer - dt)

      this.spawnTimer -= dt
      if (this.spawnTimer <= 0) { this.spawnRow(); this.spawnTimer = Math.max(28, 70 - this.distance / 80) }

      this.chaserZ += (this.stumbleTimer > 0 ? -2.5 : 0.4) * dt
      this.chaserZ = Math.max(30, Math.min(260, this.chaserZ))
      EventBus.emit('chaser-distance', { distanceRatio: 1 - this.chaserZ / 260 })

      const pz = 0
      for (const o of this.obstacles) {
        if (!o.alive) continue
        o.z -= this.speed * dt * 3
        if (o.z < -80) { o.alive = false; o.sprite.destroy(); continue }
        this.drawObstacle(o)
        if (o.z < pz + 60 && o.z > pz - 20) {
          const olx = (o.lane - 1) * LANE_W
          if (Math.abs(olx - this.playerX) < LANE_W * 0.65) {
            const hit = (o.type === 'barrier' && !this.jumping) || (o.type === 'arch' && !this.sliding) || (o.type === 'pit' && !this.jumping)
            if (hit && !this.shieldActive) {
              o.alive = false; o.sprite.destroy()
              this.stumbleTimer = 30; this.chaserZ -= 55; this.safePlay('sfx_hit')
              this.cameras.main.shake(120, 0.008)
              if (this.chaserZ <= 35) { this.setLoss(); return }
            } else if (hit && this.shieldActive) {
              o.alive = false; o.sprite.destroy(); this.shieldActive = false
              this.safePlay('sfx_powerup')
            }
          }
        }
      }
      this.obstacles = this.obstacles.filter(o => o.alive)

      for (const c of this.coinItems) {
        if (!c.alive) continue
        c.z -= this.speed * dt * 3
        if (c.z < -80) { c.alive = false; c.sprite.destroy(); continue }
        this.drawCoin(c)
        const clx = (c.lane - 1) * LANE_W
        const magnetRange = this.magnetTimer > 0 ? LANE_W * 1.6 : LANE_W * 0.6
        if (c.z < 80 && c.z > -20 && Math.abs(clx - this.playerX) < magnetRange) {
          c.alive = false; c.sprite.destroy(); this.coins++; this.safePlay('sfx_collect')
        }
      }
      this.coinItems = this.coinItems.filter(c => c.alive)

      for (const pw of this.powerups) {
        if (!pw.alive) continue
        pw.z -= this.speed * dt * 3
        if (pw.z < -80) { pw.alive = false; pw.sprite.destroy(); continue }
        this.drawPowerup(pw)
        const plx = (pw.lane - 1) * LANE_W
        if (pw.z < 70 && pw.z > -20 && Math.abs(plx - this.playerX) < LANE_W * 0.7) {
          pw.alive = false; pw.sprite.destroy(); this.safePlay('sfx_powerup')
          if (pw.type === 'magnet') this.magnetTimer = 360
          else if (pw.type === 'shield') this.shieldActive = true
          else this.boostTimer = 240
          EventBus.emit('powerup-state', { magnet: this.magnetTimer, shield: this.shieldActive, boost: this.boostTimer })
        }
      }
      this.powerups = this.powerups.filter(p => p.alive)

      const total = Math.floor(this.distance) + this.coins * 10
      if (this.frame % 6 === 0) EventBus.emit('score-update', { score: total, coins: this.coins, distance: Math.floor(this.distance), multiplier: this.boostTimer > 0 ? 2 : 1 })
    }

    this.trackG.clear()
    const segCount = 22
    for (let i = segCount - 1; i >= 0; i--) {
      const zFar = i * 80 + (this.distance * 3 % 80)
      const zNear = zFar - 80
      if (zNear < -40) continue
      drawTrackSeg(this.trackG, Math.max(0, zNear), zFar, this.curve)
    }

    this.playerG.clear()
    if (this.phase !== 'MENU') {
      const mode = this.stumbleTimer > 0 && this.frame % 8 < 4 ? 'idle' : this.playerMode
      drawStickman(this.playerG, W / 2 + this.playerX * proj(0, 0).s, PLAYER_SCREEN_Y + this.playerYOff, 1.4, this.frame, mode, 0xf5deb3, 0xffd700, false)
      if (this.shieldActive) {
        this.playerG.lineStyle(3, 0x44aaff, 0.7)
        this.playerG.strokeCircle(W / 2 + this.playerX, PLAYER_SCREEN_Y + this.playerYOff - 40, 50)
      }
    }

    this.enemyG.clear()
    if (this.phase !== 'MENU' && this.chaserZ > 0) {
      const ep = proj(this.playerX * 0.6, this.chaserZ)
      drawStickman(this.enemyG, ep.x, ep.y + (BOTTOM_Y - ep.y) * 0.02, ep.s * 1.5, this.frame, 'run', 0x1a1a2e, 0, true)
    }
  }
}

export const StartGame = (parent: string) => {
  const game = new PhaserGame({
    type: AUTO, width: W, height: H, parent,
    backgroundColor: '#0d0520',
    scale: { mode: Scale.FIT, autoCenter: Scale.CENTER_BOTH },
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 } } },
    scene: [Game]
  })
  if (typeof window !== 'undefined') {
    (window as any).__PHASER_GAME__ = game
    ;(window as any).__PHASER_EVENT_BUS__ = EventBus
  }
  return game
}