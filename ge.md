Technical Specification: Automated Floor Plan Vectorization (OpenCV.js)
1. Project Objective
Extract vector data (walls, doors, windows) from a raster floor plan image for a Konva.js-based editor. The system must recognize specific colors and convert them into rectangles with x, y, width, height coordinates.

2. Input Specification
Image Format: PNG / JPG (Clean, non-photographic, schematic).

Key Color Semantics:

Black (#000000): Walls.

Yellow (#FADB4E): Doors.

Blue (#70A5D8): Windows.
(Note: Colors might have slight variations due to compression; logic must use range-based thresholding.)

3. Technology Stack
Primary Library: opencv.js (OpenCV for WebAssembly).

UI Context: HTML5 Canvas / Konva.js.

4. Recognition Pipeline (The Algorithm)
A. Pre-processing
Load Image: Read the uploaded file into an HTMLImageElement.

Convert Color Space: Transform the image from RGBA to RGB, then to HSV (Hue, Saturation, Value) for robust color segmentation.

B. Color Masking (Semantic Segmentation)
Define HSV ranges for the three target categories:

Wall Mask: H: 0-180, S: 0-255, V: 0-50 (Low brightness).

Door Mask: H: 20-35, S: 100-255, V: 100-255 (Yellow range).

Window Mask: H: 100-130, S: 100-255, V: 100-255 (Blue range).

C. Morphological Refinement
Apply Erode and Dilate (or morphologyEx) to the masks to remove isolated noise pixels and bridge tiny gaps caused by anti-aliasing.

D. Contour Extraction & Vectorization
Use cv.findContours on each mask.

Filter contours by cv.contourArea to ignore insignificant artifacts.

For each valid contour, apply cv.boundingRect to get the Axis-Aligned Bounding Box (AABB).

Store results with their semantic type.

5. Data Output Structure (JSON)
The output should be an array of objects compatible with the Konva.js state:

JSON
[
  {
    "type": "wall",
    "x": 120.5,
    "y": 45.0,
    "width": 300,
    "height": 10,
    "rotation": 0
  },
  {
    "type": "window",
    "x": 150.0,
    "y": 45.0,
    "width": 60,
    "height": 10,
    "rotation": 0
  }
]
6. Implementation Notes for Claude
Snap to Grid: Implement a rounding function (e.g., round to nearest 5 or 10 units) to ensure the vector objects align perfectly.

Coordinate Scaling: Map the pixel coordinates from the OpenCV source image to the Konva Stage coordinate system.

Memory Management: Ensure cv.Mat.delete() is called for all intermediate matrices to prevent memory leaks in the browser.

Thickness Correction: Since walls have thickness in pixels, the boundingRect will capture the full volume. Ensure the width or height (depending on orientation) reflects the wall thickness.

7. Expected UI/UX Flow
User uploads g1.png.

Processing indicator appears.

System parses image -> Generates JSON.

JSON is fed into konva.Layer.add(new Konva.Rect(...)).

User can immediately click and drag the recognized wall/door.


請幫我寫一個名為 FloorplanAnalyzer 的 Class，裡面包含 process(imageElement) 方法，並使用 OpenCV.js 來實作上述邏輯。