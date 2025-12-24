/**
 * WebGPU type declarations
 * These provide type definitions for the WebGPU API
 */

interface Navigator {
  gpu?: GPU;
}

interface GPU {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
}

interface GPURequestAdapterOptions {
  powerPreference?: 'low-power' | 'high-performance';
}

interface GPUAdapter {
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
  features: ReadonlySet<string>;
  limits: Record<string, number>;
}

interface GPUDeviceDescriptor {
  requiredFeatures?: string[];
  requiredLimits?: Record<string, number>;
}

interface GPUDevice {
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
  createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline;
  createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
  createCommandEncoder(): GPUCommandEncoder;
  queue: GPUQueue;
}

interface GPUBufferDescriptor {
  size: number;
  usage: GPUBufferUsageFlags;
  mappedAtCreation?: boolean;
}

type GPUBufferUsageFlags = number;

declare const GPUBufferUsage: {
  MAP_READ: GPUBufferUsageFlags;
  MAP_WRITE: GPUBufferUsageFlags;
  COPY_SRC: GPUBufferUsageFlags;
  COPY_DST: GPUBufferUsageFlags;
  INDEX: GPUBufferUsageFlags;
  VERTEX: GPUBufferUsageFlags;
  UNIFORM: GPUBufferUsageFlags;
  STORAGE: GPUBufferUsageFlags;
  INDIRECT: GPUBufferUsageFlags;
  QUERY_RESOLVE: GPUBufferUsageFlags;
};

declare const GPUMapMode: {
  READ: number;
  WRITE: number;
};

interface GPUBuffer {
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
  destroy(): void;
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
}

interface GPUShaderModuleDescriptor {
  code: string;
}

interface GPUShaderModule {}

interface GPUComputePipelineDescriptor {
  layout: 'auto' | GPUPipelineLayout;
  compute: {
    module: GPUShaderModule;
    entryPoint: string;
  };
}

interface GPUPipelineLayout {}

interface GPUComputePipeline {
  getBindGroupLayout(index: number): GPUBindGroupLayout;
}

interface GPUBindGroupLayout {}

interface GPUBindGroupDescriptor {
  layout: GPUBindGroupLayout;
  entries: GPUBindGroupEntry[];
}

interface GPUBindGroupEntry {
  binding: number;
  resource: GPUBufferBinding | GPUSampler | GPUTextureView;
}

interface GPUBufferBinding {
  buffer: GPUBuffer;
  offset?: number;
  size?: number;
}

interface GPUSampler {}
interface GPUTextureView {}

interface GPUBindGroup {}

interface GPUCommandEncoder {
  beginComputePass(): GPUComputePassEncoder;
  copyBufferToBuffer(
    source: GPUBuffer,
    sourceOffset: number,
    destination: GPUBuffer,
    destinationOffset: number,
    size: number
  ): void;
  finish(): GPUCommandBuffer;
}

interface GPUComputePassEncoder {
  setPipeline(pipeline: GPUComputePipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

interface GPUCommandBuffer {}

interface GPUQueue {
  submit(commandBuffers: GPUCommandBuffer[]): void;
}
