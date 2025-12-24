# WebGPU Status UI Integration

## Overview

The UI has been modified to display whether WebGPU is available and being used, or if the CPU fallback is active.

## UI Changes

### Header Component
The header now displays a status badge on the right side showing:
- **"WebGPU Active"** (green) - When WebGPU is available and currently being used
- **"WebGPU Available"** (blue) - When WebGPU is available but not currently processing
- **"CPU Fallback"** (orange) - When WebGPU is not available

### Types Updated
`types.ts` now includes WebGPU status fields in `WorkerResponse`:
```typescript
export type WorkerResponse = {
  type: 'complete' | 'progress' | 'status';
  result?: Blob;
  progress?: number;
  error?: string;
  webgpuAvailable?: boolean;  // NEW
  usingWebGPU?: boolean;       // NEW
};
```

### App State
Added state tracking in `App.tsx`:
```typescript
const [webgpuAvailable, setWebgpuAvailable] = useState<boolean | null>(null);
const [usingWebGPU, setUsingWebGPU] = useState<boolean>(false);
```

## Worker Integration Required

To make this work with the WebGPU implementation in PR #4, the worker needs to send status messages:

### 1. On Worker Initialization
When the worker determines WebGPU availability:

```typescript
// In imageProcessor.worker.ts - after initWebGPU()
const webgpuAvailable = await initWebGPU();
self.postMessage({ 
  type: 'status', 
  webgpuAvailable: webgpuAvailable 
});
```

### 2. During Processing
When starting to process with WebGPU or CPU:

```typescript
// Before processing starts
self.postMessage({ 
  type: 'status', 
  usingWebGPU: webgpuAvailable && webgpuProcessor !== null 
});

// Then process...
const outputData = webgpuAvailable && webgpuProcessor 
  ? await processWithWebGPU(...)
  : processWithCPU(...);
```

### 3. In Complete Message
Include status in the final result:

```typescript
self.postMessage({ 
  type: 'complete', 
  result: blob,
  webgpuAvailable: webgpuAvailable,
  usingWebGPU: usedWebGPU  // track this during processing
});
```

## Example Worker Implementation

```typescript
// Global state
let webgpuProcessor: WebGPUProcessor | null | undefined = undefined;

async function initWebGPU(): Promise<boolean> {
  if (webgpuProcessor === undefined) {
    try {
      webgpuProcessor = await createWebGPUProcessor();
      const available = webgpuProcessor !== null;
      
      // Report status to UI
      self.postMessage({ 
        type: 'status', 
        webgpuAvailable: available 
      });
      
      return available;
    } catch (error) {
      webgpuProcessor = null;
      self.postMessage({ 
        type: 'status', 
        webgpuAvailable: false 
      });
      return false;
    }
  }
  return webgpuProcessor !== null;
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  if (e.data.type !== 'process') return;
  
  try {
    const webgpuAvailable = await initWebGPU();
    let usedWebGPU = false;
    
    // Report that we're starting to use WebGPU (or not)
    self.postMessage({ 
      type: 'status', 
      usingWebGPU: webgpuAvailable 
    });
    
    let outputData: Uint8ClampedArray;
    if (webgpuAvailable && webgpuProcessor) {
      outputData = await processWithWebGPU(...);
      usedWebGPU = true;
    } else {
      outputData = await processWithCPU(...);
      usedWebGPU = false;
    }
    
    // Include status in final result
    self.postMessage({ 
      type: 'complete', 
      result: blob,
      webgpuAvailable: webgpuAvailable,
      usingWebGPU: usedWebGPU
    });
  } catch (error) {
    self.postMessage({ 
      type: 'complete', 
      error: error.message 
    });
  }
};
```

## Testing

1. **WebGPU Available Browser** (Chrome 113+, Edge 113+):
   - Should show "WebGPU Available" initially
   - Should show "WebGPU Active" during processing
   - Should return to "WebGPU Available" after processing

2. **Non-WebGPU Browser** (Firefox, Safari, older Chrome):
   - Should show "CPU Fallback"
   - Badge should remain "CPU Fallback" during and after processing

## Visual Examples

- Green badge = Using GPU acceleration ✓
- Orange badge = Using CPU (slower but compatible)
- Blue badge = GPU available but not currently processing

This helps users understand if they're getting the performance benefits of WebGPU or if they need to use a different browser for better performance.
