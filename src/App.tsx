import { useLayoutEffect, useRef, useState, useEffect } from 'react'
import { StartGame, EventBus } from './game/main'
import type { Game } from './game/main'

type Phase = 'MENU' | 'COUNTDOWN' | 'PLAYING' | 'PAUSED' | 'LOSS'

interface ScoreData { score: number; coins: number; distance: number; multiplier: number }

function best(): number { return parseInt(localStorage.getItem('temple_best') || '0') }

export default function App() {
  const gameRef = useRef<ReturnType<typeof StartGame> | null>(null)
  const sceneRef = useRef<Game | null>(null)
  const [phase, setPhase] = useState<Phase>('MENU')
  const [score, setScore] = useState<ScoreData>({ score: 0, coins: 0, distance: 0, multiplier: 1 })
  const [danger, setDanger] = useState(0)
  const [countdown, setCountdown] = useState(3)
  const [highScore, setHighScore] = useState(best())
  const [muted, setMuted] = useState(false)
  const [booted, setBooted] = useState(false)

  useLayoutEffect(() => {
    const g = StartGame('game-container')
    gameRef.current = g
    return () => { g.destroy(true); gameRef.current = null }
  }, [])

  useEffect(() => {
    const onPhase = (p: Phase) => { setPhase(p); if (p === 'LOSS') setHighScore(best()) }
    const onScore = (d: ScoreData) => setScore(d)
    const onDanger = (d: { distanceRatio: number }) => setDanger(d.distanceRatio)
    const onTick = (v: number) => setCountdown(v)
    const onReady = (s: Game) => { sceneRef.current = s; setBooted(true) }
    EventBus.on('phase-changed', onPhase)
    EventBus.on('score-update', onScore)
    EventBus.on('chaser-distance', onDanger)
    EventBus.on('countdown-tick', onTick)
    EventBus.on('current-scene-ready', onReady)
    return () => {
      EventBus.off('phase-changed', onPhase)
      EventBus.off('score-update', onScore)
      EventBus.off('chaser-distance', onDanger)
      EventBus.off('countdown-tick', onTick)
      EventBus.off('current-scene-ready', onReady)
    }
  }, [])

  const start = () => EventBus.emit('start-game')
  const pause = () => EventBus.emit('pause')
  const resume = () => EventBus.emit('resume')
  const toMenu = () => EventBus.emit('back-to-menu')
  const lane = (d: 'left' | 'right' | 'jump' | 'slide') => EventBus.emit('lane-action', d)
  const toggleMute = () => {
    const g = gameRef.current
    if (!g) return
    g.sound.mute = !g.sound.mute
    setMuted(g.sound.mute)
  }

  const dangerPulse = danger > 0.7
  const dangerColor = danger > 0.8 ? '#ff2200' : danger > 0.5 ? '#ff8800' : '#44ff88'

  return (
    <div id="app">
      <div id="game-container" />

      {/* HUD */}
      {phase === 'PLAYING' && (
        <div className="hud">
          <div className="hud-left">
            <div className="hud-chip"><span className="hud-label">DIST</span><span className="hud-val">{score.distance}m</span></div>
            <div className="hud-chip gold"><span className="hud-label">GOLD</span><span className="hud-val">{score.coins}</span></div>
            {score.multiplier > 1 && <div className="hud-chip boost">×{score.multiplier}</div>}
          </div>
          <div className="hud-right">
            <div className="hud-chip"><span className="hud-label">SCORE</span><span className="hud-val">{score.score}</span></div>
            <button className="icon-btn" onClick={toggleMute} aria-label="Mute">{muted ? '🔇' : '🔊'}</button>
            <button className="icon-btn" onClick={pause} aria-label="Pause">⏸</button>
          </div>
          <div className={`danger-bar${dangerPulse ? ' pulse' : ''}`}>
            <div className="danger-fill" style={{ width: `${Math.round(danger * 100)}%`, background: dangerColor }} />
            <span className="danger-label">CHASER</span>
          </div>
          {/* Touch controls */}
          <div className="touch-row">
            <button className="tbtn" onPointerDown={() => lane('left')}>◀</button>
            <button className="tbtn tbtn-jump" onPointerDown={() => lane('jump')}>▲ JUMP</button>
            <button className="tbtn tbtn-slide" onPointerDown={() => lane('slide')}>▼ SLIDE</button>
            <button className="tbtn" onPointerDown={() => lane('right')}>▶</button>
          </div>
        </div>
      )}

      {/* MENU */}
      {phase === 'MENU' && (
        <div className="overlay menu-overlay">
          <div className="menu-card">
            <div className="menu-stickman">🏃</div>
            <h1 className="title">TEMPLE ESCAPE</h1>
            <p className="subtitle">KOLADE'S RUN</p>
            <div className="menu-stats">
              <span>BEST <strong>{highScore}</strong></span>
            </div>
            <button className="btn-primary" onClick={start} disabled={!booted}>▶ START RUN</button>
            <div className="controls-hint">
              <p>← → or A/D — Switch Lane</p>
              <p>↑ / W / Space — Jump &nbsp;·&nbsp; ↓ / S — Slide</p>
              <p>Swipe on mobile &nbsp;·&nbsp; ESC — Pause</p>
            </div>
          </div>
        </div>
      )}

      {/* COUNTDOWN */}
      {phase === 'COUNTDOWN' && (
        <div className="overlay countdown-overlay">
          <div className="countdown-num">{countdown > 0 ? countdown : 'RUN!'}</div>
          <div className="countdown-sub">The Shadow is closing in…</div>
        </div>
      )}

      {/* PAUSED */}
      {phase === 'PAUSED' && (
        <div className="overlay pause-overlay">
          <div className="pause-card">
            <h2>PAUSED</h2>
            <button className="btn-primary" onClick={resume}>▶ RESUME</button>
            <button className="btn-secondary" onClick={start}>↺ RESTART</button>
            <button className="btn-ghost" onClick={toMenu}>✕ QUIT TO MENU</button>
          </div>
        </div>
      )}

      {/* LOSS */}
      {phase === 'LOSS' && (
        <div className="overlay loss-overlay">
          <div className="loss-card">
            <div className="loss-icon">💀</div>
            <h2>CAUGHT BY THE SHADOW</h2>
            <div className="loss-stats">
              <div><span>DISTANCE</span><strong>{score.distance}m</strong></div>
              <div><span>GOLD</span><strong>{score.coins}</strong></div>
              <div><span>SCORE</span><strong>{score.score}</strong></div>
              <div className={score.score >= highScore ? 'new-best' : ''}><span>BEST</span><strong>{highScore}</strong></div>
            </div>
            <button className="btn-primary" onClick={start}>↺ RUN AGAIN</button>
            <button className="btn-ghost" onClick={toMenu}>MENU</button>
          </div>
        </div>
      )}
    </div>
  )
}
