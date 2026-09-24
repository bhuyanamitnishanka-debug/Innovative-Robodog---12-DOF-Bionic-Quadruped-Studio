import React, { useState } from 'react';
import { Cpu, Battery, Eye, Shield, Radio, Wrench, Layers, Info } from 'lucide-react';

export const BlueprintExplorer: React.FC = () => {
  const [activeHotspot, setActiveHotspot] = useState<string>('actuators');
  const [activeLayer, setActiveLayer] = useState<'all' | 'mechanical' | 'electrical' | 'sensors'>('all');

  const hotspots = [
    {
      id: 'actuators',
      title: '12-DOF Brushless Actuator Modules',
      category: 'Kinematics',
      summary: 'High-torque planetary gearboxes with integrated strain-gauge torque sensors.',
      details:
        '12 independent coreless motor planetary gearboxes matched with localized micro-stepping controllers. Dual CAN-FD bus provides sub-millisecond 1kHz feedback loops for adaptive ground impedance matching.',
      specs: [
        { label: 'Total Actuators', value: '12 Units (3/leg)' },
        { label: 'Peak Joint Torque', value: '38.5 N·m' },
        { label: 'Bus Feedback Loop', value: '1.0 kHz' },
        { label: 'Gearbox Ratio', value: '1:9 Planetary' },
      ],
      x: 340,
      y: 270,
    },
    {
      id: 'chassis',
      title: 'Aviation-Grade Carbon Fiber Skeleton',
      category: 'Mechanical',
      summary: 'High-modulus carbon composite chassis combined with CNC 7075 aluminum nodes.',
      details:
        'Engineered for maximum torsional stiffness during high-speed gallop and vertical bounds. Sealed internal conduits shield high-frequency wiring from joint shear wear.',
      specs: [
        { label: 'Chassis Material', value: 'T700 Carbon Fiber' },
        { label: 'Node Hardware', value: '7075-T6 Aluminum' },
        { label: 'Ingress Protection', value: 'IP67 Waterproof' },
        { label: 'Max Payload Capacity', value: '12.5 kg' },
      ],
      x: 480,
      y: 220,
    },
    {
      id: 'battery',
      title: '48V 15Ah Smart Li-Ion Power Core',
      category: 'Electrical',
      summary: 'High-capacity liquid-cooled battery pack with dual-redundant CAN bus BMS.',
      details:
        'Integrated liquid cooling chambers maintain optimal thermal performance during continuous 3.8 m/s traversal. Supports regenerative braking on downhill descent and 80A fast charge.',
      specs: [
        { label: 'Pack Voltage', value: '48.0 V Nominal' },
        { label: 'Capacity', value: '15.0 Ah (720 Wh)' },
        { label: 'Continuous Runtime', value: '4.5 Hours' },
        { label: 'Fast Charge Rate', value: '0-80% in 18 min' },
      ],
      x: 460,
      y: 280,
    },
    {
      id: 'mcu',
      title: 'RD-CPU BARK-CORE v3.1 Microcontroller',
      category: 'Firmware & Compute',
      summary: 'Dual-core STM32H7 processor with hardware-accelerated SPI/I2C sensor hub.',
      details:
        'ARM Cortex-M7 running at 480MHz handles real-time 400Hz gait kinematics and motor control, while Cortex-M4 at 240MHz handles telemetry streaming and sensor fusion.',
      specs: [
        { label: 'Primary Core', value: 'ARM Cortex-M7 @ 480MHz' },
        { label: 'Co-Processor', value: 'ARM Cortex-M4 @ 240MHz' },
        { label: 'Actuator Networks', value: 'Dual CAN-FD + RS-485' },
        { label: 'Storage', value: '2TB NVMe SSD' },
      ],
      x: 520,
      y: 245,
    },
    {
      id: 'sensors',
      title: 'Perception Array & Dual-Depth LiDAR',
      category: 'Autonomous Perception',
      summary: 'Stereo depth cameras, 360° LiDAR, and ultrasonic proximity nodes.',
      details:
        'Provides millimeter-accurate point clouds for real-time SLAM navigation. Inputs directly to Gemini VLA onboard model for dynamic terrain obstacle avoidance.',
      specs: [
        { label: 'LiDAR Range', value: '25.0 m @ 360°' },
        { label: 'Vision Cameras', value: 'Dual Active Stereo' },
        { label: 'Proximity Nodes', value: '4x Ultrasonic' },
        { label: 'SLAM Latency', value: '< 2.5 ms' },
      ],
      x: 640,
      y: 190,
    },
    {
      id: 'docking',
      title: 'Magnetic Docking & Fast-Charge Interface',
      category: 'Infrastructure',
      summary: 'Self-mating electromagnetic guidance collar with optical homing lasers.',
      details:
        'Underbelly docking port automatically mates with charging station. Heavy-duty solid copper contact pins support up to 80A continuous current without arcing.',
      specs: [
        { label: 'Contact Terminals', value: 'Solid Copper 80A' },
        { label: 'Guidance Alignment', value: 'Dual Pulsed IR Lasers' },
        { label: 'Docking Precision', value: '±1.5 mm' },
        { label: 'Lockout Mechanism', value: 'Electromagnetic Collar' },
      ],
      x: 430,
      y: 330,
    },
  ];

  const currentHotspot = hotspots.find((h) => h.id === activeHotspot) || hotspots[0];

  return (
    <div className="space-y-6">
      {/* Editorial Overview Section */}
      <div className="bg-[#080d1a] border border-slate-800/90 rounded-xl p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-800/80">
          <div>
            <div className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-1">
              Project Presentation & Engineering Blueprint
            </div>
            <h2 className="font-['Chakra_Petch'] text-2xl font-bold text-slate-100 tracking-tight">
              INNOVATIVE ROBODOG: FROM DESIGN TO REALITY
            </h2>
            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-2">
              <span>Creator: Amit Nishanka Bhuyan</span>
              <span aria-hidden="true">·</span>
              <span>Platform: CERBERUS-04 ALPHA</span>
              <span aria-hidden="true">·</span>
              <span>12-DOF Bionic Quadruped</span>
              <span aria-hidden="true">·</span>
              <span>Published July 2026</span>
            </div>
          </div>

          {/* Layer Filter Controls */}
          <div className="flex items-center gap-1 p-1 bg-slate-900/90 rounded-lg border border-slate-800">
            {(['all', 'mechanical', 'electrical', 'sensors'] as const).map((layer) => (
              <button
                key={layer}
                onClick={() => setActiveLayer(layer)}
                className={`px-3 py-1.5 text-xs font-mono rounded cursor-pointer transition-colors ${
                  activeLayer === layer
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {layer.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive CAD Schematic Viewport */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Blueprint SVG Canvas */}
          <div className="lg:col-span-8 bg-[#050812] rounded-lg border border-slate-800/80 relative overflow-hidden bg-blueprint-grid p-4 min-h-[460px] flex items-center justify-center">
            {/* Blueprint Coordinate Axes & Watermark */}
            <div className="absolute top-3 left-3 text-[10px] font-mono text-cyan-400/50">
              SYS-SCHEMATIC: RD-ALPHA-2026 // REV 4.2
            </div>
            <div className="absolute bottom-3 right-3 text-[10px] font-mono text-slate-600">
              SCALE: 1:4 METRIC · CANONICAL CAD
            </div>

            {/* Technical Vector Robodog Blueprint */}
            <svg
              viewBox="0 0 840 500"
              className="w-full h-auto max-h-[440px] select-none"
              style={{ filter: 'drop-shadow(0 0 10px rgba(6, 182, 212, 0.15))' }}
            >
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(6,182,212,0.06)" strokeWidth="1" />
                </pattern>
                <linearGradient id="cyanGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.4" />
                </linearGradient>
              </defs>

              {/* Grid backdrop */}
              <rect width="840" height="500" fill="url(#grid)" />

              {/* Ground reference line */}
              <line x1="60" y1="410" x2="780" y2="410" stroke="#1e293b" strokeWidth="2" strokeDasharray="4,4" />
              <text x="70" y="426" fill="#64748b" fontSize="10" fontFamily="JetBrains Mono">
                DATUM ZERO / GROUND CONTACT
              </text>

              {/* Skeleton Spine Line */}
              <path
                d="M 280 230 Q 480 200 660 210"
                fill="none"
                stroke="#06b6d4"
                strokeWidth="1.5"
                strokeDasharray="6,3"
              />

              {/* Central Chassis Body Outline */}
              <path
                d="M 260 250 L 320 220 L 590 200 L 670 210 L 640 290 L 320 310 Z"
                fill="rgba(8, 13, 26, 0.85)"
                stroke="#38bdf8"
                strokeWidth="2"
              />

              {/* Battery Compartment Core */}
              <rect
                x="350"
                y="245"
                width="220"
                height="50"
                fill="rgba(2, 132, 199, 0.15)"
                stroke="#0284c7"
                strokeWidth="1.5"
              />
              <text x="365" y="275" fill="#38bdf8" fontSize="11" fontFamily="JetBrains Mono" fontWeight="bold">
                48V 15Ah LI-ION CORE
              </text>

              {/* STM32 Dual Core MCU Board */}
              <rect
                x="580"
                y="235"
                width="50"
                height="45"
                fill="rgba(16, 185, 129, 0.15)"
                stroke="#10b981"
                strokeWidth="1.5"
              />
              <text x="588" y="260" fill="#34d399" fontSize="9" fontFamily="JetBrains Mono">
                BARK MCU
              </text>

              {/* Head & Vision Sensor Turret */}
              <path
                d="M 660 210 L 730 190 L 760 220 L 730 250 L 660 240 Z"
                fill="rgba(15, 23, 42, 0.9)"
                stroke="#38bdf8"
                strokeWidth="2"
              />
              {/* Stereo Visor */}
              <path d="M 725 205 L 755 215 L 745 230 L 720 220 Z" fill="#06b6d4" />
              {/* LiDAR Turret on top */}
              <rect x="690" y="172" width="28" height="18" rx="4" fill="#0369a1" stroke="#38bdf8" strokeWidth="1.5" />
              <path d="M 704 172 L 704 152 M 692 160 L 716 160" stroke="#06b6d4" strokeWidth="1.5" />

              {/* Rear Leg (Left) */}
              <g stroke="#38bdf8" strokeWidth="2.5" fill="none">
                <circle cx="290" cy="270" r="14" fill="#0f172a" stroke="#06b6d4" strokeWidth="2" />
                <line x1="290" y1="270" x2="240" y2="340" />
                <circle cx="240" cy="340" r="10" fill="#0f172a" stroke="#06b6d4" strokeWidth="2" />
                <line x1="240" y1="340" x2="270" y2="410" />
                <circle cx="270" cy="410" r="6" fill="#38bdf8" />
              </g>

              {/* Front Leg (Left) */}
              <g stroke="#38bdf8" strokeWidth="2.5" fill="none">
                <circle cx="630" cy="250" r="14" fill="#0f172a" stroke="#06b6d4" strokeWidth="2" />
                <line x1="630" y1="250" x2="680" y2="330" />
                <circle cx="680" cy="330" r="10" fill="#0f172a" stroke="#06b6d4" strokeWidth="2" />
                <line x1="680" y1="330" x2="650" y2="410" />
                <circle cx="650" cy="410" r="6" fill="#38bdf8" />
              </g>

              {/* Docking Interface Underbelly */}
              <rect
                x="440"
                y="310"
                width="60"
                height="14"
                fill="#f59e0b"
                stroke="#d97706"
                strokeWidth="1.5"
                rx="2"
              />
              <text x="444" y="321" fill="#0f172a" fontSize="8" fontFamily="JetBrains Mono" fontWeight="bold">
                80A DOCK
              </text>

              {/* Interactive Hotspot Targets */}
              {hotspots.map((h) => {
                const isSelected = activeHotspot === h.id;
                return (
                  <g
                    key={h.id}
                    onClick={() => setActiveHotspot(h.id)}
                    className="cursor-pointer transition-transform hover:scale-110"
                  >
                    <circle
                      cx={h.x}
                      cy={h.y}
                      r={isSelected ? 18 : 14}
                      fill={isSelected ? 'rgba(6, 182, 212, 0.4)' : 'rgba(15, 23, 42, 0.8)'}
                      stroke={isSelected ? '#22d3ee' : '#0284c7'}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                    />
                    <circle cx={h.x} cy={h.y} r="4" fill={isSelected ? '#22d3ee' : '#38bdf8'} />
                    {isSelected && (
                      <circle
                        cx={h.x}
                        cy={h.y}
                        r="24"
                        fill="none"
                        stroke="#22d3ee"
                        strokeWidth="1"
                        strokeDasharray="3,3"
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Right: Selected Subsystem Diagnostic Card */}
          <div className="lg:col-span-4 bg-[#050811] rounded-lg border border-slate-800/80 p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono text-cyan-400 mb-1">
                <span>{currentHotspot.category}</span>
                <span aria-hidden="true">·</span>
                <span>Subsystem Diagnostic</span>
              </div>
              <h3 className="font-['Chakra_Petch'] text-lg font-bold text-slate-100">
                {currentHotspot.title}
              </h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                {currentHotspot.details}
              </p>

              {/* Subsystem Specifications Matrix */}
              <div className="mt-5 space-y-2.5 pt-4 border-t border-slate-800/80">
                {currentHotspot.specs.map((s, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400">{s.label}</span>
                    <span className="text-cyan-300 font-semibold tabular-nums">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Switch Buttons for other hotspots */}
            <div className="pt-4 border-t border-slate-800/80 mt-4">
              <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider block mb-2">
                Inspect Platform Modules:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {hotspots.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => setActiveHotspot(h.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono cursor-pointer transition-colors ${
                      activeHotspot === h.id
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {h.id.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* CERBERUS-04 System Specifications Grid (From Video Slide) */}
        <div className="mt-8 pt-6 border-t border-slate-800/80">
          <h3 className="font-['Chakra_Petch'] text-base font-bold text-slate-100 uppercase tracking-wider mb-4">
            System Specifications & Performance Boundaries
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Max Payload', value: '12.5 kg', desc: 'Heavy payload capability' },
              { label: 'Max Speed', value: '3.8 m/s', desc: '13.7 km/h high sprint' },
              { label: 'Runtime', value: '4.5 Hours', desc: '48V 15Ah Li-ion pack' },
              { label: 'Operating Temp', value: '-10°C to +50°C', desc: 'All-weather thermal loop' },
              { label: 'Ingress Rating', value: 'IP67 Waterproof', desc: 'Submersion resistant' },
              { label: 'Onboard Storage', value: '2TB NVMe SSD', desc: 'High-speed SLAM cache' },
            ].map((spec, i) => (
              <div
                key={i}
                className="p-3.5 bg-[#050811] rounded-lg border border-slate-800/80 flex flex-col justify-between"
              >
                <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                  {spec.label}
                </div>
                <div className="font-['Chakra_Petch'] text-xl font-bold text-cyan-400 my-1 tabular-nums">
                  {spec.value}
                </div>
                <div className="text-[10px] text-slate-500">{spec.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
