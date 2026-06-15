#!/usr/bin/env python3
"""
Extract visual features from an image for use in Processing sketches.
Outputs JSON to stdout. Optionally writes blob SVG files to --output-dir.
"""

import sys
import os
import json
import argparse
import cv2
import numpy as np


# ── palette ────────────────────────────────────────────────────────────────────

def extract_palette(img_rgb, k=6):
    pixels = img_rgb.reshape(-1, 3).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centers = cv2.kmeans(pixels, k, None, criteria, 10, cv2.KMEANS_RANDOM_CENTERS)
    centers = centers.astype(int)
    counts = np.bincount(labels.flatten(), minlength=k)
    total = counts.sum()
    order = np.argsort(-counts)
    palette = []
    for i in order:
        palette.append({
            "r": int(centers[i][0]),
            "g": int(centers[i][1]),
            "b": int(centers[i][2]),
            "weight": round(float(counts[i]) / total, 4),
        })
    return palette


# ── edge contours ──────────────────────────────────────────────────────────────

def extract_contours(img_gray, img_w, img_h, max_contours=20, epsilon_factor=0.005):
    blurred = cv2.GaussianBlur(img_gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 30, 100)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:max_contours]
    result = []
    for c in contours:
        if len(c) < 3:
            continue
        epsilon = epsilon_factor * cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, epsilon, False)
        if len(approx) < 2:
            continue
        points = [
            [round(float(p[0][0]) / img_w, 4), round(float(p[0][1]) / img_h, 4)]
            for p in approx
        ]
        result.append(points)
    return result


# ── blob SVG extraction ────────────────────────────────────────────────────────

def _catmull_to_svg(pts):
    """Convert a closed polygon to a smooth cubic-bezier SVG path via Catmull-Rom."""
    n = len(pts)
    if n < 3:
        segs = [f"M {pts[0][0]},{pts[0][1]}"]
        for p in pts[1:]:
            segs.append(f"L {p[0]},{p[1]}")
        return " ".join(segs) + " Z"

    segs = [f"M {pts[0][0]},{pts[0][1]}"]
    for i in range(n):
        p0 = pts[(i - 1) % n]
        p1 = pts[i % n]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n]
        cp1x = round(p1[0] + (p2[0] - p0[0]) / 6, 1)
        cp1y = round(p1[1] + (p2[1] - p0[1]) / 6, 1)
        cp2x = round(p2[0] - (p3[0] - p1[0]) / 6, 1)
        cp2y = round(p2[1] - (p3[1] - p1[1]) / 6, 1)
        segs.append(f"C {cp1x},{cp1y} {cp2x},{cp2y} {p2[0]},{p2[1]}")
    segs.append("Z")
    return " ".join(segs)


MORPH_N = 64  # fixed point count for every blob — enables direct lerp morphing

def _resample_contour(contour, img_w, img_h, n=MORPH_N):
    """
    Resample a raw contour (CHAIN_APPROX_NONE) to exactly n equally arc-length-spaced
    points, normalised to 0–1 image coordinates.
    Same n for every blob so Processing can lerp point-by-point between any two.
    """
    pts = contour.reshape(-1, 2).astype(float)
    diffs = np.diff(pts, axis=0)
    seg_lens = np.sqrt((diffs ** 2).sum(axis=1))
    cum = np.concatenate([[0.0], np.cumsum(seg_lens)])
    total = cum[-1]
    if total < 1e-6:
        p0 = [round(float(pts[0][0]) / img_w, 4), round(float(pts[0][1]) / img_h, 4)]
        return [p0] * n

    targets = np.linspace(0.0, total, n, endpoint=False)
    result = []
    for d in targets:
        idx = int(np.searchsorted(cum, d, side="right")) - 1
        idx = max(0, min(idx, len(pts) - 2))
        seg = cum[idx + 1] - cum[idx]
        t = (d - cum[idx]) / seg if seg > 1e-8 else 0.0
        p = pts[idx] + t * (pts[idx + 1] - pts[idx])
        result.append([round(float(p[0]) / img_w, 4), round(float(p[1]) / img_h, 4)])
    return result


def extract_blob_svgs(img_bgr, img_gray, img_w, img_h, max_blobs=8, output_dir=None):
    """
    Detect filled blob regions, vectorize each outline as a smooth SVG,
    and write blob_N.svg files into output_dir if provided.
    Returns metadata list.
    """
    blurred = cv2.GaussianBlur(img_gray, (7, 7), 0)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # External contours only — blob outlines
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)

    total_area = img_w * img_h
    result = []

    for c in contours:
        if len(result) >= max_blobs:
            break

        area = cv2.contourArea(c)
        norm_area = area / total_area
        if norm_area < 0.002 or norm_area > 0.95:
            continue

        x, y, w, h = cv2.boundingRect(c)
        if w < 8 or h < 8:
            continue

        # Simplify – keep enough points for a smooth curve
        epsilon = 0.006 * cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, epsilon, True)
        if len(approx) < 3:
            continue

        # Coordinates relative to bounding box
        pts = [(int(p[0][0]) - x, int(p[0][1]) - y) for p in approx]
        path_d = _catmull_to_svg(pts)

        # Dominant colour inside this blob
        mask = np.zeros(img_gray.shape, dtype=np.uint8)
        cv2.drawContours(mask, [c], -1, 255, -1)
        mean_bgr = cv2.mean(img_bgr, mask=mask)
        r, g, b = int(mean_bgr[2]), int(mean_bgr[1]), int(mean_bgr[0])

        filename = f"blob_{len(result)}.svg"

        if output_dir:
            svg = (
                '<?xml version="1.0" encoding="UTF-8"?>\n'
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">\n'
                f'  <path d="{path_d}" fill="rgb({r},{g},{b})" stroke="none"/>\n'
                '</svg>\n'
            )
            with open(os.path.join(output_dir, filename), "w") as f:
                f.write(svg)

        result.append({
            "filename": filename,
            "svgWidth": w,
            "svgHeight": h,
            "cx": round((x + w / 2) / img_w, 4),
            "cy": round((y + h / 2) / img_h, 4),
            "area": round(norm_area, 4),
            "color": {"r": r, "g": g, "b": b},
            "morphPoints": _resample_contour(c, img_w, img_h, MORPH_N),
        })

    return result


# ── main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("image", help="Path to input image")
    parser.add_argument("--palette", type=int, default=6)
    parser.add_argument("--contours", type=int, default=20)
    parser.add_argument("--blobs", type=int, default=8)
    parser.add_argument("--output-dir", default=None,
                        help="Directory to write blob_N.svg files into")
    args = parser.parse_args()

    img_bgr = cv2.imread(args.image)
    if img_bgr is None:
        print(json.dumps({"error": f"Cannot read image: {args.image}"}))
        sys.exit(1)

    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    img_gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    h, w = img_bgr.shape[:2]

    result = {
        "imageWidth": w,
        "imageHeight": h,
        "palette": extract_palette(img_rgb, args.palette),
        "contours": extract_contours(img_gray, w, h, args.contours),
        "blobSvgs": extract_blob_svgs(img_bgr, img_gray, w, h, args.blobs, args.output_dir),
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
