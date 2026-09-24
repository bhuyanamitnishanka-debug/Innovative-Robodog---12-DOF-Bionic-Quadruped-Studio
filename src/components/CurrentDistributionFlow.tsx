import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { TelemetryState, DiagnosticEvent } from '../types/robotics';
import { audioSynth } from '../utils/audioSynthesizer';
import {
  Zap,
  Activity,
  Cpu,
  AlertTriangle,
  RotateCcw,
  Play,
  Pause,
  Sliders,
  ShieldAlert,
  CheckCircle2,
  Info,
  Gauge,
  TrendingUp,
  Layers,
  Power,
  BatteryCharging,
  Maximize2,
  Minimize2,
  ArrowRight,
  Sparkles,
  Flame,
  Radio,
  RefreshCw,
} from 'lucide-react';

interface CurrentDistributionFlowProps {
  telemetry: TelemetryState;
  updateTelemetry?: (partial: Partial<TelemetryState>) => void;
  onLogDiagnosticEvent?: (event: Omit<DiagnosticEvent, 'id' | 'timestamp' | 'relativeTimeMs'>) => void;
}

export type DisplayMode = 'amperage' | 'power' | 'joule_loss' | 'efficiency';
export type LegRailId = 'fl' | 'fr' | 'rl' | 'rr';

interface RailState {
  id: LegRailId;
  name: string;
  shortName: string;
  color: string;
  hexColor: string;
  glowColor: string;
  current: number;       // Amperes
  voltage: number;       // Volts
  power: number;         // Watts
  percentOfTotal: number;// %
  eFuseStatus: 'closed' | 'warning' | 'tripped';
  tripThreshold: number; // A (e.g. 24.0 A)
  jointBreakdown: {
    roll: { current: number; power: number; pwm: number; temp: number; name: string };
    pitch: { current: number; power: number; pwm: number; temp: number; name: string };
    knee: { current: number; power: number; pwm: number; temp: number; name: string };
  };
  phaseRippleMilliAmps: number;
  resistanceMilliOhms: number;
  jouleLossWatts: number;
  isStancePhase: boolean;
}

interface AvionicsRailState {
  id: 'avionics';
  name: string;
  color: string;
  hexColor: string;
  current: number;
  voltage: number;
  power: number;
  percentOfTotal: number;
  subsystems: {
    mcu: { name: string; current: number; power: number; desc: string };
    vision: { name: string; current: number; power: number; desc: string };
    cooling: { name: string; current: number; power: number; desc: string };
    canBus: { name: string; current: number; power: number; desc: string };
  };
}

export const CurrentDistributionFlow: React.FC<CurrentDistributionFlowProps> = ({
  telemetry,
  updateTelemetry,
  onLogDiagnosticEvent,
}) => {
  // Play/pause simulation animation
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('amperage');
  const [flowSpeed, setFlowSpeed] = useState<'slow' | 'normal' | 'fast' | 'off'>('normal');
  const [selectedRail, setSelectedRail] = useState<LegRailId | 'avionics' | 'main' | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [expandJoints, setExpandJoints] = useState<boolean>(true);
  const [showParticleFlow, setShowParticleFlow] = useState<boolean>(true);

  // Manual e-fuse trip overrides for interactive fault injection
  const [trippedRails, setTrippedRails] = useState<Record<LegRailId, boolean>>({
    fl: false,
    fr: false,
    rl: false,
    rr: false,
  });

  // Simulated current surge test preset state
  const [activePreset, setActivePreset] = useState<string | null>('dynamic_trot');
  const [regenSpikeActive, setRegenSpikeActive] = useState<boolean>(false);
  const [dashOffset, setDashOffset] = useState<number>(0);

  // Telemetry history buffer for selected rail oscilloscope mini-chart
  const [historyBuffer, setHistoryBuffer] = useState<{ time: number; fl: number; fr: number; rl: number; rr: number; total: number }[]>([]);

  // Simulation phase generator (for stance/swing pulsation in gait)
  const animFrameRef = useRef<number | null>(null);
  const phaseTimerRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(performance.now());

  // Animation ticker for SVG dash offsets and rhythmic gait pulses
  useEffect(() => {
    let running = true;
    const animate = (time: number) => {
      const dt = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      if (isPlaying && running) {
        const speedMultiplier = flowSpeed === 'fast' ? 2.2 : flowSpeed === 'slow' ? 0.5 : flowSpeed === 'off' ? 0 : 1.0;
        phaseTimerRef.current += dt * (telemetry.swingFrequency || 1.8) * Math.PI * 2 * speedMultiplier;

        // Flow particles dash offset progression
        setDashOffset((prev) => (prev - dt * 28 * speedMultiplier) % 100);
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, flowSpeed, telemetry.swingFrequency]);

  // Derive Dynamic Real-Time Rail Amperages based on Telemetry + Gait
  const calculatedRails = useMemo(() => {
    const p = phaseTimerRef.current;
    const gait = telemetry.gait || 'trot';
    const baseVoltage = telemetry.voltage > 30 ? telemetry.voltage : 48.2;
    const baseCurrent = Math.max(1.8, telemetry.current || 4.8);

    // Stance phase weighting based on gait
    let stanceWeights = { fl: 0.5, fr: 0.5, rl: 0.5, rr: 0.5 };

    if (gait === 'trot') {
      // Diagonal pairs (FL+RR) vs (FR+RL)
      const diagonalA = (Math.sin(p) + 1) / 2; // 0..1
      const diagonalB = 1 - diagonalA;
      stanceWeights = {
        fl: 0.25 + 0.75 * diagonalA,
        rr: 0.25 + 0.75 * diagonalA,
        fr: 0.25 + 0.75 * diagonalB,
        rl: 0.25 + 0.75 * diagonalB,
      };
    } else if (gait === 'gallop' || gait === 'bound') {
      // Rear vs Front surge
      const rearSurge = (Math.sin(p) + 1) / 2;
      const frontSurge = (Math.sin(p - Math.PI * 0.5) + 1) / 2;
      stanceWeights = {
        fl: 0.2 + 0.8 * frontSurge,
        fr: 0.2 + 0.8 * frontSurge,
        rl: 0.2 + 0.8 * rearSurge,
        rr: 0.2 + 0.8 * rearSurge,
      };
    } else if (gait === 'stand') {
      stanceWeights = { fl: 0.5, fr: 0.5, rl: 0.5, rr: 0.5 };
    } else {
      // Walk / 4-beat cycle
      stanceWeights = {
        fl: 0.3 + 0.7 * Math.max(0, Math.sin(p)),
        fr: 0.3 + 0.7 * Math.max(0, Math.sin(p + Math.PI * 0.5)),
        rl: 0.3 + 0.7 * Math.max(0, Math.sin(p + Math.PI)),
        rr: 0.3 + 0.7 * Math.max(0, Math.sin(p + Math.PI * 1.5)),
      };
    }

    // Avionics rail draws stable ~1.05A at 48V (~50W)
    const avionicsCurrent = 0.95 + 0.1 * Math.sin(p * 0.3);
    const avionicsPower = avionicsCurrent * baseVoltage;

    // Remaining current distributed among 4 limbs
    const actuatorTotalCurrentBudget = Math.max(0.8, baseCurrent - avionicsCurrent);

    // Compute raw limb currents
    const torqueFL = Math.max(0.5, telemetry.legs?.fl?.torque || 14.5);
    const torqueFR = Math.max(0.5, telemetry.legs?.fr?.torque || 13.8);
    const torqueRL = Math.max(0.5, telemetry.legs?.rl?.torque || 16.2);
    const torqueRR = Math.max(0.5, telemetry.legs?.rr?.torque || 15.9);

    const weightedFL = torqueFL * stanceWeights.fl;
    const weightedFR = torqueFR * stanceWeights.fr;
    const weightedRL = torqueRL * stanceWeights.rl;
    const weightedRR = torqueRR * stanceWeights.rr;

    const totalWeight = Math.max(0.1, weightedFL + weightedFR + weightedRL + weightedRR);

    let curFL = (weightedFL / totalWeight) * actuatorTotalCurrentBudget;
    let curFR = (weightedFR / totalWeight) * actuatorTotalCurrentBudget;
    let curRL = (weightedRL / totalWeight) * actuatorTotalCurrentBudget;
    let curRR = (weightedRR / totalWeight) * actuatorTotalCurrentBudget;

    // Zero out tripped rails
    if (trippedRails.fl) curFL = 0;
    if (trippedRails.fr) curFR = 0;
    if (trippedRails.rl) curRL = 0;
    if (trippedRails.rr) curRR = 0;

    // If regenerative braking spike active
    if (regenSpikeActive) {
      curFL = -0.8;
      curFR = -0.9;
      curRL = -1.1;
      curRR = -1.0;
    }

    const totalPackCurrent = (regenSpikeActive ? -2.85 : (curFL + curFR + curRL + curRR + avionicsCurrent));
    const totalPackPower = totalPackCurrent * baseVoltage;

    // Helper to generate limb detailed object
    const buildLimb = (
      id: LegRailId,
      name: string,
      shortName: string,
      color: string,
      hexColor: string,
      glowColor: string,
      current: number,
      isStance: boolean,
      legTelemetry: any
    ): RailState => {
      const isTripped = trippedRails[id];
      const eFuseStatus: 'closed' | 'warning' | 'tripped' = isTripped
        ? 'tripped'
        : current > 18.0
        ? 'warning'
        : 'closed';

      const railVoltage = Math.max(38.0, baseVoltage - current * 0.045); // slight line drop
      const power = current * railVoltage;
      const share = totalPackCurrent > 0.1 ? Math.max(0, (current / totalPackCurrent) * 100) : 0;

      // Joint current split: Hip Roll (20%), Hip Pitch (40%), Knee Pitch (40%)
      const rollFrac = 0.20 + 0.04 * Math.sin(p + (id === 'fl' ? 0 : 1));
      const pitchFrac = 0.40 - 0.02 * Math.cos(p);
      const kneeFrac = Math.max(0.1, 1 - (rollFrac + pitchFrac));

      const rollCurrent = current * rollFrac;
      const pitchCurrent = current * pitchFrac;
      const kneeCurrent = current * kneeFrac;

      const rollTemp = legTelemetry?.hipRollTemp || legTelemetry?.temperature || 36.5;
      const pitchTemp = legTelemetry?.hipPitchTemp || legTelemetry?.temperature || 38.2;
      const kneeTemp = legTelemetry?.kneePitchTemp || (legTelemetry?.temperature ? legTelemetry.temperature + 4.5 : 43.2);

      // Phase winding Joule loss: 3 * I_phase^2 * R_ph
      const rPhase = 0.052; // 52 mOhms phase resistance
      const jouleLossWatts = isTripped ? 0 : 3 * Math.pow(current / Math.sqrt(3), 2) * rPhase;

      return {
        id,
        name,
        shortName,
        color,
        hexColor,
        glowColor,
        current,
        voltage: railVoltage,
        power,
        percentOfTotal: share,
        eFuseStatus,
        tripThreshold: 24.0,
        jointBreakdown: {
          roll: {
            current: rollCurrent,
            power: rollCurrent * railVoltage,
            pwm: Math.min(100, Math.round((rollCurrent / 8.0) * 100)),
            temp: rollTemp,
            name: `${shortName}-M1 Abduction/Roll`,
          },
          pitch: {
            current: pitchCurrent,
            power: pitchCurrent * railVoltage,
            pwm: Math.min(100, Math.round((pitchCurrent / 10.0) * 100)),
            temp: pitchTemp,
            name: `${shortName}-M2 Hip Pitch`,
          },
          knee: {
            current: kneeCurrent,
            power: kneeCurrent * railVoltage,
            pwm: Math.min(100, Math.round((kneeCurrent / 12.0) * 100)),
            temp: kneeTemp,
            name: `${shortName}-M3 Knee Pitch`,
          },
        },
        phaseRippleMilliAmps: isTripped ? 0 : Math.round(18 + current * 4.2),
        resistanceMilliOhms: 45,
        jouleLossWatts,
        isStancePhase: isStance,
      };
    };

    const flRail = buildLimb('fl', 'Front-Left Power Rail', 'FL', 'cyan', '#06b6d4', 'rgba(6, 182, 212, 0.4)', curFL, stanceWeights.fl > 0.5, telemetry.legs?.fl);
    const frRail = buildLimb('fr', 'Front-Right Power Rail', 'FR', 'sky', '#38bdf8', 'rgba(56, 189, 248, 0.4)', curFR, stanceWeights.fr > 0.5, telemetry.legs?.fr);
    const rlRail = buildLimb('rl', 'Rear-Left Power Rail', 'RL', 'emerald', '#10b981', 'rgba(16, 185, 129, 0.4)', curRL, stanceWeights.rl > 0.5, telemetry.legs?.rl);
    const rrRail = buildLimb('rr', 'Rear-Right Power Rail', 'RR', 'amber', '#f59e0b', 'rgba(245, 158, 11, 0.4)', curRR, stanceWeights.rr > 0.5, telemetry.legs?.rr);

    const avionicsRail: AvionicsRailState = {
      id: 'avionics',
      name: 'Avionics & Core Compute Rail',
      color: 'purple',
      hexColor: '#a855f7',
      current: avionicsCurrent,
      voltage: baseVoltage,
      power: avionicsPower,
      percentOfTotal: totalPackCurrent > 0 ? (avionicsCurrent / totalPackCurrent) * 100 : 0,
      subsystems: {
        mcu: { name: 'STM32H7 Core M7/M4 + CAN-FD', current: 0.28, power: 0.28 * 48, desc: '1000Hz Deterministic Loop' },
        vision: { name: 'Edge AI NPU + LiDAR + Depth', current: 0.42, power: 0.42 * 48, desc: 'Spatial SLAM & VLA Node' },
        cooling: { name: 'Active Ducted Brushless Blowers', current: 0.18, power: 0.18 * 48, desc: 'Torque Motor Stator Coolers' },
        canBus: { name: 'Dual Isolated CAN-FD Transceivers', current: 0.07, power: 0.07 * 48, desc: '5Mbps Actuator Data Phase' },
      },
    };

    return {
      baseVoltage,
      totalPackCurrent,
      totalPackPower,
      fl: flRail,
      fr: frRail,
      rl: rlRail,
      rr: rrRail,
      avionics: avionicsRail,
      totalJouleLossWatts: flRail.jouleLossWatts + frRail.jouleLossWatts + rlRail.jouleLossWatts + rrRail.jouleLossWatts,
      efficiencyPercent: Math.min(99.2, Math.max(88, ((totalPackPower - (flRail.jouleLossWatts + frRail.jouleLossWatts + rlRail.jouleLossWatts + rrRail.jouleLossWatts)) / Math.max(1, totalPackPower)) * 100)),
    };
  }, [telemetry, trippedRails, regenSpikeActive]);

  // Keep a running buffer of history for oscilloscope
  useEffect(() => {
    const timer = setInterval(() => {
      setHistoryBuffer((prev) => {
        const next = [
          ...prev.slice(-30),
          {
            time: Date.now(),
            fl: calculatedRails.fl.current,
            fr: calculatedRails.fr.current,
            rl: calculatedRails.rl.current,
            rr: calculatedRails.rr.current,
            total: calculatedRails.totalPackCurrent,
          },
        ];
        return next;
      });
    }, 250);
    return () => clearInterval(timer);
  }, [calculatedRails]);

  // Handle manual e-fuse toggle
  const handleToggleEFuse = useCallback((railId: LegRailId) => {
    setTrippedRails((prev) => {
      const nextState = !prev[railId];
      if (nextState) {
        audioSynth.playAlert(telemetry.audioEnabled);
        if (onLogDiagnosticEvent) {
          onLogDiagnosticEvent({
            severity: 'critical',
            subsystem: 'ACTUATORS',
            code: 'RAIL_EFUSE_OPEN',
            message: `Electronic circuit breaker TRIPPED on ${railId.toUpperCase()} leg rail. Solid-state high-side switch isolated branch.`,
            metric: `Rail: ${railId.toUpperCase()} | Status: ISOLATED | 0.0A`,
          });
        }
      } else {
        audioSynth.playDockingLatch(telemetry.audioEnabled);
        if (onLogDiagnosticEvent) {
          onLogDiagnosticEvent({
            severity: 'info',
            subsystem: 'ACTUATORS',
            code: 'RAIL_EFUSE_RESET',
            message: `Electronic circuit breaker RESET for ${railId.toUpperCase()} leg rail. Branch re-energized.`,
            metric: `Rail: ${railId.toUpperCase()} | Status: ENERGIZED`,
          });
        }
      }
      return { ...prev, [railId]: nextState };
    });
  }, [telemetry.audioEnabled, onLogDiagnosticEvent]);

  // Handle Preset Selection
  const applyPreset = (presetName: string) => {
    setActivePreset(presetName);
    setRegenSpikeActive(false);

    if (presetName === 'dynamic_trot') {
      if (updateTelemetry) {
        updateTelemetry({
          gait: 'trot',
          linearVelocity: 1.6,
          swingFrequency: 2.1,
          current: 6.8,
          power: 326.0,
        });
      }
    } else if (presetName === 'sprint_surge') {
      audioSynth.playPowerBurst(telemetry.audioEnabled);
      if (updateTelemetry) {
        updateTelemetry({
          gait: 'gallop',
          linearVelocity: 3.2,
          swingFrequency: 3.4,
          current: 24.8,
          power: 1180.0,
        });
      }
      if (onLogDiagnosticEvent) {
        onLogDiagnosticEvent({
          severity: 'warning',
          subsystem: 'BMS-48V',
          code: 'SURGE_BURST_PEAK',
          message: 'High-current gallop surge engaged. Bus current peak at 24.8A across all 4 rails.',
          metric: 'Bus: 24.8A | 1.18 kW',
        });
      }
    } else if (presetName === 'hill_climb') {
      if (updateTelemetry) {
        updateTelemetry({
          gait: 'walk',
          linearVelocity: 0.8,
          swingFrequency: 1.2,
          bodyPitch: 14,
          current: 11.4,
          power: 545.0,
          legs: {
            ...telemetry.legs,
            rl: { ...telemetry.legs.rl, torque: 34.0 },
            rr: { ...telemetry.legs.rr, torque: 33.2 },
          },
        });
      }
    } else if (presetName === 'regen_brake') {
      setRegenSpikeActive(true);
      audioSynth.playDockingLatch(telemetry.audioEnabled);
      if (updateTelemetry) {
        updateTelemetry({
          linearVelocity: 0.2,
          current: -2.8,
          power: -135.0,
        });
      }
      if (onLogDiagnosticEvent) {
        onLogDiagnosticEvent({
          severity: 'info',
          subsystem: 'BMS-48V',
          code: 'REGEN_BRAKING_PULSE',
          message: 'Regenerative deceleration active. Inverters backfeeding kinetic energy to 48V battery.',
          metric: 'Reverse Current: -2.85A | 137W Recycled',
        });
      }
    } else if (presetName === 'fault_rl') {
      setTrippedRails((prev) => ({ ...prev, rl: true }));
      audioSynth.playAlert(telemetry.audioEnabled);
      if (onLogDiagnosticEvent) {
        onLogDiagnosticEvent({
          severity: 'critical',
          subsystem: 'ACTUATORS',
          code: 'OVERCURRENT_TRIP_RL',
          message: 'Rear-Left limb e-Fuse tripped due to simulated continuous stall overload >24A.',
          metric: 'RL Rail: 0.0A (TRIPPED)',
        });
      }
    } else if (presetName === 'idle_stand') {
      setTrippedRails({ fl: false, fr: false, rl: false, rr: false });
      if (updateTelemetry) {
        updateTelemetry({
          gait: 'stand',
          linearVelocity: 0,
          swingFrequency: 0.8,
          current: 3.2,
          power: 154.0,
        });
      }
    }
  };

  // SVG Sankey Layout Geometry
  // Layout dimensions:
  // Width: 1040, Height: 580
  const svgWidth = 1040;
  const svgHeight = 560;

  // Column Positions (X coordinates):
  // Col 0: Battery & BMS Source (x: 40)
  // Col 1: High-Voltage Common PDU Busbar (x: 240)
  // Col 2: 5 Rails (FL, FR, RL, RR, Avionics) (x: 520)
  // Col 3: Joint Actuators / Subsystems Sinks (x: 820)
  const colX = {
    source: 40,
    sourceW: 130,
    pdu: 240,
    pduW: 110,
    rails: 500,
    railsW: 140,
    sinks: 810,
    sinksW: 180,
  };

  // Proportional Ribbon Width calculation helper
  // Maps amperes or watts to ribbon height with minimum aesthetic clamping
  const totalDisplayVal = displayMode === 'power'
    ? Math.max(10, Math.abs(calculatedRails.totalPackPower))
    : displayMode === 'joule_loss'
    ? Math.max(5, calculatedRails.totalJouleLossWatts * 6)
    : Math.max(1, Math.abs(calculatedRails.totalPackCurrent));

  const getRibbonH = (val: number, maxAvailableH: number = 70, minH: number = 8) => {
    if (val <= 0.001) return 4;
    const ratio = Math.min(1.0, Math.max(0.04, val / (totalDisplayVal || 1)));
    return Math.round(minH + ratio * (maxAvailableH - minH));
  };

  // Helper function to build clean cubic bezier Sankey ribbons
  const createSankeyRibbon = (
    x1: number,
    y1: number,
    h1: number,
    x2: number,
    y2: number,
    h2: number,
    curvature: number = 0.45
  ) => {
    const dx = (x2 - x1) * curvature;
    return `
      M ${x1} ${y1}
      C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}
      L ${x2} ${y2 + h2}
      C ${x2 - dx} ${y2 + h2}, ${x1 + dx} ${y1 + h1}, ${x1} ${y1 + h1}
      Z
    `.replace(/\s+/g, ' ').trim();
  };

  // Centerline helper for electron particle flow dashes
  const createCenterline = (
    x1: number,
    y1: number,
    h1: number,
    x2: number,
    y2: number,
    h2: number,
    curvature: number = 0.45
  ) => {
    const cy1 = y1 + h1 / 2;
    const cy2 = y2 + h2 / 2;
    const dx = (x2 - x1) * curvature;
    return `M ${x1} ${cy1} C ${x1 + dx} ${cy1}, ${x2 - dx} ${cy2}, ${x2} ${cy2}`;
  };

  // Pre-calculate heights & positions for all 5 branches
  const branches = useMemo(() => {
    const c = calculatedRails;
    const isPower = displayMode === 'power';
    const isJoule = displayMode === 'joule_loss';

    const getVal = (rail: RailState | AvionicsRailState) => {
      if (isPower) return Math.max(0.1, rail.power);
      if (isJoule) return 'jouleLossWatts' in rail ? Math.max(0.1, rail.jouleLossWatts) : 0.8;
      return Math.max(0.1, rail.current);
    };

    const valFL = getVal(c.fl);
    const valFR = getVal(c.fr);
    const valRL = getVal(c.rl);
    const valRR = getVal(c.rr);
    const valAv = getVal(c.avionics);

    // Dynamic ribbon heights at Rail Nodes
    const hFL = getRibbonH(valFL, 62, 8);
    const hFR = getRibbonH(valFR, 62, 8);
    const hRL = getRibbonH(valRL, 62, 8);
    const hRR = getRibbonH(valRR, 62, 8);
    const hAv = getRibbonH(valAv, 46, 8);

    // Rail node vertical center anchors
    const yFL = 45;
    const yFR = 145;
    const yRL = 250;
    const yRR = 355;
    const yAv = 460;

    // PDU distribution outlet anchors (stacked neatly)
    const pduTopY = 130;
    const pduH_FL = Math.max(8, hFL * 0.9);
    const pduH_FR = Math.max(8, hFR * 0.9);
    const pduH_RL = Math.max(8, hRL * 0.9);
    const pduH_RR = Math.max(8, hRR * 0.9);
    const pduH_Av = Math.max(8, hAv * 0.9);

    const pduY_FL = pduTopY;
    const pduY_FR = pduY_FL + pduH_FL + 8;
    const pduY_RL = pduY_FR + pduH_FR + 8;
    const pduY_RR = pduY_RL + pduH_RL + 8;
    const pduY_Av = pduY_RR + pduH_RR + 8;
    const pduTotalH = (pduY_Av + pduH_Av) - pduTopY;

    return {
      fl: { val: valFL, h: hFL, y: yFL, pduY: pduY_FL, pduH: pduH_FL },
      fr: { val: valFR, h: hFR, y: yFR, pduY: pduY_FR, pduH: pduH_FR },
      rl: { val: valRL, h: hRL, y: yRL, pduY: pduY_RL, pduH: pduH_RL },
      rr: { val: valRR, h: hRR, y: yRR, pduY: pduY_RR, pduH: pduH_RR },
      avionics: { val: valAv, h: hAv, y: yAv, pduY: pduY_Av, pduH: pduH_Av },
      pduTopY,
      pduTotalH,
    };
  }, [calculatedRails, displayMode]);

  return (
    <div className="bg-[#080d1a] border border-slate-800/90 rounded-2xl p-4 sm:p-6 shadow-2xl text-slate-100 space-y-6">
      {/* Component Title & System Telemetry Header */}
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Zap className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
                  CURRENT DISTRIBUTION FLOW
                  <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 border border-cyan-700/60 text-cyan-300 font-mono">
                    SANKEY ARCHITECTURE
                  </span>
                </h2>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Real-Time 4-Limb Rail Amperage, Solid-State e-Fuse Topology & 12-Actuator Load Flow
              </p>
            </div>
          </div>
        </div>

        {/* Live System Stat Chips */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs font-mono">
          {/* Main Bus Voltage */}
          <div className="px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700/70 flex items-center gap-2">
            <span className="text-slate-400 text-[10px] uppercase">Bus Voltage:</span>
            <span className="font-bold text-cyan-300">
              {calculatedRails.baseVoltage.toFixed(2)} V
            </span>
          </div>

          {/* Total Pack Current */}
          <div className={`px-3 py-1.5 rounded-lg border flex items-center gap-2 ${
            calculatedRails.totalPackCurrent < 0
              ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-300'
              : calculatedRails.totalPackCurrent > 20
              ? 'bg-rose-950/60 border-rose-500/60 text-rose-300'
              : 'bg-slate-900/90 border-slate-700/70 text-amber-300'
          }`}>
            <span className="text-slate-400 text-[10px] uppercase">Pack Net Current:</span>
            <span className="font-bold">
              {calculatedRails.totalPackCurrent > 0 ? '+' : ''}
              {calculatedRails.totalPackCurrent.toFixed(2)} A
            </span>
            {calculatedRails.totalPackCurrent < 0 && (
              <span className="text-[10px] px-1 py-0.2 bg-emerald-800 text-white rounded font-bold">REGEN</span>
            )}
          </div>

          {/* Active Power */}
          <div className="px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700/70 flex items-center gap-2">
            <span className="text-slate-400 text-[10px] uppercase">Bus Load:</span>
            <span className="font-bold text-slate-100">
              {Math.abs(calculatedRails.totalPackPower).toFixed(1)} W
            </span>
          </div>

          {/* Efficiency */}
          <div className="px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700/70 flex items-center gap-2">
            <span className="text-slate-400 text-[10px] uppercase">Conduction Eff:</span>
            <span className="font-bold text-emerald-400">
              {calculatedRails.efficiencyPercent.toFixed(1)}%
            </span>
          </div>

          {/* Play / Pause ticker */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            title={isPlaying ? 'Pause simulation stream' : 'Resume simulation stream'}
            className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
              isPlaying
                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/30'
                : 'bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30'
            }`}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span className="text-[11px] font-bold">{isPlaying ? 'STREAMING' : 'PAUSED'}</span>
          </button>
        </div>
      </div>

      {/* Control Bar: Metric Selector, Flow Speeds, and Maneuver Simulation Presets */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center bg-slate-950/80 p-3 rounded-xl border border-slate-800/80 text-xs font-mono">
        {/* Metric Display Mode Switcher */}
        <div className="lg:col-span-4 flex items-center gap-1.5">
          <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1 mr-1">
            <Sliders className="w-3.5 h-3.5 text-cyan-400" /> Metric:
          </span>
          <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
            {[
              { id: 'amperage', label: 'Amps (A)' },
              { id: 'power', label: 'Power (W)' },
              { id: 'joule_loss', label: 'I²R Loss (W)' },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setDisplayMode(m.id as DisplayMode)}
                className={`px-2.5 py-1 rounded cursor-pointer transition-all ${
                  displayMode === m.id
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Maneuver Stress Presets */}
        <div className="lg:col-span-8 flex flex-wrap items-center justify-end gap-1.5">
          <span className="text-slate-400 text-[10px] uppercase font-semibold mr-1 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-400" /> Presets:
          </span>
          {[
            { id: 'dynamic_trot', label: 'Dynamic Trot (Diagonal)' },
            { id: 'sprint_surge', label: 'Sprint Surge (24.8A Peak)' },
            { id: 'hill_climb', label: 'Hill Climb (Rear Bias)' },
            { id: 'regen_brake', label: 'Regen Brake (-2.8A)' },
            { id: 'fault_rl', label: 'Trip RL e-Fuse (Fault)' },
            { id: 'idle_stand', label: 'Reset / Stand' },
          ].map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset.id)}
              className={`px-2.5 py-1 rounded border text-[11px] cursor-pointer transition-all ${
                activePreset === preset.id
                  ? 'bg-cyan-950 border-cyan-500 text-cyan-200 font-bold shadow-sm'
                  : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {preset.label}
            </button>
          ))}

          {/* Toggle Flow Particles */}
          <button
            onClick={() => setShowParticleFlow(!showParticleFlow)}
            className={`px-2.5 py-1 rounded border text-[11px] cursor-pointer transition-all ml-1 ${
              showParticleFlow
                ? 'bg-slate-800 border-slate-600 text-cyan-300'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
            title="Toggle animated current flow particles"
          >
            Electron Flow: {showParticleFlow ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Main Sankey Diagram Container */}
      <div className="relative bg-[#050811] rounded-2xl border border-slate-800/90 overflow-hidden shadow-inner">
        {/* Stage Column Guide Headers */}
        <div className="grid grid-cols-4 px-6 pt-3 pb-2 border-b border-slate-800/60 text-[10px] font-mono text-slate-400 uppercase tracking-widest bg-slate-950/40 select-none">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            Stage 0: 48V Power Source
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            Stage 1: Solid-State PDU Bus
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            Stage 2: Quad Leg Power Rails
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
            Stage 3: Joint Actuators & Sinks
          </div>
        </div>

        {/* SVG Viewport */}
        <div className="relative w-full overflow-x-auto select-none">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-auto min-w-[860px]"
            style={{ filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.5))' }}
          >
            <defs>
              {/* Linear Gradients for Sankey Ribbons */}
              {/* Battery to PDU */}
              <linearGradient id="grad-batt-pdu" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.65" />
              </linearGradient>

              {/* PDU to FL Rail */}
              <linearGradient id="grad-pdu-fl" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.65" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.75" />
              </linearGradient>

              {/* PDU to FR Rail */}
              <linearGradient id="grad-pdu-fr" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.65" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.75" />
              </linearGradient>

              {/* PDU to RL Rail */}
              <linearGradient id="grad-pdu-rl" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.65" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.75" />
              </linearGradient>

              {/* PDU to RR Rail */}
              <linearGradient id="grad-pdu-rr" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.65" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.75" />
              </linearGradient>

              {/* PDU to Avionics Rail */}
              <linearGradient id="grad-pdu-av" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.65" />
                <stop offset="100%" stopColor="#a855f7" stopOpacity="0.75" />
              </linearGradient>

              {/* Reverse Gradient for Regenerative Flow */}
              <linearGradient id="grad-regen-flow" x1="100%" y1="0%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.6" />
              </linearGradient>

              {/* Glow filter */}
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Background Grid Accent Lines */}
            <g opacity="0.12" stroke="#334155" strokeDasharray="3 3">
              <line x1={colX.source + colX.sourceW} y1={20} x2={colX.source + colX.sourceW} y2={svgHeight - 20} />
              <line x1={colX.pdu + colX.pduW} y1={20} x2={colX.pdu + colX.pduW} y2={svgHeight - 20} />
              <line x1={colX.rails + colX.railsW} y1={20} x2={colX.rails + colX.railsW} y2={svgHeight - 20} />
            </g>

            {/* ============================================================ */}
            {/* SANKEY FLOW RIBBONS (Stage 0 -> Stage 1) */}
            {/* ============================================================ */}
            {/* Battery Source -> Common PDU Main Busbar */}
            {(() => {
              const battY = 190;
              const battH = Math.max(24, Math.min(130, (branches.pduTotalH || 100)));
              const pduInY = branches.pduTopY;
              const pduInH = branches.pduTotalH;
              const ribbonPath = createSankeyRibbon(
                colX.source + colX.sourceW,
                battY,
                battH,
                colX.pdu,
                pduInY,
                pduInH,
                0.5
              );
              const centerPath = createCenterline(
                colX.source + colX.sourceW,
                battY,
                battH,
                colX.pdu,
                pduInY,
                pduInH,
                0.5
              );

              return (
                <g className="cursor-pointer" onClick={() => setSelectedRail('main')}>
                  <path
                    d={ribbonPath}
                    fill={regenSpikeActive ? 'url(#grad-regen-flow)' : 'url(#grad-batt-pdu)'}
                    stroke={regenSpikeActive ? '#10b981' : '#38bdf8'}
                    strokeWidth="1"
                    strokeOpacity="0.6"
                    className="transition-all duration-300 hover:fill-opacity-80"
                  />
                  {showParticleFlow && (
                    <path
                      d={centerPath}
                      fill="none"
                      stroke={regenSpikeActive ? '#34d399' : '#e0f2fe'}
                      strokeWidth="2.5"
                      strokeDasharray="6 14"
                      strokeDashoffset={regenSpikeActive ? -dashOffset : dashOffset}
                      strokeLinecap="round"
                      opacity="0.85"
                    />
                  )}
                </g>
              );
            })()}

            {/* ============================================================ */}
            {/* SANKEY FLOW RIBBONS (Stage 1 -> Stage 2: PDU -> 5 Rails) */}
            {/* ============================================================ */}
            {/* 1. FL Rail Ribbon */}
            {(() => {
              const b = branches.fl;
              const isTripped = trippedRails.fl;
              const ribbonPath = createSankeyRibbon(
                colX.pdu + colX.pduW,
                b.pduY,
                b.pduH,
                colX.rails,
                b.y + 10,
                b.h,
                0.48
              );
              const centerPath = createCenterline(
                colX.pdu + colX.pduW,
                b.pduY,
                b.pduH,
                colX.rails,
                b.y + 10,
                b.h,
                0.48
              );
              return (
                <g className="cursor-pointer" onClick={() => setSelectedRail('fl')}>
                  <path
                    d={ribbonPath}
                    fill={isTripped ? '#1e293b' : 'url(#grad-pdu-fl)'}
                    stroke={isTripped ? '#dc2626' : '#06b6d4'}
                    strokeWidth={hoveredNode === 'fl' ? 2 : 1}
                    strokeOpacity={isTripped ? 0.3 : 0.7}
                    fillOpacity={isTripped ? 0.2 : hoveredNode === 'fl' ? 0.9 : 0.65}
                    className="transition-all duration-200"
                  />
                  {!isTripped && showParticleFlow && (
                    <path
                      d={centerPath}
                      fill="none"
                      stroke="#67e8f9"
                      strokeWidth="2"
                      strokeDasharray="5 12"
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                      opacity="0.8"
                    />
                  )}
                </g>
              );
            })()}

            {/* 2. FR Rail Ribbon */}
            {(() => {
              const b = branches.fr;
              const isTripped = trippedRails.fr;
              const ribbonPath = createSankeyRibbon(
                colX.pdu + colX.pduW,
                b.pduY,
                b.pduH,
                colX.rails,
                b.y + 10,
                b.h,
                0.48
              );
              const centerPath = createCenterline(
                colX.pdu + colX.pduW,
                b.pduY,
                b.pduH,
                colX.rails,
                b.y + 10,
                b.h,
                0.48
              );
              return (
                <g className="cursor-pointer" onClick={() => setSelectedRail('fr')}>
                  <path
                    d={ribbonPath}
                    fill={isTripped ? '#1e293b' : 'url(#grad-pdu-fr)'}
                    stroke={isTripped ? '#dc2626' : '#38bdf8'}
                    strokeWidth={hoveredNode === 'fr' ? 2 : 1}
                    strokeOpacity={isTripped ? 0.3 : 0.7}
                    fillOpacity={isTripped ? 0.2 : hoveredNode === 'fr' ? 0.9 : 0.65}
                    className="transition-all duration-200"
                  />
                  {!isTripped && showParticleFlow && (
                    <path
                      d={centerPath}
                      fill="none"
                      stroke="#bae6fd"
                      strokeWidth="2"
                      strokeDasharray="5 12"
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                      opacity="0.8"
                    />
                  )}
                </g>
              );
            })()}

            {/* 3. RL Rail Ribbon */}
            {(() => {
              const b = branches.rl;
              const isTripped = trippedRails.rl;
              const ribbonPath = createSankeyRibbon(
                colX.pdu + colX.pduW,
                b.pduY,
                b.pduH,
                colX.rails,
                b.y + 10,
                b.h,
                0.48
              );
              const centerPath = createCenterline(
                colX.pdu + colX.pduW,
                b.pduY,
                b.pduH,
                colX.rails,
                b.y + 10,
                b.h,
                0.48
              );
              return (
                <g className="cursor-pointer" onClick={() => setSelectedRail('rl')}>
                  <path
                    d={ribbonPath}
                    fill={isTripped ? '#1e293b' : 'url(#grad-pdu-rl)'}
                    stroke={isTripped ? '#dc2626' : '#10b981'}
                    strokeWidth={hoveredNode === 'rl' ? 2 : 1}
                    strokeOpacity={isTripped ? 0.3 : 0.7}
                    fillOpacity={isTripped ? 0.2 : hoveredNode === 'rl' ? 0.9 : 0.65}
                    className="transition-all duration-200"
                  />
                  {!isTripped && showParticleFlow && (
                    <path
                      d={centerPath}
                      fill="none"
                      stroke="#6ee7b7"
                      strokeWidth="2"
                      strokeDasharray="5 12"
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                      opacity="0.8"
                    />
                  )}
                </g>
              );
            })()}

            {/* 4. RR Rail Ribbon */}
            {(() => {
              const b = branches.rr;
              const isTripped = trippedRails.rr;
              const ribbonPath = createSankeyRibbon(
                colX.pdu + colX.pduW,
                b.pduY,
                b.pduH,
                colX.rails,
                b.y + 10,
                b.h,
                0.48
              );
              const centerPath = createCenterline(
                colX.pdu + colX.pduW,
                b.pduY,
                b.pduH,
                colX.rails,
                b.y + 10,
                b.h,
                0.48
              );
              return (
                <g className="cursor-pointer" onClick={() => setSelectedRail('rr')}>
                  <path
                    d={ribbonPath}
                    fill={isTripped ? '#1e293b' : 'url(#grad-pdu-rr)'}
                    stroke={isTripped ? '#dc2626' : '#f59e0b'}
                    strokeWidth={hoveredNode === 'rr' ? 2 : 1}
                    strokeOpacity={isTripped ? 0.3 : 0.7}
                    fillOpacity={isTripped ? 0.2 : hoveredNode === 'rr' ? 0.9 : 0.65}
                    className="transition-all duration-200"
                  />
                  {!isTripped && showParticleFlow && (
                    <path
                      d={centerPath}
                      fill="none"
                      stroke="#fde68a"
                      strokeWidth="2"
                      strokeDasharray="5 12"
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                      opacity="0.8"
                    />
                  )}
                </g>
              );
            })()}

            {/* 5. Avionics Rail Ribbon */}
            {(() => {
              const b = branches.avionics;
              const ribbonPath = createSankeyRibbon(
                colX.pdu + colX.pduW,
                b.pduY,
                b.pduH,
                colX.rails,
                b.y + 10,
                b.h,
                0.48
              );
              const centerPath = createCenterline(
                colX.pdu + colX.pduW,
                b.pduY,
                b.pduH,
                colX.rails,
                b.y + 10,
                b.h,
                0.48
              );
              return (
                <g className="cursor-pointer" onClick={() => setSelectedRail('avionics')}>
                  <path
                    d={ribbonPath}
                    fill="url(#grad-pdu-av)"
                    stroke="#a855f7"
                    strokeWidth={hoveredNode === 'avionics' ? 2 : 1}
                    strokeOpacity="0.7"
                    fillOpacity={hoveredNode === 'avionics' ? 0.9 : 0.65}
                    className="transition-all duration-200"
                  />
                  {showParticleFlow && (
                    <path
                      d={centerPath}
                      fill="none"
                      stroke="#d8b4fe"
                      strokeWidth="2"
                      strokeDasharray="5 12"
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                      opacity="0.8"
                    />
                  )}
                </g>
              );
            })()}

            {/* ============================================================ */}
            {/* SANKEY FLOW RIBBONS (Stage 2 -> Stage 3: Rails -> Actuators) */}
            {/* ============================================================ */}
            {[
              { id: 'fl' as LegRailId, rail: calculatedRails.fl, b: branches.fl, color: '#06b6d4', sinkStartY: 35 },
              { id: 'fr' as LegRailId, rail: calculatedRails.fr, b: branches.fr, color: '#38bdf8', sinkStartY: 135 },
              { id: 'rl' as LegRailId, rail: calculatedRails.rl, b: branches.rl, color: '#10b981', sinkStartY: 240 },
              { id: 'rr' as LegRailId, rail: calculatedRails.rr, b: branches.rr, color: '#f59e0b', sinkStartY: 345 },
            ].map(({ id, rail, b, color, sinkStartY }) => {
              const isTripped = trippedRails[id];
              const joints = [
                { name: 'Roll', frac: 0.22, yOff: 0 },
                { name: 'Pitch', frac: 0.39, yOff: 26 },
                { name: 'Knee', frac: 0.39, yOff: 52 },
              ];

              return (
                <g key={`joints-${id}`}>
                  {joints.map((j, i) => {
                    const subH = Math.max(4, Math.round(b.h * j.frac));
                    const outY = b.y + 10 + (i === 0 ? 0 : i === 1 ? b.h * 0.25 : b.h * 0.65);
                    const sinkY = sinkStartY + j.yOff;
                    const sinkH = 14;

                    const ribbon = createSankeyRibbon(
                      colX.rails + colX.railsW,
                      outY,
                      subH,
                      colX.sinks,
                      sinkY,
                      sinkH,
                      0.4
                    );

                    return (
                      <g key={j.name}>
                        <path
                          d={ribbon}
                          fill={isTripped ? '#1e293b' : color}
                          fillOpacity={isTripped ? 0.1 : 0.25}
                          stroke={isTripped ? '#475569' : color}
                          strokeWidth="0.8"
                          strokeOpacity={isTripped ? 0.2 : 0.5}
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Avionics Subsystems Sinks */}
            {(() => {
              const b = branches.avionics;
              const subItems = [
                { yOff: 0, frac: 0.3 },
                { yOff: 22, frac: 0.4 },
                { yOff: 44, frac: 0.2 },
                { yOff: 66, frac: 0.1 },
              ];
              return (
                <g>
                  {subItems.map((item, idx) => {
                    const outY = b.y + 10 + idx * (b.h / 4);
                    const sinkY = 450 + item.yOff;
                    const ribbon = createSankeyRibbon(
                      colX.rails + colX.railsW,
                      outY,
                      Math.max(3, b.h * item.frac),
                      colX.sinks,
                      sinkY,
                      12,
                      0.4
                    );
                    return (
                      <path
                        key={idx}
                        d={ribbon}
                        fill="#a855f7"
                        fillOpacity="0.25"
                        stroke="#a855f7"
                        strokeWidth="0.8"
                        strokeOpacity="0.5"
                      />
                    );
                  })}
                </g>
              );
            })()}

            {/* ============================================================ */}
            {/* STAGE 0: PRIMARY SOURCE NODE (48V Battery & Contactor) */}
            {/* ============================================================ */}
            <g
              transform={`translate(${colX.source}, 170)`}
              className="cursor-pointer"
              onClick={() => setSelectedRail('main')}
              onMouseEnter={() => setHoveredNode('source')}
              onMouseLeave={() => setHoveredNode(null)}
            >
              <rect
                width={colX.sourceW}
                height={175}
                rx={12}
                fill="#0b1329"
                stroke={hoveredNode === 'source' ? '#38bdf8' : '#1e3a8a'}
                strokeWidth="1.5"
                filter="url(#glow)"
              />
              {/* Header Tab */}
              <rect width={colX.sourceW} height={26} rx={10} fill="#1e293b" />
              <text x={12} y={17} fill="#38bdf8" fontSize="10" fontFamily="monospace" fontWeight="bold">
                ⚡ 48V BMS PACK
              </text>

              {/* Status Indicator */}
              <circle cx={colX.sourceW - 14} cy={13} r={4} fill="#10b981" />

              {/* Content Specs */}
              <text x={12} y={48} fill="#94a3b8" fontSize="9" fontFamily="monospace">
                12S5P Li-Ion (15Ah)
              </text>
              <text x={12} y={68} fill="#ffffff" fontSize="16" fontFamily="monospace" fontWeight="bold">
                {calculatedRails.baseVoltage.toFixed(2)} V
              </text>
              <text x={12} y={90} fill={calculatedRails.totalPackCurrent < 0 ? '#34d399' : '#38bdf8'} fontSize="13" fontFamily="monospace" fontWeight="bold">
                {calculatedRails.totalPackCurrent > 0 ? '+' : ''}{calculatedRails.totalPackCurrent.toFixed(2)} A
              </text>
              <text x={12} y={110} fill="#cbd5e1" fontSize="11" fontFamily="monospace">
                {Math.abs(calculatedRails.totalPackPower).toFixed(0)} W Active
              </text>

              {/* Contactor Health Badge */}
              <rect x={10} y={124} width={colX.sourceW - 20} height={20} rx={4} fill="#0f172a" stroke="#334155" strokeWidth="0.8" />
              <text x={colX.sourceW / 2} y={137} fill="#10b981" fontSize="8.5" fontFamily="monospace" textAnchor="middle">
                MAIN CONTACTOR: CLOSED
              </text>

              {/* State Indicator */}
              <text x={12} y={160} fill="#64748b" fontSize="8" fontFamily="monospace">
                Shunt: Dual LEM 50A
              </text>
            </g>

            {/* ============================================================ */}
            {/* STAGE 1: SOLID-STATE PDU BUSBAR NODE */}
            {/* ============================================================ */}
            <g
              transform={`translate(${colX.pdu}, ${branches.pduTopY - 24})`}
              className="cursor-pointer"
              onClick={() => setSelectedRail('main')}
              onMouseEnter={() => setHoveredNode('pdu')}
              onMouseLeave={() => setHoveredNode(null)}
            >
              <rect
                width={colX.pduW}
                height={branches.pduTotalH + 48}
                rx={10}
                fill="#070d1e"
                stroke={hoveredNode === 'pdu' ? '#60a5fa' : '#2563eb'}
                strokeWidth="1.5"
              />
              <rect width={colX.pduW} height={24} rx={8} fill="#1e3a8a" />
              <text x={colX.pduW / 2} y={16} fill="#bfdbfe" fontSize="9.5" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                SOLID-STATE PDU
              </text>

              {/* Distribution status */}
              <text x={10} y={40} fill="#94a3b8" fontSize="8.5" fontFamily="monospace">
                Bus: 48V Copper
              </text>
              <text x={10} y={54} fill="#60a5fa" fontSize="9" fontFamily="monospace" fontWeight="bold">
                5 Isolated Rails
              </text>
              <text x={10} y={68} fill="#94a3b8" fontSize="8" fontFamily="monospace">
                e-Fuse: PROFET+2
              </text>

              {/* Outlet mini-bars */}
              <g transform="translate(10, 85)">
                <text x={0} y={0} fill="#64748b" fontSize="7.5" fontFamily="monospace">
                  OUTLETS (A):
                </text>
                <text x={0} y={14} fill="#06b6d4" fontSize="8" fontFamily="monospace">
                  FL: {calculatedRails.fl.current.toFixed(1)}A
                </text>
                <text x={0} y={26} fill="#38bdf8" fontSize="8" fontFamily="monospace">
                  FR: {calculatedRails.fr.current.toFixed(1)}A
                </text>
                <text x={0} y={38} fill="#10b981" fontSize="8" fontFamily="monospace">
                  RL: {calculatedRails.rl.current.toFixed(1)}A
                </text>
                <text x={0} y={50} fill="#f59e0b" fontSize="8" fontFamily="monospace">
                  RR: {calculatedRails.rr.current.toFixed(1)}A
                </text>
                <text x={0} y={62} fill="#c084fc" fontSize="8" fontFamily="monospace">
                  AV: {calculatedRails.avionics.current.toFixed(1)}A
                </text>
              </g>
            </g>

            {/* ============================================================ */}
            {/* STAGE 2: 5 POWER RAIL NODES (FL, FR, RL, RR, AVIONICS) */}
            {/* ============================================================ */}
            {[
              { id: 'fl' as LegRailId, rail: calculatedRails.fl, b: branches.fl, badge: 'FL-RAIL', color: '#06b6d4' },
              { id: 'fr' as LegRailId, rail: calculatedRails.fr, b: branches.fr, badge: 'FR-RAIL', color: '#38bdf8' },
              { id: 'rl' as LegRailId, rail: calculatedRails.rl, b: branches.rl, badge: 'RL-RAIL', color: '#10b981' },
              { id: 'rr' as LegRailId, rail: calculatedRails.rr, b: branches.rr, badge: 'RR-RAIL', color: '#f59e0b' },
            ].map(({ id, rail, b, badge, color }) => {
              const isTripped = trippedRails[id];
              const isSelected = selectedRail === id;
              const isHovered = hoveredNode === id;

              return (
                <g
                  key={id}
                  transform={`translate(${colX.rails}, ${b.y - 10})`}
                  className="cursor-pointer"
                  onClick={() => setSelectedRail(id)}
                  onMouseEnter={() => setHoveredNode(id)}
                  onMouseLeave={() => setHoveredNode(null)}
                >
                  {/* Node Box */}
                  <rect
                    width={colX.railsW}
                    height={85}
                    rx={10}
                    fill={isTripped ? '#18121a' : isSelected ? '#0e1c36' : '#081124'}
                    stroke={
                      isTripped
                        ? '#dc2626'
                        : isSelected
                        ? color
                        : isHovered
                        ? '#ffffff'
                        : '#1e293b'
                    }
                    strokeWidth={isSelected ? '2' : '1.2'}
                  />

                  {/* Header Strip */}
                  <rect width={colX.railsW} height={20} rx={8} fill={isTripped ? '#7f1d1d' : '#0f172a'} />
                  <text x={8} y={14} fill={isTripped ? '#fca5a5' : color} fontSize="9" fontFamily="monospace" fontWeight="bold">
                    {badge}
                  </text>

                  {/* e-Fuse Status Indicator & Stance Flag */}
                  <circle
                    cx={colX.railsW - 12}
                    cy={10}
                    r={3.5}
                    fill={isTripped ? '#ef4444' : rail.isStancePhase ? '#10b981' : '#64748b'}
                  />

                  {/* Telemetry Numbers */}
                  <text x={8} y={38} fill={isTripped ? '#ef4444' : '#ffffff'} fontSize="14" fontFamily="monospace" fontWeight="bold">
                    {isTripped ? '0.00 A' : `${rail.current.toFixed(2)} A`}
                  </text>

                  <text x={8} y={54} fill="#94a3b8" fontSize="8.5" fontFamily="monospace">
                    {displayMode === 'power'
                      ? `${rail.power.toFixed(1)} W`
                      : displayMode === 'joule_loss'
                      ? `${rail.jouleLossWatts.toFixed(2)} W loss`
                      : `${rail.voltage.toFixed(1)}V · ${rail.power.toFixed(0)}W`}
                  </text>

                  {/* Load Share & eFuse status */}
                  <g transform="translate(8, 62)">
                    {/* Share Bar */}
                    <rect width={colX.railsW - 16} height={4} rx={2} fill="#1e293b" />
                    <rect
                      width={Math.max(2, ((colX.railsW - 16) * rail.percentOfTotal) / 100)}
                      height={4}
                      rx={2}
                      fill={isTripped ? '#dc2626' : color}
                    />
                    <text x={0} y={14} fill="#64748b" fontSize="7.5" fontFamily="monospace">
                      Share: {rail.percentOfTotal.toFixed(1)}% | {rail.isStancePhase ? 'STANCE' : 'SWING'}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Avionics Rail Node */}
            {(() => {
              const b = branches.avionics;
              const rail = calculatedRails.avionics;
              const isSelected = selectedRail === 'avionics';
              const isHovered = hoveredNode === 'avionics';

              return (
                <g
                  transform={`translate(${colX.rails}, ${b.y - 10})`}
                  className="cursor-pointer"
                  onClick={() => setSelectedRail('avionics')}
                  onMouseEnter={() => setHoveredNode('avionics')}
                  onMouseLeave={() => setHoveredNode(null)}
                >
                  <rect
                    width={colX.railsW}
                    height={85}
                    rx={10}
                    fill={isSelected ? '#1f1033' : '#100b1e'}
                    stroke={isSelected ? '#c084fc' : isHovered ? '#ffffff' : '#4c1d95'}
                    strokeWidth={isSelected ? '2' : '1.2'}
                  />
                  <rect width={colX.railsW} height={20} rx={8} fill="#3b0764" />
                  <text x={8} y={14} fill="#e9d5ff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                    AVIONICS RAIL
                  </text>
                  <circle cx={colX.railsW - 12} cy={10} r={3.5} fill="#a855f7" />

                  <text x={8} y={38} fill="#ffffff" fontSize="14" fontFamily="monospace" fontWeight="bold">
                    {rail.current.toFixed(2)} A
                  </text>
                  <text x={8} y={54} fill="#c084fc" fontSize="8.5" fontFamily="monospace">
                    {rail.power.toFixed(1)} W (Regulated)
                  </text>

                  <g transform="translate(8, 62)">
                    <rect width={colX.railsW - 16} height={4} rx={2} fill="#2e1065" />
                    <rect
                      width={Math.max(2, ((colX.railsW - 16) * rail.percentOfTotal) / 100)}
                      height={4}
                      rx={2}
                      fill="#a855f7"
                    />
                    <text x={0} y={14} fill="#94a3b8" fontSize="7.5" fontFamily="monospace">
                      Share: {rail.percentOfTotal.toFixed(1)}% | 48V-&gt;12V/5V
                    </text>
                  </g>
                </g>
              );
            })()}

            {/* ============================================================ */}
            {/* STAGE 3: SINKS / ACTUATORS & SUBSYSTEMS */}
            {/* ============================================================ */}
            {[
              { id: 'fl' as LegRailId, rail: calculatedRails.fl, startY: 30, color: '#06b6d4' },
              { id: 'fr' as LegRailId, rail: calculatedRails.fr, startY: 135, color: '#38bdf8' },
              { id: 'rl' as LegRailId, rail: calculatedRails.rl, startY: 240, color: '#10b981' },
              { id: 'rr' as LegRailId, rail: calculatedRails.rr, startY: 345, color: '#f59e0b' },
            ].map(({ id, rail, startY, color }) => {
              const isTripped = trippedRails[id];
              const joints = [
                { key: 'roll', ...rail.jointBreakdown.roll, label: 'M1 Abduct' },
                { key: 'pitch', ...rail.jointBreakdown.pitch, label: 'M2 HipPitch' },
                { key: 'knee', ...rail.jointBreakdown.knee, label: 'M3 Knee' },
              ];

              return (
                <g key={`sinks-${id}`} transform={`translate(${colX.sinks}, ${startY})`}>
                  {joints.map((joint, idx) => {
                    const rowY = idx * 27;
                    return (
                      <g key={joint.key} transform={`translate(0, ${rowY})`}>
                        <rect
                          width={colX.sinksW}
                          height={22}
                          rx={5}
                          fill={isTripped ? '#0f172a' : '#090e1c'}
                          stroke={isTripped ? '#334155' : '#1e293b'}
                          strokeWidth="0.8"
                        />
                        {/* Status bar */}
                        <rect
                          width={3}
                          height={22}
                          rx={1.5}
                          fill={isTripped ? '#dc2626' : color}
                        />
                        <text x={8} y={14} fill={isTripped ? '#64748b' : '#cbd5e1'} fontSize="8" fontFamily="monospace" fontWeight="bold">
                          {joint.label}
                        </text>
                        <text x={80} y={14} fill={isTripped ? '#dc2626' : '#ffffff'} fontSize="8" fontFamily="monospace" fontWeight="bold">
                          {isTripped ? '0.0 A' : `${joint.current.toFixed(2)}A`}
                        </text>
                        <text x={126} y={14} fill="#64748b" fontSize="7.5" fontFamily="monospace">
                          {isTripped ? 'OFF' : `${joint.pwm}% PWM`}
                        </text>
                        <text x={colX.sinksW - 6} y={14} fill="#94a3b8" fontSize="7" fontFamily="monospace" textAnchor="end">
                          {joint.temp.toFixed(0)}°C
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Avionics Subsystems Sink List */}
            <g transform={`translate(${colX.sinks}, 450)`}>
              {[
                { name: 'MCU Core Dual H7 + CAN', cur: calculatedRails.avionics.subsystems.mcu.current },
                { name: 'Edge AI NPU + LiDAR SLAM', cur: calculatedRails.avionics.subsystems.vision.current },
                { name: 'Ducted Actuator Blowers', cur: calculatedRails.avionics.subsystems.cooling.current },
                { name: 'Isolated Dual CAN Transceivers', cur: calculatedRails.avionics.subsystems.canBus.current },
              ].map((item, idx) => (
                <g key={idx} transform={`translate(0, ${idx * 21})`}>
                  <rect width={colX.sinksW} height={18} rx={4} fill="#130924" stroke="#2e1065" strokeWidth="0.8" />
                  <rect width={2.5} height={18} rx={1} fill="#c084fc" />
                  <text x={7} y={12} fill="#e9d5ff" fontSize="7.5" fontFamily="monospace">
                    {item.name}
                  </text>
                  <text x={colX.sinksW - 6} y={12} fill="#a855f7" fontSize="7.5" fontFamily="monospace" fontWeight="bold" textAnchor="end">
                    {item.cur.toFixed(2)}A
                  </text>
                </g>
              ))}
            </g>
          </svg>
        </div>

        {/* Floating Quick Legend & Instructions */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 bg-slate-950/70 border-t border-slate-800/80 text-[10px] font-mono text-slate-400">
          <div className="flex items-center gap-4">
            <span className="text-slate-300 font-semibold">LEGEND:</span>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2 rounded bg-cyan-400" /> FL Rail
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2 rounded bg-sky-400" /> FR Rail
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2 rounded bg-emerald-400" /> RL Rail
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2 rounded bg-amber-400" /> RR Rail
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2 rounded bg-purple-400" /> Avionics
            </div>
          </div>
          <div className="text-slate-400">
            Click any rail node to inspect joint breakdown, trip e-fuses, or view wave telemetry
          </div>
        </div>
      </div>

      {/* 4-Limb Rail Telemetry Comparison Cards & e-Fuse Trip Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { id: 'fl' as LegRailId, rail: calculatedRails.fl, label: 'FRONT-LEFT RAIL', color: 'border-cyan-500/40 text-cyan-300' },
          { id: 'fr' as LegRailId, rail: calculatedRails.fr, label: 'FRONT-RIGHT RAIL', color: 'border-sky-500/40 text-sky-300' },
          { id: 'rl' as LegRailId, rail: calculatedRails.rl, label: 'REAR-LEFT RAIL', color: 'border-emerald-500/40 text-emerald-300' },
          { id: 'rr' as LegRailId, rail: calculatedRails.rr, label: 'REAR-RIGHT RAIL', color: 'border-amber-500/40 text-amber-300' },
        ].map(({ id, rail, label, color }) => {
          const isTripped = trippedRails[id];
          const isSelected = selectedRail === id;

          return (
            <div
              key={id}
              onClick={() => setSelectedRail(id)}
              className={`rounded-xl border p-4 bg-slate-950/70 transition-all cursor-pointer ${
                isTripped
                  ? 'border-rose-600/70 bg-rose-950/20 shadow-red-950/20'
                  : isSelected
                  ? `${color} bg-slate-900/90 shadow-lg`
                  : 'border-slate-800/80 hover:border-slate-700'
              }`}
            >
              {/* Card Header */}
              <div className="flex items-center justify-between gap-2 border-b border-slate-800/70 pb-2.5 mb-3 font-mono">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${isTripped ? 'bg-rose-500 animate-ping' : 'bg-cyan-400'}`} />
                  <span className="text-xs font-bold tracking-wider text-slate-200">{label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                    isTripped
                      ? 'bg-rose-950 border border-rose-600 text-rose-300'
                      : rail.isStancePhase
                      ? 'bg-emerald-950 border border-emerald-600/70 text-emerald-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}>
                    {isTripped ? 'TRIPPED' : rail.isStancePhase ? 'STANCE' : 'SWING'}
                  </span>
                </div>
              </div>

              {/* Main Gauge / Amperage Readout */}
              <div className="space-y-3 font-mono">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold text-white tracking-tight">
                    {isTripped ? '0.00' : rail.current.toFixed(2)}
                    <span className="text-xs text-slate-400 ml-1 font-normal">A RMS</span>
                  </span>
                  <div className="text-right text-xs">
                    <span className="text-slate-400">Load: </span>
                    <span className="font-bold text-cyan-300">{rail.power.toFixed(0)} W</span>
                  </div>
                </div>

                {/* Current Load Bar relative to 24A trip limit */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>e-Fuse Load: {(rail.current / rail.tripThreshold * 100).toFixed(0)}%</span>
                    <span>Max: {rail.tripThreshold}A</span>
                  </div>
                  <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden border border-slate-800">
                    <div
                      className={`h-full transition-all duration-300 ${
                        isTripped
                          ? 'bg-rose-600'
                          : rail.current > 18
                          ? 'bg-amber-400'
                          : 'bg-cyan-400'
                      }`}
                      style={{ width: `${Math.min(100, (rail.current / rail.tripThreshold) * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Detailed 3-Actuator Breakdown Table */}
                <div className="pt-2 border-t border-slate-800/60 space-y-1.5 text-[11px]">
                  <div className="flex justify-between text-slate-400">
                    <span>M1 Abduct:</span>
                    <span className="font-semibold text-slate-200">
                      {isTripped ? '0.0A' : `${rail.jointBreakdown.roll.current.toFixed(2)}A (${rail.jointBreakdown.roll.pwm}%)`}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>M2 Hip Pitch:</span>
                    <span className="font-semibold text-slate-200">
                      {isTripped ? '0.0A' : `${rail.jointBreakdown.pitch.current.toFixed(2)}A (${rail.jointBreakdown.pitch.pwm}%)`}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>M3 Knee Pitch:</span>
                    <span className="font-semibold text-slate-200">
                      {isTripped ? '0.0A' : `${rail.jointBreakdown.knee.current.toFixed(2)}A (${rail.jointBreakdown.knee.pwm}%)`}
                    </span>
                  </div>
                </div>

                {/* Additional Rail Metrics */}
                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                  <span>I²R Heat Loss:</span>
                  <span className="text-amber-400 font-bold">{rail.jouleLossWatts.toFixed(2)} W</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Phase Ripple RMS:</span>
                  <span className="text-slate-300">{rail.phaseRippleMilliAmps} mA</span>
                </div>

                {/* e-Fuse Toggle Button */}
                <div className="pt-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleEFuse(id);
                    }}
                    className={`w-full py-1.5 px-3 rounded-lg border text-xs font-mono font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      isTripped
                        ? 'bg-rose-900/60 border-rose-500 text-rose-200 hover:bg-rose-900'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-rose-500 hover:text-rose-300'
                    }`}
                  >
                    {isTripped ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> RESET E-FUSE (BREAKER)
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="w-3.5 h-3.5 text-slate-400" /> SIMULATE TRIP FAULT
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Deep-Dive Inspection Panel for Selected Rail or Avionics */}
      {selectedRail && (
        <div className="bg-slate-950 border border-cyan-500/40 rounded-xl p-4 sm:p-5 font-mono space-y-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-cyan-950 border border-cyan-500/50 text-cyan-300">
                <Gauge className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  {selectedRail === 'main'
                    ? 'MAIN DC BUSBAR & BMS CONTACTOR DIAGNOSTIC'
                    : selectedRail === 'avionics'
                    ? 'AVIONICS & COMPUTE RAIL ARCHITECTURE'
                    : `${selectedRail.toUpperCase()} POWER RAIL DEEP INSPECTION`}
                </h3>
                <p className="text-xs text-slate-400">
                  Telemetry parameters, line impedance and thermal dissipation limits
                </p>
              </div>
            </div>

            <button
              onClick={() => setSelectedRail(null)}
              className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded bg-slate-900 border border-slate-800 cursor-pointer"
            >
              CLOSE INSPECTOR ✕
            </button>
          </div>

          {selectedRail === 'avionics' ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {Object.entries(calculatedRails.avionics.subsystems).map(([key, sub]) => (
                <div key={key} className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1.5">
                  <div className="text-xs font-bold text-purple-300">{sub.name}</div>
                  <div className="text-lg font-bold text-white">{sub.current.toFixed(2)} A</div>
                  <div className="text-[11px] text-slate-400">{sub.power.toFixed(1)} W @ 48V Bus</div>
                  <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800">{sub.desc}</div>
                </div>
              ))}
            </div>
          ) : selectedRail === 'main' ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2">
                <div className="font-bold text-cyan-400">BATTERY TERMINAL TELEMETRY</div>
                <div className="flex justify-between"><span className="text-slate-400">Terminal Voltage:</span> <span className="font-bold text-white">{calculatedRails.baseVoltage.toFixed(2)} V</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Total Discharge Rate:</span> <span className="font-bold text-cyan-300">{calculatedRails.totalPackCurrent.toFixed(2)} A</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Pack SoC:</span> <span className="font-bold text-emerald-400">{telemetry.batteryPercent}%</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Pack Temperature:</span> <span className="font-bold text-white">{telemetry.bmsTemp.toFixed(1)} °C</span></div>
              </div>

              <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2">
                <div className="font-bold text-blue-400">COPPER BUSBAR & LOSS ANALYSIS</div>
                <div className="flex justify-between"><span className="text-slate-400">Busbar Resistance:</span> <span className="font-bold text-white">12.4 mΩ</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Total Actuator I²R Loss:</span> <span className="font-bold text-amber-400">{calculatedRails.totalJouleLossWatts.toFixed(2)} W</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Conduction Efficiency:</span> <span className="font-bold text-emerald-400">{calculatedRails.efficiencyPercent.toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Estimated Bus Sag:</span> <span className="font-bold text-white">{(calculatedRails.totalPackCurrent * 0.045).toFixed(2)} V</span></div>
              </div>

              <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2">
                <div className="font-bold text-emerald-400">SOLID-STATE SAFETY & PYROFUSE</div>
                <div className="flex justify-between"><span className="text-slate-400">Pyro Contactor:</span> <span className="font-bold text-emerald-400">ARMED / HEALTHY</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Continuous Rating:</span> <span className="font-bold text-white">45.0 A continuous</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Surge Limit (100ms):</span> <span className="font-bold text-white">90.0 A</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Active Rails:</span> <span className="font-bold text-white">{4 - Object.values(trippedRails).filter(Boolean).length} / 4 Legs Active</span></div>
              </div>
            </div>
          ) : (
            (() => {
              const rail = calculatedRails[selectedRail as LegRailId];
              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {Object.entries(rail.jointBreakdown).map(([k, j]) => (
                      <div key={k} className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">{j.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono">
                            {j.pwm}% PWM
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between">
                          <span className="text-xl font-bold text-cyan-300">{j.current.toFixed(2)} A</span>
                          <span className="text-xs text-slate-400">{j.power.toFixed(1)} W</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-slate-400 pt-1 border-t border-slate-800">
                          <span>Winding Temp:</span>
                          <span className={`font-bold ${j.temp > 55 ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {j.temp.toFixed(1)} °C
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* History Oscilloscope mini preview */}
                  <div className="bg-slate-900/90 rounded-lg p-3 border border-slate-800 space-y-2">
                    <div className="flex justify-between text-xs text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                        Rolling Current Waveform (Last 30 Samples):
                      </span>
                      <span className="font-bold text-cyan-300">
                        Peak: {Math.max(...historyBuffer.map((h) => (h as any)[selectedRail] || 0)).toFixed(2)} A
                      </span>
                    </div>

                    <div className="h-16 flex items-end gap-1 w-full bg-slate-950 p-1 rounded border border-slate-800">
                      {historyBuffer.map((pt, i) => {
                        const val = (pt as any)[selectedRail] || 0;
                        const maxVal = 20;
                        const barH = Math.min(100, Math.max(4, (val / maxVal) * 100));
                        return (
                          <div
                            key={i}
                            className="flex-1 bg-cyan-500/70 hover:bg-cyan-400 transition-all rounded-t-sm"
                            style={{ height: `${barH}%` }}
                            title={`${val.toFixed(2)} A`}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      )}
    </div>
  );
};
