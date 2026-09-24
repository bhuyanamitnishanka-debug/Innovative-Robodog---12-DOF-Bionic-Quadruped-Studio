import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { TelemetryState, DiagnosticEvent } from '../types/robotics';
import { audioSynth } from '../utils/audioSynthesizer';
import {
  Flame,
  Zap,
  Activity,
  AlertTriangle,
  RotateCcw,
  Play,
  Pause,
  Sliders,
  ChevronRight,
  Info,
  ShieldAlert,
  Gauge,
  Sparkles,
  Wind,
  Layers,
  TrendingUp,
  Cpu,
  Thermometer,
} from 'lucide-react';

interface MotorThermalHeatmapProps {
  telemetry: TelemetryState;
  updateTelemetry?: (partial: Partial<TelemetryState>) => void;
  onLogDiagnosticEvent?: (event: Omit<DiagnosticEvent, 'id' | 'timestamp' | 'relativeTimeMs'>) => void;
}

export type JointId =
  | 'fl_roll'
  | 'fl_pitch'
  | 'fl_knee'
  | 'fr_roll'
  | 'fr_pitch'
  | 'fr_knee'
  | 'rl_roll'
  | 'rl_pitch'
  | 'rl_knee'
  | 'rr_roll'
  | 'rr_pitch'
  | 'rr_knee';

export type ThermalMetricMode =
  | 'absolute_celsius'
  | 'thermal_margin'
  | 'joule_watts'
  | 'sag_correlation';

export type ThermalColorPalette = 'ironbow' | 'turbo' | 'inferno' | 'cyber';

export interface JointThermalData {
  id: JointId;
  leg: 'FL' | 'FR' | 'RL' | 'RR';
  jointType: 'roll' | 'pitch' | 'knee';
  jointName: string;
  actuatorModel: string;
  currentTemp: number; // °C
  peakTemp: number; // °C
  pwmDuty: number; // % (0-100)
  phaseCurrentRms: number; // Amperes
  jouleLossWatts: number; // Watts (3 * I^2 * R_ph)
  deltaTPerMin: number; // °C / min rate
  thermalMargin: number; // °C to 85°C limit
  mosfetTemp: number; // °C
  gearboxTemp: number; // °C
  sagMultiplier: number; // Factor due to bus voltage sag (e.g. 1.18x)
  status: 'nominal' | 'elevated' | 'warning' | 'throttling';
  history: number[]; // Recent temperature history
}

export const MotorThermalHeatmap2D: React.FC<MotorThermalHeatmapProps> = ({
  telemetry,
  updateTelemetry,
  onLogDiagnosticEvent,
}) => {
  // View & visualization controls
  const [metricMode, setMetricMode] = useState<ThermalMetricMode>('absolute_celsius');
  const [colorPalette, setColorPalette] = useState<ThermalColorPalette>('ironbow');
  const [selectedJointId, setSelectedJointId] = useState<JointId>('fl_knee');
  const [isSamplingPaused, setIsSamplingPaused] = useState<boolean>(false);
  const [viewLayout, setViewLayout] = useState<'both' | 'spatial' | 'grid'>('both');
  const [coolingOverrideActive, setCoolingOverrideActive] = useState<boolean>(false);

  // Active thermal simulation scenario
  const [activeScenario, setActiveScenario] = useState<string>('nominal');
  const [scenarioRemainingSec, setScenarioRemainingSec] = useState<number>(0);

  // Warning thresholds
  const STATOR_WARNING_TEMP = 68.0; // °C
  const STATOR_THROTTLE_TEMP = 82.0; // °C
  const STATOR_MAX_LIMIT = 95.0; // °C

  // 12-Joint Thermal State Buffer
  const [jointDataMap, setJointDataMap] = useState<Record<JointId, JointThermalData>>(() => {
    const legs = ['fl', 'fr', 'rl', 'rr'] as const;
    const initialMap = {} as Record<JointId, JointThermalData>;

    legs.forEach((legKey) => {
      const legUpper = legKey.toUpperCase() as 'FL' | 'FR' | 'RL' | 'RR';
      const legTel = telemetry.legs[legKey];

      const joints: Array<{
        type: 'roll' | 'pitch' | 'knee';
        name: string;
        model: string;
        baseTemp: number;
        basePwm: number;
      }> = [
        {
          type: 'roll',
          name: `${legUpper} Hip Abduction / Roll`,
          model: 'RoboDrive ILM-50x14 Frameless',
          baseTemp: legTel.hipRollTemp || 32.2,
          basePwm: 26.5,
        },
        {
          type: 'pitch',
          name: `${legUpper} Hip Pitch / Thigh`,
          model: 'RoboDrive ILM-70x18 High-Torque',
          baseTemp: legTel.hipPitchTemp || 38.0,
          basePwm: 46.2,
        },
        {
          type: 'knee',
          name: `${legUpper} Knee Pitch / Calf`,
          model: 'RoboDrive ILM-70x18 High-Torque',
          baseTemp: legTel.kneePitchTemp || 43.5,
          basePwm: 62.8,
        },
      ];

      joints.forEach((j) => {
        const id = `${legKey}_${j.type}` as JointId;
        const temp = j.baseTemp;
        const currentA = (j.basePwm / 100) * 16.5;
        const joule = Math.round(3 * Math.pow(currentA, 2) * 0.048 * 10) / 10;

        initialMap[id] = {
          id,
          leg: legUpper,
          jointType: j.type,
          jointName: j.name,
          actuatorModel: j.model,
          currentTemp: temp,
          peakTemp: temp + 1.8,
          pwmDuty: j.basePwm,
          phaseCurrentRms: parseFloat(currentA.toFixed(1)),
          jouleLossWatts: joule,
          deltaTPerMin: 0.4,
          thermalMargin: parseFloat((STATOR_THROTTLE_TEMP - temp).toFixed(1)),
          mosfetTemp: temp - 3.2,
          gearboxTemp: temp - 4.5,
          sagMultiplier: 1.0,
          status: 'nominal',
          history: Array.from({ length: 24 }, (_, idx) =>
            parseFloat((temp - (24 - idx) * 0.08 + Math.sin(idx * 0.5) * 0.2).toFixed(1))
          ),
        };
      });
    });

    return initialMap;
  });

  // Track event dispatch debouncing so we don't spam logs
  const lastLoggedAlertRef = useRef<Record<string, number>>({});

  const logThermalDiagnostic = useCallback(
    (code: string, message: string, severity: 'info' | 'warning' | 'critical', metric: string) => {
      const now = Date.now();
      const lastTime = lastLoggedAlertRef.current[code] || 0;
      if (now - lastTime < 12000) return; // 12 second throttle per code
      lastLoggedAlertRef.current[code] = now;

      if (onLogDiagnosticEvent) {
        onLogDiagnosticEvent({
          severity,
          subsystem: 'THERMAL',
          code,
          message,
          metric,
        });
      }

      window.dispatchEvent(
        new CustomEvent('robodog:log-diagnostic-event', {
          detail: {
            severity,
            subsystem: 'THERMAL',
            code,
            message,
            metric,
          },
        })
      );

      if (telemetry.audioEnabled && (severity === 'warning' || severity === 'critical')) {
        audioSynth.playAlert(true);
      }
    },
    [onLogDiagnosticEvent, telemetry.audioEnabled]
  );

  // Physics-based real-time thermal simulation ticker
  useEffect(() => {
    if (isSamplingPaused) return;

    const interval = setInterval(() => {
      const railV = telemetry.voltage || 48.0;
      const nominalV = 48.24;
      const sagDeltaV = Math.max(0, nominalV - railV);

      // Voltage sag current multiplier: at lower voltage, constant mechanical torque/power
      // forces higher inverter phase currents I = P / (sqrt(3) * V_rms * cos(theta))
      const sagAmpFactor = Math.pow(nominalV / Math.max(30.0, railV), 1.85);

      // Speed and gait activity factors
      const gaitMultiplierMap: Record<string, number> = {
        stand: 0.25,
        walk: 0.85,
        trot: 1.15,
        pace: 1.25,
        creep: 0.6,
        bound: 1.7,
        gallop: 2.1,
        crawl: 0.5,
      };
      const gaitFactor = gaitMultiplierMap[telemetry.gait] || 1.0;
      const speedFactor = Math.max(0.2, telemetry.linearVelocity || 0.8);
      const isBurst = Boolean(telemetry.powerBurstActive);

      setJointDataMap((prev) => {
        const next = { ...prev };
        let anyThrottling = false;
        let anyWarning = false;

        (Object.keys(next) as JointId[]).forEach((id) => {
          const item = next[id];
          const isKnee = item.jointType === 'knee';
          const isPitch = item.jointType === 'pitch';
          const isRear = item.leg === 'RL' || item.leg === 'RR';

          // Scenario biases
          let scenarioBiasPwm = 0;
          let scenarioTempDrift = 0;

          if (activeScenario === 'climb' && isRear) {
            scenarioBiasPwm = isKnee ? 24.0 : 16.0;
            scenarioTempDrift = 0.08;
          } else if (activeScenario === 'sprint') {
            scenarioBiasPwm = isKnee ? 28.0 : 18.0;
            scenarioTempDrift = 0.12;
          } else if (activeScenario === 'stall_fl' && id === 'fl_knee') {
            scenarioBiasPwm = 38.0;
            scenarioTempDrift = 0.32;
          } else if (coolingOverrideActive || activeScenario === 'cooling') {
            scenarioTempDrift = -0.15;
          }

          // Base PWM dynamically adjusted by gait & speed
          const baseDuty = isKnee ? 54.0 : isPitch ? 40.0 : 24.0;
          const dynamicPwm = Math.min(
            98.5,
            Math.max(
              8.0,
              baseDuty * gaitFactor * (speedFactor * 0.7 + 0.3) +
                (isBurst ? 22 : 0) +
                scenarioBiasPwm +
                (Math.sin(Date.now() * 0.003 + (id.charCodeAt(0) % 5)) * 2.5)
            )
          );

          // Phase current estimation: I_phase ~ (PWM / 100) * I_max * sagAmpFactor
          const maxPhaseCurrentA = isKnee ? 24.0 : isPitch ? 20.0 : 14.0;
          const phaseCurrent = parseFloat(
            ((dynamicPwm / 100) * maxPhaseCurrentA * sagAmpFactor).toFixed(1)
          );

          // Joule heating: P_loss = 3 * I_phase^2 * R_ph (R_ph = 0.048 Ohm)
          const windingResistance = isKnee ? 0.052 : isPitch ? 0.048 : 0.042;
          const jouleWatts = Math.round(3 * Math.pow(phaseCurrent, 2) * windingResistance * 10) / 10;

          // Heat dissipation vs heat generation balance
          // Ambient: 24.0°C; Liquid cooling loop thermal resistance R_th = 0.42 °C/W
          const coolingEfficiency = coolingOverrideActive ? 1.6 : 1.0;
          const ambient = 24.0;
          const thermalEquilibrium =
            ambient + (jouleWatts * 0.48) / coolingEfficiency;

          // Thermal inertia / time constant integration
          const deltaT = (thermalEquilibrium - item.currentTemp) * 0.04 + scenarioTempDrift;
          const nextTemp = parseFloat(
            Math.max(22.0, Math.min(108.0, item.currentTemp + deltaT)).toFixed(1)
          );

          // Thermal gradient rate (°C/min)
          const deltaTPerMin = parseFloat((deltaT * 60).toFixed(1));
          const peak = Math.max(item.peakTemp, nextTemp);
          const margin = parseFloat((STATOR_THROTTLE_TEMP - nextTemp).toFixed(1));

          // Determine status
          let status: 'nominal' | 'elevated' | 'warning' | 'throttling' = 'nominal';
          if (nextTemp >= STATOR_THROTTLE_TEMP) {
            status = 'throttling';
            anyThrottling = true;
          } else if (nextTemp >= STATOR_WARNING_TEMP) {
            status = 'warning';
            anyWarning = true;
          } else if (nextTemp >= 52.0) {
            status = 'elevated';
          }

          // Update recent history sparkline (maintain 24 points)
          const nextHistory = [...item.history.slice(1), nextTemp];

          next[id] = {
            ...item,
            currentTemp: nextTemp,
            peakTemp: peak,
            pwmDuty: parseFloat(dynamicPwm.toFixed(1)),
            phaseCurrentRms: phaseCurrent,
            jouleLossWatts: jouleWatts,
            deltaTPerMin,
            thermalMargin: margin,
            mosfetTemp: parseFloat((nextTemp - 4.2 + (jouleWatts * 0.03)).toFixed(1)),
            gearboxTemp: parseFloat((nextTemp - 5.5).toFixed(1)),
            sagMultiplier: parseFloat(sagAmpFactor.toFixed(2)),
            status,
            history: nextHistory,
          };
        });

        // Trigger diagnostic events when status escalates
        if (anyThrottling) {
          const hottest = Object.values(next).sort((a, b) => b.currentTemp - a.currentTemp)[0];
          logThermalDiagnostic(
            'THERMAL_DERATE_ENGAGED',
            `THERMAL THROTTLE ACTIVE: ${hottest.jointName} reached ${hottest.currentTemp}°C (Threshold ${STATOR_THROTTLE_TEMP}°C). Phase current derated to 65% to avert winding degradation.`,
            'critical',
            `${hottest.jointName}: ${hottest.currentTemp}°C | Sag: ${sagDeltaV.toFixed(2)}V`
          );
        } else if (anyWarning) {
          const hottest = Object.values(next).sort((a, b) => b.currentTemp - a.currentTemp)[0];
          logThermalDiagnostic(
            'THERMAL_WARNING_ELEVATED',
            `STATOR COIL ELEVATED: ${hottest.jointName} at ${hottest.currentTemp}°C with ${hottest.pwmDuty}% PWM duty. Bus sag factor ${sagAmpFactor.toFixed(2)}x.`,
            'warning',
            `${hottest.jointName}: ${hottest.currentTemp}°C | PWM: ${hottest.pwmDuty}%`
          );
        }

        return next;
      });

      // Countdown test scenarios
      if (scenarioRemainingSec > 0) {
        setScenarioRemainingSec((s) => {
          if (s <= 1) {
            setActiveScenario('nominal');
            return 0;
          }
          return s - 1;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [
    isSamplingPaused,
    telemetry.voltage,
    telemetry.gait,
    telemetry.linearVelocity,
    telemetry.powerBurstActive,
    activeScenario,
    scenarioRemainingSec,
    coolingOverrideActive,
    logThermalDiagnostic,
  ]);

  // Color interpolation helpers for heatmaps
  const getThermalColor = useCallback(
    (temp: number, palette: ThermalColorPalette = colorPalette) => {
      // Scale: 25°C (cool) to 90°C (extreme hot)
      const t = Math.max(0, Math.min(1, (temp - 25.0) / (90.0 - 25.0)));

      if (palette === 'ironbow') {
        // FLIR Ironbow: dark purple -> deep navy -> crimson -> orange -> bright yellow -> white
        if (t < 0.2) {
          // #100b2b to #27146e
          return interpolateRgb([16, 11, 43], [39, 20, 110], t / 0.2);
        } else if (t < 0.45) {
          // #27146e to #911a78
          return interpolateRgb([39, 20, 110], [145, 26, 120], (t - 0.2) / 0.25);
        } else if (t < 0.7) {
          // #911a78 to #e65c00
          return interpolateRgb([145, 26, 120], [230, 92, 0], (t - 0.45) / 0.25);
        } else if (t < 0.9) {
          // #e65c00 to #fadb36
          return interpolateRgb([230, 92, 0], [250, 219, 54], (t - 0.7) / 0.2);
        } else {
          // #fadb36 to #ffffff
          return interpolateRgb([250, 219, 54], [255, 255, 255], (t - 0.9) / 0.1);
        }
      } else if (palette === 'turbo') {
        // Spectral Turbo: Deep Navy -> Cyan -> Green -> Yellow -> Red
        if (t < 0.25) {
          return interpolateRgb([30, 58, 138], [6, 182, 212], t / 0.25);
        } else if (t < 0.5) {
          return interpolateRgb([6, 182, 212], [16, 185, 129], (t - 0.25) / 0.25);
        } else if (t < 0.75) {
          return interpolateRgb([16, 185, 129], [234, 179, 8], (t - 0.5) / 0.25);
        } else {
          return interpolateRgb([234, 179, 8], [239, 68, 68], (t - 0.75) / 0.25);
        }
      } else if (palette === 'inferno') {
        // Inferno: Black -> Dark Purple -> Crimson -> Bright Amber -> Pale Yellow
        if (t < 0.3) {
          return interpolateRgb([10, 5, 20], [85, 16, 115], t / 0.3);
        } else if (t < 0.6) {
          return interpolateRgb([85, 16, 115], [195, 45, 75], (t - 0.3) / 0.3);
        } else if (t < 0.85) {
          return interpolateRgb([195, 45, 75], [250, 140, 45], (t - 0.6) / 0.25);
        } else {
          return interpolateRgb([250, 140, 45], [252, 253, 191], (t - 0.85) / 0.15);
        }
      } else {
        // Cyber: Deep Slate -> Cyan -> Emerald -> Amber -> Neon Rose
        if (t < 0.3) {
          return interpolateRgb([15, 23, 42], [6, 182, 212], t / 0.3);
        } else if (t < 0.6) {
          return interpolateRgb([6, 182, 212], [16, 185, 129], (t - 0.3) / 0.3);
        } else if (t < 0.8) {
          return interpolateRgb([16, 185, 129], [245, 158, 11], (t - 0.6) / 0.2);
        } else {
          return interpolateRgb([245, 158, 11], [244, 63, 94], (t - 0.8) / 0.2);
        }
      }
    },
    [colorPalette]
  );

  // Helper RGB interpolator
  function interpolateRgb(c1: [number, number, number], c2: [number, number, number], f: number) {
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * f);
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * f);
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * f);
    return `rgb(${r}, ${g}, ${b})`;
  }

  // Get displayed value based on selected metric mode
  const getMetricDisplay = useCallback(
    (item: JointThermalData) => {
      switch (metricMode) {
        case 'absolute_celsius':
          return {
            primary: `${item.currentTemp.toFixed(1)}°C`,
            sub: `${((item.currentTemp * 9) / 5 + 32).toFixed(1)}°F`,
            accent: item.currentTemp >= STATOR_THROTTLE_TEMP ? '#f43f5e' : item.currentTemp >= STATOR_WARNING_TEMP ? '#f59e0b' : '#38bdf8',
          };
        case 'thermal_margin':
          return {
            primary: `${item.thermalMargin.toFixed(1)}°C`,
            sub: item.thermalMargin <= 0 ? 'THROTTLED' : 'Headroom',
            accent: item.thermalMargin <= 3 ? '#f43f5e' : item.thermalMargin <= 12 ? '#f59e0b' : '#10b981',
          };
        case 'joule_watts':
          return {
            primary: `${item.jouleLossWatts.toFixed(1)}W`,
            sub: `${item.phaseCurrentRms.toFixed(1)}A RMS`,
            accent: item.jouleLossWatts > 35 ? '#f43f5e' : item.jouleLossWatts > 20 ? '#f59e0b' : '#a855f7',
          };
        case 'sag_correlation':
          return {
            primary: `+${((item.sagMultiplier - 1) * 100).toFixed(0)}%`,
            sub: `${item.sagMultiplier.toFixed(2)}x I²R Boost`,
            accent: item.sagMultiplier >= 1.25 ? '#f43f5e' : item.sagMultiplier >= 1.1 ? '#f59e0b' : '#06b6d4',
          };
      }
    },
    [metricMode]
  );

  // Aggregates across all 12 joints
  const stats = useMemo(() => {
    const list = Object.values(jointDataMap);
    const temps = list.map((j) => j.currentTemp);
    const maxTemp = Math.max(...temps);
    const minTemp = Math.min(...temps);
    const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;

    const pwms = list.map((j) => j.pwmDuty);
    const avgPwm = pwms.reduce((a, b) => a + b, 0) / pwms.length;

    const totalJouleWatts = list.reduce((sum, j) => sum + j.jouleLossWatts, 0);

    const hottestJoint = list.find((j) => j.currentTemp === maxTemp) || list[0];
    const throttledCount = list.filter((j) => j.status === 'throttling').length;
    const warningCount = list.filter((j) => j.status === 'warning').length;

    // Voltage sag correlation calculation
    const railV = telemetry.voltage || 48.0;
    const nominalV = 48.24;
    const sagV = Math.max(0, nominalV - railV);
    const sagInducedHeatingPct = Math.max(0, Math.pow(nominalV / Math.max(32, railV), 1.85) - 1.0) * 100;

    return {
      maxTemp,
      minTemp,
      avgTemp,
      avgPwm,
      totalJouleWatts,
      hottestJoint,
      throttledCount,
      warningCount,
      sagV,
      sagInducedHeatingPct,
    };
  }, [jointDataMap, telemetry.voltage]);

  // Selected joint
  const selectedJoint = jointDataMap[selectedJointId] || jointDataMap['fl_knee'];

  // Test bench scenario triggers
  const triggerScenario = (scenarioId: string, durationSec: number = 15) => {
    setActiveScenario(scenarioId);
    setScenarioRemainingSec(durationSec);

    if (telemetry.audioEnabled) {
      if (scenarioId === 'stall_fl') {
        audioSynth.playAlert(true);
      } else {
        audioSynth.playPowerBurst(true);
      }
    }

    const scenarioLabels: Record<string, string> = {
      nominal: 'Nominal Trot Equilibrium',
      climb: '35° Incline Climb (Rear Knees 76% PWM)',
      sprint: 'Gallop Dynamic Sprint (All 4 Knees 84% PWM)',
      stall_fl: 'FL Knee Obstacle Pinch / Stall Surge (95% PWM)',
      cooling: 'Active Liquid Cooling Flush (Radiator Overdrive)',
    };

    logThermalDiagnostic(
      `SCENARIO_${scenarioId.toUpperCase()}`,
      `TEST SCENARIO ENGAGED: ${scenarioLabels[scenarioId] || scenarioId}. Correlating PWM saturation and rail voltage sag.`,
      scenarioId === 'stall_fl' ? 'critical' : 'info',
      `Mode: ${scenarioId} | Window: ${durationSec}s`
    );
  };

  const resetAllToNominal = () => {
    setActiveScenario('nominal');
    setScenarioRemainingSec(0);
    setCoolingOverrideActive(false);

    setJointDataMap((prev) => {
      const next = { ...prev };
      (Object.keys(next) as JointId[]).forEach((id) => {
        const item = next[id];
        const isKnee = item.jointType === 'knee';
        const isPitch = item.jointType === 'pitch';
        const base = isKnee ? 42.5 : isPitch ? 37.5 : 32.0;

        next[id] = {
          ...item,
          currentTemp: base,
          peakTemp: base + 1.2,
          pwmDuty: isKnee ? 54.0 : isPitch ? 42.0 : 26.0,
          jouleLossWatts: isKnee ? 22.4 : isPitch ? 14.8 : 7.2,
          phaseCurrentRms: isKnee ? 12.8 : isPitch ? 9.8 : 6.2,
          status: 'nominal',
          deltaTPerMin: 0.2,
          thermalMargin: parseFloat((STATOR_THROTTLE_TEMP - base).toFixed(1)),
          mosfetTemp: base - 3.5,
          gearboxTemp: base - 4.8,
        };
      });
      return next;
    });

    logThermalDiagnostic(
      'THERMAL_SIM_RESET',
      'Thermal baseline restored. Stators normalized to nominal ambient operational state.',
      'info',
      'Nominal: 32-43°C'
    );
  };

  // 2D Spatial Layout Node Positions (normalized 0-100% within SVG chassis canvas)
  const spatialNodePositions: Record<JointId, { x: number; y: number; labelAnchor: 'start' | 'end' | 'middle'; legGroup: string }> = {
    fl_roll: { x: 34, y: 26, labelAnchor: 'end', legGroup: 'Front Left' },
    fl_pitch: { x: 26, y: 20, labelAnchor: 'end', legGroup: 'Front Left' },
    fl_knee: { x: 18, y: 14, labelAnchor: 'end', legGroup: 'Front Left' },

    fr_roll: { x: 66, y: 26, labelAnchor: 'start', legGroup: 'Front Right' },
    fr_pitch: { x: 74, y: 20, labelAnchor: 'start', legGroup: 'Front Right' },
    fr_knee: { x: 82, y: 14, labelAnchor: 'start', legGroup: 'Front Right' },

    rl_roll: { x: 34, y: 74, labelAnchor: 'end', legGroup: 'Rear Left' },
    rl_pitch: { x: 26, y: 80, labelAnchor: 'end', legGroup: 'Rear Left' },
    rl_knee: { x: 18, y: 86, labelAnchor: 'end', legGroup: 'Rear Left' },

    rr_roll: { x: 66, y: 74, labelAnchor: 'start', legGroup: 'Rear Right' },
    rr_pitch: { x: 74, y: 80, labelAnchor: 'start', legGroup: 'Rear Right' },
    rr_knee: { x: 82, y: 86, labelAnchor: 'start', legGroup: 'Rear Right' },
  };

  // Matrix Grid rows and columns
  const legRows: Array<{ id: 'FL' | 'FR' | 'RL' | 'RR'; name: string }> = [
    { id: 'FL', name: 'Front Left (FL)' },
    { id: 'FR', name: 'Front Right (FR)' },
    { id: 'RL', name: 'Rear Left (RL)' },
    { id: 'RR', name: 'Rear Right (RR)' },
  ];

  const jointColumns: Array<{ type: 'roll' | 'pitch' | 'knee'; label: string; axis: string }> = [
    { type: 'roll', label: 'Hip Roll / Abduction', axis: 'Actuator 1 (X-Axis)' },
    { type: 'pitch', label: 'Hip Pitch / Thigh', axis: 'Actuator 2 (Y-Axis)' },
    { type: 'knee', label: 'Knee Pitch / Calf', axis: 'Actuator 3 (Z-Axis)' },
  ];

  return (
    <div className="bg-[#080d1a] border border-slate-800/90 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-6">
      {/* 1. Header & System Metadata Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400">
              <Flame className="w-5 h-5 animate-pulse" />
            </span>
            <h2 className="text-lg sm:text-xl font-bold font-['Chakra_Petch'] tracking-wide text-slate-100">
              12-Joint Motor Thermal Load Heatmap
            </h2>
          </div>
          {/* Zero-Pill unboxed metadata text */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400 mt-2">
            <span>Real-Time Stator Temperature</span>
            <span aria-hidden="true" className="text-slate-700">·</span>
            <span className="text-cyan-400 font-semibold">SVPWM Correlated</span>
            <span aria-hidden="true" className="text-slate-700">·</span>
            <span>Bus Voltage Sag Amplification</span>
            <span aria-hidden="true" className="text-slate-700">·</span>
            <span>Cooling: {coolingOverrideActive ? 'Radiator Fan Max' : 'Liquid 1.4 L/min'}</span>
          </div>
        </div>

        {/* Global Controls & Sampling State */}
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <button
            onClick={() => setIsSamplingPaused(!isSamplingPaused)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
              isSamplingPaused
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                : 'bg-slate-900 border-slate-700/80 text-slate-300 hover:text-white hover:border-slate-500'
            }`}
            title={isSamplingPaused ? 'Resume live thermal tracking' : 'Pause thermal tracking'}
          >
            {isSamplingPaused ? <Play className="w-3.5 h-3.5 text-amber-400" /> : <Pause className="w-3.5 h-3.5 text-cyan-400" />}
            <span>{isSamplingPaused ? 'RESUME' : 'PAUSE'}</span>
          </button>

          <button
            onClick={() => setCoolingOverrideActive(!coolingOverrideActive)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
              coolingOverrideActive
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                : 'bg-slate-900 border-slate-700/80 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/50'
            }`}
            title="Toggle Radiator Fan & Liquid Pump Forced Overdrive"
          >
            <Wind className={`w-3.5 h-3.5 ${coolingOverrideActive ? 'text-cyan-300 animate-spin' : 'text-slate-400'}`} />
            <span>FAN OVERDRIVE</span>
          </button>

          <button
            onClick={resetAllToNominal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-slate-300 hover:text-white hover:border-slate-500 transition-colors cursor-pointer"
            title="Reset thermal simulation to baseline equilibrium"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span>RESET</span>
          </button>
        </div>
      </div>

      {/* 2. Top Metric KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Peak Stator Temp */}
        <div className="bg-[#0b1222] border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Peak Joint Temp</span>
            <Thermometer className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span
              className={`text-2xl font-bold font-mono ${
                stats.maxTemp >= STATOR_THROTTLE_TEMP
                  ? 'text-rose-400 animate-pulse'
                  : stats.maxTemp >= STATOR_WARNING_TEMP
                  ? 'text-amber-400'
                  : 'text-slate-100'
              }`}
            >
              {stats.maxTemp.toFixed(1)}°C
            </span>
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-500 truncate">
            {stats.hottestJoint.jointName}
          </div>
        </div>

        {/* Average 12-Joint Stator Temp */}
        <div className="bg-[#0b1222] border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>12-Joint Mean</span>
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-cyan-300">
              {stats.avgTemp.toFixed(1)}°C
            </span>
            <span className="text-xs font-mono text-slate-500">avg</span>
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-500">
            Min: {stats.minTemp.toFixed(1)}°C · Spread: {(stats.maxTemp - stats.minTemp).toFixed(1)}°
          </div>
        </div>

        {/* Mean PWM Duty Cycle */}
        <div className="bg-[#0b1222] border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Mean PWM Duty</span>
            <Gauge className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-amber-300">
              {stats.avgPwm.toFixed(1)}%
            </span>
            <span className="text-xs font-mono text-slate-500">duty</span>
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-500">
            20 kHz Space-Vector FOC
          </div>
        </div>

        {/* Total Copper Loss I^2*R */}
        <div className="bg-[#0b1222] border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Total Joule Heat</span>
            <Zap className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-violet-300">
              {stats.totalJouleWatts.toFixed(0)}W
            </span>
            <span className="text-xs font-mono text-slate-500">loss</span>
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-500">
            3·I_ph²·R_ph dissipation
          </div>
        </div>

        {/* Voltage Sag Thermal Acceleration */}
        <div className="bg-[#0b1222] border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Sag Thermal Boost</span>
            <TrendingUp className="w-3.5 h-3.5 text-orange-400" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-orange-300">
              +{stats.sagInducedHeatingPct.toFixed(0)}%
            </span>
            <span className="text-xs font-mono text-slate-500">rate</span>
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-500">
            Rail: {telemetry.voltage.toFixed(2)}V (Δ{stats.sagV.toFixed(2)}V)
          </div>
        </div>

        {/* Thermal Protection Status */}
        <div className="bg-[#0b1222] border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Derate Status</span>
            <ShieldAlert className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            {stats.throttledCount > 0 ? (
              <span className="text-2xl font-bold font-mono text-rose-400 animate-pulse">
                {stats.throttledCount} DERATED
              </span>
            ) : stats.warningCount > 0 ? (
              <span className="text-2xl font-bold font-mono text-amber-400">
                {stats.warningCount} ELEVATED
              </span>
            ) : (
              <span className="text-2xl font-bold font-mono text-emerald-400">
                NOMINAL
              </span>
            )}
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-500">
            Ceiling: 82.0°C / Lock: 95.0°C
          </div>
        </div>
      </div>

      {/* 3. Interactive Options & View Filters Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#050a16] border border-slate-800 p-3 rounded-xl text-xs font-mono">
        {/* Metric Display Mode Selector (Functional Buttons) */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400 text-[11px]">DISPLAY METRIC:</span>
          <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
            {[
              { id: 'absolute_celsius', label: 'Temp (°C)' },
              { id: 'thermal_margin', label: 'Margin to 82°C' },
              { id: 'joule_watts', label: 'Joule Loss (W)' },
              { id: 'sag_correlation', label: 'Sag Multiplier' },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setMetricMode(m.id as ThermalMetricMode)}
                className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                  metricMode === m.id
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Color Palette Selector */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400 text-[11px]">PALETTE:</span>
          <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
            {[
              { id: 'ironbow', label: 'FLIR Ironbow' },
              { id: 'turbo', label: 'Turbo Spectral' },
              { id: 'inferno', label: 'Inferno' },
              { id: 'cyber', label: 'Cyber IR' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setColorPalette(p.id as ThermalColorPalette)}
                className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                  colorPalette === p.id
                    ? 'bg-rose-500 text-white font-bold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* View Layout Filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 text-[11px]">VIEW:</span>
          <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
            {[
              { id: 'both', label: 'Dual View' },
              { id: 'spatial', label: 'Spatial Map' },
              { id: 'grid', label: 'Matrix Grid' },
            ].map((v) => (
              <button
                key={v.id}
                onClick={() => setViewLayout(v.id as any)}
                className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                  viewLayout === v.id
                    ? 'bg-slate-700 text-cyan-300 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Thermal Scale Reference Bar */}
      <div className="bg-[#0b1222] border border-slate-800/80 rounded-xl p-3">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-2">
          <span>THERMAL GRADIENT SPECTRUM (25.0°C - 90.0°C)</span>
          <div className="flex items-center gap-4 text-[10px]">
            <span className="text-cyan-400 font-semibold">25°C Cool Baseline</span>
            <span className="text-amber-400 font-semibold">68°C Warning Threshold</span>
            <span className="text-rose-400 font-semibold">82°C Derating Throttling</span>
            <span className="text-white font-semibold">95°C Critical Junction</span>
          </div>
        </div>
        <div className="relative h-3 rounded-full overflow-hidden flex shadow-inner">
          {Array.from({ length: 100 }, (_, i) => {
            const temp = 25.0 + (i / 99) * (90.0 - 25.0);
            return (
              <div
                key={i}
                className="flex-1 h-full"
                style={{ backgroundColor: getThermalColor(temp) }}
              />
            );
          })}
        </div>
      </div>

      {/* 5. Main Visualizations: 2D Spatial Map & 2D Matrix Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left/Main Column: Spatial Map and/or Matrix Grid */}
        <div className={`${viewLayout === 'both' ? 'lg:col-span-8' : 'lg:col-span-8'} space-y-6`}>
          {/* Spatial 2D Top-Down Chassis Heatmap */}
          {(viewLayout === 'both' || viewLayout === 'spatial') && (
            <div className="bg-[#0b1222] border border-slate-800/90 rounded-2xl p-4 sm:p-5 relative overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-200">
                    2D Anatomical Top-Down Chassis Heatmap
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  Click any joint node to inspect
                </span>
              </div>

              {/* Interactive Vector Canvas */}
              <div className="relative w-full aspect-[16/10] sm:aspect-[16/9] max-h-[460px] bg-[#050811] rounded-xl border border-slate-800/90 overflow-hidden flex items-center justify-center p-2">
                <svg
                  viewBox="0 0 1000 600"
                  className="w-full h-full select-none"
                  style={{ filter: 'drop-shadow(0 0 12px rgba(0,0,0,0.8))' }}
                >
                  <defs>
                    {/* SVG Radial Gradients for Joint Nodes */}
                    {(Object.keys(jointDataMap) as JointId[]).map((id) => {
                      const item = jointDataMap[id];
                      const color = getThermalColor(item.currentTemp);
                      return (
                        <radialGradient key={id} id={`heat-glow-${id}`} cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor={color} stopOpacity="0.85" />
                          <stop offset="60%" stopColor={color} stopOpacity="0.35" />
                          <stop offset="100%" stopColor={color} stopOpacity="0" />
                        </radialGradient>
                      );
                    })}

                    {/* Central battery glow */}
                    <linearGradient id="chassis-bus-flow" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.6" />
                      <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.6" />
                    </linearGradient>
                  </defs>

                  {/* Robot Coordinate Grid */}
                  <g opacity="0.15">
                    <line x1="500" y1="40" x2="500" y2="560" stroke="#38bdf8" strokeDasharray="4 4" />
                    <line x1="100" y1="300" x2="900" y2="300" stroke="#38bdf8" strokeDasharray="4 4" />
                    <circle cx="500" cy="300" r="160" stroke="#38bdf8" fill="none" strokeDasharray="2 4" />
                    <circle cx="500" cy="300" r="260" stroke="#38bdf8" fill="none" strokeDasharray="2 4" />
                  </g>

                  {/* Central Carbon-Fiber Chassis Backbone */}
                  <rect
                    x="420"
                    y="140"
                    width="160"
                    height="320"
                    rx="28"
                    fill="#0f172a"
                    stroke="#1e293b"
                    strokeWidth="3"
                  />
                  <rect
                    x="440"
                    y="160"
                    width="120"
                    height="280"
                    rx="18"
                    fill="#090e1a"
                    stroke="#334155"
                    strokeWidth="1.5"
                  />

                  {/* 48V Battery Module Enclosure in Chassis */}
                  <rect
                    x="455"
                    y="190"
                    width="90"
                    height="180"
                    rx="8"
                    fill="url(#chassis-bus-flow)"
                    stroke="#0284c7"
                    strokeWidth="1.5"
                    opacity="0.8"
                  />
                  <text
                    x="500"
                    y="275"
                    textAnchor="middle"
                    fill="#e0f2fe"
                    fontSize="11"
                    fontFamily="monospace"
                    fontWeight="bold"
                    letterSpacing="1"
                  >
                    48V BMS
                  </text>
                  <text
                    x="500"
                    y="292"
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {telemetry.voltage.toFixed(2)}V · Δ{stats.sagV.toFixed(2)}V
                  </text>

                  {/* Central Liquid Cooling Loop Radiator & Flow Lines */}
                  <path
                    d="M 500 160 L 500 140 M 500 440 L 500 460"
                    stroke={coolingOverrideActive ? '#06b6d4' : '#0284c7'}
                    strokeWidth="4"
                    strokeDasharray={coolingOverrideActive ? '4 2' : 'none'}
                  />

                  {/* Front Shoulder Structural Brackets */}
                  <path
                    d="M 440 180 L 340 160 L 260 120 L 180 84"
                    fill="none"
                    stroke="#334155"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M 560 180 L 660 160 L 740 120 L 820 84"
                    fill="none"
                    stroke="#334155"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Rear Hip Structural Brackets */}
                  <path
                    d="M 440 420 L 340 440 L 260 480 L 180 516"
                    fill="none"
                    stroke="#334155"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M 560 420 L 660 440 L 740 480 L 820 516"
                    fill="none"
                    stroke="#334155"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* CAN-FD & 48V High-Current Bus Ribbons to 4 Limb Hubs */}
                  <g stroke="#06b6d4" strokeWidth="1.5" opacity="0.4" strokeDasharray="3 3">
                    <line x1="450" y1="210" x2="340" y2="160" />
                    <line x1="550" y1="210" x2="660" y2="160" />
                    <line x1="450" y1="370" x2="340" y2="440" />
                    <line x1="550" y1="370" x2="660" y2="440" />
                  </g>

                  {/* Direction Heading Indicator */}
                  <polygon points="500,105 510,125 490,125" fill="#38bdf8" opacity="0.9" />
                  <text
                    x="500"
                    y="95"
                    textAnchor="middle"
                    fill="#38bdf8"
                    fontSize="11"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    FORWARD HEADING (0°)
                  </text>

                  {/* Render 12 Joint Thermal Nodes */}
                  {(Object.keys(jointDataMap) as JointId[]).map((id) => {
                    const item = jointDataMap[id];
                    const pos = spatialNodePositions[id];
                    const cx = (pos.x / 100) * 1000;
                    const cy = (pos.y / 100) * 600;
                    const isSelected = selectedJointId === id;
                    const color = getThermalColor(item.currentTemp);
                    const metric = getMetricDisplay(item);

                    return (
                      <g
                        key={id}
                        onClick={() => setSelectedJointId(id)}
                        className="cursor-pointer transition-transform hover:scale-110"
                        style={{ transformOrigin: `${cx}px ${cy}px` }}
                      >
                        {/* Thermal Glow Aura Field */}
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isSelected ? 58 : 44}
                          fill={`url(#heat-glow-${id})`}
                        />

                        {/* Outer Selection Reticle */}
                        {isSelected && (
                          <circle
                            cx={cx}
                            cy={cy}
                            r="32"
                            fill="none"
                            stroke="#38bdf8"
                            strokeWidth="2"
                            strokeDasharray="4 2"
                            className="animate-spin"
                            style={{ transformOrigin: `${cx}px ${cy}px` }}
                          />
                        )}

                        {/* Core Joint Stator Enclosure Node */}
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isSelected ? 22 : 18}
                          fill={color}
                          stroke={isSelected ? '#ffffff' : '#0f172a'}
                          strokeWidth={isSelected ? '2.5' : '2'}
                          style={{
                            filter: `drop-shadow(0 0 ${isSelected ? '10px' : '4px'} ${color})`,
                          }}
                        />

                        {/* Stator Inner Hub Core */}
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isSelected ? 10 : 8}
                          fill="#090e1a"
                          stroke="#cbd5e1"
                          strokeWidth="1"
                        />

                        {/* Temperature / Metric Floating HUD Label */}
                        <g transform={`translate(${cx}, ${cy})`}>
                          <rect
                            x={pos.labelAnchor === 'start' ? 26 : pos.labelAnchor === 'end' ? -108 : -40}
                            y="-22"
                            width="82"
                            height="44"
                            rx="6"
                            fill="#0b1222"
                            stroke={isSelected ? '#38bdf8' : '#1e293b'}
                            strokeWidth="1.2"
                            opacity="0.95"
                          />
                          <text
                            x={pos.labelAnchor === 'start' ? 32 : pos.labelAnchor === 'end' ? -102 : -34}
                            y="-8"
                            fill="#94a3b8"
                            fontSize="9"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            {item.leg} {item.jointType.toUpperCase()}
                          </text>
                          <text
                            x={pos.labelAnchor === 'start' ? 32 : pos.labelAnchor === 'end' ? -102 : -34}
                            y="8"
                            fill={metric.accent}
                            fontSize="12"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            {metric.primary}
                          </text>
                          <text
                            x={pos.labelAnchor === 'start' ? 32 : pos.labelAnchor === 'end' ? -102 : -34}
                            y="18"
                            fill="#64748b"
                            fontSize="8"
                            fontFamily="monospace"
                          >
                            PWM {item.pwmDuty.toFixed(0)}%
                          </text>
                        </g>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          )}

          {/* 2D Matrix Grid: 4 Legs × 3 Joint Types */}
          {(viewLayout === 'both' || viewLayout === 'grid') && (
            <div className="bg-[#0b1222] border border-slate-800/90 rounded-2xl p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-200">
                    4×3 Actuator Heatmap Matrix Grid
                  </h3>
                </div>
                {/* Zero-Pill unboxed text */}
                <div className="text-[11px] font-mono text-slate-400">
                  Select cell for telemetry correlation deep-dive
                </div>
              </div>

              {/* Responsive Grid Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono border-collapse min-w-[620px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                      <th className="py-2.5 px-3 w-36">Limb Quadrant</th>
                      {jointColumns.map((col) => (
                        <th key={col.type} className="py-2.5 px-3">
                          <div>{col.label}</div>
                          <div className="text-[9px] text-slate-500 font-normal">{col.axis}</div>
                        </th>
                      ))}
                      <th className="py-2.5 px-3 text-right">Limb Max</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {legRows.map((leg) => {
                      const legLower = leg.id.toLowerCase() as 'fl' | 'fr' | 'rl' | 'rr';
                      const rollId = `${legLower}_roll` as JointId;
                      const pitchId = `${legLower}_pitch` as JointId;
                      const kneeId = `${legLower}_knee` as JointId;

                      const legJoints = [jointDataMap[rollId], jointDataMap[pitchId], jointDataMap[kneeId]];
                      const legMax = Math.max(...legJoints.map((j) => j.currentTemp));

                      return (
                        <tr key={leg.id} className="hover:bg-slate-900/40 transition-colors">
                          <td className="py-3 px-3">
                            <div className="font-bold text-slate-200 text-xs">{leg.name}</div>
                            <div className="text-[10px] text-slate-500">
                              {leg.id.startsWith('F') ? 'Forelimb Bus A' : 'Hindlimb Bus B'}
                            </div>
                          </td>

                          {legJoints.map((item) => {
                            const isSelected = selectedJointId === item.id;
                            const color = getThermalColor(item.currentTemp);
                            const metric = getMetricDisplay(item);

                            return (
                              <td key={item.id} className="py-2 px-2">
                                <div
                                  onClick={() => setSelectedJointId(item.id)}
                                  className={`p-2.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
                                    isSelected
                                      ? 'border-cyan-400 ring-2 ring-cyan-500/30 shadow-lg'
                                      : 'border-slate-800 hover:border-slate-600'
                                  }`}
                                  style={{
                                    backgroundColor: '#070d19',
                                  }}
                                >
                                  {/* Subtle thermal tint background */}
                                  <div
                                    className="absolute inset-0 opacity-20 pointer-events-none"
                                    style={{ backgroundColor: color }}
                                  />

                                  <div className="relative z-10 flex items-start justify-between">
                                    <div>
                                      <div className="text-sm font-bold" style={{ color: metric.accent }}>
                                        {metric.primary}
                                      </div>
                                      <div className="text-[10px] text-slate-400">{metric.sub}</div>
                                    </div>
                                    <div
                                      className="w-3 h-3 rounded-full border border-slate-700 shadow-sm"
                                      style={{ backgroundColor: color }}
                                    />
                                  </div>

                                  <div className="relative z-10 mt-2 flex items-center justify-between text-[10px] text-slate-500 border-t border-slate-800/80 pt-1">
                                    <span>PWM: {item.pwmDuty.toFixed(0)}%</span>
                                    <span>{item.jouleLossWatts.toFixed(0)}W</span>
                                  </div>
                                </div>
                              </td>
                            );
                          })}

                          <td className="py-3 px-3 text-right">
                            <span
                              className={`text-sm font-bold ${
                                legMax >= STATOR_THROTTLE_TEMP
                                  ? 'text-rose-400'
                                  : legMax >= STATOR_WARNING_TEMP
                                  ? 'text-amber-400'
                                  : 'text-slate-300'
                              }`}
                            >
                              {legMax.toFixed(1)}°C
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Selected Joint Deep-Dive Inspector & Electrical Correlation Panel */}
        <div className="lg:col-span-4 space-y-6">
          {/* Selected Joint Deep-Dive Inspector */}
          <div className="bg-[#0b1222] border border-cyan-500/40 rounded-2xl p-5 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
                <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-200">
                  Joint Telemetry Inspector
                </h3>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-300">
                NODE 0x{selectedJoint.id.slice(0, 2).toUpperCase()}
              </span>
            </div>

            {/* Joint Name & Core Readings */}
            <div>
              <div className="text-base font-bold text-slate-100">{selectedJoint.jointName}</div>
              <div className="text-xs font-mono text-slate-400 mt-0.5">{selectedJoint.actuatorModel}</div>
            </div>

            {/* Primary Temp Indicator */}
            <div className="mt-4 p-3.5 rounded-xl bg-[#070c18] border border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-mono text-slate-400">STATOR COIL TEMPERATURE</div>
                <div className="text-3xl font-bold font-mono text-slate-100 mt-1 flex items-baseline gap-2">
                  <span
                    style={{
                      color:
                        selectedJoint.currentTemp >= STATOR_THROTTLE_TEMP
                          ? '#f43f5e'
                          : selectedJoint.currentTemp >= STATOR_WARNING_TEMP
                          ? '#f59e0b'
                          : '#38bdf8',
                    }}
                  >
                    {selectedJoint.currentTemp.toFixed(1)}°C
                  </span>
                  <span className="text-xs text-slate-500">
                    (Peak: {selectedJoint.peakTemp.toFixed(1)}°C)
                  </span>
                </div>
              </div>

              {/* Status Indicator */}
              <div className="text-right font-mono">
                <div
                  className={`text-xs font-bold uppercase ${
                    selectedJoint.status === 'throttling'
                      ? 'text-rose-400 animate-pulse'
                      : selectedJoint.status === 'warning'
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {selectedJoint.status}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Margin: {selectedJoint.thermalMargin.toFixed(1)}°C
                </div>
              </div>
            </div>

            {/* Sparkline Temperature History (Last 24 Samples) */}
            <div className="mt-4">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1.5">
                <span>RECENT THERMAL DRIFT (24s)</span>
                <span>Rate: {selectedJoint.deltaTPerMin >= 0 ? `+${selectedJoint.deltaTPerMin}` : selectedJoint.deltaTPerMin}°C/min</span>
              </div>
              <div className="h-12 w-full bg-[#050811] rounded-lg border border-slate-800/80 p-1 flex items-end gap-1">
                {selectedJoint.history.map((val, idx) => {
                  const min = 25.0;
                  const max = 85.0;
                  const pct = Math.max(8, Math.min(100, ((val - min) / (max - min)) * 100));
                  return (
                    <div
                      key={idx}
                      className="flex-1 rounded-xs transition-all"
                      style={{
                        height: `${pct}%`,
                        backgroundColor: getThermalColor(val),
                      }}
                      title={`${val}°C`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Detailed Correlated Electrical Metrics */}
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-[#070c18] border border-slate-800">
                <span className="text-[10px] text-slate-500 block">PWM DUTY CYCLE</span>
                <span className="text-sm font-bold text-amber-300">
                  {selectedJoint.pwmDuty.toFixed(1)}%
                </span>
                <span className="text-[9px] text-slate-500 block">20 kHz SVPWM</span>
              </div>

              <div className="p-2.5 rounded-lg bg-[#070c18] border border-slate-800">
                <span className="text-[10px] text-slate-500 block">PHASE CURRENT</span>
                <span className="text-sm font-bold text-cyan-300">
                  {selectedJoint.phaseCurrentRms.toFixed(1)}A RMS
                </span>
                <span className="text-[9px] text-slate-500 block">Field Oriented</span>
              </div>

              <div className="p-2.5 rounded-lg bg-[#070c18] border border-slate-800">
                <span className="text-[10px] text-slate-500 block">JOULE LOSS (I²R)</span>
                <span className="text-sm font-bold text-violet-300">
                  {selectedJoint.jouleLossWatts.toFixed(1)} W
                </span>
                <span className="text-[9px] text-slate-500 block">Copper Dissipation</span>
              </div>

              <div className="p-2.5 rounded-lg bg-[#070c18] border border-slate-800">
                <span className="text-[10px] text-slate-500 block">SAG ACCELERATION</span>
                <span className="text-sm font-bold text-orange-300">
                  {selectedJoint.sagMultiplier.toFixed(2)}x
                </span>
                <span className="text-[9px] text-slate-500 block">
                  +{(Math.max(0, selectedJoint.sagMultiplier - 1) * 100).toFixed(0)}% Thermal Rise
                </span>
              </div>
            </div>

            {/* Subsystem Component Thermals */}
            <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between text-slate-400">
                <span>Inverter GaN/MOSFET Junction:</span>
                <span className="text-slate-200 font-semibold">{selectedJoint.mosfetTemp.toFixed(1)}°C</span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Harmonic Drive Gearbox Oil:</span>
                <span className="text-slate-200 font-semibold">{selectedJoint.gearboxTemp.toFixed(1)}°C</span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Thermal Throttling Headroom:</span>
                <span
                  className={`font-semibold ${
                    selectedJoint.thermalMargin <= 3
                      ? 'text-rose-400 font-bold'
                      : selectedJoint.thermalMargin <= 12
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {selectedJoint.thermalMargin.toFixed(1)}°C
                </span>
              </div>
            </div>
          </div>

          {/* Electrical Physics Correlation: Voltage Sag vs Joule Heating */}
          <div className="bg-[#0b1222] border border-slate-800/90 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-200">
                  Sag vs Thermal Dissipation Curve
                </h3>
              </div>
              <span className="text-[10px] font-mono text-cyan-400">LIVE COUPLING</span>
            </div>

            {/* Physics Mathematical Correlation Explainer */}
            <div className="text-xs text-slate-400 leading-relaxed">
              When terminal rail voltage sags under high joint torque demand, inverter field-oriented control compensates by advancing PWM duty cycle and phase current:
              <div className="my-2 p-2.5 rounded-lg bg-[#070c18] border border-slate-800 font-mono text-[11px] text-cyan-300">
                P_copper = 3 · [ (P_mech / (η · V_rail))² · R_winding ]
              </div>
              A 10% rail voltage sag produces an exponential{' '}
              <strong className="text-orange-300">+23% surge</strong> in motor winding thermal dissipation.
            </div>

            {/* Interactive SVG Correlation Chart */}
            <div className="h-44 w-full bg-[#050811] rounded-xl border border-slate-800/90 p-2 relative">
              <svg viewBox="0 0 320 140" className="w-full h-full">
                {/* Grid Lines */}
                <line x1="30" y1="20" x2="310" y2="20" stroke="#1e293b" strokeDasharray="2 2" />
                <line x1="30" y1="60" x2="310" y2="60" stroke="#1e293b" strokeDasharray="2 2" />
                <line x1="30" y1="100" x2="310" y2="100" stroke="#1e293b" strokeDasharray="2 2" />

                {/* X and Y axes */}
                <line x1="30" y1="10" x2="30" y2="115" stroke="#334155" />
                <line x1="30" y1="115" x2="310" y2="115" stroke="#334155" />

                {/* Axis Labels */}
                <text x="10" y="24" fill="#64748b" fontSize="8" fontFamily="monospace">60W</text>
                <text x="10" y="64" fill="#64748b" fontSize="8" fontFamily="monospace">35W</text>
                <text x="10" y="104" fill="#64748b" fontSize="8" fontFamily="monospace">15W</text>

                <text x="40" y="128" fill="#64748b" fontSize="8" fontFamily="monospace">36V</text>
                <text x="120" y="128" fill="#64748b" fontSize="8" fontFamily="monospace">40V</text>
                <text x="200" y="128" fill="#64748b" fontSize="8" fontFamily="monospace">44V</text>
                <text x="280" y="128" fill="#64748b" fontSize="8" fontFamily="monospace">48.2V</text>

                {/* Theoretical Curve: Thermal Loss (W) vs Terminal Voltage (V) */}
                {/* 36V -> x=40, y=25 (high loss) */}
                {/* 42V -> x=160, y=65 */}
                {/* 48.24V -> x=285, y=102 (low nominal loss) */}
                <path
                  d="M 40 24 Q 140 70, 285 102"
                  fill="none"
                  stroke="#f97316"
                  strokeWidth="2.5"
                />

                {/* Safe Operating Threshold Line */}
                <line x1="30" y1="50" x2="310" y2="50" stroke="#f43f5e" strokeDasharray="3 3" opacity="0.6" />
                <text x="220" y="46" fill="#f43f5e" fontSize="7" fontFamily="monospace">
                  COIL DERATE (42W)
                </text>

                {/* Current Operating Point Marker */}
                {(() => {
                  const railV = telemetry.voltage || 48.0;
                  // Map 36V -> 40px, 48.24V -> 285px
                  const cx = 40 + ((railV - 36.0) / (48.24 - 36.0)) * (285 - 40);
                  const clampedCx = Math.max(40, Math.min(285, cx));
                  // Calculate corresponding Y
                  const jouleW = selectedJoint.jouleLossWatts;
                  // Map 10W -> 110px, 60W -> 24px
                  const cy = 110 - ((jouleW - 10) / (60 - 10)) * (110 - 24);
                  const clampedCy = Math.max(20, Math.min(115, cy));

                  return (
                    <g>
                      <circle cx={clampedCx} cy={clampedCy} r="7" fill="#06b6d4" opacity="0.4" className="animate-ping" />
                      <circle cx={clampedCx} cy={clampedCy} r="4.5" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.5" />
                      <text
                        x={Math.min(250, clampedCx + 8)}
                        y={Math.max(30, clampedCy - 6)}
                        fill="#38bdf8"
                        fontSize="8"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        {selectedJoint.jouleLossWatts.toFixed(0)}W @ {railV.toFixed(1)}V
                      </text>
                    </g>
                  );
                })()}
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* 6. Interactive Thermal Stress Test Bench & Scenario Injections */}
      <div className="bg-[#0b1222] border border-slate-800/90 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-200">
              Thermal Stress & Scenario Test Bench
            </h3>
          </div>
          {/* Active scenario status badge (Zero-Pill text) */}
          <div className="text-xs font-mono text-slate-400 flex items-center gap-2">
            <span>ACTIVE LOAD INJECTION:</span>
            <span className="text-cyan-300 font-bold uppercase">
              {activeScenario === 'nominal' ? 'Nominal Equilibrium' : activeScenario}
            </span>
            {scenarioRemainingSec > 0 && (
              <span className="text-amber-400">({scenarioRemainingSec}s rem)</span>
            )}
          </div>
        </div>

        {/* Action Buttons Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Nominal Trot */}
          <button
            onClick={() => triggerScenario('nominal', 0)}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              activeScenario === 'nominal'
                ? 'bg-cyan-500/10 border-cyan-400 text-slate-100 ring-1 ring-cyan-400/40'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
            }`}
          >
            <div className="text-xs font-bold font-mono text-cyan-300">1. Nominal Trot</div>
            <div className="text-[10px] text-slate-400 mt-1 leading-snug">
              Balanced 4-limb duty (35-55% PWM). Bus at nominal 48.24V. Steady-state 38-44°C.
            </div>
          </button>

          {/* Incline Climb */}
          <button
            onClick={() => triggerScenario('climb', 18)}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              activeScenario === 'climb'
                ? 'bg-amber-500/10 border-amber-400 text-slate-100 ring-1 ring-amber-400/40'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
            }`}
          >
            <div className="text-xs font-bold font-mono text-amber-300">2. 35° Incline Climb</div>
            <div className="text-[10px] text-slate-400 mt-1 leading-snug">
              Hind leg torque bias. Rear knees hit 78% PWM; voltage sags 3.2V. Thermal rise +6°C/m.
            </div>
          </button>

          {/* Gallop Dynamic Sprint */}
          <button
            onClick={() => triggerScenario('sprint', 15)}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              activeScenario === 'sprint'
                ? 'bg-rose-500/10 border-rose-400 text-slate-100 ring-1 ring-rose-400/40'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
            }`}
          >
            <div className="text-xs font-bold font-mono text-rose-300">3. Sprint Gallop Surge</div>
            <div className="text-[10px] text-slate-400 mt-1 leading-snug">
              High-speed bound. All 4 knees at 84% PWM. 4.8V bus sag. Elevates thermals to ~72°C.
            </div>
          </button>

          {/* Stalled Joint Jam */}
          <button
            onClick={() => triggerScenario('stall_fl', 12)}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              activeScenario === 'stall_fl'
                ? 'bg-red-500/20 border-red-500 text-slate-100 ring-2 ring-red-500/50'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
            }`}
          >
            <div className="text-xs font-bold font-mono text-red-400">4. FL Knee Joint Stall</div>
            <div className="text-[10px] text-slate-400 mt-1 leading-snug">
              Severe stall obstacle. 95% PWM saturation, severe local heating to &gt;82°C (Derate trigger).
            </div>
          </button>

          {/* Forced Cooling Flush */}
          <button
            onClick={() => {
              setCoolingOverrideActive(true);
              triggerScenario('cooling', 20);
            }}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              activeScenario === 'cooling' || coolingOverrideActive
                ? 'bg-cyan-500/20 border-cyan-400 text-slate-100 ring-1 ring-cyan-400/40'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
            }`}
          >
            <div className="text-xs font-bold font-mono text-cyan-300">5. Cooling Flush</div>
            <div className="text-[10px] text-slate-400 mt-1 leading-snug">
              Radiator fan & pump 100% override. Accelerates heat extraction (-8.5°C/m) back to base.
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
