/**
 * WebGPU compute shaders for image processing operations
 */

/**
 * Shader for palette matching (Phase 1)
 * Maps each pixel to the closest palette color using Euclidean distance
 */
export const paletteMatchingShader = `
struct Params {
  width: u32,
  height: u32,
  paletteSize: u32,
  padding: u32,
}

struct Color {
  r: f32,
  g: f32,
  b: f32,
  padding: f32,
}

@group(0) @binding(0) var<storage, read> pixelData: array<u32>;
@group(0) @binding(1) var<storage, read> palette: array<Color>;
@group(0) @binding(2) var<storage, read> colorToGroupIdx: array<i32>;
@group(0) @binding(3) var<storage, read> colorHashes: array<u32>;
@group(0) @binding(4) var<storage, read_write> outputIndices: array<i32>;
@group(0) @binding(5) var<uniform> params: Params;

fn colorDistance(r1: f32, g1: f32, b1: f32, r2: f32, g2: f32, b2: f32) -> f32 {
  let dr = r1 - r2;
  let dg = g1 - g2;
  let db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

fn hashColor(r: u32, g: u32, b: u32) -> u32 {
  return (r << 16u) | (g << 8u) | b;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  let y = global_id.y;
  
  if (x >= params.width || y >= params.height) {
    return;
  }
  
  let idx = y * params.width + x;
  let pixel = pixelData[idx];
  
  let r = f32((pixel >> 16u) & 0xFFu);
  let g = f32((pixel >> 8u) & 0xFFu);
  let b = f32(pixel & 0xFFu);
  
  let hash = hashColor((pixel >> 16u) & 0xFFu, (pixel >> 8u) & 0xFFu, pixel & 0xFFu);
  
  // Check if this exact color has a group mapping
  var groupIdx = -1;
  for (var i = 0u; i < arrayLength(&colorHashes); i++) {
    if (colorHashes[i] == hash) {
      groupIdx = colorToGroupIdx[i];
      break;
    }
  }
  
  // If not in group, find closest palette color
  if (groupIdx < 0) {
    var minDist = 999999.0;
    var closestIdx = 0;
    
    for (var i = 0u; i < params.paletteSize; i++) {
      let dist = colorDistance(r, g, b, palette[i].r, palette[i].g, palette[i].b);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i32(i);
      }
    }
    groupIdx = closestIdx;
  }
  
  outputIndices[idx] = groupIdx;
}
`;

/**
 * Shader for edge protection (Phase 2)
 * Applies morphological operations to clean up palette indices
 */
export const edgeProtectionShader = `
struct Params {
  width: u32,
  height: u32,
  radius: u32,
  paletteSize: u32,
}

struct Color {
  r: f32,
  g: f32,
  b: f32,
  padding: f32,
}

@group(0) @binding(0) var<storage, read> inputIndices: array<i32>;
@group(0) @binding(1) var<storage, read> originalPixels: array<u32>;
@group(0) @binding(2) var<storage, read> palette: array<Color>;
@group(0) @binding(3) var<storage, read_write> outputIndices: array<i32>;
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  let y = global_id.y;
  
  if (x >= params.width || y >= params.height) {
    return;
  }
  
  let idx = y * params.width + x;
  let currentIdx = inputIndices[idx];
  
  let yStart = max(i32(y) - i32(params.radius), 0);
  let yEnd = min(i32(y) + i32(params.radius), i32(params.height) - 1);
  let xStart = max(i32(x) - i32(params.radius), 0);
  let xEnd = min(i32(x) + i32(params.radius), i32(params.width) - 1);
  
  // Count occurrences of each palette index in the window
  var counts = array<u32, 256>();
  for (var i = 0u; i < 256u; i++) {
    counts[i] = 0u;
  }
  
  for (var ny = yStart; ny <= yEnd; ny++) {
    for (var nx = xStart; nx <= xEnd; nx++) {
      let nIdx = inputIndices[u32(ny) * params.width + u32(nx)];
      if (nIdx >= 0 && nIdx < 256) {
        counts[u32(nIdx)]++;
      }
    }
  }
  
  // Find top 3 most common indices
  var major1Idx = 0;
  var major1Count = 0u;
  var major2Idx = 0;
  var major2Count = 0u;
  var major3Idx = 0;
  var major3Count = 0u;
  
  for (var i = 0; i < i32(params.paletteSize); i++) {
    let count = counts[u32(i)];
    if (count > major1Count) {
      major3Idx = major2Idx;
      major3Count = major2Count;
      major2Idx = major1Idx;
      major2Count = major1Count;
      major1Idx = i;
      major1Count = count;
    } else if (count > major2Count) {
      major3Idx = major2Idx;
      major3Count = major2Count;
      major2Idx = i;
      major2Count = count;
    } else if (count > major3Count) {
      major3Idx = i;
      major3Count = count;
    }
  }
  
  // Apply betweenness filter
  var finalMajor2 = major2Idx;
  if (major1Idx != major2Idx && major2Idx != major3Idx) {
    let p1 = palette[major1Idx];
    let p2 = palette[major2Idx];
    let p3 = palette[major3Idx];
    
    let d13 = sqrt((p1.r - p3.r) * (p1.r - p3.r) + (p1.g - p3.g) * (p1.g - p3.g) + (p1.b - p3.b) * (p1.b - p3.b));
    let d12 = sqrt((p1.r - p2.r) * (p1.r - p2.r) + (p1.g - p2.g) * (p1.g - p2.g) + (p1.b - p2.b) * (p1.b - p2.b));
    let d23 = sqrt((p3.r - p2.r) * (p3.r - p2.r) + (p3.g - p2.g) * (p3.g - p2.g) + (p3.b - p2.b) * (p3.b - p2.b));
    
    if (d12 + d23 < d13 * 1.10) {
      finalMajor2 = major3Idx;
    }
  }
  
  // Topology cleaning
  if (currentIdx != major1Idx && currentIdx != finalMajor2) {
    let pC = palette[currentIdx];
    let p1 = palette[major1Idx];
    let p2 = palette[finalMajor2];
    
    let d1 = (pC.r - p1.r) * (pC.r - p1.r) + (pC.g - p1.g) * (pC.g - p1.g) + (pC.b - p1.b) * (pC.b - p1.b);
    let d2 = (pC.r - p2.r) * (pC.r - p2.r) + (pC.g - p2.g) * (pC.g - p2.g) + (pC.b - p2.b) * (pC.b - p2.b);
    
    if (d1 < d2) {
      outputIndices[idx] = major1Idx;
    } else {
      outputIndices[idx] = finalMajor2;
    }
  } else {
    // Resolve between majors using source similarity
    let pixel = originalPixels[idx];
    let srcR = f32((pixel >> 16u) & 0xFFu);
    let srcG = f32((pixel >> 8u) & 0xFFu);
    let srcB = f32(pixel & 0xFFu);
    
    let p1 = palette[major1Idx];
    let p2 = palette[finalMajor2];
    
    let err1 = (srcR - p1.r) * (srcR - p1.r) + (srcG - p1.g) * (srcG - p1.g) + (srcB - p1.b) * (srcB - p1.b);
    let err2 = (srcR - p2.r) * (srcR - p2.r) + (srcG - p2.g) * (srcG - p2.g) + (srcB - p2.b) * (srcB - p2.b);
    
    if (err1 < err2) {
      outputIndices[idx] = major1Idx;
    } else {
      outputIndices[idx] = finalMajor2;
    }
  }
}
`;

/**
 * Shader for high-resolution reconstruction (Phase 3)
 * Performs intelligent upscaling with anti-aliasing
 */
export const reconstructionShader = `
struct Params {
  nativeWidth: u32,
  nativeHeight: u32,
  workspaceWidth: u32,
  workspaceHeight: u32,
  paletteSize: u32,
  scaleX: f32,
  scaleY: f32,
  smoothingLevels: f32,
}

struct Color {
  r: f32,
  g: f32,
  b: f32,
  padding: f32,
}

@group(0) @binding(0) var<storage, read> lowResIndices: array<i32>;
@group(0) @binding(1) var<storage, read> highResPixels: array<u32>;
@group(0) @binding(2) var<storage, read> palette: array<Color>;
@group(0) @binding(3) var<storage, read_write> outputPixels: array<u32>;
@group(0) @binding(4) var<uniform> params: Params;

fn blendColors(c1: Color, c2: Color, t: f32) -> vec3<f32> {
  return vec3<f32>(
    c1.r + t * (c2.r - c1.r),
    c1.g + t * (c2.g - c1.g),
    c1.b + t * (c2.b - c1.b)
  );
}

fn sigmoid(x: f32, k: f32) -> f32 {
  let s0 = 1.0 / (1.0 + exp(-k * (-0.5)));
  let s1 = 1.0 / (1.0 + exp(-k * 0.5));
  let rawS = 1.0 / (1.0 + exp(-k * (x - 0.5)));
  return (rawS - s0) / (s1 - s0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  let y = global_id.y;
  
  if (x >= params.workspaceWidth || y >= params.workspaceHeight) {
    return;
  }
  
  let idx = y * params.workspaceWidth + x;
  
  // Map to low-res coordinates
  let lx = min(u32(f32(x) / params.scaleX), params.nativeWidth - 1u);
  let ly = min(u32(f32(y) / params.scaleY), params.nativeHeight - 1u);
  
  // Get current reference color from high-res interpolated image
  let pixel = highResPixels[idx];
  let refR = f32((pixel >> 16u) & 0xFFu);
  let refG = f32((pixel >> 8u) & 0xFFu);
  let refB = f32(pixel & 0xFFu);
  
  // Gather local candidates (5x5 window)
  let yMin = max(i32(ly) - 2, 0);
  let yMax = min(i32(ly) + 2, i32(params.nativeHeight) - 1);
  let xMin = max(i32(lx) - 2, 0);
  let xMax = min(i32(lx) + 2, i32(params.nativeWidth) - 1);
  
  var weights = array<f32, 256>();
  for (var i = 0u; i < 256u; i++) {
    weights[i] = 0.0;
  }
  
  for (var ny = yMin; ny <= yMax; ny++) {
    let dy = abs(ny - i32(ly));
    for (var nx = xMin; nx <= xMax; nx++) {
      let dx = abs(nx - i32(lx));
      let nIdx = lowResIndices[u32(ny) * params.nativeWidth + u32(nx)];
      
      // Gaussian weighting
      var weight = 1.0;
      if (dx > 0 || dy > 0) {
        weight = 0.5;
      }
      if (dx > 1 || dy > 1) {
        weight = 0.2;
      }
      
      if (nIdx >= 0 && nIdx < 256) {
        weights[u32(nIdx)] += weight;
      }
    }
  }
  
  // Find top 2 candidates
  var major1Idx = 0;
  var major1Weight = 0.0;
  var major2Idx = 0;
  var major2Weight = 0.0;
  
  for (var i = 0; i < i32(params.paletteSize); i++) {
    let w = weights[u32(i)];
    if (w > major1Weight) {
      major2Idx = major1Idx;
      major2Weight = major1Weight;
      major1Idx = i;
      major1Weight = w;
    } else if (w > major2Weight) {
      major2Idx = i;
      major2Weight = w;
    }
  }
  
  // Get core pixel index
  let coreIdx = lowResIndices[ly * params.nativeWidth + lx];
  
  // Determine blend pair
  var blendA = coreIdx;
  var blendB = major1Idx;
  
  if (coreIdx == major1Idx) {
    blendB = major2Idx;
  } else if (coreIdx != major1Idx) {
    blendA = major1Idx;
    blendB = major2Idx;
  }
  
  // Output color
  var finalColor: vec3<f32>;
  
  if (blendA == blendB || params.smoothingLevels < 0.01) {
    // No blending
    let p = palette[blendA];
    finalColor = vec3<f32>(p.r, p.g, p.b);
  } else {
    // Calculate blend ratio
    let c1 = palette[blendA];
    let c2 = palette[blendB];
    
    let dr = c2.r - c1.r;
    let dg = c2.g - c1.g;
    let db = c2.b - c1.b;
    
    let pr = refR - c1.r;
    let pg = refG - c1.g;
    let pb = refB - c1.b;
    
    let lenSq = dr * dr + dg * dg + db * db;
    var t = 0.0;
    
    if (lenSq > 0.0) {
      t = clamp((pr * dr + pg * dg + pb * db) / lenSq, 0.0, 1.0);
    }
    
    // Apply sigmoid for smoother transitions
    let intensity = params.smoothingLevels / 100.0;
    let k = 28.0 * (1.0 - intensity) + 8.0 * intensity;
    
    let deadzone = 0.15 * (1.0 - intensity);
    if (t < deadzone) {
      t = 0.0;
    } else if (t > 1.0 - deadzone) {
      t = 1.0;
    } else {
      t = sigmoid(t, k);
    }
    
    finalColor = blendColors(c1, c2, t);
  }
  
  // Pack color into output
  let outR = u32(clamp(finalColor.x, 0.0, 255.0));
  let outG = u32(clamp(finalColor.y, 0.0, 255.0));
  let outB = u32(clamp(finalColor.z, 0.0, 255.0));
  
  outputPixels[idx] = (outR << 16u) | (outG << 8u) | outB | 0xFF000000u;
}
`;
