# StaticJumpPage.html - Feature Updates

## Summary
Updated the Static Jump analysis page to support new 3D pose data format and key frame navigation features.

---

## New Data Formats Supported

### 1. **pose.json** - 3D Keypoints
- **Format**: Each keypoint is now `[x, y, z, confidence]`
- **Handling**: System extracts 2D `[x, y]` for legacy 2D rendering while maintaining full 3D data for 3D view
- **Variables**: 
  - `poseData` - Full 3D data
  - `poseData2D` - Extracted 2D positions

### 2. **filtered_average_2d_positions.json** - Simplified Skeleton
- **Format**: `(time_step, keypoint_type, coordinate)`
- **Keypoint Types**: ankle, knee, hip, shoulder, elbow, wrist
- **Purpose**: Cleaner representation of key body positions
- **Display**: Magenta dashed lines as overlay on 2D pose view

### 3. **key_frames.json** - Jump Phase Markers
- **Format**: Array of 4 frame indices
- **Key Frames**:
  1. **Coil Position** - Lowest point
  2. **Mid-Extension** - Midway between takeoff and coil
  3. **Takeoff** - Feet leave ground
  4. **Highest Point** - Peak height
- **UI**: Navigation buttons above video player

### 4. **joint_angles_key_frames.json** - Biomechanical Angles
- **Format**: 5 angles per key frame
- **Angles Measured**:
  1. Shank → Ground
  2. Thigh → Shank
  3. Torso → Thigh
  4. Upper Arm → Torso
  5. Forearm → Upper Arm
- **Display**: Info panel appears when viewing key frames

---

## New Features Implemented

### 1. 3D/2D View Toggle
**Location**: Top center of pose canvas

**Functionality**:
- Toggle between 2D skeleton view and 3D rotated view
- 3D view uses simple orthographic projection with Y-axis rotation
- Depth-based shading (closer points = brighter)
- Maintains all existing controls (zoom, pan, joint selection)

**Implementation**:
- New canvas element `pose3DCanvas` overlays `poseCanvas`
- `drawPose3D()` function handles 3D rendering
- State variable `currentView` tracks active mode

### 2. Key Frame Navigation Bar
**Location**: Below reps bar, above video player

**Features**:
- 4 buttons for each key frame phase
- Click to jump directly to that frame
- Active key frame highlighted with distinct styling
- Auto-hides if `key_frames.json` not available

**Visual Design**:
- Blue gradient background
- Two-line labels (phase name + description)
- Active state: brighter blue with glow effect

### 3. Joint Angles Info Panel
**Location**: Bottom-left of pose canvas (when at key frame)

**Features**:
- Automatically appears when viewing a key frame
- Displays all 5 biomechanical angles
- Clean list format with labels and values
- Semi-transparent dark background
- Hides when navigating away from key frames

**Data Source**: `joint_angles_key_frames.json`

### 4. Filtered Position Overlay
**Status**: Prepared for activation (toggle to be added)

**Features**:
- Displays simplified 5-joint skeleton
- Magenta color to distinguish from main pose
- Dashed lines for connections
- Only shows at key frames (when most relevant)

**Implementation**:
- `drawFilteredPositionsOverlay()` function
- Can be toggled via `showFilteredOverlay` flag
- Future: Add checkbox control in pose controls

---

## Technical Changes

### Data Loading
- Added `loadKeyFrames()` - Loads key frame indices
- Added `loadFilteredAveragePositions()` - Loads simplified skeleton data
- Added `loadJointAnglesKeyFrames()` - Loads angle measurements
- Updated `loadPoseData()` - Extracts 2D from 3D format
- Updated `loadAllForCurrentRep()` - Calls all new loaders

### Pose Processing
- Updated `normalizePoseFrame()` - Handles 3D format with optional 2D extraction
- Modified to accept `extract2D` parameter
- Backwards compatible with legacy 2D format

### Rendering Functions
- **New**: `drawPose3D()` - 3D skeleton visualization
- **Updated**: `drawPose()` - Now switches between 2D/3D views
- **New**: `drawFilteredPositionsOverlay()` - Simplified skeleton overlay
- Updated all overlay functions to use `poseData2D`

### UI State Management
- `currentView` - Tracks '2D' or '3D' mode
- `currentKeyFrame` - Tracks active key frame (0-3 or null)
- `keyFramesData` - Stores frame indices for quick navigation
- `showFilteredOverlay` - Toggle for simplified skeleton display

### Frame Navigation
- `updateKeyFrameHighlight()` - Updates active key frame button
- `updateAngleInfoPanel()` - Shows/hides angle info based on current frame
- Key frame buttons directly update `currentFrame` and trigger redraw

---

## UI/UX Improvements

### Visual Hierarchy
1. **Reps Bar** (top) - Switch between jumps
2. **Key Frames Bar** (below reps) - Navigate to critical moments
3. **3 Panels** (main content) - Video | Pose | Charts
4. **Pose Controls** (overlay) - 2D/3D toggle at top, angles panel at bottom

### Color Coding
- **White** - Main 2D skeleton
- **Green** - Keypoints
- **Yellow/Orange** - Selected joints & angle lines
- **Magenta** - Filtered positions & height measurements
- **Cyan** - COM marker & chest starting line
- **Blue** - Key frame buttons
- **Gray** - 3D depth shading

### Interaction Patterns
- **Click Key Frame** → Jump to that frame instantly
- **Toggle 2D/3D** → Switch visualization mode
- **View Key Frame** → Angle panel auto-appears
- All existing interactions (zoom, pan, joint selection) preserved

---

## Code Organization

### New State Variables (lines ~500-520)
```javascript
let currentView = '2D';
let keyFramesData = null;
let filteredAveragePositions = null;
let jointAnglesKeyFrames = null;
let showFilteredOverlay = false;
let currentKeyFrame = null;
let poseData2D = [];
```

### New Functions
- `drawPose3D()` - 3D rendering
- `drawFilteredPositionsOverlay()` - Simplified skeleton
- `updateKeyFrameHighlight()` - UI state sync
- `updateAngleInfoPanel()` - Dynamic angle display
- `loadKeyFrames()` - Data loading
- `loadFilteredAveragePositions()` - Data loading
- `loadJointAnglesKeyFrames()` - Data loading

### Updated Functions
- `normalizePoseFrame()` - 3D format support
- `loadPoseData()` - 2D extraction
- `drawPose()` - View switching
- `drawPoseOverlay()` - Uses poseData2D
- All overlay alignment functions - Uses poseData2D

---

## Future Enhancements (Not Yet Implemented)

### 1. LLM Coaching Text Display
**Requirement**: Text analysis at each key frame
- Location: Below angle info panel or in separate card
- Format: Markdown-formatted coaching advice
- Source: Future `coaching_insights.json` or API call

### 2. Aggregate Comparison View
**Requirement**: Compare current rep to averages
- Overlay multiple rep data
- Statistical visualization (mean, std dev)
- Highlight differences from "good rep" template

### 3. Filtered Overlay Toggle Control
**Quick Add**: Checkbox in pose controls section
```javascript
<label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;">
  <input type="checkbox" id="showFilteredCheckbox"/>
  <span>Show Simplified Skeleton</span>
</label>
```

### 4. 3D View Enhancements
- Interactive rotation controls
- Multiple viewing angles (front, side, top)
- Better depth perception (fog, size scaling)

---

## Testing Checklist

- [ ] Load page with new 3D pose.json format
- [ ] Toggle between 2D and 3D views
- [ ] Click each key frame button
- [ ] Verify angle info panel appears at key frames
- [ ] Test zoom/pan in both 2D and 3D modes
- [ ] Verify filtered positions data loads (check console)
- [ ] Test with missing optional files (key_frames, angles)
- [ ] Switch between different reps
- [ ] Verify all existing features still work (overlay, height chart, etc.)

---

## File Locations
- Main file: `StaticJumpPage.html`
- Expected data paths:
  - `{player}/jump/{session}/{kickId}/pose.json`
  - `{player}/jump/{session}/{kickId}/key_frames.json`
  - `{player}/jump/{session}/{kickId}/filtered_average_2d_positions.json`
  - `{player}/jump/{session}/{kickId}/joint_angles_key_frames.json`

---

## Notes
- All changes are backwards compatible with existing 2D data
- System gracefully handles missing new data files
- 3D view is experimental and can be improved with proper 3D library (Three.js) if needed
- Filtered overlay function is ready but needs UI toggle to activate
