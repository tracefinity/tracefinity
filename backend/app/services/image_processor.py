from __future__ import annotations

import cv2
import numpy as np
from pathlib import Path
from typing import Literal

PAPER_SIZES = {
    "a4": (210, 297),
    "letter": (215.9, 279.4),
}

PX_PER_MM = 10


class ImageProcessor:
    def detect_paper_corners(self, image_path: str) -> list[tuple[float, float]] | None:
        """detect paper corners using multiple edge detection strategies"""
        img = cv2.imread(image_path)
        if img is None:
            return None

        h, w = img.shape[:2]
        min_area = (h * w) * 0.05  # paper should be at least 5% of image
        max_area = (h * w) * 0.85  # but not more than 85% (exclude full-image detections)
        edge_margin = int(min(h, w) * 0.02)  # 2% margin from edges

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # try brightness-based detection first (paper is usually brightest)
        bright_result = self._detect_bright_region(img, gray, min_area, max_area, edge_margin, h, w)
        if bright_result:
            return bright_result

        # fallback to edge detection strategies
        strategies = [
            self._detect_canny(gray, 50, 150),
            self._detect_canny(gray, 30, 100),
            self._detect_canny(gray, 75, 200),
            self._detect_adaptive_threshold(gray),
            self._detect_saturation(img),
        ]

        for edges in strategies:
            if edges is None:
                continue

            result = self._find_paper_contour(edges, min_area, max_area, edge_margin, h, w)
            if result:
                return result

        return None

    def _detect_bright_region(
        self, img: np.ndarray, gray: np.ndarray,
        min_area: float, max_area: float, margin: int, h: int, w: int
    ) -> list[tuple[float, float]] | None:
        """detect paper by finding bright white region"""
        # try multiple thresholds, strictest first
        for thresh_val in [200, 190, 180]:
            result = self._try_brightness_threshold(
                gray, thresh_val, min_area, max_area, margin, h, w
            )
            if result:
                return result
        return None

    def _try_brightness_threshold(
        self, gray: np.ndarray, thresh_val: int,
        min_area: float, max_area: float, margin: int, h: int, w: int
    ) -> list[tuple[float, float]] | None:
        """try to find paper at a specific brightness threshold"""
        _, thresh = cv2.threshold(gray, thresh_val, 255, cv2.THRESH_BINARY)

        # minimal morphology - just close small gaps
        kernel = np.ones((3, 3), np.uint8)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=1)

        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
            area = cv2.contourArea(contour)
            if area < min_area or area > max_area:
                continue

            # use minimum area rectangle for better fit
            rect = cv2.minAreaRect(contour)
            box = cv2.boxPoints(rect)
            box = np.int32(box)

            # skip if any corner touches image boundary
            box_margin = margin * 2
            if np.any(box[:, 0] < box_margin) or np.any(box[:, 0] > w - box_margin):
                continue
            if np.any(box[:, 1] < box_margin) or np.any(box[:, 1] > h - box_margin):
                continue

            # verify most of the rectangle interior is bright
            rect_mask = np.zeros(gray.shape, dtype=np.uint8)
            cv2.fillPoly(rect_mask, [box], 255)
            bright_pixels = cv2.countNonZero(cv2.bitwise_and(thresh, rect_mask))
            total_pixels = cv2.countNonZero(rect_mask)
            if total_pixels == 0 or bright_pixels / total_pixels < 0.7:
                continue

            # check aspect ratio is paper-like (A4=0.707, Letter=0.77)
            rect_w, rect_h = rect[1]
            if rect_w == 0 or rect_h == 0:
                continue
            aspect = min(rect_w, rect_h) / max(rect_w, rect_h)
            if aspect < 0.55 or aspect > 0.85:
                continue

            # order corners properly
            corners = self._order_corners(box.astype(float))
            return [(float(c[0]), float(c[1])) for c in corners]

        return None

    def _find_paper_contour(
        self, edges: np.ndarray, min_area: float, max_area: float, margin: int, h: int, w: int
    ) -> list[tuple[float, float]] | None:
        """find paper rectangle from edge image"""
        kernel = np.ones((3, 3), np.uint8)
        edges = cv2.dilate(edges, kernel, iterations=2)
        edges = cv2.erode(edges, kernel, iterations=1)

        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
            area = cv2.contourArea(contour)
            if area < min_area or area > max_area:
                continue

            # skip if touching image boundary
            x, y, cw, ch = cv2.boundingRect(contour)
            if x < margin or y < margin or x + cw > w - margin or y + ch > h - margin:
                continue

            peri = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.02 * peri, True)

            if len(approx) == 4 and self._is_roughly_rectangular(approx):
                corners = self._order_corners(approx.reshape(4, 2))
                return [(float(c[0]), float(c[1])) for c in corners]

        return None

    def _is_roughly_rectangular(self, approx: np.ndarray) -> bool:
        """check if 4-point contour is roughly rectangular (not too skewed)"""
        pts = approx.reshape(4, 2)
        # check angles are roughly 90 degrees
        for i in range(4):
            p1 = pts[i]
            p2 = pts[(i + 1) % 4]
            p3 = pts[(i + 2) % 4]
            v1 = p1 - p2
            v2 = p3 - p2
            cos_angle = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-6)
            # angle should be close to 90 degrees (cos ~= 0), allow up to 30 degree deviation
            if abs(cos_angle) > 0.5:
                return False
        return True

    def _detect_canny(self, gray: np.ndarray, low: int, high: int) -> np.ndarray:
        """standard canny edge detection"""
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        return cv2.Canny(blur, low, high)

    def _detect_adaptive_threshold(self, gray: np.ndarray) -> np.ndarray | None:
        """adaptive threshold for varying lighting conditions"""
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        thresh = cv2.adaptiveThreshold(
            blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
        )
        return cv2.Canny(thresh, 50, 150)

    def _detect_saturation(self, img: np.ndarray) -> np.ndarray | None:
        """detect paper using saturation channel (paper is usually low saturation)"""
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        sat = hsv[:, :, 1]
        _, thresh = cv2.threshold(sat, 30, 255, cv2.THRESH_BINARY_INV)
        return cv2.Canny(thresh, 50, 150)

    def _order_corners(self, pts: np.ndarray) -> np.ndarray:
        """order corners: top-left, top-right, bottom-right, bottom-left"""
        rect = np.zeros((4, 2), dtype="float32")
        s = pts.sum(axis=1)
        rect[0] = pts[np.argmin(s)]
        rect[2] = pts[np.argmax(s)]
        diff = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(diff)]
        rect[3] = pts[np.argmax(diff)]
        return rect

    def apply_perspective_correction(
        self,
        image_path: str,
        corners: list[tuple[float, float]],
        paper_size: Literal["a4", "letter"],
    ) -> tuple[str, float]:
        """warp image to top-down view and return output path + scale factor"""
        img = cv2.imread(image_path)
        src = np.array(corners, dtype="float32")

        width_mm, height_mm = PAPER_SIZES[paper_size]
        width_px = int(width_mm * PX_PER_MM)
        height_px = int(height_mm * PX_PER_MM)

        dst = np.array(
            [
                [0, 0],
                [width_px - 1, 0],
                [width_px - 1, height_px - 1],
                [0, height_px - 1],
            ],
            dtype="float32",
        )

        M = cv2.getPerspectiveTransform(src, dst)
        warped = cv2.warpPerspective(img, M, (width_px, height_px))

        base = Path(image_path)
        output_dir = base.parent.parent / "processed"
        output_path = output_dir / f"{base.stem}_corrected{base.suffix}"
        cv2.imwrite(str(output_path), warped)

        scale_factor = 1.0 / PX_PER_MM
        return str(output_path), scale_factor

    def debug_contour_detection(
        self, image_path: str, output_dir: Path
    ) -> dict:
        """run contour detection and save debug images for each step"""
        img = cv2.imread(image_path)
        if img is None:
            return {"error": "could not read image"}

        h, w = img.shape[:2]
        results = {}

        # step 1: grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        cv2.imwrite(str(output_dir / "01_gray.jpg"), gray)
        results["gray"] = "01_gray.jpg"

        # step 2: CLAHE normalized
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        normalized = clahe.apply(gray)
        cv2.imwrite(str(output_dir / "02_clahe.jpg"), normalized)
        results["clahe"] = "02_clahe.jpg"

        # step 3: blur
        blur = cv2.GaussianBlur(normalized, (7, 7), 0)
        cv2.imwrite(str(output_dir / "03_blur.jpg"), blur)
        results["blur"] = "03_blur.jpg"

        # step 4: canny edges
        edges = cv2.Canny(blur, 30, 100)
        cv2.imwrite(str(output_dir / "04_canny.jpg"), edges)
        results["canny"] = "04_canny.jpg"

        # step 5: dilate edges
        kernel = np.ones((5, 5), np.uint8)
        dilated = cv2.dilate(edges, kernel, iterations=2)
        cv2.imwrite(str(output_dir / "05_dilated.jpg"), dilated)
        results["dilated"] = "05_dilated.jpg"

        # step 6: close gaps
        closed = cv2.morphologyEx(dilated, cv2.MORPH_CLOSE, kernel, iterations=3)
        cv2.imwrite(str(output_dir / "06_closed.jpg"), closed)
        results["closed"] = "06_closed.jpg"

        # step 7: flood fill from corners
        filled = closed.copy()
        mask = np.zeros((h + 2, w + 2), np.uint8)
        cv2.floodFill(filled, mask, (0, 0), 255)
        filled_inv = cv2.bitwise_not(filled)
        final_mask = closed | filled_inv
        cv2.imwrite(str(output_dir / "07_filled.jpg"), final_mask)
        results["filled"] = "07_filled.jpg"

        # step 8: cleanup
        final_clean = cv2.morphologyEx(final_mask, cv2.MORPH_OPEN, kernel, iterations=1)
        cv2.imwrite(str(output_dir / "08_final.jpg"), final_clean)
        results["final"] = "08_final.jpg"

        # step 9: contours on original
        contours, _ = cv2.findContours(final_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contour_img = img.copy()
        cv2.drawContours(contour_img, contours, -1, (0, 255, 0), 2)
        cv2.imwrite(str(output_dir / "09_contours.jpg"), contour_img)
        results["contours"] = "09_contours.jpg"
        results["contour_count"] = len(contours)
        results["contour_areas"] = sorted([cv2.contourArea(c) for c in contours], reverse=True)[:10]

        return results

