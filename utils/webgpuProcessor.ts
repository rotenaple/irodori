/**
 * WebGPU-accelerated image processor
 * Handles palette matching, edge protection, and reconstruction using GPU compute shaders
 */

import { PaletteColor } from '../types';
import { initWebGPU, createBuffer, readBuffer } from './webgpuUtils';
import { paletteMatchingShader, edgeProtectionShader, reconstructionShader } from './webgpuShaders';
import { rgbToHex } from './colorUtils';

interface ProcessorParams {
  nativeWidth: number;
  nativeHeight: number;
  workspaceWidth: number;
  workspaceHeight: number;
  palette: PaletteColor[];
  colorToGroupIdx: Map<string, number>;
  edgeProtection: number;
  smoothingLevels: number;
}

export class WebGPUProcessor {
  private device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /**
   * Phase 1: Palette matching using WebGPU
   */
  async paletteMatching(
    pixelData: Uint8ClampedArray,
    width: number,
    height: number,
    palette: PaletteColor[],
    colorToGroupIdx: Map<string, number>
  ): Promise<Int16Array> {
    // Pack RGB data into u32 array for GPU
    const packedPixels = new Uint32Array(width * height);
    for (let i = 0; i < pixelData.length; i += 4) {
      const idx = i / 4;
      const r = pixelData[i];
      const g = pixelData[i + 1];
      const b = pixelData[i + 2];
      packedPixels[idx] = (r << 16) | (g << 8) | b;
    }

    // Prepare palette data
    const paletteData = new Float32Array(palette.length * 4);
    for (let i = 0; i < palette.length; i++) {
      paletteData[i * 4] = palette[i].r;
      paletteData[i * 4 + 1] = palette[i].g;
      paletteData[i * 4 + 2] = palette[i].b;
      paletteData[i * 4 + 3] = 0; // padding
    }

    // Prepare color-to-group mapping
    const colorHashes: number[] = [];
    const groupIndices: number[] = [];
    colorToGroupIdx.forEach((groupIdx, hex) => {
      const hash = parseInt(hex.substring(1), 16);
      colorHashes.push(hash);
      groupIndices.push(groupIdx);
    });

    const colorHashesArray = new Uint32Array(colorHashes);
    const groupIndicesArray = new Int32Array(groupIndices);

    // Create GPU buffers
    const pixelBuffer = createBuffer(this.device, packedPixels, GPUBufferUsage.STORAGE);
    const paletteBuffer = createBuffer(this.device, paletteData, GPUBufferUsage.STORAGE);
    const hashBuffer = createBuffer(this.device, colorHashesArray, GPUBufferUsage.STORAGE);
    const groupBuffer = createBuffer(this.device, groupIndicesArray, GPUBufferUsage.STORAGE);

    const outputBuffer = this.device.createBuffer({
      size: width * height * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    // Create uniform buffer for parameters
    const paramsData = new Uint32Array([width, height, palette.length, 0]);
    const paramsBuffer = createBuffer(this.device, paramsData, GPUBufferUsage.UNIFORM);

    // Create compute pipeline
    const shaderModule = this.device.createShaderModule({ code: paletteMatchingShader });
    const pipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pixelBuffer } },
        { binding: 1, resource: { buffer: paletteBuffer } },
        { binding: 2, resource: { buffer: groupBuffer } },
        { binding: 3, resource: { buffer: hashBuffer } },
        { binding: 4, resource: { buffer: outputBuffer } },
        { binding: 5, resource: { buffer: paramsBuffer } }
      ]
    });

    // Execute compute shader
    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    
    const workgroupsX = Math.ceil(width / 8);
    const workgroupsY = Math.ceil(height / 8);
    passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);

    // Read results
    const resultBuffer = await readBuffer(this.device, outputBuffer, width * height * 4);
    const result = new Int16Array(resultBuffer);

    // Cleanup
    pixelBuffer.destroy();
    paletteBuffer.destroy();
    hashBuffer.destroy();
    groupBuffer.destroy();
    outputBuffer.destroy();
    paramsBuffer.destroy();

    return result;
  }

  /**
   * Phase 2: Edge protection using WebGPU
   */
  async edgeProtection(
    inputIndices: Int16Array,
    originalPixels: Uint8ClampedArray,
    width: number,
    height: number,
    palette: PaletteColor[],
    radius: number,
    iterations: number
  ): Promise<Int16Array> {
    // Pack original pixels
    const packedPixels = new Uint32Array(width * height);
    for (let i = 0; i < originalPixels.length; i += 4) {
      const idx = i / 4;
      const r = originalPixels[i];
      const g = originalPixels[i + 1];
      const b = originalPixels[i + 2];
      packedPixels[idx] = (r << 16) | (g << 8) | b;
    }

    // Prepare palette data
    const paletteData = new Float32Array(palette.length * 4);
    for (let i = 0; i < palette.length; i++) {
      paletteData[i * 4] = palette[i].r;
      paletteData[i * 4 + 1] = palette[i].g;
      paletteData[i * 4 + 2] = palette[i].b;
      paletteData[i * 4 + 3] = 0;
    }

    // Create shader module and pipeline
    const shaderModule = this.device.createShaderModule({ code: edgeProtectionShader });
    const pipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    // Ping-pong buffers for iterations
    let currentIndices = new Int16Array(inputIndices);
    
    for (let iter = 0; iter < iterations; iter++) {
      const inputBuffer = createBuffer(this.device, currentIndices, GPUBufferUsage.STORAGE);
      const pixelBuffer = createBuffer(this.device, packedPixels, GPUBufferUsage.STORAGE);
      const paletteBuffer = createBuffer(this.device, paletteData, GPUBufferUsage.STORAGE);

      const outputBuffer = this.device.createBuffer({
        size: width * height * 2,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      });

      const paramsData = new Uint32Array([width, height, radius, palette.length]);
      const paramsBuffer = createBuffer(this.device, paramsData, GPUBufferUsage.UNIFORM);

      const bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: inputBuffer } },
          { binding: 1, resource: { buffer: pixelBuffer } },
          { binding: 2, resource: { buffer: paletteBuffer } },
          { binding: 3, resource: { buffer: outputBuffer } },
          { binding: 4, resource: { buffer: paramsBuffer } }
        ]
      });

      const commandEncoder = this.device.createCommandEncoder();
      const passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(pipeline);
      passEncoder.setBindGroup(0, bindGroup);
      
      const workgroupsX = Math.ceil(width / 8);
      const workgroupsY = Math.ceil(height / 8);
      passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY);
      passEncoder.end();

      this.device.queue.submit([commandEncoder.finish()]);

      const resultBuffer = await readBuffer(this.device, outputBuffer, width * height * 2);
      currentIndices = new Int16Array(resultBuffer);

      // Cleanup
      inputBuffer.destroy();
      pixelBuffer.destroy();
      paletteBuffer.destroy();
      outputBuffer.destroy();
      paramsBuffer.destroy();
    }

    return currentIndices;
  }

  /**
   * Phase 3: High-resolution reconstruction using WebGPU
   */
  async reconstruction(
    lowResIndices: Int16Array,
    highResPixels: Uint8ClampedArray,
    params: ProcessorParams
  ): Promise<Uint8ClampedArray> {
    const { nativeWidth, nativeHeight, workspaceWidth, workspaceHeight, palette, smoothingLevels } = params;

    // Pack high-res pixels
    const packedPixels = new Uint32Array(workspaceWidth * workspaceHeight);
    for (let i = 0; i < highResPixels.length; i += 4) {
      const idx = i / 4;
      const r = highResPixels[i];
      const g = highResPixels[i + 1];
      const b = highResPixels[i + 2];
      packedPixels[idx] = (r << 16) | (g << 8) | b;
    }

    // Prepare palette data
    const paletteData = new Float32Array(palette.length * 4);
    for (let i = 0; i < palette.length; i++) {
      paletteData[i * 4] = palette[i].r;
      paletteData[i * 4 + 1] = palette[i].g;
      paletteData[i * 4 + 2] = palette[i].b;
      paletteData[i * 4 + 3] = 0;
    }

    // Create buffers
    const lowResBuffer = createBuffer(this.device, lowResIndices, GPUBufferUsage.STORAGE);
    const highResBuffer = createBuffer(this.device, packedPixels, GPUBufferUsage.STORAGE);
    const paletteBuffer = createBuffer(this.device, paletteData, GPUBufferUsage.STORAGE);

    const outputBuffer = this.device.createBuffer({
      size: workspaceWidth * workspaceHeight * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    // Create uniform buffer
    const scaleX = workspaceWidth / nativeWidth;
    const scaleY = workspaceHeight / nativeHeight;
    const paramsData = new Float32Array([
      nativeWidth, nativeHeight, workspaceWidth, workspaceHeight,
      palette.length, scaleX, scaleY, smoothingLevels
    ]);
    const paramsBuffer = createBuffer(this.device, paramsData, GPUBufferUsage.UNIFORM);

    // Create pipeline
    const shaderModule = this.device.createShaderModule({ code: reconstructionShader });
    const pipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: lowResBuffer } },
        { binding: 1, resource: { buffer: highResBuffer } },
        { binding: 2, resource: { buffer: paletteBuffer } },
        { binding: 3, resource: { buffer: outputBuffer } },
        { binding: 4, resource: { buffer: paramsBuffer } }
      ]
    });

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    
    const workgroupsX = Math.ceil(workspaceWidth / 8);
    const workgroupsY = Math.ceil(workspaceHeight / 8);
    passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);

    // Read results
    const resultBuffer = await readBuffer(this.device, outputBuffer, workspaceWidth * workspaceHeight * 4);
    const packedResult = new Uint32Array(resultBuffer);

    // Unpack to RGBA
    const result = new Uint8ClampedArray(workspaceWidth * workspaceHeight * 4);
    for (let i = 0; i < packedResult.length; i++) {
      const pixel = packedResult[i];
      result[i * 4] = (pixel >> 16) & 0xFF;
      result[i * 4 + 1] = (pixel >> 8) & 0xFF;
      result[i * 4 + 2] = pixel & 0xFF;
      result[i * 4 + 3] = 255;
    }

    // Cleanup
    lowResBuffer.destroy();
    highResBuffer.destroy();
    paletteBuffer.destroy();
    outputBuffer.destroy();
    paramsBuffer.destroy();

    return result;
  }
}

/**
 * Create a WebGPU processor instance if supported
 */
export async function createWebGPUProcessor(): Promise<WebGPUProcessor | null> {
  const context = await initWebGPU();
  if (!context) {
    return null;
  }
  return new WebGPUProcessor(context.device);
}
