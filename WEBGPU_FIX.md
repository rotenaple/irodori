# WebGPU Logic Fix - Black Pixel Output Issue

## Problem Summary

The WebGPU implementation in PR #4 produces black pixels instead of colored output. The root cause is **data type mismatches** between WGSL shaders and TypeScript code.

## Root Cause Analysis

### The Bug

WGSL shaders use `i32` (4 bytes) for storing palette indices, but TypeScript code reads/writes them as `Int16Array` (2 bytes per element). This causes:

1. **Incorrect buffer sizes**: Buffers sized for 2-byte integers but shaders write 4-byte integers
2. **Data corruption**: Reading 4-byte values as 2-byte values produces garbage data
3. **Black pixels**: Corrupted indices cause reconstruction to use wrong or invalid colors

### Affected Code Locations

#### 1. Palette Matching Phase (`utils/webgpuProcessor.ts` line ~120-123)

**Current (Broken)**:
```typescript
const outputBuffer = this.device.createBuffer({
  size: width * height * 4,  // Correct size for i32
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
});
// ...
const resultBuffer = await readBuffer(this.device, outputBuffer, width * height * 4);
const result = new Int16Array(resultBuffer); // ❌ WRONG: Reads i32 as i16
```

**Fixed**:
```typescript
const resultBuffer = await readBuffer(this.device, outputBuffer, width * height * 4);
const int32Result = new Int32Array(resultBuffer); // ✅ Read as i32

// Convert from i32 to i16 for consistency with CPU path
const result = new Int16Array(width * height);
for (let i = 0; i < int32Result.length; i++) {
  result[i] = int32Result[i];
}
```

#### 2. Edge Protection Phase (`utils/webgpuProcessor.ts` line ~183-223)

**Current (Broken)**:
```typescript
let currentIndices = new Int16Array(inputIndices);

for (let iter = 0; iter < iterations; iter++) {
  const inputBuffer = createBuffer(this.device, currentIndices, GPUBufferUsage.STORAGE); // ❌ i16 buffer
  
  const outputBuffer = this.device.createBuffer({
    size: width * height * 2,  // ❌ WRONG: Too small for i32
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  // ...
  const resultBuffer = await readBuffer(this.device, outputBuffer, width * height * 2);
  currentIndices = new Int16Array(resultBuffer); // ❌ Reads truncated data
}
```

**Fixed**:
```typescript
// Convert i16 input to i32 for shader
let currentIndices32 = new Int32Array(inputIndices);

for (let iter = 0; iter < iterations; iter++) {
  const inputBuffer = createBuffer(this.device, currentIndices32, GPUBufferUsage.STORAGE); // ✅ i32 buffer
  
  const outputBuffer = this.device.createBuffer({
    size: width * height * 4,  // ✅ Correct size for i32
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  // ...
  const resultBuffer = await readBuffer(this.device, outputBuffer, width * height * 4);
  currentIndices32 = new Int32Array(resultBuffer); // ✅ Read as i32
}

// Convert from i32 back to i16 for consistency with CPU path
const result = new Int16Array(width * height);
for (let i = 0; i < currentIndices32.length; i++) {
  result[i] = currentIndices32[i];
}
return result;
```

#### 3. Reconstruction Phase (`utils/webgpuProcessor.ts` line ~272-273)

**Current (Broken)**:
```typescript
// Create buffers
const lowResBuffer = createBuffer(this.device, lowResIndices, GPUBufferUsage.STORAGE); // ❌ i16 buffer
```

**Fixed**:
```typescript
// Convert lowResIndices from i16 to i32 for shader
const lowResIndices32 = new Int32Array(lowResIndices);

// Create buffers
const lowResBuffer = createBuffer(this.device, lowResIndices32, GPUBufferUsage.STORAGE); // ✅ i32 buffer
```

## Why Not Change Shaders?

WGSL (WebGPU Shading Language) **does not support `i16` type**. The only integer types available are:
- `i32` (signed 32-bit)
- `u32` (unsigned 32-bit)

Therefore, the fix must be on the TypeScript side, not the shader side.

## Impact

This fix:
- ✅ Corrects all buffer size mismatches
- ✅ Ensures proper data type conversions between TypeScript and shaders
- ✅ Maintains compatibility with CPU path (which uses `Int16Array`)
- ✅ No changes to shader code needed
- ✅ Should produce identical output to CPU path

## Testing

After applying this fix:
1. Run `npm run build` to verify no TypeScript errors
2. Open `test-worker-output.html` in a WebGPU-capable browser (Chrome/Edge)
3. Verify both test runs produce colored pixels (not black)
4. Confirm pixel comparison shows MATCH ✓

## Files Modified

- `utils/webgpuProcessor.ts` - All three processing phases updated

## See Also

- Patch file: `webgpu-data-type-fix.patch` in this PR
- Detailed verification: `FIX_VERIFICATION.md`
