/**
 * WebGPU utilities for accelerated image processing
 * Provides feature detection and shader execution helpers
 */

export interface WebGPUContext {
  device: GPUDevice;
  adapter: GPUAdapter;
  isSupported: boolean;
}

let cachedContext: WebGPUContext | null = null;

/**
 * Check if WebGPU is available and initialize the context
 */
export async function initWebGPU(): Promise<WebGPUContext | null> {
  if (cachedContext) {
    return cachedContext;
  }

  if (!navigator.gpu) {
    console.warn('WebGPU is not supported in this browser');
    return null;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.warn('Failed to get WebGPU adapter');
      return null;
    }

    const device = await adapter.requestDevice();
    
    cachedContext = {
      device,
      adapter,
      isSupported: true
    };

    return cachedContext;
  } catch (error) {
    console.error('Failed to initialize WebGPU:', error);
    return null;
  }
}

/**
 * Create a GPU buffer from data
 */
export function createBuffer(
  device: GPUDevice,
  data: Float32Array | Uint32Array | Int16Array,
  usage: GPUBufferUsageFlags
): GPUBuffer {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage,
    mappedAtCreation: true
  });

  const constructor = data.constructor as any;
  new constructor(buffer.getMappedRange()).set(data);
  buffer.unmap();

  return buffer;
}

/**
 * Read data back from GPU buffer
 */
export async function readBuffer(
  device: GPUDevice,
  buffer: GPUBuffer,
  size: number
): Promise<ArrayBuffer> {
  const stagingBuffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
  });

  const commandEncoder = device.createCommandEncoder();
  commandEncoder.copyBufferToBuffer(buffer, 0, stagingBuffer, 0, size);
  device.queue.submit([commandEncoder.finish()]);

  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const arrayBuffer = stagingBuffer.getMappedRange().slice(0);
  stagingBuffer.unmap();
  stagingBuffer.destroy();

  return arrayBuffer;
}
