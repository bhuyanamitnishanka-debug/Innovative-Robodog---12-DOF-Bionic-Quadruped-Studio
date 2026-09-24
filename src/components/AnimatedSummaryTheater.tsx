import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, Sparkles, Heart, Activity, Zap, Cpu, Compass, Radio } from 'lucide-react';
import { audioSynth } from '../utils/audioSynthesizer';

interface Chapter {
  id: number;
  timeRange: string;
  title: string;
  subtitle: string;
  theme: string;
  dialogue: string;
  presenterEmotion: 'welcoming' | 'explaining' | 'enthusiastic' | 'focused' | 'proud';
  dogBehavior: 'greeting' | 'flexing' | 'charging' | 'scanning' | 'teleoperated';
  keyStats: { label: string; value: string }[];
}

export const AnimatedSummaryTheater: React.FC<{ audioEnabled: boolean }> = ({ audioEnabled }) => {
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);

  const chapters: Chapter[] = [
    {
      id: 1,
      timeRange: '00:00 - 00:15',
      title: '01. From Design to Reality',
      subtitle: 'The Genesis of Human-Machine Companionship',
      theme: 'Pioneering the transition from the Inverter project into agile robotics.',
      dialogue:
        '"Welcome to the innovative Robodog project. This 12-DOF bionic platform represents a significant leap forward, redefining human-machine companionship."',
      presenterEmotion: 'welcoming',
      dogBehavior: 'greeting',
      keyStats: [
        { label: 'PLATFORM', value: 'CERBERUS-04' },
        { label: 'DOF', value: '12 Degrees' },
        { label: 'CREATOR', value: 'Amit N. Bhuyan' },
      ],
    },
    {
      id: 2,
      timeRange: '00:18 - 00:54',
      title: '02. 12-DOF Kinematic Agility',
      subtitle: 'Quadruped Mechanics & Aviation Carbon Skeleton',
      theme: 'High-torque brushless planetary actuators paired with T700 carbon fiber.',
      dialogue:
        '"Our mechanical system features 12 independent high-torque brushless actuators with strain gauge torque sensors, achieving sub-millisecond compliance and 3.8 m/s speed."',
      presenterEmotion: 'explaining',
      dogBehavior: 'flexing',
      keyStats: [
        { label: 'MAX SPEED', value: '3.8 m/s' },
        { label: 'PAYLOAD', value: '12.5 kg' },
        { label: 'INGRESS', value: 'IP67 Waterproof' },
      ],
    },
    {
      id: 3,
      timeRange: '00:56 - 01:34',
      title: '03. 48V Power & 80A Rapid Docking',
      subtitle: 'Liquid Cooling & Electromagnetic Guidance Collar',
      theme: 'Liquid-cooled 48V 15Ah Li-ion pack with 80A fast charge in under 18 minutes.',
      dialogue:
        '"For energy storage, the 48V Li-ion core uses active liquid cooling, while our self-mating magnetic collar and optical IR homing beacon enable rapid docking."',
      presenterEmotion: 'enthusiastic',
      dogBehavior: 'charging',
      keyStats: [
        { label: 'CAPACITY', value: '48V 15Ah (720Wh)' },
        { label: 'RUNTIME', value: '4.5 Hours' },
        { label: 'FAST CHARGE', value: '0-80% < 18 min' },
      ],
    },
    {
      id: 4,
      timeRange: '01:35 - 02:00',
      title: '04. Gemini Embedded Vision (VLA)',
      subtitle: 'Autonomous Cognitive Loop & STM32H7 Core',
      theme: '400Hz real-time ML control pipeline integrating dual-depth LiDAR and IMU.',
      dialogue:
        '"The software engine is the brain of the operation. It runs Gemini Embedded Vision for spatial understanding, processed by our STM32H7 dual-core Bark-Core at 480MHz."',
      presenterEmotion: 'focused',
      dogBehavior: 'scanning',
      keyStats: [
        { label: 'AI ENGINE', value: 'Gemini VLA' },
        { label: 'MCU CORE', value: 'Cortex-M7 480MHz' },
        { label: 'LOOP RATE', value: '400 Hz' },
      ],
    },
    {
      id: 5,
      timeRange: '02:01 - 02:37',
      title: '05. Man-Machine Joystick Symbiosis',
      subtitle: 'Sub-GHz Tactile Teleoperation & Companion Bond',
      theme: 'Dual-axis Hall-effect precision steering with immediate gait swapping.',
      dialogue:
        '"The operator experience relies on our custom RD-C1 controller with frictionless magnetic sticks and tactile gait selectors, forging true partnership between human and robot."',
      presenterEmotion: 'proud',
      dogBehavior: 'teleoperated',
      keyStats: [
        { label: 'RF LINK', value: 'Sub-GHz 915MHz' },
        { label: 'CONTROLLER', value: 'RD-C1 Dual Hall' },
        { label: 'BOND', value: 'Seamless' },
      ],
    },
  ];

  const currentChapter = chapters[currentChapterIndex];

  // Auto-progress chapter loop
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          setCurrentChapterIndex((idx) => (idx + 1) % chapters.length);
          return 0;
        }
        return prev + 1.25; // ~8 seconds per chapter
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, chapters.length]);

  // Handle Chapter Change
  const setChapter = (index: number) => {
    setCurrentChapterIndex(index);
    setProgress(0);
    if (audioEnabled) {
      audioSynth.playLidarPing(true);
    }
  };

  // Canvas Animated Scene Renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let time = 0;

    const render = () => {
      time += 0.03;
      const w = canvas.width;
      const h = canvas.height;

      // 1. Futuristic Research Laboratory Background
      ctx.fillStyle = '#060913';
      ctx.fillRect(0, 0, w, h);

      // Perspective grid floor
      const groundY = h * 0.72;
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.12)';
      ctx.lineWidth = 1;
      for (let x = -200; x <= w + 200; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, groundY);
        ctx.lineTo(w / 2 + (x - w / 2) * 2.2, h);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(w, groundY);
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Atmospheric lab background screens & hologram windows
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.fillRect(w * 0.08, h * 0.15, w * 0.28, h * 0.4);
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.8)';
      ctx.strokeRect(w * 0.08, h * 0.15, w * 0.28, h * 0.4);

      ctx.fillStyle = 'rgba(6, 182, 212, 0.2)';
      ctx.font = '10px "JetBrains Mono"';
      ctx.fillText('LAB STATION #04 // BIONIC SLAM', w * 0.1, h * 0.2);

      // Draw floating holographic charts in background
      for (let i = 0; i < 5; i++) {
        const barH = Math.sin(time + i * 0.8) * 20 + 30;
        ctx.fillStyle = 'rgba(6, 182, 212, 0.3)';
        ctx.fillRect(w * 0.1 + i * 22, h * 0.48 - barH, 14, barH);
      }

      // 2. Draw Stylized Animated Character: The Presenter (Robotics Lead)
      drawStylizedPresenter(ctx, w * 0.32, groundY, currentChapter.presenterEmotion, time);

      // 3. Draw Stylized Animated Subject: The Robodog "CERBERUS-04 ALPHA"
      drawStylizedRobodog(ctx, w * 0.68, groundY, currentChapter.dogBehavior, time);

      // 4. Special Chapter Visual FX (Hologram Laser, Electrical Arc, LiDAR Wave)
      drawChapterFX(ctx, w, h, groundY, currentChapter.id, time);

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [currentChapter]);

  // Stylized Presenter Character Renderer
  const drawStylizedPresenter = (
    ctx: CanvasRenderingContext2D,
    x: number,
    groundY: number,
    emotion: string,
    time: number
  ) => {
    ctx.save();
    ctx.translate(x, groundY);

    const idleBob = Math.sin(time * 1.5) * 2;
    const bodyHeight = 160;

    // Shadow
    ctx.fillStyle = 'rgba(2, 6, 23, 0.6)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 28, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs / Pants (Tailored dark modern tech suit)
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-10, -bodyHeight * 0.45);
    ctx.lineTo(-10, 0);
    ctx.moveTo(10, -bodyHeight * 0.45);
    ctx.lineTo(10, 0);
    ctx.stroke();

    // Torso / Blazer (Black elegant tech wear from video)
    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.moveTo(-18, -bodyHeight * 0.85 + idleBob);
    ctx.lineTo(18, -bodyHeight * 0.85 + idleBob);
    ctx.lineTo(14, -bodyHeight * 0.45 + idleBob);
    ctx.lineTo(-14, -bodyHeight * 0.45 + idleBob);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Silver pendant necklace from video
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-6, -bodyHeight * 0.82 + idleBob);
    ctx.lineTo(0, -bodyHeight * 0.74 + idleBob);
    ctx.lineTo(6, -bodyHeight * 0.82 + idleBob);
    ctx.stroke();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(0, -bodyHeight * 0.73 + idleBob, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Arms & Gestures based on emotion
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';

    // Left arm
    ctx.beginPath();
    ctx.moveTo(-18, -bodyHeight * 0.82 + idleBob);
    if (emotion === 'welcoming' || emotion === 'explaining') {
      // Warm open hand gesture toward Robodog
      ctx.quadraticCurveTo(-30, -bodyHeight * 0.6 + idleBob, 10, -bodyHeight * 0.68 + idleBob);
    } else {
      ctx.lineTo(-24, -bodyHeight * 0.45 + idleBob);
    }
    ctx.stroke();

    // Right arm (pointing / tablet control)
    ctx.beginPath();
    ctx.moveTo(18, -bodyHeight * 0.82 + idleBob);
    if (emotion === 'proud' || emotion === 'enthusiastic') {
      // Gesturing to the robodog with palm up
      ctx.quadraticCurveTo(38, -bodyHeight * 0.7 + idleBob, 45, -bodyHeight * 0.8 + idleBob);
    } else {
      ctx.lineTo(24, -bodyHeight * 0.45 + idleBob);
    }
    ctx.stroke();

    // Head / Face (Stylized blond hair, friendly expressive face from video)
    const headY = -bodyHeight * 0.94 + idleBob;
    // Hair behind
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.ellipse(0, headY + 4, 16, 22, 0, 0, Math.PI * 2);
    ctx.fill();

    // Face skin tone
    ctx.fillStyle = '#fbcfe8';
    ctx.beginPath();
    ctx.arc(0, headY, 13, 0, Math.PI * 2);
    ctx.fill();

    // Hair styling (blonde side-part wavy hair)
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(-14, headY - 4);
    ctx.quadraticCurveTo(-6, headY - 18, 12, headY - 14);
    ctx.quadraticCurveTo(18, headY, 14, headY + 16);
    ctx.quadraticCurveTo(10, headY + 18, 8, headY + 8);
    ctx.quadraticCurveTo(0, headY - 10, -12, headY + 14);
    ctx.closePath();
    ctx.fill();

    // Friendly eyes
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(-4, headY - 1, 1.8, 0, Math.PI * 2);
    ctx.arc(4, headY - 1, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Warm Smile
    ctx.strokeStyle = '#e11d48';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, headY + 4, 3.5, 0.2, Math.PI - 0.2);
    ctx.stroke();

    // Presenter Name Tag
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px "JetBrains Mono"';
    ctx.textAlign = 'center';
    ctx.fillText('LEAD ROBOTICIST', 0, 16);

    ctx.restore();
  };

  // Stylized Robodog "CERBERUS-04" Subject Renderer
  const drawStylizedRobodog = (
    ctx: CanvasRenderingContext2D,
    x: number,
    groundY: number,
    behavior: string,
    time: number
  ) => {
    ctx.save();
    ctx.translate(x, groundY);

    let dogBounce = 0;
    let headAngle = 0;
    let tailWag = Math.sin(time * 6) * 0.4;
    let legOffset = 0;

    if (behavior === 'greeting') {
      // Playful head tilt & gentle stance bounce
      headAngle = Math.sin(time * 2) * 0.15 + 0.1;
      dogBounce = Math.sin(time * 3) * 4;
      tailWag = Math.sin(time * 12) * 0.7; // Excited wag!
    } else if (behavior === 'flexing') {
      // Demonstrating 12-DOF articulation
      dogBounce = Math.sin(time * 4) * 8;
      legOffset = Math.sin(time * 4) * 12;
    } else if (behavior === 'charging') {
      // Docked low profile
      dogBounce = -6;
      headAngle = -0.1;
    } else if (behavior === 'scanning') {
      // Sentry alert stance
      dogBounce = 2;
      headAngle = Math.sin(time * 2) * 0.25;
    } else if (behavior === 'teleoperated') {
      // Agile trot
      dogBounce = Math.sin(time * 6) * 6;
      legOffset = Math.sin(time * 6) * 18;
    }

    const dogY = -68 + dogBounce;

    // Contact shadow
    ctx.fillStyle = 'rgba(2, 6, 23, 0.7)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 55, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rear Leg Pair
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-45, dogY + 10);
    ctx.lineTo(-55 + legOffset, dogY + 45);
    ctx.lineTo(-48 + legOffset, 0);
    ctx.stroke();

    // Tail Actuator Link
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-52, dogY + 4);
    ctx.lineTo(-72, dogY - 14 + tailWag * 20);
    ctx.stroke();

    // Torso Exoskeleton
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(-55, dogY - 10);
    ctx.lineTo(40, dogY - 12);
    ctx.lineTo(52, dogY + 12);
    ctx.lineTo(-45, dogY + 18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Spine Glowing Battery Pulse
    ctx.fillStyle = behavior === 'charging' ? '#f59e0b' : '#06b6d4';
    ctx.fillRect(-35, dogY - 9, 50, 3.5);

    // Front Leg Pair
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(35, dogY + 10);
    ctx.lineTo(42 - legOffset, dogY + 45);
    ctx.lineTo(38 - legOffset, 0);
    ctx.stroke();

    // Joint glowing rings (Brushless Actuators)
    ctx.fillStyle = '#06b6d4';
    [-45, 35].forEach((hipX) => {
      ctx.beginPath();
      ctx.arc(hipX, dogY + 10, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Neck & Canine Head
    ctx.save();
    ctx.translate(46, dogY - 6);
    ctx.rotate(headAngle);

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(24, -14);
    ctx.lineTo(38, -6);
    ctx.lineTo(32, 10);
    ctx.lineTo(0, 8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Pointed Bionic Ears / Antennas
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(12, -14);
    ctx.lineTo(16, -26);
    ctx.lineTo(20, -14);
    ctx.closePath();
    ctx.fill();

    // Glowing Visor / LED Eyes
    ctx.fillStyle = behavior === 'charging' ? '#fbbf24' : '#22d3ee';
    ctx.beginPath();
    ctx.moveTo(22, -6);
    ctx.lineTo(34, -2);
    ctx.lineTo(30, 4);
    ctx.lineTo(20, 0);
    ctx.closePath();
    ctx.fill();

    // LiDAR Turret atop Head
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(14, -16, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Name Badge
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 9px "Chakra Petch"';
    ctx.textAlign = 'center';
    ctx.fillText('CERBERUS-04 ALPHA', 0, 16);

    ctx.restore();
  };

  // Chapter-specific animated FX
  const drawChapterFX = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    groundY: number,
    chapterId: number,
    time: number
  ) => {
    if (chapterId === 3) {
      // 80A Rapid Charging Electrical Arcs & Magnetic Beacon
      ctx.save();
      const dockX = w * 0.68;
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = -30; i <= 30; i += 10) {
        ctx.moveTo(dockX + i, groundY - 2);
        ctx.lineTo(dockX + i + (Math.random() - 0.5) * 14, groundY - 30);
      }
      ctx.stroke();

      // Pulsing laser homing beacon
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.5)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(dockX, 0);
      ctx.lineTo(dockX, groundY);
      ctx.stroke();
      ctx.restore();
    } else if (chapterId === 4) {
      // 360° LiDAR Scan Wave expanding from Robodog
      ctx.save();
      const dogX = w * 0.68;
      const dogY = groundY - 60;
      const radius = ((time * 70) % 240) + 10;
      ctx.strokeStyle = `rgba(6, 182, 212, ${Math.max(0, 1 - radius / 240)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(dogX, dogY, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (chapterId === 5) {
      // Teleoperation Wireless RF Link waves from Presenter to Robodog
      ctx.save();
      const startX = w * 0.32;
      const targetX = w * 0.68;
      const beamY = groundY - 80;
      const pulseX = startX + ((time * 120) % (targetX - startX));

      ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(startX, beamY);
      ctx.lineTo(targetX, beamY);
      ctx.stroke();

      ctx.fillStyle = '#22d3ee';
      ctx.beginPath();
      ctx.arc(pulseX, beamY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  return (
    <div className="bg-[#080d1a] border border-slate-800/90 rounded-xl p-6 shadow-xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Animated Video Summary Theater</span>
          </div>
          <h2 className="font-['Chakra_Petch'] text-2xl font-bold text-slate-100">
            {currentChapter.title}: {currentChapter.subtitle}
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-1">
            <span>Video Timestamp: {currentChapter.timeRange}</span>
            <span aria-hidden="true">·</span>
            <span>Featuring Stylized Presenter & CERBERUS-04 Robodog</span>
          </div>
        </div>

        {/* Media Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setChapter((currentChapterIndex - 1 + chapters.length) % chapters.length)}
            title="Previous Chapter"
            className="p-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            title={isPlaying ? 'Pause Journey' : 'Play Journey'}
            className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs font-mono flex items-center gap-2 cursor-pointer transition-colors shadow-[0_0_12px_rgba(6,182,212,0.3)]"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isPlaying ? 'PAUSE' : 'PLAY'}</span>
          </button>
          <button
            onClick={() => setChapter((currentChapterIndex + 1) % chapters.length)}
            title="Next Chapter"
            className="p-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Animated Scene Viewport */}
      <div className="relative w-full h-[400px] rounded-lg overflow-hidden border border-slate-800/90 bg-[#060913]">
        <canvas
          ref={canvasRef}
          width={960}
          height={400}
          className="w-full h-full block"
        />

        {/* Spoken Dialogue Subtitle Bubble */}
        <div className="absolute bottom-4 left-6 right-6 p-3.5 bg-slate-950/85 backdrop-blur-md rounded-lg border border-slate-800/90 flex items-start gap-3">
          <div className="w-7 h-7 rounded-full bg-cyan-950 border border-cyan-500/50 flex items-center justify-center shrink-0 text-cyan-300 font-bold text-xs">
            A
          </div>
          <div className="flex-1">
            <div className="text-[11px] font-mono text-cyan-400 font-semibold mb-0.5">
              ROBOTICS LEAD NARRATION // AMIT N. BHUYAN PROJECT
            </div>
            <p className="text-xs text-slate-200 italic leading-relaxed">
              {currentChapter.dialogue}
            </p>
          </div>
        </div>
      </div>

      {/* Chapter Progress Bar */}
      <div className="space-y-2">
        <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-400 transition-all duration-100 ease-linear shadow-[0_0_8px_rgba(6,182,212,0.6)]"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Chapter Selection Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-2">
          {chapters.map((chap, idx) => {
            const isActive = currentChapterIndex === idx;
            return (
              <button
                key={chap.id}
                onClick={() => setChapter(idx)}
                className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                  isActive
                    ? 'bg-cyan-950/50 border-cyan-500/80 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                    : 'bg-[#050811] border-slate-800/80 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mb-1">
                  <span>{chap.timeRange}</span>
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />}
                </div>
                <div className="font-['Chakra_Petch'] text-xs font-bold truncate">
                  {chap.title.split('. ')[1]}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chapter Key Highlights Bar */}
      <div className="p-4 bg-[#050811] rounded-lg border border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block">
            Core Theme & Milestone:
          </span>
          <p className="text-xs text-slate-200 font-medium mt-0.5">
            {currentChapter.theme}
          </p>
        </div>

        <div className="flex items-center gap-6">
          {currentChapter.keyStats.map((stat, i) => (
            <div key={i} className="text-right">
              <span className="text-[10px] font-mono text-slate-500 uppercase block">
                {stat.label}
              </span>
              <span className="font-mono text-xs font-bold text-cyan-300">
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
