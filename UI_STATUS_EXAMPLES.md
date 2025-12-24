# WebGPU Status UI - Visual Examples

## Header Status Badge Examples

The header now displays a status badge on the right side showing WebGPU availability:

### 1. WebGPU Active (Green Badge)
```
╔════════════════════════════════════════════════════════════╗
║  Irodori                          ┌─────────────────┐     ║
║  いろどり                           │ ✓ WebGPU Active │     ║
║                                   └─────────────────┘     ║
╚════════════════════════════════════════════════════════════╝
```
- **Color**: Green background, green text
- **Icon**: Checkmark
- **When**: WebGPU is available and currently processing an image
- **Meaning**: User is getting GPU-accelerated performance

### 2. WebGPU Available (Blue Badge)
```
╔════════════════════════════════════════════════════════════╗
║  Irodori                          ┌───────────────────┐   ║
║  いろどり                           │ WebGPU Available  │   ║
║                                   └───────────────────┘   ║
╚════════════════════════════════════════════════════════════╝
```
- **Color**: Blue background, blue text
- **No icon**
- **When**: WebGPU is available but not currently processing
- **Meaning**: GPU acceleration is ready to use when user processes an image

### 3. CPU Fallback (Orange Badge)
```
╔════════════════════════════════════════════════════════════╗
║  Irodori                          ┌──────────────┐        ║
║  いろどり                           │ CPU Fallback │        ║
║                                   └──────────────┘        ║
╚════════════════════════════════════════════════════════════╝
```
- **Color**: Orange background, orange text
- **No icon**
- **When**: WebGPU is not available in the browser
- **Meaning**: Using CPU processing (slower but compatible)

### 4. Initial State (No Badge)
```
╔════════════════════════════════════════════════════════════╗
║  Irodori                                                   ║
║  いろどり                                                    ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```
- **When**: Worker hasn't initialized yet
- **Meaning**: Status unknown/loading

## Badge Styling

All badges use:
- **Size**: Small (10px text)
- **Font**: Uppercase, medium weight, wide tracking
- **Padding**: 2px vertical, 8px horizontal
- **Border radius**: Rounded corners
- **Position**: Right side of header

## User Experience Flow

1. **Page Load**: No badge (status unknown)
2. **Worker Initializes**: Badge appears showing WebGPU Available or CPU Fallback
3. **User Clicks Apply**: Badge changes to "WebGPU Active" (if available)
4. **Processing Completes**: Badge returns to "WebGPU Available" or stays "CPU Fallback"

## Browser Compatibility

| Browser | Expected Status |
|---------|----------------|
| Chrome 113+ | WebGPU Available/Active |
| Edge 113+ | WebGPU Available/Active |
| Firefox | CPU Fallback |
| Safari | CPU Fallback |
| Chrome <113 | CPU Fallback |

## Benefits

1. **Transparency**: Users know if they're getting GPU acceleration
2. **Troubleshooting**: Easy to see if WebGPU is working
3. **Performance Expectations**: Users understand processing speed differences
4. **Browser Guidance**: Helps users choose the right browser for best performance

## Implementation Note

The badge automatically updates based on worker messages. No user interaction required - it's purely informational and reactive to the worker's status reports.
