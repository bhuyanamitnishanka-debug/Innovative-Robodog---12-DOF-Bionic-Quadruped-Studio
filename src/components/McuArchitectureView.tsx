import React from 'react';
import { Cpu, Network, Zap, Binary, HardDrive, Shield } from 'lucide-react';

export const McuArchitectureView: React.FC = () => {
  return (
    <div className="bg-[#080d1a] border border-slate-800/90 rounded-xl p-6 shadow-xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="text-xs font-mono text-cyan-400 uppercase tracking-wider mb-1">
            Central Processing Unit & Embedded Firmware
          </div>
          <h2 className="font-['Chakra_Petch'] text-2xl font-bold text-slate-100">
            RD-CPU: BARK-CORE v3.1 MICROCONTROLLER
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-1">
            <span>STM32H7 Dual-Core Architecture</span>
            <span aria-hidden="true">·</span>
            <span>ARM Cortex-M7 @ 480MHz</span>
            <span aria-hidden="true">·</span>
            <span>ARM Cortex-M4 @ 240MHz</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <div className="px-3 py-1.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
            FLASH: 2MB DUAL-BANK
          </div>
          <div className="px-3 py-1.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
            SRAM: 1MB AXI-SRAM
          </div>
        </div>
      </div>

      {/* 3 Core Architecture Pillars (From Video Slide) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-[#050811] rounded-lg border border-slate-800/80 p-5 flex flex-col justify-between space-y-3">
          <div className="w-9 h-9 rounded bg-cyan-950/60 border border-cyan-800/60 flex items-center justify-center text-cyan-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-['Chakra_Petch'] text-base font-bold text-slate-100 mb-1">
              STM32H7 Dual-Core MCU
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              High-performance ARM Cortex-M7 core running at 480MHz paired with a Cortex-M4 core at 240MHz for real-time motor control and sensor fusion.
            </p>
          </div>
          <div className="pt-3 border-t border-slate-800/60 text-[11px] font-mono text-cyan-300">
            Loop Frequency: 400Hz · Latency &lt; 250μs
          </div>
        </div>

        <div className="bg-[#050811] rounded-lg border border-slate-800/80 p-5 flex flex-col justify-between space-y-3">
          <div className="w-9 h-9 rounded bg-amber-950/60 border border-amber-800/60 flex items-center justify-center text-amber-400">
            <Network className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-['Chakra_Petch'] text-base font-bold text-slate-100 mb-1">
              Dedicated Actuator Bus
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Dual CAN-FD and RS-485 transceiver networks enabling high-frequency feedback loops with 12 independent joint servo motors at 1kHz.
            </p>
          </div>
          <div className="pt-3 border-t border-slate-800/60 text-[11px] font-mono text-amber-300">
            Dual CAN-FD 5.0 Mbps · ISO 11898-1
          </div>
        </div>

        <div className="bg-[#050811] rounded-lg border border-slate-800/80 p-5 flex flex-col justify-between space-y-3">
          <div className="w-9 h-9 rounded bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-['Chakra_Petch'] text-base font-bold text-slate-100 mb-1">
              Sensor Hub Interface
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Hardware-accelerated SPI and I2C buses connecting directly to onboard IMU, LiDAR array, and depth cameras for sub-millisecond data ingestion.
            </p>
          </div>
          <div className="pt-3 border-t border-slate-800/60 text-[11px] font-mono text-emerald-300">
            DMA Channels: 16 · FIFO Depth: 512B
          </div>
        </div>
      </div>

      {/* Visual Block Diagram of RD-CPU BARK-CORE v3.1 */}
      <div className="bg-[#050811] rounded-lg border border-slate-800/80 p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-['Chakra_Petch'] text-sm font-bold text-slate-200 uppercase tracking-wider">
            RD-CPU BARK-CORE v3.1 PCB Interconnect Architecture
          </h4>
          <span className="text-xs font-mono text-slate-500">Board Revision: 3.1.4</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Block 1: Power Management */}
          <div className="p-4 rounded bg-slate-950 border border-slate-800 flex flex-col justify-between space-y-2">
            <span className="text-[10px] font-mono text-cyan-400 uppercase">Power Subsystem</span>
            <div className="font-['Chakra_Petch'] text-xs font-bold text-slate-200">
              Isolated DC-DC Buck
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              48V In → 12V High-Torque Bus<br />
              → 5V Logic Bus<br />
              → 3.3V Low-Noise Analog
            </div>
          </div>

          {/* Block 2: Cortex-M7 Core */}
          <div className="p-4 rounded bg-cyan-950/40 border border-cyan-800/60 flex flex-col justify-between space-y-2">
            <span className="text-[10px] font-mono text-cyan-300 uppercase">Primary Core M7</span>
            <div className="font-['Chakra_Petch'] text-xs font-bold text-cyan-100">
              ARM Cortex-M7 @ 480MHz
            </div>
            <div className="text-[11px] font-mono text-slate-300">
              Inverse Kinematics Solver<br />
              400Hz Gait Generation<br />
              Closed-Loop Torque Reg.
            </div>
          </div>

          {/* Block 3: Cortex-M4 Core */}
          <div className="p-4 rounded bg-emerald-950/40 border border-emerald-800/60 flex flex-col justify-between space-y-2">
            <span className="text-[10px] font-mono text-emerald-300 uppercase">Co-Processor M4</span>
            <div className="font-['Chakra_Petch'] text-xs font-bold text-emerald-100">
              ARM Cortex-M4 @ 240MHz
            </div>
            <div className="text-[11px] font-mono text-slate-300">
              LiDAR Point-Cloud Parsing<br />
              Sub-GHz RF Telemetry Link<br />
              Dual-Channel CAN-FD Bus
            </div>
          </div>

          {/* Block 4: Storage & Accelerator */}
          <div className="p-4 rounded bg-slate-950 border border-slate-800 flex flex-col justify-between space-y-2">
            <span className="text-[10px] font-mono text-amber-400 uppercase">Edge Accelerator</span>
            <div className="font-['Chakra_Petch'] text-xs font-bold text-slate-200">
              TensorRT INT8 NPU
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              Gemini VLA Model Inference<br />
              2TB NVMe SLAM Cache<br />
              PCIe Gen3 x2 Link
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
