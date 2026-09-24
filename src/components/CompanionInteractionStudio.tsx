import React, { useState, useRef, useEffect } from 'react';
import { Heart, Sparkles, Smile, ShieldAlert, Zap, Radio, Volume2, Award, Play } from 'lucide-react';
import { audioSynth } from '../utils/audioSynthesizer';

type EmotionMode = 'affection' | 'playful' | 'curious' | 'agility' | 'sentry';

export const CompanionInteractionStudio: React.FC<{ audioEnabled: boolean }> = ({ audioEnabled }) => {
  const [activeEmotion, setActiveEmotion] = useState<EmotionMode>('affection');
  const [reactionText, setReactionText] = useState(
    'Alpha leans gently into the roboticist\'s hand with compliant joint impedance. Human-machine bond at 98% nominal sync.'
  );
  const [interactionCount, setInteractionCount] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);

  const emotionModes: {
    id: EmotionMode;
    label: string;
    sub: string;
    icon: any;
    desc: string;
    dialogue: string;
    reaction: string;
  }[] = [
    {
      id: 'affection',
      label: 'Affectionate Bonding',
      sub: 'Gentle Lean & Compliance',
      icon: Heart,
      desc: 'Compliant joint impedance enables natural physical contact between roboticist and bionic dog.',
      dialogue: '"Good boy, Alpha. The strain gauges are registering true compliant softness in your joints."',
      reaction: 'Alpha steps close, leans gently into the roboticist\'s palm with relaxed brushless motors and glowing cyan visor.',
    },
    {
      id: 'playful',
      label: 'Playful Canine Bow',
      sub: 'Energetic Bionic Greeting',
      icon: Smile,
      desc: 'Canine play posture with front elbows lowered, hind legs arched, and high-frequency tail wag.',
      dialogue: '"Ready to run our agility test, partner? Look at that tail actuator go!"',
      reaction: 'Alpha dips into an athletic canine bow, springs into a playful bounce, and wags its carbon-fiber tail.',
    },
    {
      id: 'curious',
      label: 'Curious Head Tilt',
      sub: 'Perception Acoustic Sync',
      icon: Sparkles,
      desc: 'Head unit tilts 25° while dual-depth LiDAR and stereo mics calibrate spatial orientation.',
      dialogue: '"Alpha, parse the laboratory layout and identify the target beacon."',
      reaction: 'Alpha tilts its head with attentive perked bionic ears, scanning the presenter with gentle harmonic chirps.',
    },
    {
      id: 'agility',
      label: 'Athletic Sprint',
      sub: '3.8 m/s Gallop Leap',
      icon: Zap,
      desc: 'Dynamic leap demonstrating high-torque planetary gearboxes and carbon-fiber shock absorption.',
      dialogue: '"Engage high-speed gallop! 3.8 meters per second across the test track."',
      reaction: 'Alpha launches into a powerful gallop sprint, executing a fluid bound while the roboticist tracks live telemetry.',
    },
    {
      id: 'sentry',
      label: 'Protective Sentry',
      sub: '360° Perimeter Guard',
      icon: ShieldAlert,
      desc: 'Vigilant elevated stance with rotating LiDAR sweep and amber security perimeter rings.',
      dialogue: '"Sentry mode active. Maintain 360-degree radar perimeter around the workstation."',
      reaction: 'Alpha locks into an elevated rigid stance, illuminating perimeter safety rings and scanning for intrusions.',
    },
  ];

  const handleSelectEmotion = (mode: EmotionMode) => {
    setActiveEmotion(mode);
    const selected = emotionModes.find((m) => m.id === mode);
    if (selected) {
      setReactionText(selected.reaction);
      setInteractionCount((c) => c + 1);
    }
    if (audioEnabled) {
      if (mode === 'playful') audioSynth.playFootstep(true);
      else if (mode === 'sentry') audioSynth.playAlert(true);
      else audioSynth.playLidarPing(true);
    }
  };

  // Canvas interaction animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let time = 0;

    const render = () => {
      time += 0.035;
      const w = canvas.width;
      const h = canvas.height;

      // Dark futuristic studio environment
      ctx.fillStyle = '#060a14';
      ctx.fillRect(0, 0, w, h);

      const groundY = h * 0.74;

      // Studio light radial floor glow
      const floorGlow = ctx.createRadialGradient(w / 2, groundY, 20, w / 2, groundY, w * 0.5);
      floorGlow.addColorStop(0, 'rgba(6, 182, 212, 0.12)');
      floorGlow.addColorStop(1, 'rgba(2, 6, 23, 0.0)');
      ctx.fillStyle = floorGlow;
      ctx.fillRect(0, groundY - 40, w, h - groundY + 40);

      // Baseline
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w * 0.1, groundY);
      ctx.lineTo(w * 0.9, groundY);
      ctx.stroke();

      // Draw interactive subjects based on activeEmotion
      drawInteractiveSubjects(ctx, w, h, groundY, activeEmotion, time);

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [activeEmotion]);

  // Render stylized interactive characters
  const drawInteractiveSubjects = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    groundY: number,
    mode: EmotionMode,
    time: number
  ) => {
    let presenterX = w * 0.35;
    let dogX = w * 0.62;

    if (mode === 'affection') {
      // Close together for petting/bonding
      presenterX = w * 0.42;
      dogX = w * 0.58;
    } else if (mode === 'agility') {
      // Dog sprinting across
      dogX = w * 0.5 + Math.sin(time * 2.5) * (w * 0.25);
    }

    const presenterBob = Math.sin(time * 2) * 1.5;

    // 1. Draw Roboticist (Blond Lead Presenter)
    ctx.save();
    ctx.translate(presenterX, groundY);

    // Presenter Shadow
    ctx.fillStyle = 'rgba(2, 6, 23, 0.7)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 26, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-8, -60);
    ctx.lineTo(-8, 0);
    ctx.moveTo(8, -60);
    ctx.lineTo(8, 0);
    ctx.stroke();

    // Black Tech Blazer
    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.moveTo(-16, -120 + presenterBob);
    ctx.lineTo(16, -120 + presenterBob);
    ctx.lineTo(12, -60 + presenterBob);
    ctx.lineTo(-12, -60 + presenterBob);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Arm reaching to pet Alpha in affection mode
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(14, -115 + presenterBob);
    if (mode === 'affection') {
      // Hand resting on dog's head!
      ctx.quadraticCurveTo(35, -95 + presenterBob, 50, -85 + presenterBob);
    } else if (mode === 'playful') {
      // Clapping / encouraging
      ctx.quadraticCurveTo(30, -100 + presenterBob, 20, -110 + presenterBob);
    } else {
      ctx.lineTo(20, -65 + presenterBob);
    }
    ctx.stroke();

    // Head & Blond Hair
    const headY = -135 + presenterBob;
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.ellipse(0, headY + 3, 14, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fed7aa';
    ctx.beginPath();
    ctx.arc(0, headY, 11, 0, Math.PI * 2);
    ctx.fill();

    // Blond wavy styling
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(-12, headY - 4);
    ctx.quadraticCurveTo(-4, headY - 14, 10, headY - 12);
    ctx.quadraticCurveTo(15, headY + 2, 12, headY + 14);
    ctx.quadraticCurveTo(8, headY + 16, 6, headY + 6);
    ctx.quadraticCurveTo(0, headY - 8, -10, headY + 12);
    ctx.closePath();
    ctx.fill();

    // Happy smiling face
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(-3.5, headY - 1, 1.6, 0, Math.PI * 2);
    ctx.arc(3.5, headY - 1, 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#e11d48';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, headY + 3.5, 3, 0.2, Math.PI - 0.2);
    ctx.stroke();

    ctx.restore();

    // 2. Draw CERBERUS-04 ALPHA Robodog
    ctx.save();
    ctx.translate(dogX, groundY);

    let dogY = -56;
    let headTilt = 0;
    let tailAngle = Math.sin(time * 8) * 0.4;
    let legPitchFront = 0;
    let legPitchRear = 0;

    if (mode === 'affection') {
      dogY = -54 + Math.sin(time * 1.5) * 1.5;
      headTilt = -0.15; // Nuzzling upward into hand
      tailAngle = Math.sin(time * 10) * 0.5; // Happy wag
    } else if (mode === 'playful') {
      // Play bow: front down, rear up
      dogY = -48 + Math.sin(time * 5) * 4;
      legPitchFront = -0.3;
      legPitchRear = 0.2;
      tailAngle = Math.sin(time * 16) * 0.8; // Super excited wag!
    } else if (mode === 'curious') {
      headTilt = 0.42; // Distinct curious canine head tilt
      dogY = -56 + Math.sin(time * 2) * 2;
    } else if (mode === 'agility') {
      dogY = -68 + Math.sin(time * 6) * 12; // Bounding in air
      legPitchFront = Math.sin(time * 6) * 0.4;
      legPitchRear = -Math.sin(time * 6) * 0.4;
    } else if (mode === 'sentry') {
      dogY = -62; // Tall elevated stance
      headTilt = Math.sin(time * 2) * 0.2;
    }

    // Robodog Shadow
    ctx.fillStyle = 'rgba(2, 6, 23, 0.7)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 48, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';

    // Rear leg
    ctx.beginPath();
    ctx.moveTo(-35, dogY + 8);
    ctx.lineTo(-42 + legPitchRear * 20, dogY + 34);
    ctx.lineTo(-38 + legPitchRear * 20, 0);
    ctx.stroke();

    // Front leg
    ctx.beginPath();
    ctx.moveTo(30, dogY + 8);
    ctx.lineTo(36 + legPitchFront * 20, dogY + 34);
    ctx.lineTo(34 + legPitchFront * 20, 0);
    ctx.stroke();

    // Tail
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-42, dogY + 2);
    ctx.lineTo(-60, dogY - 14 + tailAngle * 18);
    ctx.stroke();

    // Torso Exoskeleton
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(-44, dogY - 8);
    ctx.lineTo(32, dogY - 10);
    ctx.lineTo(42, dogY + 10);
    ctx.lineTo(-36, dogY + 14);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = mode === 'sentry' ? '#f59e0b' : '#38bdf8';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Battery Spine LED
    ctx.fillStyle = mode === 'affection' ? '#ec4899' : '#06b6d4';
    ctx.fillRect(-28, dogY - 7, 40, 3);

    // Head
    ctx.save();
    ctx.translate(38, dogY - 6);
    ctx.rotate(headTilt);

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(20, -12);
    ctx.lineTo(32, -4);
    ctx.lineTo(26, 8);
    ctx.lineTo(0, 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = mode === 'sentry' ? '#f59e0b' : '#38bdf8';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Pointed Ears
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(10, -12);
    ctx.lineTo(14, -22);
    ctx.lineTo(18, -12);
    ctx.closePath();
    ctx.fill();

    // Glowing Eye Visor
    ctx.fillStyle = mode === 'affection' ? '#f472b6' : mode === 'sentry' ? '#f59e0b' : '#22d3ee';
    ctx.beginPath();
    ctx.moveTo(18, -4);
    ctx.lineTo(28, 0);
    ctx.lineTo(25, 4);
    ctx.lineTo(16, 1);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // Special Emotional Overlays
    if (mode === 'affection') {
      // Floating neon pink heart between them
      const heartPulse = (Math.sin(time * 3) + 1) * 0.5;
      ctx.fillStyle = `rgba(244, 114, 182, ${0.6 + heartPulse * 0.4})`;
      ctx.font = '16px sans-serif';
      ctx.fillText('♥', -18, dogY - 30 - heartPulse * 6);
    } else if (mode === 'sentry') {
      // Amber perimeter alert circle
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 70, 16, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  };

  const currentModeObj = emotionModes.find((m) => m.id === activeEmotion) || emotionModes[0];

  return (
    <div className="bg-[#080d1a] border border-slate-800/90 rounded-xl p-6 shadow-xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <Heart className="w-3.5 h-3.5 text-pink-400" />
            <span>Character & Companion Interaction Studio</span>
          </div>
          <h2 className="font-['Chakra_Petch'] text-2xl font-bold text-slate-100">
            HUMAN-MACHINE COMPANIONSHIP IN ACTION
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-1">
            <span>Featuring the Lead Roboticist & CERBERUS-04 ALPHA</span>
            <span aria-hidden="true">·</span>
            <span>Sync Interactions: {interactionCount}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span className="w-2 h-2 rounded-full bg-pink-400 animate-pulse" />
          <span>COMPLIANT JOINT IMPEDANCE: 98% SYNC</span>
        </div>
      </div>

      {/* Main Animated Stage */}
      <div className="relative w-full h-[360px] rounded-lg overflow-hidden border border-slate-800/90 bg-[#060a14]">
        <canvas
          ref={canvasRef}
          width={960}
          height={360}
          className="w-full h-full block"
        />

        {/* Presenter Spoken Reaction Box */}
        <div className="absolute top-4 left-6 max-w-md p-3.5 bg-slate-950/85 backdrop-blur-md rounded-lg border border-slate-800/90">
          <div className="text-[10px] font-mono text-cyan-400 font-semibold mb-0.5">
            LEAD ROBOTICIST (PRESENTING)
          </div>
          <p className="text-xs text-slate-200 italic leading-relaxed">
            {currentModeObj.dialogue}
          </p>
        </div>

        {/* Dynamic Reaction Readout */}
        <div className="absolute bottom-4 left-6 right-6 p-3 bg-slate-950/85 backdrop-blur-md rounded-lg border border-slate-800/90 flex items-center justify-between gap-4">
          <div className="text-xs font-mono text-slate-300">
            <span className="text-pink-400 font-bold uppercase mr-2">Alpha State:</span>
            <span>{reactionText}</span>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono text-slate-500 shrink-0">
            <span>CAN-FD 1kHz</span>
            <span>·</span>
            <span>Torque Telemetry Active</span>
          </div>
        </div>
      </div>

      {/* Emotional State Selector Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {emotionModes.map((mode) => {
          const Icon = mode.icon;
          const isActive = activeEmotion === mode.id;
          return (
            <button
              key={mode.id}
              onClick={() => handleSelectEmotion(mode.id)}
              className={`p-3.5 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between ${
                isActive
                  ? 'bg-pink-950/40 border-pink-500/80 text-pink-200 shadow-[0_0_12px_rgba(236,72,153,0.25)]'
                  : 'bg-[#050811] border-slate-800/90 text-slate-400 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-pink-400' : 'text-slate-500'}`} />
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" />}
                </div>
                <div className="font-['Chakra_Petch'] text-xs font-bold">{mode.label}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{mode.sub}</div>
              </div>
              <div className="mt-3 text-[10px] font-mono text-cyan-400/90">
                Trigger Action →
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
