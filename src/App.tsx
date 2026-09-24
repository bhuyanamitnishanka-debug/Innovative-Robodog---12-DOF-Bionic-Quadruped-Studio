import React, { useState, useEffect, useRef } from 'react';
import { TelemetryState, DiagnosticEvent } from './types/robotics';
import { NavigationHeader } from './components/NavigationHeader';
import { RobodogCanvas } from './components/RobodogCanvas';
import { VirtualController } from './components/VirtualController';
import { GaitPowerEfficiencyChart } from './components/GaitPowerEfficiencyChart';
import { DiagnosticEventLogPanel } from './components/DiagnosticEventLogPanel';
import { BlueprintExplorer } from './components/BlueprintExplorer';
import { KinematicsLab } from './components/KinematicsLab';
import { ElectricalBmsView } from './components/ElectricalBmsView';
import { BatteryDischargeVoltageSagChart } from './components/BatteryDischargeVoltageSagChart';
import { PwmDistributionHistogram } from './components/PwmDistributionHistogram';
import { MotorThermalHeatmap2D } from './components/MotorThermalHeatmap2D';
import { CurrentDistributionFlow } from './components/CurrentDistributionFlow';
import { McuArchitectureView } from './components/McuArchitectureView';
import { GeminiVLAConsole } from './components/GeminiVLAConsole';
import { AnimatedSummaryTheater } from './components/AnimatedSummaryTheater';
import { CompanionInteractionStudio } from './components/CompanionInteractionStudio';
import { InteractionOpportunitiesGuide } from './components/InteractionOpportunitiesGuide';
import { audioSynth } from './utils/audioSynthesizer';
import { BatteryCharging, AlertOctagon, Terminal } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('simulator');
  const [electricalViewFilter, setElectricalViewFilter] = useState<'all' | 'flow' | 'heatmap' | 'pwm' | 'sag' | 'bms'>('all');

  const [telemetry, setTelemetry] = useState<TelemetryState>({
    voltage: 48.24,
    current: 4.85,
    power: 234.0,
    batteryPercent: 88,
    bmsTemp: 31.6,
    bmsCellVoltages: [4.02, 4.01, 4.03, 4.02, 4.01, 4.04, 4.02, 4.01, 4.03, 4.02, 4.01, 4.02],
    chargingState: 'disconnected',
    chargeTimeRemainingMin: 18,

    gait: 'trot',
    linearVelocity: 1.4,
    angularVelocity: 0.0,
    strideLength: 280,
    swingFrequency: 1.8,
    bodyPitch: 0,
    bodyRoll: 0,
    stanceHeight: 220,
    heading: 45,
    positionX: 0,
    positionY: 0,
    targetWaypoint: null,

    legs: {
      fl: { hipAbduction: 0, hipPitch: 22, kneePitch: 46, torque: 14.5, temperature: 38.2, hipRollTemp: 32.4, hipPitchTemp: 38.2, kneePitchTemp: 43.8 },
      fr: { hipAbduction: 0, hipPitch: 24, kneePitch: 48, torque: 13.8, temperature: 38.0, hipRollTemp: 31.8, hipPitchTemp: 37.6, kneePitchTemp: 42.5 },
      rl: { hipAbduction: 0, hipPitch: 20, kneePitch: 42, torque: 16.2, temperature: 38.6, hipRollTemp: 33.1, hipPitchTemp: 39.4, kneePitchTemp: 45.2 },
      rr: { hipAbduction: 0, hipPitch: 21, kneePitch: 44, torque: 15.9, temperature: 38.4, hipRollTemp: 32.7, hipPitchTemp: 38.9, kneePitchTemp: 44.6 },
    },
    avgMotorTemp: 38.3,
    totalTorqueOutput: 60.4,

    nearestObstacleDist: 2.4,
    nearestObstacleAngle: 15,
    lidarPoints: [],
    canBusRateHz: 1000,
    mcuCoreM7Load: 42,
    mcuCoreM4Load: 28,
    imuUpdateRateHz: 400,

    emergencyStop: false,
    controlMode: 'manual',
    viewMode: 'bionic',
    audioEnabled: false,
  });

  // Diagnostic Event Log Buffer
  const [events, setEvents] = useState<DiagnosticEvent[]>([
    {
      id: 'EV-1001',
      timestamp: 'T+00:00:01.042',
      relativeTimeMs: 1042,
      severity: 'info',
      subsystem: 'BMS-48V',
      code: 'PWR_RAIL_ACTIVE',
      message: '48V 15Ah Li-Ion power bus energized. 12 series cells balanced within ±8mV.',
      metric: 'Rail: 48.24V | Cells: 12S',
    },
    {
      id: 'EV-1002',
      timestamp: 'T+00:00:02.180',
      relativeTimeMs: 2180,
      severity: 'info',
      subsystem: 'CAN-FD',
      code: 'CAN_BUS_SYNC_OK',
      message: 'Dual CAN-FD buses synchronized at 1.0 Mbps nominal / 5.0 Mbps data phase. All 12 joint nodes online.',
      metric: 'Nodes: 12/12 | 1000Hz',
    },
    {
      id: 'EV-1003',
      timestamp: 'T+00:00:04.512',
      relativeTimeMs: 4512,
      severity: 'info',
      subsystem: 'IMU-400Hz',
      code: 'IMU_CALIBRATION_OK',
      message: '6-DOF IMU zero-rate calibration nominal. Gravity vector aligned to vertical datum.',
      metric: 'Bias: <0.02°/s',
    },
    {
      id: 'EV-1004',
      timestamp: 'T+00:01:14.205',
      relativeTimeMs: 74205,
      severity: 'warning',
      subsystem: 'CAN-FD',
      code: 'CAN_ERR_JITTER_EXCEEDED',
      message: 'Periodic frame latency jitter on Node 0x14 (FL Knee) measured at 2.48ms. Bit rate phase lock compensated.',
      metric: 'Latency: 2.48ms',
    },
    {
      id: 'EV-1005',
      timestamp: 'T+00:02:08.891',
      relativeTimeMs: 128891,
      severity: 'info',
      subsystem: 'THERMAL',
      code: 'THERMAL_PUMP_NOMINAL',
      message: 'Liquid cooling loop circulating at 1.4 L/min. Radiator exhaust temp 31.6°C.',
      metric: 'Flow: 1.4 L/min',
    },
  ]);

  const prevGait = useRef<string>(telemetry.gait);
  const prevEStop = useRef<boolean>(telemetry.emergencyStop);

  const getRelativeTimestamp = () => {
    const now = new Date();
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `T+00:${mm}:${ss}.${ms}`;
  };

  const handleInjectEvent = (
    eventData: Omit<DiagnosticEvent, 'id' | 'timestamp' | 'relativeTimeMs'>
  ) => {
    const newEvent: DiagnosticEvent = {
      id: `EV-${Date.now().toString().slice(-4)}`,
      timestamp: getRelativeTimestamp(),
      relativeTimeMs: Date.now(),
      ...eventData,
    };
    setEvents((prev) => [...prev, newEvent].slice(-200));
  };

  const handleClearEvents = () => {
    setEvents([]);
  };

  // Listen for custom diagnostic event dispatch
  useEffect(() => {
    const handleCustomLogEvent = (e: Event) => {
      const customEv = e as CustomEvent<Omit<DiagnosticEvent, 'id' | 'timestamp' | 'relativeTimeMs'>>;
      if (customEv.detail) {
        handleInjectEvent(customEv.detail);
      }
    };
    window.addEventListener('robodog:log-diagnostic-event', handleCustomLogEvent);
    return () => {
      window.removeEventListener('robodog:log-diagnostic-event', handleCustomLogEvent);
    };
  }, []);

  // Monitor Telemetry Changes & Auto-Log Events
  useEffect(() => {
    // Gait change detection
    if (prevGait.current !== telemetry.gait) {
      handleInjectEvent({
        severity: 'info',
        subsystem: 'ACTUATORS',
        code: `GAIT_SWITCH_${telemetry.gait.toUpperCase()}`,
        message: `Gait pattern transitioned to ${telemetry.gait.toUpperCase()}. Trajectory planner adjusted kinematics and duty cycle.`,
        metric: `Gait: ${telemetry.gait.toUpperCase()}`,
      });
      prevGait.current = telemetry.gait;
    }

    // Emergency Stop detection
    if (prevEStop.current !== telemetry.emergencyStop) {
      if (telemetry.emergencyStop) {
        handleInjectEvent({
          severity: 'critical',
          subsystem: 'ACTUATORS',
          code: 'ESTOP_HARDWARE_HALT',
          message: 'EMERGENCY STOP ENGAGED: Hardware inverter gate drivers de-energized. Active dynamic braking locked all 12 joints.',
          metric: 'PWM: 0% | Speed: 0.0 m/s',
        });
        if (telemetry.audioEnabled) audioSynth.playAlert(true);
      } else {
        handleInjectEvent({
          severity: 'info',
          subsystem: 'ACTUATORS',
          code: 'ESTOP_CLEARED_ARMED',
          message: 'EMERGENCY STOP CLEARED: Inverter gate drivers re-armed. Brushless field-oriented control active.',
          metric: 'Status: ARMED',
        });
      }
      prevEStop.current = telemetry.emergencyStop;
    }
  }, [telemetry.gait, telemetry.emergencyStop, telemetry.audioEnabled]);

  const updateTelemetry = (partial: Partial<TelemetryState>) => {
    setTelemetry((prev) => ({ ...prev, ...partial }));
  };

  const toggleEmergencyStop = () => {
    setTelemetry((prev) => {
      const nextStop = !prev.emergencyStop;
      return {
        ...prev,
        emergencyStop: nextStop,
        linearVelocity: nextStop ? 0 : 1.2,
        angularVelocity: 0,
        gait: nextStop ? 'stand' : prev.gait,
      };
    });
  };

  const criticalCount = events.filter((e) => e.severity === 'critical').length;
  const warningCount = events.filter((e) => e.severity === 'warning').length;

  return (
    <div className="min-h-screen bg-[#050811] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Universal Top Navigation Header */}
      <NavigationHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        audioEnabled={telemetry.audioEnabled}
        setAudioEnabled={(enabled) => updateTelemetry({ audioEnabled: enabled })}
        emergencyStop={telemetry.emergencyStop}
        toggleEmergencyStop={toggleEmergencyStop}
      />

      {/* Persistent Telemetry Ribbon with Real-Time Diagnostics Sentinel */}
      <div className="bg-[#070c18] border-b border-slate-800/60 px-4 sm:px-6 py-2 select-none">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs font-mono text-slate-400">
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${telemetry.emergencyStop ? 'bg-rose-500 animate-pulse' : 'bg-emerald-400'}`} />
              <span className="text-slate-200 font-bold">
                {telemetry.emergencyStop ? 'E-STOP HALT' : 'SYSTEM NOMINAL'}
              </span>
            </span>
            <span aria-hidden="true" className="text-slate-700">|</span>
            <span>MET: T+02:44:18</span>
            <span aria-hidden="true" className="text-slate-700">|</span>
            <span className="hidden sm:inline">PLATFORM: CERBERUS-04 ALPHA</span>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            {/* Live Diagnostics Counter Button */}
            <button
              onClick={() => setActiveTab(activeTab === 'diagnostics' ? 'simulator' : 'diagnostics')}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-700/80 hover:border-cyan-500 text-[11px] font-mono cursor-pointer transition-colors"
              title="Toggle Diagnostic Event Log"
            >
              <Terminal className="w-3 h-3 text-cyan-400" />
              <span className="text-slate-300">LOG:</span>
              {criticalCount > 0 ? (
                <span className="text-rose-400 font-bold">{criticalCount} CRIT</span>
              ) : warningCount > 0 ? (
                <span className="text-amber-400 font-bold">{warningCount} WARN</span>
              ) : (
                <span className="text-emerald-400">{events.length} EV</span>
              )}
            </button>

            <span aria-hidden="true" className="text-slate-700">|</span>

            <span className="flex items-center gap-1">
              <BatteryCharging className="w-3.5 h-3.5 text-cyan-400" />
              <span>48V BMS: {telemetry.batteryPercent}%</span>
            </span>
            <span aria-hidden="true" className="text-slate-700">|</span>
            <span className="text-slate-300">
              GAIT: <strong className="text-cyan-300">{telemetry.gait.toUpperCase()}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-700">|</span>
            <span className="hidden sm:inline">CAN-FD: 1.0 kHz</span>
          </div>
        </div>
      </div>

      {/* Main Workspace Stage */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {activeTab === 'simulator' && (
          <div className="space-y-6">
            <RobodogCanvas telemetry={telemetry} updateTelemetry={updateTelemetry} />
            <VirtualController
              telemetry={telemetry}
              updateTelemetry={updateTelemetry}
              onLogDiagnosticEvent={handleInjectEvent}
            />
            <GaitPowerEfficiencyChart telemetry={telemetry} updateTelemetry={updateTelemetry} />
            <DiagnosticEventLogPanel
              events={events}
              onClearEvents={handleClearEvents}
              onInjectEvent={handleInjectEvent}
              audioEnabled={telemetry.audioEnabled}
            />
          </div>
        )}

        {activeTab === 'diagnostics' && (
          <div className="space-y-6">
            <DiagnosticEventLogPanel
              events={events}
              onClearEvents={handleClearEvents}
              onInjectEvent={handleInjectEvent}
              audioEnabled={telemetry.audioEnabled}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <KinematicsLab telemetry={telemetry} updateTelemetry={updateTelemetry} />
              <ElectricalBmsView telemetry={telemetry} updateTelemetry={updateTelemetry} />
            </div>
          </div>
        )}

        {activeTab === 'theater' && (
          <AnimatedSummaryTheater audioEnabled={telemetry.audioEnabled} />
        )}

        {activeTab === 'companion' && (
          <CompanionInteractionStudio audioEnabled={telemetry.audioEnabled} />
        )}

        {activeTab === 'guide' && (
          <InteractionOpportunitiesGuide onNavigateTab={setActiveTab} />
        )}

        {activeTab === 'blueprints' && <BlueprintExplorer />}

        {activeTab === 'kinematics' && (
          <KinematicsLab telemetry={telemetry} updateTelemetry={updateTelemetry} />
        )}

        {activeTab === 'electrical' && (
          <div className="space-y-6">
            {/* Electrical Sub-module Navigation Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#080d1a] border border-slate-800/90 rounded-xl px-4 py-3 shadow-lg">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-xs font-mono text-slate-300 font-bold uppercase tracking-wider">
                  Electrical Subsystems View:
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
                {[
                  { id: 'all', label: 'All Modules' },
                  { id: 'flow', label: 'Current Flow (Sankey)' },
                  { id: 'heatmap', label: '12-Joint Thermal Heatmap' },
                  { id: 'pwm', label: 'PWM Histogram' },
                  { id: 'sag', label: 'Voltage Sag Analyzer' },
                  { id: 'bms', label: '48V BMS & Docking' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setElectricalViewFilter(tab.id as any)}
                    className={`px-3 py-1 rounded cursor-pointer transition-all ${
                      electricalViewFilter === tab.id
                        ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Current Distribution Flow (Sankey Diagram) */}
            {(electricalViewFilter === 'all' || electricalViewFilter === 'flow') && (
              <CurrentDistributionFlow
                telemetry={telemetry}
                updateTelemetry={updateTelemetry}
                onLogDiagnosticEvent={handleInjectEvent}
              />
            )}

            {/* 2D 12-Joint Motor Thermal Heatmap */}
            {(electricalViewFilter === 'all' || electricalViewFilter === 'heatmap') && (
              <MotorThermalHeatmap2D
                telemetry={telemetry}
                updateTelemetry={updateTelemetry}
                onLogDiagnosticEvent={handleInjectEvent}
              />
            )}

            {/* PWM Distribution Histogram */}
            {(electricalViewFilter === 'all' || electricalViewFilter === 'pwm') && (
              <PwmDistributionHistogram
                telemetry={telemetry}
                updateTelemetry={updateTelemetry}
                onLogDiagnosticEvent={handleInjectEvent}
              />
            )}

            {/* Battery Discharge & Voltage Sag Chart */}
            {(electricalViewFilter === 'all' || electricalViewFilter === 'sag') && (
              <BatteryDischargeVoltageSagChart
                telemetry={telemetry}
                updateTelemetry={updateTelemetry}
                onLogDiagnosticEvent={handleInjectEvent}
              />
            )}

            {/* 48V BMS & High-Current Docking Interface */}
            {(electricalViewFilter === 'all' || electricalViewFilter === 'bms') && (
              <ElectricalBmsView telemetry={telemetry} updateTelemetry={updateTelemetry} />
            )}
          </div>
        )}

        {activeTab === 'mcu' && <McuArchitectureView />}

        {activeTab === 'vla' && (
          <div className="space-y-6">
            <RobodogCanvas telemetry={telemetry} updateTelemetry={updateTelemetry} />
            <GeminiVLAConsole telemetry={telemetry} updateTelemetry={updateTelemetry} />
          </div>
        )}
      </main>

      {/* Human Editorial Footer */}
      <footer className="border-t border-slate-800/80 bg-[#060912] py-6 px-6 mt-12 text-xs text-slate-500 font-mono">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="text-slate-400 font-semibold">CERBERUS-04 Bionic Quadruped Platform</span>
            <span className="mx-2">·</span>
            <span>Project Presentation by Amit Nishanka Bhuyan (23/7/2026)</span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span>12-DOF High-Torque Brushless Actuators</span>
            <span>·</span>
            <span>Dual-Depth LiDAR SLAM</span>
            <span>·</span>
            <span>Gemini VLA Autonomous Edge</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
