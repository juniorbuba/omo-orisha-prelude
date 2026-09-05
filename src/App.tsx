// ---------------------------------------------------------------------------
// OMO ORISHA — React shell.
// Mounts the Phaser + three.js game into #game-container and renders ALL
// primary UI as DOM overlays: title menu, awakening intro slides, HUD
// (power meter, checkpoint toasts, banners), pause, win & loss screens.
// Talks to the scene only through the EventBus (src/game/main.ts).
// ---------------------------------------------------------------------------
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import StartGame, { EventBus, EV, GameManager } from './game/main';
import type { Game, Phase, DeathReason } from './game/main';

export interface IRefPhaserGame
{
    game: Phaser.Game | null;
    scene: Game | null;
}

const INTRO_LINES = [
    { title: 'LAGOS NEVER SLEEPS', body: 'A boy runs the city’s spine — danfo roofs, container stacks, market decks.' },
    { title: 'THE OLD ONES REMEMBER', body: 'Ogun’s iron fire sleeps in his blood. One surge. One road.' },
    { title: 'REACH THE SHRINE GATE', body: 'Step on every ancestor stone. Do not fall. Do not be caught.' },
];

function IconPlay()
{
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}
function IconResume()
{
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 12a8 8 0 1 1 2.6 5.9" />
            <path d="M4 20v-5h5" />
        </svg>
    );
}
function IconPause()
{
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
    );
}
function IconSound({ muted }: { muted: boolean })
{
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
            {muted
                ? <path d="M16 9l5 6M21 9l-5 6" />
                : <><path d="M16.5 8.5a5 5 0 0 1 0 7" /><path d="M19 6a8.5 8.5 0 0 1 0 12" /></>}
        </svg>
    );
}

function App()
{
    const phaserRef = useRef<IRefPhaserGame | null>(null);

    const [phase, setPhase] = useState<Phase | 'PAUSED'>('MENU');
    const [banner, setBanner] = useState('');
    const [checkpoint, setCheckpoint] = useState(-1);
    const [power, setPower] = useState({ active: false, pct: 100 });
    const [deathReason, setDeathReason] = useState<DeathReason>('FELL_INTO_PIT');
    const [muted, setMuted] = useState(false);
    const [hasSave, setHasSave] = useState(false);
    const [introSlide, setIntroSlide] = useState(0);

    //  Mount the Phaser game into #game-container exactly once and destroy
    //  it on unmount. DO NOT remove this effect or the #game-container div.
    useLayoutEffect(() =>
    {
        if (phaserRef.current === null)
        {
            const game = StartGame("game-container");
            phaserRef.current = { game, scene: null };
        }

        const handler = (scene: Game) =>
        {
            if (phaserRef.current)
            {
                phaserRef.current.scene = scene;
            }
        };
        EventBus.on(EV.CURRENT_SCENE_READY, handler);

        return () =>
        {
            EventBus.removeListener(EV.CURRENT_SCENE_READY, handler);
            if (phaserRef.current)
            {
                phaserRef.current.game?.destroy(true);
                phaserRef.current = null;
            }
        };
    }, []);

    //  EventBus -> React state (HUD + screens).
    useEffect(() =>
    {
        const onPhase = (p: Phase) =>
        {
            setPhase(p);
            if (p === 'INTRO') setIntroSlide(0);
            if (p !== 'PLAYING') setBanner('');
        };
        const onBanner = (text: string) => setBanner(text);
        const onCheckpoint = (idx: number) => setCheckpoint(idx);
        const onPower = (s: { active: boolean; pct: number }) => setPower(s);
        const onDeath = (r: DeathReason) => setDeathReason(r);

        EventBus.on(EV.PHASE_CHANGED, onPhase);
        EventBus.on(EV.BANNER, onBanner);
        EventBus.on(EV.CHECKPOINT, onCheckpoint);
        EventBus.on(EV.POWER_STATE, onPower);
        EventBus.on(EV.DEATH_REASON, onDeath);

        return () =>
        {
            EventBus.removeListener(EV.PHASE_CHANGED, onPhase);
            EventBus.removeListener(EV.BANNER, onBanner);
            EventBus.removeListener(EV.CHECKPOINT, onCheckpoint);
            EventBus.removeListener(EV.POWER_STATE, onPower);
            EventBus.removeListener(EV.DEATH_REASON, onDeath);
        };
    }, []);

    //  React-side pause toggle (the scene freezes physics + tweens + sound).
    useEffect(() =>
    {
        const onKey = (e: KeyboardEvent) =>
        {
            if (e.key !== 'Escape') return;
            setPhase((cur) =>
            {
                if (cur === 'PLAYING')
                {
                    EventBus.emit(EV.PAUSE);
                    return 'PAUSED';
                }
                if (cur === 'PAUSED')
                {
                    EventBus.emit(EV.RESUME);
                    return 'PLAYING';
                }
                return cur;
            });
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    //  Intro slides auto-advance while the scene plays the awakening beat.
    useEffect(() =>
    {
        if (phase !== 'INTRO') return;
        const id = window.setInterval(() => setIntroSlide((s) => Math.min(s + 1, INTRO_LINES.length - 1)), 1600);
        return () => window.clearInterval(id);
    }, [phase]);

    useEffect(() => setHasSave(GameManager.hasSavedGame()), [phase]);

    const startGame = (fromCheckpoint: boolean) =>
    {
        EventBus.emit(EV.START_GAME, { fromCheckpoint });
    };

    const toMenu = () =>
    {
        if (phase === 'PAUSED') EventBus.emit(EV.RESUME);
        EventBus.emit(EV.BACK_TO_MENU);
    };

    const toggleMute = () =>
    {
        const game = phaserRef.current?.game;
        if (!game) return;
        game.sound.mute = !game.sound.mute;
        setMuted(game.sound.mute);
    };

    const playing = phase === 'PLAYING' || phase === 'INTRO' || phase === 'PAUSED';

    return (
        <div id="app">
            {/* The Phaser canvas mounts into #game-container (src/game/main.ts). */}
            <div id="game-container"></div>

            <div id="hud">
                {/* ---------- HUD (top bar) ---------- */}
                {playing && (
                    <div className="hud-top">
                        <div className="hud-chip">
                            <span className="hud-label">ANCESTOR STONES</span>
                            <span className="hud-value">{Math.max(0, checkpoint + 1)} / 3</span>
                        </div>
                        <div className="hud-right">
                            <button className="icon-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                                <IconSound muted={muted} />
                            </button>
                            {phase === 'PLAYING' && (
                                <button className="icon-btn" onClick={() => { EventBus.emit(EV.PAUSE); setPhase('PAUSED'); }} aria-label="Pause">
                                    <IconPause />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* ---------- Power meter (bottom) ---------- */}
                {playing && (
                    <div className="hud-bottom">
                        <div className={`power-meter ${power.active ? 'power-active' : ''}`}>
                            <div className="power-head">
                                <span>OGUN’S IRON SURGE</span>
                                <span>{power.pct >= 99 ? 'READY' : `${Math.round(power.pct)}%`}</span>
                            </div>
                            <div className="power-track">
                                <div className="power-fill" style={{ width: `${Math.min(100, power.pct)}%` }} />
                            </div>
                        </div>
                        <div className="controls-hint">
                            <b>WASD</b> move &middot; <b>SPACE</b> jump &middot; <b>F / SHIFT</b> power &middot; <b>ESC</b> pause
                        </div>
                    </div>
                )}

                {/* ---------- Center banner ---------- */}
                {banner !== '' && phase === 'PLAYING' && (
                    <div className="banner">{banner}</div>
                )}

                {/* ---------- Checkpoint toast ---------- */}
                {checkpoint >= 0 && phase === 'PLAYING' && (
                    <div className="toast">Checkpoint saved — the stone glows behind you</div>
                )}

                {/* ---------- MENU ---------- */}
                {phase === 'MENU' && (
                    <div className="overlay">
                        <div className="panel">
                            <div className="eyebrow">A LAGOS SAGA</div>
                            <h1 className="title">OMO <span className="gold">ORISHA</span></h1>
                            <p className="tagline">
                                A young Lagos boy channels the Orisha across danfo rooftops,
                                stacked containers and market platforms — to reach the shrine gate.
                            </p>
                            <div className="btn-row">
                                <button className="btn btn-primary" onClick={() => startGame(false)}>
                                    <IconPlay /> New Journey
                                </button>
                                {hasSave && (
                                    <button className="btn" onClick={() => startGame(true)}>
                                        <IconResume /> Continue from Shrine Step
                                    </button>
                                )}
                            </div>
                            <div className="menu-hints">
                                <span><b>WASD</b> move</span>
                                <span><b>SPACE</b> jump</span>
                                <span><b>F / SHIFT</b> Ogun's surge</span>
                                <span><b>ESC</b> pause</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* ---------- INTRO (awakening slides) ---------- */}
                {phase === 'INTRO' && (
                    <div className="overlay overlay-dim" onClick={() => EventBus.emit(EV.SKIP_INTRO)}>
                        <div className="intro-slide" key={introSlide}>
                            <h2 className="intro-title">{INTRO_LINES[introSlide].title}</h2>
                            <p className="intro-body">{INTRO_LINES[introSlide].body}</p>
                        </div>
                        <button className="skip-btn" onClick={(e) => { e.stopPropagation(); EventBus.emit(EV.SKIP_INTRO); }}>
                            Skip intro →
                        </button>
                    </div>
                )}

                {/* ---------- PAUSE ---------- */}
                {phase === 'PAUSED' && (
                    <div className="overlay overlay-dim">
                        <div className="panel panel-sm">
                            <h2 className="panel-title">PAUSED</h2>
                            <div className="btn-col">
                                <button className="btn btn-primary" onClick={() => { EventBus.emit(EV.RESUME); setPhase('PLAYING'); }}>
                                    <IconPlay /> Resume
                                </button>
                                <button className="btn" onClick={toMenu}>Main Menu</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ---------- WIN ---------- */}
                {phase === 'WIN' && (
                    <div className="overlay">
                        <div className="panel">
                            <div className="eyebrow gold">THE GATE OPENS</div>
                            <h2 className="panel-title">ORISHA SMILED</h2>
                            <p className="tagline">
                                Kolade crossed the Lagos spine and reached the shrine gate.
                                The ancestors keep his name.
                            </p>
                            <div className="btn-row">
                                <button className="btn btn-primary" onClick={() => startGame(false)}>
                                    <IconPlay /> Play Again
                                </button>
                                <button className="btn" onClick={toMenu}>Main Menu</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ---------- LOSS ---------- */}
                {phase === 'LOSS' && (
                    <div className="overlay">
                        <div className="panel">
                            <div className="eyebrow red">THE STREET WON</div>
                            <h2 className="panel-title">
                                {deathReason === 'FELL_INTO_PIT' ? 'INTO THE GAP' : 'CAUGHT BY THE AGBOLO'}
                            </h2>
                            <p className="tagline">
                                {deathReason === 'FELL_INTO_PIT'
                                    ? 'You missed a leap between the rooftops. The city swallows the careless.'
                                    : 'The agbolo’s stick found you on the market platform. Run smarter.'}
                            </p>
                            <div className="btn-row">
                                {hasSave && (
                                    <button className="btn btn-primary" onClick={() => startGame(true)}>
                                        <IconResume /> Retry from Checkpoint
                                    </button>
                                )}
                                <button className={hasSave ? 'btn' : 'btn btn-primary'} onClick={() => startGame(false)}>
                                    <IconPlay /> Restart Level
                                </button>
                                <button className="btn" onClick={toMenu}>Main Menu</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;