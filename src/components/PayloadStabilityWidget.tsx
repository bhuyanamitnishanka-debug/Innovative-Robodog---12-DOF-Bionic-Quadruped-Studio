import React, { useState, useId } from 'react';
import { TelemetryState } from '../types/robotics';
import {
  Scale,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Gauge,
  Sliders,
  RotateCcw,
  CheckCircle2,
  Box,
  Crosshair,
  TrendingDown,
  Info,
} from 'lucide-react';

interface PayloadStabilityWidgetProps {
  telemetry: TelemetryState;
  updateTelemetry: (partial: Partial<TelemetryState>) => void;
}

interface PayloadPreset {
  id: string;
  name: string;
  massKg: number;
  offsetXmm: number;
  offsetYmm: number;
  heightZmm: number;
  desc: string;
}

const PRESETS: PayloadPreset[] = [
  {
    id: 'unloaded',
    name: 'Unloaded Tare',
    massKg: 0.0,
    offsetXmm: 0,
    offsetYmm: 0,
    heightZmm: 20,
    desc: 'Bare chassis (15.0 kg base tare)',
  },
  {
    id: 'lidar_pod',
    name: 'LiDAR + Depth Pod',
    massKg: 1.8,
    offsetXmm: 85, // Forward mounted
    offsetYmm: 0,
    heightZmm: 75,
    desc: 'Fore perception sensor array',
  },
  {
    id: 'med_kit',
    name: 'Tactical Cargo Pack',
    massKg: 3.5,
    offsetXmm: -20, // Slightly aft
    offsetYmm: 0,
    heightZmm: 60,
    desc: 'Centered top cargo enclosure',
  },
  {
    id: 'side_pannier',
    name: 'Asymmetric Pannier',
    massKg: 4.2,
    offsetXmm: 10,
    offsetYmm: 70, // Port offset
    heightZmm: 45,
    desc: 'Unbalanced left lateral tool case',
  },
  {
    id: 'heavy_tool',
    name: 'Heavy Inspection Rig',
    massKg: 6.5,
    offsetXmm: -65, // Aft haunch bias
    offsetYmm: -25,
    heightZmm: 110, // High center of mass
    desc: 'High-mount robotic manipulator arm',
  },
  {
    id: 'max_structural',
    name: 'Max Structural Limit',
    massKg: 8.5,
    offsetXmm: 0,
    offsetYmm: 0,
    heightZmm: 50,
    desc: 'Maximum rated carrier payload limit',
  },
];

export const PayloadStabilityWidget: React.FC<PayloadStabilityWidgetProps> = ({
  telemetry,
  updateTelemetry,
}) => {
  // Base Robot Physical Constants
  const baseMassKg = 15.0; // CERBERUS-04 tare mass
  const baseCoMX = 0; // mm (centered between hip pivots)
  const baseCoMY = 0; // mm
  const baseCoMZ = 180; // mm (height of nominal chassis CoM from ground)
  const wheelbaseMm = 420; // Fore-aft distance between front & rear foot contacts
  const trackWidthMm = 250; // Lateral distance between left & right foot contacts

  // Interactive Payload State
  const [payloadMass, setPayloadMass] = useState<number>(2.5); // kg
  const [payloadX, setPayloadX] = useState<number>(30); // mm (fore + / aft -)
  const [payloadY, setPayloadY] = useState<number>(0); // mm (port + / starboard -)
  const [payloadZ, setPayloadZ] = useState<number>(60); // mm above chassis mounting plate
  const [activePreset, setActivePreset] = useState<string>('custom');

  // Accessible Form Control IDs
  const payloadMassId = useId();
  const payloadXId = useId();
  const payloadYId = useId();
  const payloadZId = useId();

  // Mathematical Center of Mass (CoM) Equations
  // M_total = M_base + m_payload
  // X_com = (M_base * X_base + m_payload * X_payload) / M_total
  const totalMassKg = baseMassKg + payloadMass;
  const combinedCoMX = (baseMassKg * baseCoMX + payloadMass * payloadX) / totalMassKg;
  const combinedCoMY = (baseMassKg * baseCoMY + payloadMass * payloadY) / totalMassKg;
  const combinedCoMZ = (baseMassKg * baseCoMZ + payloadMass * (baseCoMZ + payloadZ)) / totalMassKg;

  // Center of Mass Shift Deltas
  const deltaX = combinedCoMX - baseCoMX;
  const deltaY = combinedCoMY - baseCoMY;
  const deltaZ = combinedCoMZ - baseCoMZ;
  const shiftMagnitude = Math.sqrt(deltaX ** 2 + deltaY ** 2 + deltaZ ** 2);

  // Support Polygon Boundary Checks & Static Stability Margin (SSM)
  const halfWheelbase = wheelbaseMm / 2; // 210 mm
  const halfTrackWidth = trackWidthMm / 2; // 125 mm
  const marginX = Math.max(0, halfWheelbase - Math.abs(combinedCoMX));
  const marginY = Math.max(0, halfTrackWidth - Math.abs(combinedCoMY));

  // Normalized Stability Index (0 - 100%)
  const normMarginX = Math.min(1, marginX / halfWheelbase);
  const normMarginY = Math.min(1, marginY / halfTrackWidth);
  const heightDamping = Math.max(0.45, 1.0 - deltaZ / 220);
  const rawStability =
    (Math.min(normMarginX, normMarginY) * 0.65 + ((normMarginX + normMarginY) / 2) * 0.35) *
    heightDamping *
    100;
  const stabilityIndex = Math.min(100, Math.max(0, Math.round(rawStability)));

  // Critical Static Tip-Over Angle Calculation
  // theta_tip = arctan(d_margin / Z_com)
  const tipOverPitchDeg = (Math.atan2(marginX, combinedCoMZ) * 180) / Math.PI;
  const tipOverRollDeg = (Math.atan2(marginY, combinedCoMZ) * 180) / Math.PI;

  // Individual Foot Ground Reaction Forces & Load Distribution (%)
  // Using 2D moment equilibrium relative to footprint rectangle
  const fFront = 0.5 + combinedCoMX / wheelbaseMm;
  const fRear = 0.5 - combinedCoMX / wheelbaseMm;
  const fLeft = 0.5 + combinedCoMY / trackWidthMm;
  const fRight = 0.5 - combinedCoMY / trackWidthMm;

  const rawFL = fFront * fLeft;
  const rawFR = fFront * fRight;
  const rawRL = fRear * fLeft;
  const rawRR = fRear * fRight;
  const sumRaw = rawFL + rawFR + rawRL + rawRR || 1;

  const pctFL = Math.round((rawFL / sumRaw) * 100);
  const pctFR = Math.round((rawFR / sumRaw) * 100);
  const pctRL = Math.round((rawRL / sumRaw) * 100);
  const pctRR = Math.round((rawRR / sumRaw) * 100);

  // Safe Operating Speed Limit Determination
  // Base top sprint speed: 3.5 m/s
  // Multipliers based on mass inertia, longitudinal/lateral asymmetry, and elevated vertical CoM
  const massRatioFactor = Math.sqrt(baseMassKg / totalMassKg);
  const longitudinalAsymmetryFactor = Math.max(0.5, 1.0 - (Math.abs(deltaX) / halfWheelbase) * 0.5);
  const lateralAsymmetryFactor = Math.max(0.4, 1.0 - (Math.abs(deltaY) / halfTrackWidth) * 0.65);
  const verticalHeightFactor = Math.max(0.6, baseCoMZ / combinedCoMZ);

  const calculatedSafeSpeed =
    3.5 *
    massRatioFactor *
    longitudinalAsymmetryFactor *
    lateralAsymmetryFactor *
    verticalHeightFactor;

  // Clamped safe operating speed limit (m/s)
  const safeOperatingSpeedLimit = parseFloat(
    Math.min(3.5, Math.max(0.4, calculatedSafeSpeed)).toFixed(2)
  );

  // Suggested Gait Recommendation based on payload mass and CoM stability
  let recommendedGait: 'walk' | 'trot' | 'gallop' | 'creep' = 'trot';
  let gaitJustification = 'Nominal balanced trot envelope';

  if (payloadMass > 7.0 || stabilityIndex < 50) {
    recommendedGait = 'creep';
    gaitJustification = 'Heavy mass/low margin requires 4-point creeping support';
  } else if (payloadMass > 4.0 || stabilityIndex < 72 || safeOperatingSpeedLimit < 1.4) {
    recommendedGait = 'walk';
    gaitJustification = 'Wave walk with continuous tripod ground contact';
  } else if (safeOperatingSpeedLimit >= 2.2 && stabilityIndex >= 85) {
    recommendedGait = 'gallop';
    gaitJustification = 'Optimal dynamic balance permits athletic sprint';
  } else {
    recommendedGait = 'trot';
    gaitJustification = 'Diagonal pair coordination maintains dynamic equilibrium';
  }

  // Active status level
  const isOverweight = payloadMass > 8.0;
  const isWarning = stabilityIndex < 65 || isOverweight || safeOperatingSpeedLimit < 1.2;
  const isCritical = stabilityIndex < 45 || payloadMass > 9.5;

  const currentVelocity = telemetry.emergencyStop ? 0 : telemetry.linearVelocity;
  const isSpeedExceeded = currentVelocity > safeOperatingSpeedLimit;

  // Apply safe operating speed limit to active controller
  const handleApplySpeedLimit = () => {
    updateTelemetry({
      linearVelocity: safeOperatingSpeedLimit,
      gait: telemetry.gait === 'gallop' && recommendedGait !== 'gallop' ? recommendedGait : telemetry.gait,
    });
  };

  // Preset Selection Handler
  const handleSelectPreset = (preset: PayloadPreset) => {
    setActivePreset(preset.id);
    setPayloadMass(preset.massKg);
    setPayloadX(preset.offsetXmm);
    setPayloadY(preset.offsetYmm);
    setPayloadZ(preset.heightZmm);
  };

  const handleReset = () => {
    const un = PRESETS[0];
    handleSelectPreset(un);
  };

  return (
    <div className="bg-[#050811] rounded-xl border border-slate-800/90 p-5 space-y-6 shadow-2xl">
      {/* Widget Header & Quick Status */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-['Chakra_Petch'] text-lg font-bold text-slate-100 uppercase tracking-wider">
                Payload Dynamics & Center of Mass Stability
              </h3>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold border ${
                  isCritical
                    ? 'bg-rose-950/80 text-rose-300 border-rose-700/80 animate-pulse'
                    : isWarning
                    ? 'bg-amber-950/80 text-amber-300 border-amber-700/80'
                    : 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80'
                }`}
              >
                {isCritical
                  ? 'CRITICAL ROLLOVER RISK'
                  : isWarning
                  ? 'CAUTION: REDUCED MARGIN'
                  : 'STABLE EQUILIBRIUM'}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Live multi-body mass moment calculation, ground support polygon projection, and dynamic speed cap advisor.
            </p>
          </div>
        </div>

        {/* Quick Reset & Total Mass Indicator */}
        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono">
            <span className="text-slate-400">Gross Mass: </span>
            <span className="text-cyan-300 font-bold tabular-nums">
              {totalMassKg.toFixed(1)} kg
            </span>
            <span className="text-slate-500 text-[11px] ml-1">
              ({baseMassKg}kg tare + {payloadMass.toFixed(1)}kg)
            </span>
          </div>

          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs font-mono text-slate-300 hover:text-white cursor-pointer transition-colors"
            title="Reset payload to 0 kg tare"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Preset Selector Chips */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Box className="w-3.5 h-3.5 text-cyan-400" />
            <span>Carrier Configuration Presets</span>
          </span>
          <span className="text-[11px] text-slate-500">
            Selected: <strong className="text-cyan-300 uppercase">{activePreset}</strong>
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {PRESETS.map((p) => {
            const isSelected = activePreset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => handleSelectPreset(p)}
                className={`p-2 rounded-lg border text-left cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-cyan-950/60 border-cyan-500/80 text-slate-100 shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                    : 'bg-slate-950/70 border-slate-800/80 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-['Chakra_Petch'] font-bold">
                  <span className={isSelected ? 'text-cyan-300' : 'text-slate-200'}>{p.name}</span>
                  <span className="text-[10px] font-mono text-amber-300">{p.massKg}kg</span>
                </div>
                <div className="text-[10px] font-mono text-slate-500 truncate mt-1">{p.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main 2-Column Section: Left Controls + Right Visualization & Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Sliders & Parameter Customizer (5 cols) */}
        <div className="lg:col-span-5 bg-slate-950/90 rounded-xl border border-slate-800/80 p-4 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800/70">
            <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>Payload Geometry & Mass</span>
            </span>
            <span className="text-[11px] font-mono text-cyan-400">Custom Tuner</span>
          </div>

          {/* Slider 1: Added Mass */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <label htmlFor={payloadMassId} className="text-slate-400 cursor-pointer">Added Payload Mass:</label>
              <div className="flex items-center gap-1">
                <span className="text-slate-200 font-bold tabular-nums text-sm">
                  {payloadMass.toFixed(1)}
                </span>
                <span className="text-slate-500 text-[11px]">kg / 10.0 kg max</span>
              </div>
            </div>
            <input
              id={payloadMassId}
              type="range"
              min="0"
              max="10.0"
              step="0.1"
              value={payloadMass}
              onChange={(e) => {
                setPayloadMass(parseFloat(e.target.value));
                setActivePreset('custom');
              }}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>0 kg (Bare)</span>
              <span>Rated: 5.0 kg</span>
              <span className={payloadMass > 8.0 ? 'text-rose-400 font-bold' : ''}>
                10 kg (Structural Max)
              </span>
            </div>
          </div>

          {/* Slider 2: Longitudinal Position (X Fore / Aft) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <label htmlFor={payloadXId} className="text-slate-400 cursor-pointer">Fore / Aft Position (X):</label>
              <div className="flex items-center gap-1">
                <span className="text-slate-200 font-bold tabular-nums text-sm">
                  {payloadX > 0 ? `+${payloadX}` : payloadX}
                </span>
                <span className="text-slate-500 text-[11px]">
                  mm ({payloadX > 10 ? 'Fore Bias' : payloadX < -10 ? 'Aft Bias' : 'Neutral'})
                </span>
              </div>
            </div>
            <input
              id={payloadXId}
              type="range"
              min="-180"
              max="180"
              step="5"
              value={payloadX}
              onChange={(e) => {
                setPayloadX(parseInt(e.target.value, 10));
                setActivePreset('custom');
              }}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>-180 mm (Aft Haunches)</span>
              <span>0 (Center)</span>
              <span>+180 mm (Fore Sholders)</span>
            </div>
          </div>

          {/* Slider 3: Lateral Position (Y Port / Starboard) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <label htmlFor={payloadYId} className="text-slate-400 cursor-pointer">Lateral Position (Y):</label>
              <div className="flex items-center gap-1">
                <span className="text-slate-200 font-bold tabular-nums text-sm">
                  {payloadY > 0 ? `+${payloadY}` : payloadY}
                </span>
                <span className="text-slate-500 text-[11px]">
                  mm ({payloadY > 5 ? 'Port / Left' : payloadY < -5 ? 'Starboard / Right' : 'Center'})
                </span>
              </div>
            </div>
            <input
              id={payloadYId}
              type="range"
              min="-95"
              max="95"
              step="5"
              value={payloadY}
              onChange={(e) => {
                setPayloadY(parseInt(e.target.value, 10));
                setActivePreset('custom');
              }}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>-95 mm (Starboard)</span>
              <span>0 (Symmetric)</span>
              <span>+95 mm (Port)</span>
            </div>
          </div>

          {/* Slider 4: Vertical Mount Height (Z) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <label htmlFor={payloadZId} className="text-slate-400 cursor-pointer">Mount Height Above Deck (Z):</label>
              <div className="flex items-center gap-1">
                <span className="text-slate-200 font-bold tabular-nums text-sm">+{payloadZ}</span>
                <span className="text-slate-500 text-[11px]">mm above top plate</span>
              </div>
            </div>
            <input
              id={payloadZId}
              type="range"
              min="10"
              max="160"
              step="5"
              value={payloadZ}
              onChange={(e) => {
                setPayloadZ(parseInt(e.target.value, 10));
                setActivePreset('custom');
              }}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>+10 mm (Low Profile)</span>
              <span>+85 mm (Medium)</span>
              <span className={payloadZ > 100 ? 'text-amber-400 font-semibold' : ''}>
                +160 mm (Elevated Mast)
              </span>
            </div>
          </div>

          {/* Static Stability Index Gauge Bar */}
          <div className="pt-3 border-t border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Static Stability Margin (SSM):</span>
              </span>
              <span
                className={`font-['Chakra_Petch'] text-sm font-bold tabular-nums ${
                  stabilityIndex > 75
                    ? 'text-emerald-400'
                    : stabilityIndex > 50
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {stabilityIndex}%
              </span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden flex">
              <div
                className={`h-full transition-all duration-300 ${
                  stabilityIndex > 75
                    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]'
                    : stabilityIndex > 50
                    ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                    : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)] animate-pulse'
                }`}
                style={{ width: `${stabilityIndex}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>0% (Unstable / Tipover)</span>
              <span>50% (Threshold)</span>
              <span>100% (Centered Peak)</span>
            </div>
          </div>
        </div>

        {/* Right Column: 2D Support Polygon Radar + CoM Vector Shift + Speed Advisor (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Top Half: 2D Visual Support Polygon & CoM Shift Radar */}
          <div className="bg-slate-950/90 rounded-xl border border-slate-800/80 p-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/70 text-xs font-mono">
              <span className="text-slate-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                <span>Support Polygon & Center of Mass (CoM) Projection</span>
              </span>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" />
                  <span>Base Tare</span>
                </span>
                <span className="flex items-center gap-1 text-amber-400">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                  <span>Payload</span>
                </span>
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                  <span>Combined CoM</span>
                </span>
              </div>
            </div>

            {/* SVG Visual Support Polygon Diagram */}
            <div className="py-2">
              <div className="relative w-full h-[185px] bg-[#03060f] rounded-lg border border-slate-800/80 overflow-hidden flex items-center justify-center">
                <svg
                  viewBox="-170 -120 340 240"
                  className="w-full h-full select-none"
                  preserveAspectRatio="xMidYMid meet"
                >
                  {/* Grid Lines */}
                  <line x1="-160" y1="0" x2="160" y2="0" stroke="#1e293b" strokeDasharray="3 3" />
                  <line x1="0" y1="-110" x2="0" y2="110" stroke="#1e293b" strokeDasharray="3 3" />
                  <circle cx="0" cy="0" r="40" fill="none" stroke="#0f172a" strokeWidth="1" />
                  <circle cx="0" cy="0" r="80" fill="none" stroke="#0f172a" strokeWidth="1" />

                  {/* Footprint Support Polygon (Trapezoid / Rectangle) */}
                  {/* FL: (+105, -62), FR: (+105, +62), RR: (-105, +62), RL: (-105, -62) */}
                  {/* Coordinate mapping: X -> screen X (fore right, aft left), Y -> screen Y (port up, stbd down) */}
                  <polygon
                    points="105,-62 105,62 -105,62 -105,-62"
                    fill="rgba(6, 182, 212, 0.04)"
                    stroke="rgba(6, 182, 212, 0.4)"
                    strokeWidth="1.5"
                    strokeDasharray="4 2"
                  />

                  {/* Safe Inner Kernel (60% scale) */}
                  <polygon
                    points="63,-37 63,37 -63,37 -63,-37"
                    fill="rgba(52, 211, 153, 0.05)"
                    stroke="rgba(52, 211, 153, 0.25)"
                    strokeWidth="1"
                  />

                  {/* Robot Chassis Exoskeleton Outline */}
                  <rect
                    x="-85"
                    y="-38"
                    width="170"
                    height="76"
                    rx="8"
                    fill="rgba(15, 23, 42, 0.6)"
                    stroke="#334155"
                    strokeWidth="1"
                  />

                  {/* 4 Feet Contact Nodes with Live Load Percentage Badges */}
                  {/* FL (Fore Port): x = +105, y = -62 */}
                  <circle cx="105" cy="-62" r="5" fill="#0284c7" stroke="#e0f2fe" strokeWidth="1.5" />
                  <text x="105" y="-72" textAnchor="middle" fill="#7dd3fc" fontSize="9" fontFamily="monospace">
                    FL {pctFL}%
                  </text>

                  {/* FR (Fore Starboard): x = +105, y = +62 */}
                  <circle cx="105" cy="62" r="5" fill="#0284c7" stroke="#e0f2fe" strokeWidth="1.5" />
                  <text x="105" y="78" textAnchor="middle" fill="#7dd3fc" fontSize="9" fontFamily="monospace">
                    FR {pctFR}%
                  </text>

                  {/* RL (Aft Port): x = -105, y = -62 */}
                  <circle cx="-105" cy="-62" r="5" fill="#0284c7" stroke="#e0f2fe" strokeWidth="1.5" />
                  <text x="-105" y="-72" textAnchor="middle" fill="#7dd3fc" fontSize="9" fontFamily="monospace">
                    RL {pctRL}%
                  </text>

                  {/* RR (Aft Starboard): x = -105, y = +62 */}
                  <circle cx="-105" cy="62" r="5" fill="#0284c7" stroke="#e0f2fe" strokeWidth="1.5" />
                  <text x="-105" y="78" textAnchor="middle" fill="#7dd3fc" fontSize="9" fontFamily="monospace">
                    RR {pctRR}%
                  </text>

                  {/* Nominal Base Center of Mass (0, 0) */}
                  <circle cx="0" cy="0" r="4" fill="#06b6d4" />
                  <circle cx="0" cy="0" r="7" fill="none" stroke="#06b6d4" strokeWidth="1" opacity="0.6" />

                  {/* Payload Position Marker */}
                  {/* Scale: wheelbase 420mm -> 210 svg units (scale factor 0.5) */}
                  {/* Lateral 250mm -> 125 svg units (scale factor 0.5) */}
                  {payloadMass > 0 && (
                    <>
                      <circle
                        cx={payloadX * 0.5}
                        cy={-payloadY * 0.5}
                        r="4"
                        fill="#f59e0b"
                      />
                      <circle
                        cx={payloadX * 0.5}
                        cy={-payloadY * 0.5}
                        r="8"
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="1"
                        strokeDasharray="2 2"
                      />
                    </>
                  )}

                  {/* Center of Mass Shift Vector (Line from Base CoM (0,0) to Combined CoM) */}
                  {shiftMagnitude > 0.5 && (
                    <line
                      x1="0"
                      y1="0"
                      x2={combinedCoMX * 0.5}
                      y2={-combinedCoMY * 0.5}
                      stroke={stabilityIndex > 65 ? '#10b981' : '#f43f5e'}
                      strokeWidth="2"
                      markerEnd="url(#arrow)"
                    />
                  )}

                  {/* Combined Resultant Center of Mass */}
                  <circle
                    cx={combinedCoMX * 0.5}
                    cy={-combinedCoMY * 0.5}
                    r={stabilityIndex > 65 ? '5' : '6'}
                    fill={stabilityIndex > 65 ? '#10b981' : stabilityIndex > 45 ? '#f59e0b' : '#f43f5e'}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />

                  {/* Head / Fore Direction Arrow */}
                  <polygon points="95,-6 103,0 95,6" fill="#38bdf8" opacity="0.8" />
                  <text x="80" y="3" fill="#64748b" fontSize="7" fontFamily="monospace">
                    FORE
                  </text>
                  <text x="-95" y="3" fill="#64748b" fontSize="7" fontFamily="monospace">
                    AFT
                  </text>
                </svg>

                {/* SVG Overlay HUD Labels */}
                <div className="absolute top-2 left-2 text-[10px] font-mono text-slate-400 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800/60">
                  <span>Shift: </span>
                  <strong className="text-cyan-300">ΔR {shiftMagnitude.toFixed(1)} mm</strong>
                </div>

                <div className="absolute top-2 right-2 text-[10px] font-mono text-slate-400 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800/60">
                  <span>Z-Elev: </span>
                  <strong className="text-amber-300">{combinedCoMZ.toFixed(0)} mm</strong>
                </div>

                <div className="absolute bottom-2 left-2 text-[9px] font-mono text-slate-500">
                  Tip Pitch: <strong className="text-slate-300">±{tipOverPitchDeg.toFixed(1)}°</strong> | Tip Roll: <strong className="text-slate-300">±{tipOverRollDeg.toFixed(1)}°</strong>
                </div>
              </div>
            </div>

            {/* Numerical Shift Readouts */}
            <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-800/70 text-center font-mono">
              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <div className="text-[9px] text-slate-500 uppercase">Longitudinal (ΔX)</div>
                <div className="text-xs font-bold text-cyan-300 tabular-nums">
                  {deltaX >= 0 ? `+${deltaX.toFixed(1)}` : deltaX.toFixed(1)} mm
                </div>
              </div>
              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <div className="text-[9px] text-slate-500 uppercase">Lateral (ΔY)</div>
                <div className="text-xs font-bold text-cyan-300 tabular-nums">
                  {deltaY >= 0 ? `+${deltaY.toFixed(1)}` : deltaY.toFixed(1)} mm
                </div>
              </div>
              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <div className="text-[9px] text-slate-500 uppercase">Vertical (ΔZ)</div>
                <div className="text-xs font-bold text-amber-300 tabular-nums">
                  +{deltaZ.toFixed(1)} mm
                </div>
              </div>
              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <div className="text-[9px] text-slate-500 uppercase">Net Vector (ΔR)</div>
                <div className="text-xs font-bold text-emerald-400 tabular-nums">
                  {shiftMagnitude.toFixed(1)} mm
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Half: SAFE OPERATING SPEED LIMIT ADVISOR & GAIT SUGGESTION */}
          <div className="bg-slate-950/90 rounded-xl border border-slate-800/80 p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/70 text-xs font-mono">
              <span className="text-slate-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                <span>Kinematic Safe Operating Speed Limits</span>
              </span>
              <span className="text-[11px] text-slate-400">
                Current Speed: <strong className="text-white">{currentVelocity.toFixed(2)} m/s</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Box 1: Suggested Safe Speed Cap */}
              <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                <div className="text-[10px] font-mono text-slate-400 uppercase">
                  Suggested Max Speed
                </div>
                <div className="my-1">
                  <div className="font-['Chakra_Petch'] text-2xl font-bold text-cyan-300 tabular-nums">
                    {safeOperatingSpeedLimit.toFixed(2)}{' '}
                    <span className="text-xs font-mono text-slate-400 font-normal">m/s</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    {(safeOperatingSpeedLimit * 3.6).toFixed(1)} km/h
                  </div>
                </div>
                <div className="text-[10px] font-mono text-slate-500">
                  Down from 3.50 m/s tare max
                </div>
              </div>

              {/* Box 2: Suggested Optimal Gait */}
              <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                <div className="text-[10px] font-mono text-slate-400 uppercase">
                  Recommended Gait
                </div>
                <div className="my-1">
                  <div className="font-['Chakra_Petch'] text-2xl font-bold text-emerald-300 uppercase">
                    {recommendedGait}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 truncate">
                    Active: <span className="text-cyan-300 uppercase">{telemetry.gait}</span>
                  </div>
                </div>
                <div className="text-[10px] font-mono text-slate-500 truncate" title={gaitJustification}>
                  {gaitJustification}
                </div>
              </div>

              {/* Box 3: Over-Speed Sentinel & Action Button */}
              <div
                className={`p-3 rounded-lg border flex flex-col justify-between transition-all ${
                  isSpeedExceeded
                    ? 'bg-rose-950/40 border-rose-500/80 shadow-[0_0_12px_rgba(244,63,94,0.2)]'
                    : 'bg-slate-900/90 border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono uppercase">
                  <span>Speed Compliance</span>
                  {isSpeedExceeded ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400 animate-bounce" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                </div>

                <div className="my-1">
                  <div
                    className={`font-['Chakra_Petch'] text-base font-bold uppercase ${
                      isSpeedExceeded ? 'text-rose-400' : 'text-emerald-300'
                    }`}
                  >
                    {isSpeedExceeded ? 'VELOCITY EXCEEDED' : 'WITHIN SAFE ENVELOPE'}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400">
                    {isSpeedExceeded
                      ? `Exceeds limit by +${(currentVelocity - safeOperatingSpeedLimit).toFixed(2)} m/s`
                      : 'Margin headroom: OK'}
                  </div>
                </div>

                <button
                  onClick={handleApplySpeedLimit}
                  className={`w-full py-1.5 px-2 rounded text-xs font-mono font-bold cursor-pointer transition-colors flex items-center justify-center gap-1.5 ${
                    isSpeedExceeded
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-md'
                      : 'bg-cyan-950 hover:bg-cyan-900 border border-cyan-700/60 text-cyan-300'
                  }`}
                  title="Apply recommended speed limit to virtual controller"
                >
                  <Gauge className="w-3 h-3" />
                  <span>Clamp to {safeOperatingSpeedLimit.toFixed(2)} m/s</span>
                </button>
              </div>
            </div>

            {/* Diagnostic Note Banner */}
            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/60 flex items-start gap-2 text-xs font-mono text-slate-400">
              <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed text-[11px]">
                <strong>Kinematic Governor Rule:</strong> Dynamic turning radii and stride frequencies are mathematically constrained when carried weight creates an asymmetric torque bias over Front-Left ({pctFL}%) and Rear-Right ({pctRR}%) drive units to prevent planetary gearbox overheating.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
