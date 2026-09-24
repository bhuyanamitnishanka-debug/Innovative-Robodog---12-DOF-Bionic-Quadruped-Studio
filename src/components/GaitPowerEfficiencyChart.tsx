import React, { useState, useEffect, useRef } from 'react';
import { TelemetryState, GaitType } from '../types/robotics';
import {
  TrendingUp,
  Zap,
  Gauge,
  Activity,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Info,
  Layers,
} from 'lucide-react';

interface GaitPowerEfficiencyChartProps {
  telemetry: TelemetryState;
  updateTelemetry: (partial: Partial<TelemetryState>) => void;
}

interface EfficiencyDataPoint {
  timeSec: number;
  timestampStr: string;
  velocity: number;       // m/s
  power: number;          // W
  gait: GaitType;
  cot: number;            // Cost of Transport dimensionless
  energyPerMeter: number; // J/m
}

export const GaitPowerEfficiencyChart: React.FC<GaitPowerEfficiencyChartProps> = ({
  telemetry,
  updateTelemetry,
}) => {
  const [dataPoints, setDataPoints] = useState<EfficiencyDataPoint[]>([]);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [timeWindowSec, setTimeWindowSec] = useState<number>(30); // 15s, 30s, 60s
  const [activeTab, setActiveTab] = useState<'realtime' | 'curves'>('realtime');
  const [hoveredPoint, setHoveredPoint] = useState<EfficiencyDataPoint | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const lastSampleTimeRef = useRef<number>(0);

  // Platform mass in kg for Cost of Transport (CoT = P / (m * g * v))
  const ROBOT_MASS_KG = 18.5;
  const GRAVITY = 9.81;

  // Gait colors for timeline tags & curves
  const gaitColors: Record<GaitType, string> = {
    walk: '#38bdf8',   // Sky blue
    trot: '#22d3ee',   // Cyan
    gallop: '#ec4899', // Pink
    creep: '#a855f7',  // Purple
    pace: '#3b82f6',   // Blue
    bound: '#f97316',  // Orange
    crawl: '#10b981',  // Emerald
    stand: '#64748b',  // Slate
  };

  // Physical power calculation based on gait and speed
  const calculateRealisticPower = (gait: GaitType, speed: number): number => {
    const baseStandbyPower = 48.0; // Avionics, LiDAR, dual-core MCU, CAN transceivers

    if (gait === 'stand' || speed <= 0.05) {
      return baseStandbyPower + Math.random() * 2.0;
    }

    let mechanicalFactor = 85;
    let powerExponent = 1.3;

    if (gait === 'walk') {
      mechanicalFactor = 95;
      powerExponent = 1.25;
    } else if (gait === 'trot') {
      // Trot has optimal harmonic energy recovery
      mechanicalFactor = 75;
      powerExponent = 1.2;
    } else if (gait === 'gallop') {
      // Ballistic aerial thrust requires high peak power
      mechanicalFactor = 68;
      powerExponent = 1.75;
    } else if (gait === 'creep') {
      // 3-leg continuous high-torque holding
      mechanicalFactor = 120;
      powerExponent = 1.1;
    } else if (gait === 'bound') {
      mechanicalFactor = 88;
      powerExponent = 1.5;
    } else if (gait === 'pace') {
      mechanicalFactor = 82;
      powerExponent = 1.35;
    }

    const mechPower = mechanicalFactor * Math.pow(speed, powerExponent);
    const sensorNoise = (Math.sin(Date.now() * 0.005) + Math.random() * 0.5) * 3.5;

    return Math.max(baseStandbyPower, Math.round((baseStandbyPower + mechPower + sensorNoise) * 10) / 10);
  };

  // Sample data points periodically
  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsedSec = (now - startTimeRef.current) / 1000;
      const v = telemetry.linearVelocity;
      const p = calculateRealisticPower(telemetry.gait, v);

      // Keep telemetry power and current updated in sync
      const busVoltage = telemetry.voltage || 48.2;
      const current = parseFloat((p / busVoltage).toFixed(2));
      updateTelemetry({ power: p, current });

      // Calculate Cost of Transport (CoT = P / (m * g * v))
      const cot = v > 0.1 ? p / (ROBOT_MASS_KG * GRAVITY * v) : 0;
      const energyPerMeter = v > 0.1 ? Math.round(p / v) : 0;

      const newPoint: EfficiencyDataPoint = {
        timeSec: elapsedSec,
        timestampStr: new Date().toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' }),
        velocity: v,
        power: p,
        gait: telemetry.gait,
        cot: parseFloat(cot.toFixed(3)),
        energyPerMeter,
      };

      setDataPoints((prev) => {
        const next = [...prev, newPoint];
        // Retain samples within max 120s buffer
        return next.filter((pt) => elapsedSec - pt.timeSec <= 120);
      });
    }, 250);

    return () => clearInterval(interval);
  }, [isPaused, telemetry.linearVelocity, telemetry.gait, telemetry.voltage, updateTelemetry]);

  // Render Real-Time Canvas Line Chart
  useEffect(() => {
    if (activeTab !== 'realtime') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Background
    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, width, height);

    const padding = { top: 32, right: 60, bottom: 42, left: 54 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // Filter points in selected time window
    const nowSec = dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].timeSec : 0;
    const windowStartSec = Math.max(0, nowSec - timeWindowSec);
    const visiblePoints = dataPoints.filter((pt) => pt.timeSec >= windowStartSec);

    // Axes scales
    const maxVelocity = 4.0; // m/s
    const maxPower = 500;    // Watts

    // 1. Draw Grid Lines
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.6)';
    ctx.lineWidth = 1;

    // Horizontal grid (Power & Velocity divisions)
    const horizDivisions = 5;
    for (let i = 0; i <= horizDivisions; i++) {
      const y = padding.top + (chartH / horizDivisions) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();

      // Left Axis Label: Velocity (m/s) in Cyan
      const vVal = (maxVelocity * (1 - i / horizDivisions)).toFixed(1);
      ctx.fillStyle = '#22d3ee';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${vVal} m/s`, padding.left - 8, y + 3);

      // Right Axis Label: Power (W) in Amber
      const pVal = Math.round(maxPower * (1 - i / horizDivisions));
      ctx.fillStyle = '#f59e0b';
      ctx.textAlign = 'left';
      ctx.fillText(`${pVal} W`, padding.left + chartW + 8, y + 3);
    }

    // Vertical time grid
    const timeDivisions = 6;
    for (let i = 0; i <= timeDivisions; i++) {
      const x = padding.left + (chartW / timeDivisions) * i;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartH);
      ctx.stroke();

      const timeOffsetSec = Math.round(timeWindowSec * (1 - i / timeDivisions));
      ctx.fillStyle = '#64748b';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`-${timeOffsetSec}s`, x, padding.top + chartH + 18);
    }

    if (visiblePoints.length < 2) {
      ctx.fillStyle = '#475569';
      ctx.font = '12px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('COLLECTING REAL-TIME TELEMETRY DATA...', width / 2, height / 2);
      return;
    }

    // 2. Draw Gait Mode Timeline Color Strip at bottom of chart
    visiblePoints.forEach((pt, idx) => {
      if (idx === 0) return;
      const prev = visiblePoints[idx - 1];
      const x1 = padding.left + ((prev.timeSec - windowStartSec) / timeWindowSec) * chartW;
      const x2 = padding.left + ((pt.timeSec - windowStartSec) / timeWindowSec) * chartW;
      ctx.fillStyle = gaitColors[pt.gait] || '#64748b';
      ctx.fillRect(x1, padding.top + chartH + 2, Math.max(1, x2 - x1), 4);
    });

    // 3. Draw Power Consumption Line & Area (Amber)
    ctx.save();
    ctx.beginPath();
    visiblePoints.forEach((pt, idx) => {
      const x = padding.left + ((pt.timeSec - windowStartSec) / timeWindowSec) * chartW;
      const y = padding.top + (1 - Math.min(1, pt.power / maxPower)) * chartH;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    // Subtle amber gradient fill
    const powerGrad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
    powerGrad.addColorStop(0, 'rgba(245, 158, 11, 0.25)');
    powerGrad.addColorStop(1, 'rgba(245, 158, 11, 0.0)');
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    ctx.lineTo(padding.left + chartW, padding.top + chartH);
    ctx.lineTo(padding.left, padding.top + chartH);
    ctx.closePath();
    ctx.fillStyle = powerGrad;
    ctx.fill();
    ctx.restore();

    // 4. Draw Gait Velocity Line & Area (Cyan)
    ctx.save();
    ctx.beginPath();
    visiblePoints.forEach((pt, idx) => {
      const x = padding.left + ((pt.timeSec - windowStartSec) / timeWindowSec) * chartW;
      const y = padding.top + (1 - Math.min(1, pt.velocity / maxVelocity)) * chartH;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    // Subtle cyan gradient fill
    const velGrad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
    velGrad.addColorStop(0, 'rgba(34, 211, 238, 0.3)');
    velGrad.addColorStop(1, 'rgba(34, 211, 238, 0.0)');
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2.4;
    ctx.stroke();

    ctx.lineTo(padding.left + chartW, padding.top + chartH);
    ctx.lineTo(padding.left, padding.top + chartH);
    ctx.closePath();
    ctx.fillStyle = velGrad;
    ctx.fill();
    ctx.restore();

    // 5. Draw Latest Head Pointer Pulsing Dot
    const latestPt = visiblePoints[visiblePoints.length - 1];
    const headX = padding.left + chartW;
    const headYVel = padding.top + (1 - Math.min(1, latestPt.velocity / maxVelocity)) * chartH;
    const headYPwr = padding.top + (1 - Math.min(1, latestPt.power / maxPower)) * chartH;

    // Cyan dot for velocity
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(headX, headYVel, 4, 0, Math.PI * 2);
    ctx.fill();

    // Amber dot for power
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(headX, headYPwr, 4, 0, Math.PI * 2);
    ctx.fill();
  }, [dataPoints, timeWindowSec, activeTab]);

  const currentPoint = dataPoints.length > 0 ? dataPoints[dataPoints.length - 1] : null;

  // Determine current efficiency status
  const currentCot = currentPoint?.cot || 0;
  const isOptimalBand = currentCot > 0.32 && currentCot < 0.65;

  return (
    <div className="bg-[#080d1a] border border-slate-800/90 rounded-xl p-5 shadow-xl select-none space-y-5">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-800/80 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-cyan-950/60 border border-cyan-700/60 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-['Chakra_Petch'] text-sm font-bold text-slate-100 uppercase tracking-wider">
                Locomotion Efficiency: Gait Velocity vs. Power Consumption
              </h3>
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
              <span>Dual-Axis Rolling Telemetry</span>
              <span aria-hidden="true">·</span>
              <span>Specific Cost of Transport (CoT)</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300 font-semibold">{dataPoints.length} Samples</span>
            </div>
          </div>
        </div>

        {/* View Switcher & Actions */}
        <div className="flex items-center gap-2">
          <div className="flex rounded bg-slate-900 border border-slate-800 p-0.5 text-xs font-mono">
            <button
              onClick={() => setActiveTab('realtime')}
              className={`px-3 py-1 rounded cursor-pointer transition-colors ${
                activeTab === 'realtime'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Real-Time Chart
            </button>
            <button
              onClick={() => setActiveTab('curves')}
              className={`px-3 py-1 rounded cursor-pointer transition-colors ${
                activeTab === 'curves'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Efficiency Envelope
            </button>
          </div>

          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`px-2.5 py-1 rounded border text-xs font-mono flex items-center gap-1 cursor-pointer transition-colors ${
              isPaused
                ? 'bg-amber-950/60 border-amber-600 text-amber-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {isPaused ? <Play className="w-3 h-3 text-amber-400" /> : <Pause className="w-3 h-3" />}
            <span>{isPaused ? 'RESUME' : 'PAUSE'}</span>
          </button>

          <button
            onClick={() => {
              setDataPoints([]);
              startTimeRef.current = Date.now();
            }}
            className="p-1.5 rounded bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
            title="Clear Chart Buffer"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Main Real-Time Line Chart View */}
      {activeTab === 'realtime' ? (
        <div className="space-y-4">
          {/* Chart Canvas */}
          <div className="relative w-full h-[280px] bg-[#050811] rounded-lg border border-slate-800/90 overflow-hidden">
            <canvas
              ref={canvasRef}
              width={960}
              height={280}
              className="w-full h-full block"
            />

            {/* In-chart Legend */}
            <div className="absolute top-3 left-4 flex flex-wrap items-center gap-4 bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded border border-slate-800/80 text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-1 bg-cyan-400 rounded-full" />
                <span className="text-cyan-300 font-semibold">Velocity (m/s)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-1 bg-amber-400 rounded-full" />
                <span className="text-amber-300 font-semibold">Power (Watts)</span>
              </div>
            </div>

            {/* Time Window Buttons */}
            <div className="absolute top-3 right-4 flex items-center gap-1 bg-slate-950/80 backdrop-blur-md px-2 py-1 rounded border border-slate-800/80 text-[10px] font-mono">
              <span className="text-slate-500 mr-1">Window:</span>
              {[15, 30, 60].map((sec) => (
                <button
                  key={sec}
                  onClick={() => setTimeWindowSec(sec)}
                  className={`px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                    timeWindowSec === sec
                      ? 'bg-cyan-950 text-cyan-300 font-bold border border-cyan-700/60'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>

          {/* Real-time Telemetry & Cost of Transport (CoT) Meters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Card 1: Gait Velocity */}
            <div className="p-3.5 rounded-lg bg-[#050811] border border-cyan-900/40">
              <div className="text-[10px] font-mono text-cyan-400 uppercase flex items-center justify-between">
                <span>Gait Velocity</span>
                <Gauge className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold font-mono text-cyan-300 tabular-nums">
                  {telemetry.linearVelocity.toFixed(2)}
                </span>
                <span className="text-xs font-mono text-slate-400">m/s</span>
                <span className="text-[10px] font-mono text-slate-500 ml-auto">
                  {(telemetry.linearVelocity * 3.6).toFixed(1)} km/h
                </span>
              </div>
              <div className="mt-1 text-[10px] font-mono text-slate-400">
                Active Pattern: <strong className="text-slate-200 uppercase">{telemetry.gait}</strong>
              </div>
            </div>

            {/* Card 2: Electrical Power */}
            <div className="p-3.5 rounded-lg bg-[#050811] border border-amber-900/40">
              <div className="text-[10px] font-mono text-amber-400 uppercase flex items-center justify-between">
                <span>Total Power Draw</span>
                <Zap className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold font-mono text-amber-300 tabular-nums">
                  {currentPoint ? currentPoint.power.toFixed(1) : telemetry.power.toFixed(1)}
                </span>
                <span className="text-xs font-mono text-slate-400">W</span>
                <span className="text-[10px] font-mono text-slate-500 ml-auto">
                  {telemetry.current.toFixed(1)} A @ 48V
                </span>
              </div>
              <div className="mt-1 text-[10px] font-mono text-slate-400">
                Standby Avionics: 48W · Dynamic Mech: {Math.max(0, Math.round((currentPoint?.power || 48) - 48))}W
              </div>
            </div>

            {/* Card 3: Specific Cost of Transport (CoT) */}
            <div className="p-3.5 rounded-lg bg-[#050811] border border-emerald-900/40">
              <div className="text-[10px] font-mono text-emerald-400 uppercase flex items-center justify-between">
                <span>Specific Cost of Transport</span>
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold font-mono text-emerald-300 tabular-nums">
                  {currentCot > 0 ? currentCot.toFixed(2) : '--'}
                </span>
                <span className="text-xs font-mono text-slate-400">CoT</span>
                <span className={`text-[10px] font-mono ml-auto font-semibold ${isOptimalBand ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {isOptimalBand ? 'OPTIMAL BAND' : telemetry.linearVelocity > 0 ? 'SUB-OPTIMAL' : 'STATIC'}
                </span>
              </div>
              <div className="mt-1 text-[10px] font-mono text-slate-400">
                Formula: P / (m · g · v) [m = 18.5 kg]
              </div>
            </div>

            {/* Card 4: Energy per Meter */}
            <div className="p-3.5 rounded-lg bg-[#050811] border border-slate-800">
              <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center justify-between">
                <span>Specific Energy Expenditure</span>
                <Activity className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold font-mono text-slate-100 tabular-nums">
                  {currentPoint && currentPoint.energyPerMeter > 0 ? currentPoint.energyPerMeter : '--'}
                </span>
                <span className="text-xs font-mono text-slate-400">J/m</span>
                <span className="text-[10px] font-mono text-slate-500 ml-auto">
                  {currentPoint && currentPoint.energyPerMeter > 0
                    ? `${(currentPoint.energyPerMeter * 1000 / 3600).toFixed(1)} Wh/km`
                    : '--'}
                </span>
              </div>
              <div className="mt-1 text-[10px] font-mono text-slate-400">
                Battery Range: ~{Math.round((telemetry.batteryPercent / 100) * 15 * 48 / Math.max(1, currentPoint?.energyPerMeter || 120) * 1000) / 1000} km
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Comparative Gait Efficiency Envelopes Tab */
        <div className="space-y-4">
          <div className="bg-[#050811] p-4 rounded-lg border border-slate-800/90 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/70">
              <div>
                <h4 className="font-['Chakra_Petch'] text-sm font-bold text-slate-100 uppercase tracking-wider">
                  Comparative Power-Velocity Curves Across Movement Patterns
                </h4>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Benchmark analysis showing which quadruped gait minimizes power draw and Cost of Transport (CoT) at any velocity.
                </p>
              </div>
              <div className="text-xs font-mono text-cyan-400">
                Current Speed: <strong className="text-slate-100">{telemetry.linearVelocity.toFixed(1)} m/s</strong>
              </div>
            </div>

            {/* Gait Comparison Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* WALK */}
              <div className={`p-3.5 rounded-lg border ${telemetry.gait === 'walk' ? 'bg-sky-950/40 border-sky-400/80 shadow-[0_0_12px_rgba(56,189,248,0.2)]' : 'bg-[#070c1a] border-slate-800/80'}`}>
                <div className="flex items-center justify-between text-xs font-bold text-sky-400 font-['Chakra_Petch']">
                  <span>WALK (0.4 - 1.6 m/s)</span>
                  {telemetry.gait === 'walk' && <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />}
                </div>
                <div className="mt-2 text-xs font-mono text-slate-300">
                  Optimal Speed: <strong>1.1 m/s</strong>
                </div>
                <div className="text-[11px] font-mono text-slate-400 mt-1">
                  Power: <strong>140 - 180 W</strong> · CoT: <strong>0.68</strong>
                </div>
                <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                  Superior static stability for precise inspection and low terrain disturbance. Becomes mechanically inefficient above 1.6 m/s.
                </p>
              </div>

              {/* TROT */}
              <div className={`p-3.5 rounded-lg border ${telemetry.gait === 'trot' ? 'bg-cyan-950/40 border-cyan-400/80 shadow-[0_0_12px_rgba(34,211,238,0.2)]' : 'bg-[#070c1a] border-slate-800/80'}`}>
                <div className="flex items-center justify-between text-xs font-bold text-cyan-400 font-['Chakra_Petch']">
                  <span>TROT (1.2 - 2.6 m/s)</span>
                  {telemetry.gait === 'trot' && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />}
                </div>
                <div className="mt-2 text-xs font-mono text-slate-300">
                  Optimal Speed: <strong>1.8 m/s</strong>
                </div>
                <div className="text-[11px] font-mono text-slate-400 mt-1">
                  Power: <strong>190 - 240 W</strong> · CoT: <strong className="text-emerald-400">0.42 (Best)</strong>
                </div>
                <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                  Diagonal pendulum symmetry recaptures kinetic energy into leg spring stiffness. Lowest electrical cost per kilometer traveled.
                </p>
              </div>

              {/* GALLOP */}
              <div className={`p-3.5 rounded-lg border ${telemetry.gait === 'gallop' ? 'bg-pink-950/40 border-pink-400/80 shadow-[0_0_12px_rgba(236,72,153,0.2)]' : 'bg-[#070c1a] border-slate-800/80'}`}>
                <div className="flex items-center justify-between text-xs font-bold text-pink-400 font-['Chakra_Petch']">
                  <span>GALLOP (2.4 - 3.8 m/s)</span>
                  {telemetry.gait === 'gallop' && <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-ping" />}
                </div>
                <div className="mt-2 text-xs font-mono text-slate-300">
                  Optimal Speed: <strong>3.2 m/s</strong>
                </div>
                <div className="text-[11px] font-mono text-slate-400 mt-1">
                  Power: <strong>320 - 460 W</strong> · CoT: <strong>0.76</strong>
                </div>
                <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                  Transverse ballistic flight. Draws highest instantaneous peak wattage, but achieves maximum ground clearance and hurdle leaping.
                </p>
              </div>

              {/* CREEP */}
              <div className={`p-3.5 rounded-lg border ${telemetry.gait === 'creep' ? 'bg-purple-950/40 border-purple-400/80 shadow-[0_0_12px_rgba(168,85,247,0.2)]' : 'bg-[#070c1a] border-slate-800/80'}`}>
                <div className="flex items-center justify-between text-xs font-bold text-purple-400 font-['Chakra_Petch']">
                  <span>CREEP (0.1 - 0.6 m/s)</span>
                  {telemetry.gait === 'creep' && <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />}
                </div>
                <div className="mt-2 text-xs font-mono text-slate-300">
                  Optimal Speed: <strong>0.4 m/s</strong>
                </div>
                <div className="text-[11px] font-mono text-slate-400 mt-1">
                  Power: <strong>110 - 150 W</strong> · CoT: <strong>1.45</strong>
                </div>
                <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                  Continuous 3-limb static ground contact. High holding current per meter, but delivers zero tipping hazard on loose gravel or 35° slopes.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
