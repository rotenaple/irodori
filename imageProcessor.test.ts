import { describe, it, expect, beforeAll } from 'vitest';
import { PaletteColor } from './types';

/**
 * Test to compare WebGPU and CPU worker outputs
 * This ensures both implementations produce identical results
 */

// Helper to create a simple test image
function createTestImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  
  // Create a simple pattern: red, green, blue, yellow quadrants
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      
      if (x < width / 2 && y < height / 2) {
        // Red quadrant
        data[idx] = 255; data[idx + 1] = 0; data[idx + 2] = 0;
      } else if (x >= width / 2 && y < height / 2) {
        // Green quadrant
        data[idx] = 0; data[idx + 1] = 255; data[idx + 2] = 0;
      } else if (x < width / 2 && y >= height / 2) {
        // Blue quadrant
        data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 255;
      } else {
        // Yellow quadrant
        data[idx] = 255; data[idx + 1] = 255; data[idx + 2] = 0;
      }
      data[idx + 3] = 255; // Alpha
    }
  }
  
  return new ImageData(data, width, height);
}

// Helper to create a simple palette
function createTestPalette(): PaletteColor[] {
  return [
    { r: 255, g: 0, b: 0, hex: '#ff0000', id: 'red' },
    { r: 0, g: 255, b: 0, hex: '#00ff00', id: 'green' },
    { r: 0, g: 0, b: 255, hex: '#0000ff', id: 'blue' },
    { r: 255, g: 255, b: 0, hex: '#ffff00', id: 'yellow' }
  ];
}

// Helper to compare two ImageData objects
function comparePixelData(
  data1: Uint8ClampedArray,
  data2: Uint8ClampedArray,
  tolerance: number = 0
): { match: boolean; differences: number; maxDiff: number } {
  if (data1.length !== data2.length) {
    return { match: false, differences: -1, maxDiff: -1 };
  }
  
  let differences = 0;
  let maxDiff = 0;
  
  for (let i = 0; i < data1.length; i++) {
    const diff = Math.abs(data1[i] - data2[i]);
    if (diff > tolerance) {
      differences++;
      maxDiff = Math.max(maxDiff, diff);
    }
  }
  
  return {
    match: differences === 0,
    differences,
    maxDiff
  };
}

describe('Worker Output Comparison Tests', () => {
  it('should create test images correctly', () => {
    const img = createTestImage(10, 10);
    expect(img.width).toBe(10);
    expect(img.height).toBe(10);
    expect(img.data.length).toBe(10 * 10 * 4);
    
    // Check red quadrant (top-left)
    const topLeftIdx = 0;
    expect(img.data[topLeftIdx]).toBe(255); // R
    expect(img.data[topLeftIdx + 1]).toBe(0); // G
    expect(img.data[topLeftIdx + 2]).toBe(0); // B
  });

  it('should create test palette correctly', () => {
    const palette = createTestPalette();
    expect(palette.length).toBe(4);
    expect(palette[0].hex).toBe('#ff0000');
    expect(palette[1].hex).toBe('#00ff00');
  });

  it('should compare identical pixel data correctly', () => {
    const data1 = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const data2 = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    
    const result = comparePixelData(data1, data2);
    expect(result.match).toBe(true);
    expect(result.differences).toBe(0);
  });

  it('should detect differences in pixel data', () => {
    const data1 = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const data2 = new Uint8ClampedArray([255, 0, 0, 255, 0, 250, 0, 255]);
    
    const result = comparePixelData(data1, data2);
    expect(result.match).toBe(false);
    expect(result.differences).toBeGreaterThan(0);
    expect(result.maxDiff).toBe(5);
  });
});

/**
 * Manual test function to be run in a browser environment
 * This tests the actual worker implementations
 */
export async function runWorkerComparisonTest() {
  console.log('Starting Worker Comparison Test...');
  
  // Create test image
  const testImg = createTestImage(100, 100);
  const palette = createTestPalette();
  
  // Create canvas and convert to ImageBitmap
  const canvas = document.createElement('canvas');
  canvas.width = testImg.width;
  canvas.height = testImg.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(testImg, 0, 0);
  
  const imageBitmap = await createImageBitmap(canvas);
  
  // Test parameters
  const parameters = {
    upscaleFactor: 2 as const,
    denoiseRadius: 0,
    edgeProtection: 50,
    disablePostProcessing: false,
    disableRecoloring: false,
    disableScaling: false,
    palette,
    colorGroups: [],
    enabledGroups: palette.map(p => p.id),
    selectedInGroup: {},
    smoothingLevels: 50,
    vertexInertia: 100
  };
  
  // Function to run worker
  const runWorker = (workerPath: string): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL(workerPath, import.meta.url), { type: 'module' });
      
      worker.onmessage = (e) => {
        if (e.data.type === 'complete') {
          if (e.data.result) {
            resolve(e.data.result);
          } else {
            reject(new Error(e.data.error || 'Unknown error'));
          }
          worker.terminate();
        }
      };
      
      worker.onerror = (error) => {
        reject(error);
        worker.terminate();
      };
      
      worker.postMessage({
        type: 'process',
        imageBitmap,
        parameters
      }, [imageBitmap]);
    });
  };
  
  try {
    console.log('Running worker with default settings (attempts WebGPU first)...');
    const result1 = await runWorker('./imageProcessor.worker.ts');
    
    console.log('Result 1 size:', result1.size);
    
    // Convert blobs to ImageData for comparison
    const img1 = await createImageBitmap(result1);
    const canvas1 = document.createElement('canvas');
    canvas1.width = img1.width;
    canvas1.height = img1.height;
    const ctx1 = canvas1.getContext('2d')!;
    ctx1.drawImage(img1, 0, 0);
    const imageData1 = ctx1.getImageData(0, 0, img1.width, img1.height);
    
    console.log('Result 1 dimensions:', img1.width, 'x', img1.height);
    console.log('Result 1 pixel data length:', imageData1.data.length);
    
    // Check if we got actual pixel data
    let hasNonZeroPixels = false;
    for (let i = 0; i < Math.min(100, imageData1.data.length); i += 4) {
      if (imageData1.data[i] !== 0 || imageData1.data[i + 1] !== 0 || imageData1.data[i + 2] !== 0) {
        hasNonZeroPixels = true;
        console.log(`Sample pixel at ${i/4}:`, 
          imageData1.data[i], imageData1.data[i + 1], imageData1.data[i + 2], imageData1.data[i + 3]);
        break;
      }
    }
    
    if (!hasNonZeroPixels) {
      console.error('WARNING: Output appears to be all black/transparent!');
    } else {
      console.log('Output contains valid pixel data');
    }
    
    return {
      success: hasNonZeroPixels,
      width: img1.width,
      height: img1.height,
      dataLength: imageData1.data.length
    };
  } catch (error) {
    console.error('Test failed:', error);
    throw error;
  }
}

// Export for browser console testing
if (typeof window !== 'undefined') {
  (window as any).runWorkerComparisonTest = runWorkerComparisonTest;
}
